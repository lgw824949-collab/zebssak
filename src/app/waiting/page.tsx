'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { handleUnauthorizedResponse } from '@/lib/auth-client'
import { subscribeMatchRealtime } from '@/lib/match-realtime'

type BoardingLineKey =
  | 'line1'
  | 'line2'
  | 's2'
  | 'seoul1'
  | 'seoul1_incheon'
  | 'seoul1_cheonan'
  | 'seoul2'
  | 'seoul3'
  | 'seoul4'
  | 'seoul5'
  | 'seoul6'
  | 'seoul7'
  | 'seoul8'
  | 'seoul9'
  | 'incheon1'
  | 'incheon2'

interface BoardingDraft {
  role: string
  lineKey?: BoardingLineKey
  lineLabel?: string
  lineNumber: number
  trainNo: string
  carNumber: number
  direction?: string | number
  boardingStationId?: string
  boardingStationName?: string
  destinationId: string
  destinationName: string
  remainingStations: number
  seatSide?: 'A' | 'B'
  seatNumber?: number
  seat_side?: 'A' | 'B'
  seat_number?: number
}

interface StoredUser {
  username?: string
  nickname?: string | null
  is_vulnerable?: boolean
}

const WAITING_DRAFT_KEY = 'waitingDraft'
const ACTIVE_REQUEST_KEY = 'activeMatchRequestId'
const REGISTERED_FLAG_KEY = 'seekerMatchRequestRegistered'

/**
 * sessionStorage에서 탑승 draft를 읽습니다.
 */
function loadBoardingDraft(): BoardingDraft | null {
  const raw =
    sessionStorage.getItem('boardingDraft') ??
    sessionStorage.getItem(WAITING_DRAFT_KEY)
  if (!raw) return null

  try {
    return JSON.parse(raw) as BoardingDraft
  } catch {
    return null
  }
}

/** draft에서 좌석 정보 추출 (seeker API 필수) */
function resolveSeatFromDraft(
  draft: BoardingDraft
): { seatSide: 'A' | 'B'; seatNumber: number } | null {
  const seatSide = draft.seatSide ?? draft.seat_side
  const seatNumberRaw = draft.seatNumber ?? draft.seat_number
  const seatNumber =
    typeof seatNumberRaw === 'number' ? seatNumberRaw : Number(seatNumberRaw)

  if (
    (seatSide === 'A' || seatSide === 'B') &&
    Number.isInteger(seatNumber) &&
    seatNumber >= 1
  ) {
    return { seatSide, seatNumber }
  }

  return null
}

/** draft 호선에 맞는 노선 트랙 클래스 */
function getTrackClass(draft: BoardingDraft): string {
  if (
    draft.lineKey === 's2' ||
    draft.lineKey === 'seoul2' ||
    draft.lineKey === 'incheon2'
  ) {
    return 'zeb-track zeb-track--lines2'
  }
  if (
    draft.lineKey === 'line1' ||
    draft.lineKey === 'seoul1' ||
    draft.lineKey === 'seoul1_incheon' ||
    draft.lineKey === 'seoul1_cheonan' ||
    draft.lineKey === 'incheon1' ||
    draft.lineNumber === 1
  ) {
    return 'zeb-track zeb-track--line1'
  }
  return 'zeb-track zeb-track--line2'
}

/** draft 호선에 맞는 배지 클래스 */
function getLineBadgeClass(draft: BoardingDraft): string {
  if (
    draft.lineKey === 's2' ||
    draft.lineKey === 'seoul2' ||
    draft.lineKey === 'incheon2'
  ) {
    return 'zeb-line-badge zeb-line-badge--s2'
  }
  if (
    draft.lineKey === 'line1' ||
    draft.lineKey === 'seoul1' ||
    draft.lineKey === 'seoul1_incheon' ||
    draft.lineKey === 'seoul1_cheonan' ||
    draft.lineKey === 'incheon1' ||
    draft.lineNumber === 1
  ) {
    return 'zeb-line-badge zeb-line-badge--1'
  }
  return 'zeb-line-badge zeb-line-badge--2'
}

function normalizeDirection(raw: string | number | undefined): string {
  const value = String(raw ?? '').trim()
  if (value === '1' || value === '상행' || value === '내선') return '1'
  if (value === '2' || value === '하행' || value === '외선') return '2'
  return ''
}

/** 대기 등록 API용 direction 값을 보정합니다. */
function resolveRequestDirection(draft: BoardingDraft): string {
  const normalized = normalizeDirection(draft.direction)
  if (normalized) return normalized

  if (draft.lineKey === 'seoul1') return '1'
  if (draft.lineKey === 'seoul1_incheon' || draft.lineKey === 'seoul1_cheonan') return '2'

  const boardingOrder = Number.parseInt(
    String(draft.boardingStationId ?? '').match(/-(\d+)$/)?.[1] ?? '',
    10
  )
  const destinationOrder = Number.parseInt(
    String(draft.destinationId ?? '').match(/-(\d+)$/)?.[1] ?? '',
    10
  )
  if (Number.isFinite(boardingOrder) && Number.isFinite(destinationOrder)) {
    if (destinationOrder > boardingOrder) return '2'
    if (destinationOrder < boardingOrder) return '1'
  }

  // 방향 정보가 없는 구버전 draft 호환값
  return '2'
}

function getDirectionDisplay(draft: BoardingDraft): string {
  const direction = normalizeDirection(draft.direction)
  const lineKey = draft.lineKey

  if (lineKey === 'seoul1' || lineKey === 'seoul1_incheon' || lineKey === 'seoul1_cheonan') {
    return direction === '1' ? '소요산 방면' : direction === '2' ? '인천·신창 방면' : ''
  }
  if (lineKey === 'seoul2' || lineKey === 's2') {
    return direction === '1' ? '내선순환' : direction === '2' ? '외선순환' : ''
  }
  if (lineKey === 'seoul3') return direction === '1' ? '대화 방면' : direction === '2' ? '오금 방면' : ''
  if (lineKey === 'seoul4') return direction === '1' ? '당고개 방면' : direction === '2' ? '오이도 방면' : ''
  if (lineKey === 'seoul5') return direction === '1' ? '방화 방면' : direction === '2' ? '마천 방면' : ''
  if (lineKey === 'seoul6') return direction === '1' ? '응암순환' : ''
  if (lineKey === 'seoul7') return direction === '1' ? '장암 방면' : direction === '2' ? '부천종합운동장 방면' : ''
  if (lineKey === 'seoul8') return direction === '1' ? '암사 방면' : direction === '2' ? '모란 방면' : ''
  if (lineKey === 'seoul9') return direction === '1' ? '개화 방면' : direction === '2' ? '중앙보훈병원 방면' : ''
  if (lineKey === 'incheon1') {
    return direction === '1' ? '검단호수공원 방면' : direction === '2' ? '국제업무지구 방면' : ''
  }
  if (lineKey === 'incheon2') return direction === '1' ? '운연 방면' : direction === '2' ? '검단오류 방면' : ''

  if (draft.lineNumber === 1) return direction === '1' ? '소요산 방면' : direction === '2' ? '인천·신창 방면' : ''
  if (draft.lineNumber === 2) return direction === '1' ? '내선순환' : direction === '2' ? '외선순환' : ''
  return ''
}

function formatLineSummary(draft: BoardingDraft): string {
  const lineText = draft.lineLabel?.trim() || `인천 ${draft.lineNumber}호선`
  const directionDisplay = getDirectionDisplay(draft)
  return directionDisplay
    ? `${lineText} · ${draft.trainNo} · ${draft.carNumber}호차 · ${directionDisplay}`
    : `${lineText} · ${draft.trainNo} · ${draft.carNumber}호차`
}

function getLineBadgeText(draft: BoardingDraft): string {
  if (draft.lineKey === 's2') {
    return '2'
  }
  return String(draft.lineNumber)
}

function parseStationOrderFromId(stationId: string | undefined): number | null {
  if (!stationId) return null
  const matched = stationId.match(/-(\d+)$/)
  if (!matched?.[1]) return null
  const parsed = Number.parseInt(matched[1], 10)
  return Number.isFinite(parsed) ? parsed : null
}

/** draft 호환: 남은 역 수 누락/문자열/구버전 데이터 보정 */
function resolveRemainingStations(draft: BoardingDraft): number | null {
  const direct = Number(draft.remainingStations)
  if (Number.isFinite(direct) && direct >= 0) {
    return Math.floor(direct)
  }

  const fromOrder = parseStationOrderFromId(draft.boardingStationId)
  const toOrder = parseStationOrderFromId(draft.destinationId)
  if (fromOrder !== null && toOrder !== null) {
    return Math.abs(toOrder - fromOrder)
  }

  return null
}

function WaitingLoading() {
  return (
    <div className="zeb-page flex flex-col items-center justify-center gap-4">
      <div className="w-full max-w-[12rem] space-y-2" aria-hidden>
        <div className="zeb-track zeb-track--line1" />
        <div className="zeb-track zeb-track--line2" />
      </div>
      <p className="zeb-caption" style={{ fontSize: 'var(--font-size-lg)' }}>
        로딩 중...
      </p>
    </div>
  )
}

/**
 * 착석 희망 대기 화면
 */
export default function WaitingPage() {
  const router = useRouter()
  const [draft, setDraft] = useState<BoardingDraft | null>(null)
  const [user, setUser] = useState<StoredUser | null>(null)
  const [waitingRank, setWaitingRank] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [isReady, setIsReady] = useState(false)
  const initStartedRef = useRef(false)

  useEffect(() => {
    const tokenFromStorage = localStorage.getItem('token')
    if (!tokenFromStorage) {
      router.replace('/login')
      return
    }
    const authToken: string = tokenFromStorage

    if (initStartedRef.current) {
      return
    }
    initStartedRef.current = true

    const abortController = new AbortController()

    async function initializeWaiting() {
      try {
        const parsedDraft = loadBoardingDraft()
        const existingRequestId = sessionStorage.getItem(ACTIVE_REQUEST_KEY)
        const isRegistered =
          sessionStorage.getItem(REGISTERED_FLAG_KEY) === 'true'

        const rawUser = localStorage.getItem('user')
        if (rawUser) {
          setUser(JSON.parse(rawUser) as StoredUser)
        }

        if (!parsedDraft && !existingRequestId) {
          router.replace('/home')
          return
        }

        if (parsedDraft) {
          if (parsedDraft.role !== 'seeker') {
            router.replace('/home')
            return
          }
          setDraft(parsedDraft)
          sessionStorage.setItem(WAITING_DRAFT_KEY, JSON.stringify(parsedDraft))
        }

        let requestId = existingRequestId

        if (!isRegistered || !requestId) {
          if (!parsedDraft) {
            router.replace('/home')
            return
          }

          const seat = resolveSeatFromDraft(parsedDraft) ?? { seatSide: 'A' as const, seatNumber: 1 }

          const response = await fetch('/api/match-requests', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${authToken}`,
            },
            body: JSON.stringify({
              role: 'seeker',
              train_id: parsedDraft.trainNo,
              direction: resolveRequestDirection(parsedDraft),
              car_number: parsedDraft.carNumber,
              seat_side: seat.seatSide,
              seat_number: seat.seatNumber,
              destination_id: parsedDraft.destinationId,
              remaining_stops: parsedDraft.remainingStations,
              line_number: parsedDraft.lineNumber,
              destination_name: parsedDraft.destinationName,
            }),
            signal: abortController.signal,
          })

          if (handleUnauthorizedResponse(response)) {
            return
          }

          const result = (await response.json()) as {
            success: boolean
            error?: string
            data?: {
              queue_position?: number
              match_request_id?: string
              match_id?: string | null
              matched?: boolean
            }
          }

          if (!response.ok || !result.success || !result.data?.match_request_id) {
            setError(result.error ?? '매칭 요청에 실패했습니다.')
            setIsReady(true)
            return
          }

          requestId = result.data.match_request_id
          sessionStorage.setItem(ACTIVE_REQUEST_KEY, requestId)
          sessionStorage.setItem(REGISTERED_FLAG_KEY, 'true')
          sessionStorage.setItem(WAITING_DRAFT_KEY, JSON.stringify(parsedDraft))

          if (result.data.matched && result.data.match_id) {
            sessionStorage.setItem('activeMatchId', result.data.match_id)
            router.replace('/matching')
            return
          }

          setWaitingRank(result.data.queue_position ?? 1)
        } else if (requestId) {
          const statusResponse = await fetch(
            `/api/match-requests/status?request_id=${encodeURIComponent(requestId)}`,
            {
              headers: { Authorization: `Bearer ${authToken}` },
              signal: abortController.signal,
            }
          )

          if (handleUnauthorizedResponse(statusResponse)) {
            return
          }

          const statusResult = (await statusResponse.json()) as {
            success: boolean
            error?: string
            data?: {
              queue_position?: number | null
              match?: { id: string } | null
            }
          }

          if (!statusResponse.ok || !statusResult.success) {
            setError(statusResult.error ?? '대기 상태를 불러올 수 없습니다.')
            setIsReady(true)
            return
          }

          if (statusResult.data?.match?.id) {
            sessionStorage.setItem('activeMatchId', statusResult.data.match.id)
            router.replace('/matching')
            return
          }

          setWaitingRank(statusResult.data?.queue_position ?? 1)
        }

        if (!requestId) {
          setError('매칭 요청 정보가 없습니다.')
          setIsReady(true)
          return
        }

        setIsReady(true)

        await subscribeMatchRealtime(
          requestId,
          authToken,
          (matchId) => {
            sessionStorage.setItem('activeMatchId', matchId)
            router.replace('/matching')
          },
          (message) => {
            setError(message)
          },
          abortController.signal
        )
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return
        }
        setError('네트워크 오류가 발생했습니다.')
        setIsReady(true)
      }
    }

    initializeWaiting()

    return () => {
      abortController.abort()
    }
  }, [router])

  function handleCancel() {
    sessionStorage.removeItem('boardingDraft')
    sessionStorage.removeItem(WAITING_DRAFT_KEY)
    sessionStorage.removeItem(ACTIVE_REQUEST_KEY)
    sessionStorage.removeItem(REGISTERED_FLAG_KEY)
    sessionStorage.removeItem('activeMatchId')
    router.push('/home')
  }

  if (!isReady && !error) {
    return <WaitingLoading />
  }

  if (!draft && !error) {
    return <WaitingLoading />
  }

  const isVulnerable = user?.is_vulnerable === true
  const remainingStations = draft ? resolveRemainingStations(draft) : null
  const remainingStationsText =
    remainingStations === null ? '미확인' : `${remainingStations}`
  const priorityLabel = isVulnerable
    ? '교통약자 우선 (1순위)'
    : '교통약자 → 매너포인트 높은 순 → 남은 역 수 → 요청 시각'

  return (
    <div className="zeb-page wait-theme flex flex-col">
      <header
        className="zeb-page-header -mx-[max(var(--space-page-x),env(safe-area-inset-left))] px-[max(var(--space-page-x),env(safe-area-inset-left))] pb-4"
        style={{ borderBottom: '2px solid var(--border)' }}
      >
        <div className="flex items-center justify-between gap-2">
          <Link
            href="/"
            className="zeb-btn zeb-btn--ghost"
            style={{
              minHeight: 'var(--touch-min)',
              padding: '0.5rem 0.75rem',
              fontSize: 'var(--font-size-sm)',
            }}
          >
            ← 홈
          </Link>
          <h1
            className="font-bold"
            style={{ fontSize: 'var(--font-size-xl)', color: 'var(--foreground)' }}
          >
            착석 희망 대기
          </h1>
          <span className="zeb-line-badge zeb-line-badge--1" style={{ visibility: 'hidden' }}>
            ·
          </span>
        </div>
        {draft && (
          <div className="mt-3" aria-hidden>
            <div className={getTrackClass(draft)} />
          </div>
        )}
      </header>

      <main className="flex-1 space-y-6 py-2">
        {draft && (
          <div className="zeb-card text-center">
            <p className="zeb-caption">목적지</p>
            <p
              className="mt-2 font-bold"
              style={{ fontSize: 'var(--font-size-2xl)', color: 'var(--foreground)' }}
            >
              {draft.destinationName}
            </p>
            <div className="mt-3 flex items-center justify-center gap-2 flex-wrap">
              <span className={getLineBadgeClass(draft)}>
                {getLineBadgeText(draft)}
              </span>
              <p className="zeb-caption">{formatLineSummary(draft)}</p>
            </div>
          </div>
        )}

        {error && <div className="zeb-alert zeb-alert--danger">{error}</div>}

        {waitingRank !== null && (
          <>
            <section className="zeb-card text-center zeb-bg-line1-light">
              <p className="zeb-label" style={{ marginBottom: '0.25rem' }}>
                현재 대기 순위
              </p>
              <p
                className="zeb-text-line1 mt-2"
                style={{ fontSize: '3.5rem', fontWeight: 800, lineHeight: 1 }}
              >
                {waitingRank}
                <span
                  style={{
                    fontSize: 'var(--font-size-2xl)',
                    fontWeight: 700,
                    marginLeft: '0.25rem',
                  }}
                >
                  위
                </span>
              </p>
              <p className="zeb-caption mt-4">
                매칭 대기 중입니다 (Realtime 감지 중)
              </p>
              <div className="mt-4 flex justify-center gap-1" aria-hidden>
                <span className="zeb-station-dot zeb-station-dot--line1 animate-pulse" />
                <span
                  className="zeb-station-dot zeb-station-dot--line1"
                  style={{ opacity: 0.5 }}
                />
                <span
                  className="zeb-station-dot zeb-station-dot--line1"
                  style={{ opacity: 0.25 }}
                />
              </div>
            </section>

            <section className="zeb-card">
              <h2 className="zeb-label">내 우선순위</h2>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <span
                  className={
                    isVulnerable
                      ? 'zeb-line-badge zeb-line-badge--1'
                      : 'zeb-line-badge zeb-line-badge--2'
                  }
                  style={{
                    alignSelf: 'flex-start',
                    fontSize: 'var(--font-size-sm)',
                    padding: '0.375rem 0.875rem',
                  }}
                >
                  {isVulnerable ? '교통약자' : '일반'}
                </span>
                <p
                  style={{
                    fontSize: 'var(--font-size-base)',
                    color: 'var(--text-muted)',
                    lineHeight: 1.45,
                  }}
                >
                  {priorityLabel}
                </p>
              </div>
            </section>

            {draft && (
              <section className="zeb-card zeb-card--elevated">
                <h2 className="zeb-label">목적지까지 남은 역 수</h2>
                <p
                  className="mt-2"
                  style={{
                    fontSize: 'var(--font-size-3xl)',
                    fontWeight: 800,
                    color: 'var(--foreground)',
                  }}
                >
                  {remainingStationsText}
                  <span
                    style={{
                      fontSize: 'var(--font-size-xl)',
                      fontWeight: 600,
                      color: 'var(--text-muted)',
                      marginLeft: '0.25rem',
                    }}
                  >
                    역
                  </span>
                </p>
              </section>
            )}
          </>
        )}
      </main>

      <footer
        className="mt-auto pt-6"
        style={{ borderTop: '2px solid var(--border)' }}
      >
        <button
          type="button"
          onClick={handleCancel}
          className="zeb-btn zeb-btn--block zeb-btn--secondary"
        >
          대기 취소
        </button>
      </footer>
      <style jsx global>{`
        .wait-theme {
          background: #f7f8fa !important;
          color: #1a1a1a !important;
        }
        .wait-theme .zeb-card,
        .wait-theme .zeb-card--elevated {
          background: #ffffff !important;
          border: 0.5px solid #ebebeb !important;
          border-radius: 16px !important;
          box-shadow: 0 2px 10px rgba(26, 26, 26, 0.05) !important;
        }
        .wait-theme .zeb-page-header,
        .wait-theme .zeb-footer {
          background: #f7f8fa !important;
        }
        .wait-theme .zeb-label,
        .wait-theme .zeb-page-title,
        .wait-theme .zeb-text-line1 {
          color: #0052a4 !important;
        }
        .wait-theme .zeb-alert--danger {
          border-radius: 16px !important;
        }
        .wait-theme .zeb-btn {
          border-radius: 16px !important;
        }
        .wait-theme .zeb-btn--secondary {
          background: #ffffff !important;
          color: #0052a4 !important;
          border: 0.5px solid #ebebeb !important;
        }
      `}</style>
    </div>
  )
}
