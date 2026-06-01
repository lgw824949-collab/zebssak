'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'

const MATCH_TIMEOUT_SECONDS = 30

interface MatchGuideState {
  carNumber: number | null
  carDoorShort: string | null
  lineLabel: string | null
  destinationName: string | null
}

/**
 * sessionStorage → URL searchParams 순으로 matchId를 조회합니다.
 */
function resolveMatchId(matchIdFromUrl: string | null): string | null {
  const fromStorage = sessionStorage.getItem('activeMatchId')?.trim()
  if (fromStorage) {
    return fromStorage
  }

  const fromUrl = matchIdFromUrl?.trim()
  if (!fromUrl) {
    return null
  }

  sessionStorage.setItem('activeMatchId', fromUrl)
  return fromUrl
}

/**
 * 매칭 알림 화면 — 30초 내 수락/거절
 */
function MatchingForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [secondsLeft, setSecondsLeft] = useState(MATCH_TIMEOUT_SECONDS)
  const [guide, setGuide] = useState<MatchGuideState>({
    carNumber: null,
    carDoorShort: null,
    lineLabel: null,
    destinationName: null,
  })
  const [actionError, setActionError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const expireRequestedRef = useRef(false)
  const actionHandledRef = useRef(false)

  const goToWaiting = useCallback(() => {
    router.replace('/waiting')
  }, [router])

  const expireMatchOnTimeout = useCallback(async () => {
    if (expireRequestedRef.current || actionHandledRef.current) {
      return
    }
    expireRequestedRef.current = true

    const token = localStorage.getItem('token')
    const matchId = resolveMatchId(searchParams.get('matchId'))

    if (token && matchId) {
      try {
        await fetch(`/api/matches/${encodeURIComponent(matchId)}/expire`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        })
      } catch {
        // 만료 API 실패 시에도 대기 화면으로 이동
      }
    }

    goToWaiting()
  }, [goToWaiting, searchParams])

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) {
      router.replace('/login')
      return
    }

    const matchId = resolveMatchId(searchParams.get('matchId'))

    async function loadPartnerGuide() {
      if (!matchId) return

      try {
        const response = await fetch(`/api/matches/${encodeURIComponent(matchId)}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        const result = (await response.json()) as {
          success?: boolean
          data?: {
            partner?: {
              car_number?: number | null
              car_door_short?: string | null
              line_label?: string | null
              destination_station_name?: string
            }
          }
        }

        if (!response.ok || !result.success || !result.data?.partner) {
          return
        }

        const partner = result.data.partner
        setGuide({
          carNumber:
            typeof partner.car_number === 'number' ? partner.car_number : null,
          carDoorShort:
            typeof partner.car_door_short === 'string'
              ? partner.car_door_short
              : null,
          lineLabel:
            typeof partner.line_label === 'string' ? partner.line_label : null,
          destinationName:
            typeof partner.destination_station_name === 'string'
              ? partner.destination_station_name
              : null,
        })
      } catch {
        // 상대방 안내 로드 실패 시 칸 번호만 비워 둡니다.
      }
    }

    void loadPartnerGuide()
  }, [router, searchParams])

  useEffect(() => {
    if (actionHandledRef.current) {
      return
    }

    if (secondsLeft <= 0) {
      void expireMatchOnTimeout()
      return
    }

    const timerId = window.setInterval(() => {
      setSecondsLeft((prev) => prev - 1)
    }, 1000)

    return () => window.clearInterval(timerId)
  }, [secondsLeft, expireMatchOnTimeout])

  const submitMatchAction = useCallback(
    async (action: 'accept' | 'reject') => {
      if (actionHandledRef.current || isSubmitting) {
        return
      }

      const token = localStorage.getItem('token')
      const matchId = resolveMatchId(searchParams.get('matchId'))

      if (!token) {
        router.replace('/login')
        return
      }

      if (!matchId) {
        setActionError('매칭 정보를 찾을 수 없습니다.')
        return
      }

      actionHandledRef.current = true
      setIsSubmitting(true)
      setActionError('')

      try {
        const response = await fetch(
          `/api/matches/${encodeURIComponent(matchId)}`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ action }),
          }
        )

        const result = (await response.json()) as {
          success?: boolean
          error?: string
        }

        if (!response.ok || !result.success) {
          actionHandledRef.current = false
          setActionError(result.error ?? '요청 처리에 실패했습니다.')
          return
        }

        if (action === 'accept') {
          router.push('/matched')
        } else {
          goToWaiting()
        }
      } catch {
        actionHandledRef.current = false
        setActionError('네트워크 오류가 발생했습니다.')
      } finally {
        setIsSubmitting(false)
      }
    },
    [goToWaiting, isSubmitting, router, searchParams]
  )

  function handleAccept() {
    void submitMatchAction('accept')
  }

  function handleReject() {
    void submitMatchAction('reject')
  }

  const progressPercent = (secondsLeft / MATCH_TIMEOUT_SECONDS) * 100
  const isUrgent = secondsLeft <= 10

  return (
    <div className="zeb-page matching-theme flex flex-col">
      <header className="zeb-page-header" aria-hidden>
        <div className="space-y-2">
          <div className="zeb-track zeb-track--line1" />
          <div className="zeb-track zeb-track--line2" />
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center py-4">
        <div className="zeb-card w-full text-center zeb-bg-line1-light">
          <div
            className="mx-auto mb-6 flex items-center justify-center rounded-full"
            style={{
              width: '4.5rem',
              height: '4.5rem',
              background: 'var(--line-s2-light)',
            }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              width={36}
              height={36}
              aria-hidden
              style={{ color: 'var(--line-s2)' }}
            >
              <path
                fillRule="evenodd"
                d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z"
                clipRule="evenodd"
              />
            </svg>
          </div>

          <h1 className="zeb-page-title" style={{ fontSize: 'var(--font-size-2xl)' }}>
            매칭 성공!
          </h1>
          <p className="zeb-page-desc mt-3">
            하차 예정 승객과 매칭되었습니다.
            <br />
            아래 칸으로 이동해주세요.
          </p>

          <div
            className="mt-8 rounded-[var(--radius-button)] border-2 px-4 py-5"
            style={{
              background: 'var(--surface)',
              borderColor: 'var(--line-1)',
            }}
          >
            <p
              className="font-semibold zeb-text-line1"
              style={{ fontSize: 'var(--font-size-base)' }}
            >
              이동 안내 (하차 예정 승객)
            </p>
            {guide.lineLabel ? (
              <p className="zeb-caption mt-2">{guide.lineLabel}</p>
            ) : null}
            {guide.destinationName ? (
              <p className="zeb-caption mt-1">
                하차 역 · {guide.destinationName}
              </p>
            ) : null}
            <p
              className="zeb-text-line1 mt-2"
              style={{ fontSize: 'var(--font-size-3xl)', fontWeight: 800, lineHeight: 1.2 }}
            >
              {guide.carNumber != null ? `${guide.carNumber}호차` : '—호차'}
            </p>
            {guide.carDoorShort ? (
              <p
                className="zeb-text-line1 mt-2"
                style={{ fontSize: 'var(--font-size-xl)', fontWeight: 800 }}
              >
                {guide.carDoorShort}번 문 옆
              </p>
            ) : null}
          </div>

          <div className="mt-8">
            <p className="zeb-label" style={{ marginBottom: '0.5rem' }}>
              수락 남은 시간
            </p>
            <p
              className="tabular-nums"
              style={{
                fontSize: '3.25rem',
                fontWeight: 800,
                lineHeight: 1,
                color: isUrgent ? 'var(--color-danger)' : 'var(--foreground)',
              }}
            >
              {secondsLeft}
              <span style={{ fontSize: 'var(--font-size-2xl)' }}>초</span>
            </p>
            <div
              className="mt-4 w-full overflow-hidden"
              style={{
                height: 'var(--track-height)',
                borderRadius: 'var(--radius-pill)',
                background: 'var(--border)',
              }}
              role="progressbar"
              aria-valuenow={secondsLeft}
              aria-valuemin={0}
              aria-valuemax={MATCH_TIMEOUT_SECONDS}
              aria-label="수락 남은 시간"
            >
              <div
                style={{
                  height: '100%',
                  width: `${progressPercent}%`,
                  borderRadius: 'inherit',
                  background: isUrgent ? 'var(--color-danger)' : 'var(--line-1)',
                  transition: 'width 1s linear, background-color 0.2s ease',
                }}
              />
            </div>
            <div className="mt-4 flex justify-center gap-2" aria-hidden>
              <span
                className={`zeb-station-dot zeb-station-dot--line1 ${isUrgent ? '' : 'animate-pulse'}`}
              />
              <span className="zeb-station-dot zeb-station-dot--line2" />
              <span className="zeb-station-dot zeb-station-dot--lines2" />
            </div>
            <p className="zeb-caption mt-3">
              30초 내 미응답 시 대기 화면으로 돌아갑니다.
            </p>
          </div>
        </div>
      </main>

      <footer
        className="mt-auto pt-6"
        style={{ borderTop: '2px solid var(--border)' }}
      >
        <div className="space-y-3">
          {actionError && (
            <div className="zeb-alert zeb-alert--danger">{actionError}</div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={handleReject}
              disabled={isSubmitting}
              className="zeb-btn zeb-btn--secondary"
            >
              {isSubmitting ? '처리 중...' : '거절'}
            </button>
            <button
              type="button"
              onClick={handleAccept}
              disabled={isSubmitting}
              className="zeb-btn zeb-btn--line1"
            >
              {isSubmitting ? '처리 중...' : '수락'}
            </button>
          </div>
        </div>
      </footer>
      <style jsx global>{`
        .matching-theme {
          background: #f7f8fa !important;
          color: #1a1a1a !important;
        }
        .matching-theme .zeb-card {
          background: #ffffff !important;
          border: 0.5px solid #ebebeb !important;
          border-radius: 16px !important;
          box-shadow: 0 2px 10px rgba(26, 26, 26, 0.05) !important;
        }
        .matching-theme .zeb-page-title,
        .matching-theme .zeb-label,
        .matching-theme .zeb-text-line1 {
          color: #747F00 !important;
        }
        .matching-theme .zeb-alert--danger {
          border-radius: 16px !important;
        }
        .matching-theme .zeb-btn {
          border-radius: 16px !important;
        }
        .matching-theme .zeb-btn--line1 {
          background: #747F00 !important;
          color: #ffffff !important;
        }
        .matching-theme .zeb-btn--secondary {
          background: #ffffff !important;
          border: 0.5px solid #ebebeb !important;
          color: #1a1a1a !important;
        }
      `}</style>
    </div>
  )
}

export default function MatchingPage() {
  return (
    <Suspense
      fallback={
        <div className="zeb-page flex items-center justify-center">
          <p className="zeb-caption" style={{ fontSize: 'var(--font-size-lg)' }}>
            로딩 중...
          </p>
        </div>
      }
    >
      <MatchingForm />
    </Suspense>
  )
}
