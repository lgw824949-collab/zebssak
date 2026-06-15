'use client'

import MatchMovementPanel from '@/components/MatchMovementPanel'
import type { MatchMovementPayload } from '@/lib/match-movement'
import { clearMatchClientSession } from '@/lib/match-session'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'

const MATCH_TIMEOUT_SECONDS = 30
const PENDING_MATCH_POLL_MS = 2000
const MATCH_MOVEMENT_POLL_MS = 3000
const MATCH_STATUS_CONFLICT_REDIRECT_MS = 1200

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

/** 수락 완료 SSE 구독 — type: accepted 수신 시 콜백 호출 */
async function subscribeMatchAcceptSse(
  matchId: string,
  token: string,
  onAccepted: (matchId: string) => void,
  onError: (message: string) => void,
  signal: AbortSignal
): Promise<void> {
  try {
    const response = await fetch(
      `/api/matches/${encodeURIComponent(matchId)}?sse=accept`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal,
      }
    )

    if (signal.aborted) {
      return
    }

    if (!response.ok || !response.body) {
      onError('수락 알림 연결에 실패했습니다.')
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      buffer += decoder.decode(value, { stream: true })
      const chunks = buffer.split('\n\n')
      buffer = chunks.pop() ?? ''

      for (const chunk of chunks) {
        const line = chunk.split('\n').find((entry) => entry.startsWith('data: '))
        if (!line) continue

        try {
          const payload = JSON.parse(line.slice(6)) as {
            type?: string
            match_id?: string
            message?: string
          }

          if (payload.type === 'accepted' && payload.match_id) {
            onAccepted(payload.match_id)
            return
          }
          if (payload.type === 'error' && payload.message) {
            onError(payload.message)
            return
          }
        } catch {
          onError('수락 알림 메시지 처리에 실패했습니다.')
          return
        }
      }
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return
    }
    if (signal.aborted) {
      return
    }
    onError('수락 알림 연결에 실패했습니다.')
  }
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
  const [viewerRole, setViewerRole] = useState<'seeker' | 'provider' | null>(null)
  const partnerAcceptedNotice = false
  const [actionError, setActionError] = useState('')
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isDismissed, setIsDismissed] = useState(false)
  const [isNavigatingToMatched, setIsNavigatingToMatched] = useState(false)
  const [movement, setMovement] = useState<MatchMovementPayload | null>(null)
  const [isUpdatingMovement, setIsUpdatingMovement] = useState(false)
  const expireRequestedRef = useRef(false)
  const actionHandledRef = useRef(false)
  const acceptNavigateScheduledRef = useRef(false)

  /** 거절·이탈 시 등록 관련 session 전체 정리 */
  const clearMatchRegistrationSession = useCallback(() => {
    clearMatchClientSession()
  }, [])

  /** 매칭 상세에서 본인 요청 ID를 조회합니다. */
  const resolveSelfRequestId = useCallback(
    async (token: string, activeMatchId: string): Promise<string | null> => {
      const fromSession = sessionStorage.getItem('activeMatchRequestId')?.trim()
      if (fromSession) {
        return fromSession
      }

      try {
        const response = await fetch(`/api/matches/${encodeURIComponent(activeMatchId)}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        const result = (await response.json()) as {
          success?: boolean
          data?: { self?: { request_id?: string } }
        }

        if (!response.ok || !result.success) {
          return null
        }

        const requestId = result.data?.self?.request_id?.trim()
        return requestId || null
      } catch {
        return null
      }
    },
    []
  )

  const goToWaiting = useCallback(() => {
    router.replace('/waiting')
  }, [router])

  const goToMatched = useCallback(
    (matchId: string) => {
      if (acceptNavigateScheduledRef.current) {
        return
      }
      acceptNavigateScheduledRef.current = true
      setIsNavigatingToMatched(true)
      sessionStorage.setItem('activeMatchId', matchId)
      router.replace('/matched')
    },
    [router]
  )

  /** pending이 아닌 매칭 — 토스트 후 홈으로 이동 */
  const handleMatchStatusConflict = useCallback((message: string) => {
    setToastMessage(message)
    setIsDismissed(true)
    clearMatchRegistrationSession()
    window.setTimeout(() => {
      window.location.href = '/'
    }, MATCH_STATUS_CONFLICT_REDIRECT_MS)
  }, [clearMatchRegistrationSession])

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
    if (!matchId) {
      return
    }
    const resolvedMatchId = matchId

    let cancelled = false

    async function refreshMatchDetail() {
      if (cancelled) {
        return
      }

      try {
        const response = await fetch(
          `/api/matches/${encodeURIComponent(resolvedMatchId)}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
          }
        )
        const result = (await response.json()) as {
          success?: boolean
          data?: {
            status?: string
            viewer_role?: 'seeker' | 'provider'
            movement?: MatchMovementPayload
            partner?: {
              car_number?: number | null
              car_door_short?: string | null
              line_label?: string | null
              destination_station_name?: string
            }
            self?: {
              car_number?: number | null
              car_door_short?: string | null
              line_label?: string | null
              destination_station_name?: string
            }
          }
        }

        if (!response.ok || !result.success || !result.data) {
          return
        }

        const role = result.data.viewer_role
        if (role === 'seeker' || role === 'provider') {
          setViewerRole(role)
        }

        if (result.data.movement) {
          setMovement(result.data.movement)
        }

        const matchStatus = result.data.status

        if (matchStatus === 'accepted') {
          goToMatched(resolvedMatchId)
          return
        }

        if (matchStatus === 'cancelled' || matchStatus === 'expired') {
          clearMatchRegistrationSession()
          window.location.href = '/'
          return
        }

        if (matchStatus !== 'pending') {
          handleMatchStatusConflict('처리할 수 없는 매칭 상태입니다.')
          return
        }

        const guideSource =
          role === 'provider' ? result.data.self : result.data.partner
        if (!guideSource) {
          return
        }

        setGuide({
          carNumber:
            typeof guideSource.car_number === 'number' ? guideSource.car_number : null,
          carDoorShort:
            typeof guideSource.car_door_short === 'string'
              ? guideSource.car_door_short
              : null,
          lineLabel:
            typeof guideSource.line_label === 'string' ? guideSource.line_label : null,
          destinationName:
            typeof guideSource.destination_station_name === 'string'
              ? guideSource.destination_station_name
              : null,
        })
      } catch {
        // 상대방 안내 로드 실패 시 칸 번호만 비워 둡니다.
      }
    }

    void refreshMatchDetail()
    const timerId = window.setInterval(() => {
      void refreshMatchDetail()
    }, MATCH_MOVEMENT_POLL_MS)

    return () => {
      cancelled = true
      window.clearInterval(timerId)
    }
  }, [clearMatchRegistrationSession, goToMatched, handleMatchStatusConflict, router, searchParams])

  const submitMovementStatus = useCallback(
    async (status: 'moving' | 'arrived') => {
      const token = localStorage.getItem('token')
      const matchId = resolveMatchId(searchParams.get('matchId'))

      if (!token || !matchId || viewerRole !== 'seeker') {
        return
      }

      setIsUpdatingMovement(true)

      try {
        const response = await fetch(
          `/api/matches/${encodeURIComponent(matchId)}/movement-status`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ status }),
          }
        )

        const result = (await response.json()) as {
          success?: boolean
          data?: { status?: 'moving' | 'arrived' }
        }

        if (!response.ok || !result.success || !result.data?.status) {
          setActionError('이동 상태 전송에 실패했습니다.')
          return
        }

        setMovement((prev) =>
          prev
            ? {
                ...prev,
                self: {
                  status: result.data!.status!,
                  updated_at: new Date().toISOString(),
                },
              }
            : prev
        )
        setActionError('')
      } catch {
        setActionError('이동 상태 전송 중 오류가 발생했습니다.')
      } finally {
        setIsUpdatingMovement(false)
      }
    },
    [searchParams, viewerRole]
  )

  // sessionStorage에 matchId만 있을 때 URL을 맞춥니다.
  useEffect(() => {
    const matchId = resolveMatchId(searchParams.get('matchId'))
    if (!matchId || searchParams.get('matchId')) {
      return
    }

    router.replace(`/matching?matchId=${encodeURIComponent(matchId)}`)
  }, [router, searchParams])

  // 매칭 대기 중 pending 매칭이 생기면 /matching으로 이동합니다.
  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) {
      return
    }

    let cancelled = false

    async function pollPendingMatch() {
      if (cancelled) {
        return
      }

      const currentMatchId = resolveMatchId(searchParams.get('matchId'))
      if (currentMatchId) {
        return
      }

      const requestId = sessionStorage.getItem('activeMatchRequestId')?.trim()
      if (!requestId) {
        return
      }

      try {
        const response = await fetch(
          `/api/match-requests/status?request_id=${encodeURIComponent(requestId)}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
          }
        )

        if (!response.ok) {
          return
        }

        const result = (await response.json()) as {
          success?: boolean
          data?: {
            match?: { id?: string; status?: string } | null
          }
        }

        if (!result.success || !result.data?.match?.id) {
          return
        }

        if (result.data.match.status !== 'pending') {
          return
        }

        sessionStorage.setItem('activeMatchId', result.data.match.id)
        router.replace(
          `/matching?matchId=${encodeURIComponent(result.data.match.id)}`
        )
      } catch {
        // 폴링 실패 시 다음 주기에 재시도합니다.
      }
    }

    void pollPendingMatch()
    const timerId = window.setInterval(() => {
      void pollPendingMatch()
    }, PENDING_MATCH_POLL_MS)

    return () => {
      cancelled = true
      window.clearInterval(timerId)
    }
  }, [router, searchParams])

  useEffect(() => {
    const token = localStorage.getItem('token')
    const matchId = resolveMatchId(searchParams.get('matchId'))
    if (!token || !matchId || !viewerRole || actionHandledRef.current || isDismissed) {
      return
    }

    const abortController = new AbortController()

    void subscribeMatchAcceptSse(
      matchId,
      token,
      (acceptedMatchId) => {
        goToMatched(acceptedMatchId)
      },
      (message) => {
        setActionError(message)
      },
      abortController.signal
    ).catch(() => {
      // Strict Mode cleanup abort — 무시
    })

    return () => {
      abortController.abort()
    }
  }, [goToMatched, isDismissed, searchParams, viewerRole])

  useEffect(() => {
    if (actionHandledRef.current || isDismissed) {
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
  }, [secondsLeft, expireMatchOnTimeout, isDismissed])

  const submitMatchAction = useCallback(
    async (action: 'accept' | 'reject') => {
      if (actionHandledRef.current || isSubmitting || isDismissed) {
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
      setActionError('')

      if (action === 'reject') {
        setIsDismissed(true)
        setIsSubmitting(true)

        const requestId =
          (await resolveSelfRequestId(token, matchId)) ??
          sessionStorage.getItem('activeMatchRequestId')?.trim() ??
          ''

        try {
          await fetch(`/api/matches/${encodeURIComponent(matchId)}`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ action }),
          })
        } catch {
          // 매칭 거절 API 실패 시에도 요청 취소를 시도합니다.
        }

        try {
          if (requestId) {
            await fetch('/api/match-requests/status', {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ request_id: requestId, status: 'cancelled' }),
            })
          }
        } catch {
          // 요청 취소 API 실패 시에도 홈으로 이동합니다.
        } finally {
          clearMatchRegistrationSession()
          window.location.href = '/'
        }
        return
      }

      setIsSubmitting(true)

      try {
        const res = await fetch(
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

        const result = (await res.json()) as {
          success?: boolean
          error?: string
          code?: string
          data?: {
            match_id?: string
            status?: string
          }
        }

        if (!res.ok) {
          handleMatchStatusConflict(
            result.error ?? '처리할 수 없는 매칭 상태입니다.'
          )
          return
        }

        goToMatched(result.data?.match_id ?? matchId)
      } catch {
        actionHandledRef.current = false
        setActionError('네트워크 오류가 발생했습니다.')
      } finally {
        setIsSubmitting(false)
      }
    },
    [
      clearMatchRegistrationSession,
      goToMatched,
      handleMatchStatusConflict,
      isDismissed,
      isSubmitting,
      resolveSelfRequestId,
      router,
      searchParams,
    ]
  )

  function handleAccept() {
    void submitMatchAction('accept')
  }

  function handleReject() {
    void submitMatchAction('reject')
  }

  if (isNavigatingToMatched) {
    return null
  }

  if (isDismissed) {
    return (
      <div className="zeb-page matching-theme flex min-h-dvh items-center justify-center">
        {toastMessage ? (
          <p className="fixed bottom-6 left-1/2 z-30 -translate-x-1/2 rounded-full bg-gray-800 px-4 py-2 text-sm text-white">
            {toastMessage}
          </p>
        ) : null}
        <p className="text-sm font-medium text-[#6B7280]">대기 화면으로 이동 중…</p>
      </div>
    )
  }

  const progressPercent = (secondsLeft / MATCH_TIMEOUT_SECONDS) * 100
  const isUrgent = secondsLeft <= 10

  return (
    <div className="zeb-page matching-theme flex flex-col">
      {toastMessage ? (
        <p className="fixed bottom-6 left-1/2 z-30 -translate-x-1/2 rounded-full bg-gray-800 px-4 py-2 text-sm text-white">
          {toastMessage}
        </p>
      ) : null}
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
            {viewerRole === 'provider' ? (
              <>
                착석 희망자와 매칭되었습니다.
                <br />
                자리를 넘기려면 승낙을 눌러주세요.
              </>
            ) : (
              <>
                하차 예정 승객과 매칭되었습니다.
                <br />
                아래 칸으로 이동한 뒤 승낙해주세요.
              </>
            )}
          </p>

          {partnerAcceptedNotice ? (
            <div
              className="mt-4 rounded-[var(--radius-button)] border-2 px-4 py-4"
              style={{
                background: 'var(--surface)',
                borderColor: 'var(--line-1)',
              }}
              role="status"
            >
              <p
                className="font-semibold zeb-text-line1"
                style={{ fontSize: 'var(--font-size-lg)' }}
              >
                상대방이 수락했습니다
              </p>
              <p className="zeb-caption mt-2">잠시 후 완료 화면으로 이동합니다.</p>
            </div>
          ) : null}

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
              {viewerRole === 'provider'
                ? '내 자리 (양보 예정)'
                : '이동 안내 (하차 예정 승객)'}
            </p>
            {guide.lineLabel ? (
              <p className="zeb-caption mt-2">{guide.lineLabel}</p>
            ) : null}
            {guide.destinationName ? (
              <p className="zeb-caption mt-1">하차 역 · {guide.destinationName}</p>
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

          {movement && viewerRole ? (
            <div className="mt-6 text-left">
              <MatchMovementPanel
                viewerRole={viewerRole}
                movement={movement}
                isUpdating={isUpdatingMovement}
                onStartMoving={() => void submitMovementStatus('moving')}
                onArrived={() => void submitMovementStatus('arrived')}
              />
            </div>
          ) : null}

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
              disabled={isSubmitting || partnerAcceptedNotice || isDismissed}
              className="zeb-btn zeb-btn--secondary"
            >
              {isSubmitting ? '처리 중...' : '거절'}
            </button>
            <button
              type="button"
              onClick={handleAccept}
              disabled={isSubmitting || partnerAcceptedNotice || isDismissed}
              className="zeb-btn zeb-btn--line1"
            >
              {isSubmitting ? '처리 중...' : '승낙'}
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
