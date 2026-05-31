'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
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

function isLineTwo(draft: BoardingDraft): boolean {
  return (
    draft.lineKey === 's2' ||
    draft.lineKey === 'seoul2' ||
    draft.lineKey === 'incheon2' ||
    draft.lineNumber === 2
  )
}

function resolveLineColor(draft: BoardingDraft): string {
  return isLineTwo(draft) ? '#00A84D' : '#0052A4'
}

function resolveLineShortLabel(draft: BoardingDraft): string {
  const fromLabel = (draft.lineLabel || '').replace(/\s+/g, '')
  if (/^서울2호선$/.test(fromLabel) || fromLabel === '2호선') return '2호선'
  if (/^서울1호선$/.test(fromLabel) || fromLabel === '1호선') return '1호선'
  return isLineTwo(draft) ? '2호선' : '1호선'
}

function formatTrainSubline(draft: BoardingDraft): string {
  const directionDisplay = getDirectionDisplay(draft)
  const parts = [`열차번호 ${draft.trainNo}`, `${draft.carNumber}호차`]
  if (directionDisplay) {
    parts.push(directionDisplay)
  }
  return parts.join(' · ')
}

const PRIORITY_CRITERIA = [
  '교통약자 여부',
  '매너포인트 높은 순',
  '남은 역 수',
  '요청 시각',
] as const

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
  const [waitingRank, setWaitingRank] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    const tokenFromStorage = localStorage.getItem('token')
    if (!tokenFromStorage) {
      router.replace('/login')
      return
    }
    const authToken: string = tokenFromStorage
    let cancelled = false
    const abortController = new AbortController()

    async function initializeWaiting() {
      try {
        const parsedDraft = loadBoardingDraft()
        const existingRequestId = sessionStorage.getItem(ACTIVE_REQUEST_KEY)
        const isRegistered =
          sessionStorage.getItem(REGISTERED_FLAG_KEY) === 'true'

        if (!parsedDraft && !existingRequestId) {
          router.replace('/home')
          return
        }

        if (parsedDraft) {
          if (parsedDraft.role !== 'seeker') {
            router.replace('/home')
            return
          }
          if (!cancelled) {
            setDraft(parsedDraft)
          }
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

          if (cancelled) return

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

          if (!cancelled) {
            setWaitingRank(result.data.queue_position ?? 1)
          }
        } else if (requestId) {
          const statusResponse = await fetch(
            `/api/match-requests/status?request_id=${encodeURIComponent(requestId)}`,
            {
              headers: { Authorization: `Bearer ${authToken}` },
              signal: abortController.signal,
            }
          )

          if (cancelled) return

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

          if (!cancelled) {
            setWaitingRank(statusResult.data?.queue_position ?? 1)
          }
        }

        if (!requestId) {
          setError('매칭 요청 정보가 없습니다.')
          setIsReady(true)
          return
        }

        if (!cancelled) {
          setIsReady(true)
        }

        void subscribeMatchRealtime(
          requestId,
          authToken,
          (matchId) => {
            if (cancelled) return
            sessionStorage.setItem('activeMatchId', matchId)
            router.replace('/matching')
          },
          (message) => {
            if (cancelled) return
            setError(message)
          },
          abortController.signal
        ).catch(() => {
          // Strict Mode cleanup abort — 무시
        })
      } catch (err) {
        if (cancelled) return
        if (err instanceof Error && err.name === 'AbortError') {
          return
        }
        setError('네트워크 오류가 발생했습니다.')
        setIsReady(true)
      }
    }

    void initializeWaiting().catch((err) => {
      if (cancelled) return
      if (err instanceof Error && err.name === 'AbortError') return
    })

    return () => {
      cancelled = true
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
    return (
      <div className="zeb-page wait-theme flex flex-col items-center justify-center gap-4 px-4">
        <p className="text-center text-sm font-medium text-[#475569]">
          대기 정보를 불러오지 못했습니다.
        </p>
        <button
          type="button"
          onClick={handleCancel}
          className="zeb-btn zeb-btn--secondary"
        >
          홈으로
        </button>
      </div>
    )
  }

  const lineColor = draft ? resolveLineColor(draft) : '#0052A4'
  const lineColorLight =
    lineColor === '#00A84D' ? 'rgba(0, 168, 77, 0.14)' : 'rgba(0, 82, 164, 0.14)'
  const remainingStations = draft ? resolveRemainingStations(draft) : null
  const remainingStationsText =
    remainingStations === null ? '미확인' : `${remainingStations}`

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100dvh',
        background: '#F7F8FA',
        color: '#1A1A1A',
      }}
    >
      <header
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          alignItems: 'center',
          padding: '14px 16px',
          background: '#FFFFFF',
          borderBottom: '1px solid #EBEBEB',
          flexShrink: 0,
        }}
      >
        <div style={{ justifySelf: 'start' }}>
          <Link
            href="/"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              minHeight: 44,
              padding: '0 4px',
              fontSize: 15,
              fontWeight: 600,
              color: '#374151',
              textDecoration: 'none',
            }}
          >
            홈
          </Link>
        </div>
        <h1
          style={{
            justifySelf: 'center',
            margin: 0,
            fontSize: 16,
            fontWeight: 700,
            color: '#1A1A1A',
            textAlign: 'center',
          }}
        >
          착석 희망 대기
        </h1>
        <div style={{ justifySelf: 'end' }} aria-hidden />
      </header>

      <main
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          padding: '16px 16px 0',
          overflow: 'auto',
        }}
      >
        {draft && (
          <section
            style={{
              background: lineColor,
              borderRadius: 16,
              padding: '20px 18px',
              color: '#FFFFFF',
            }}
          >
            <p style={{ margin: 0, fontSize: 12, fontWeight: 600, opacity: 0.88 }}>목적지</p>
            <p
              style={{
                margin: '10px 0 0',
                fontSize: 28,
                fontWeight: 800,
                lineHeight: 1.2,
              }}
            >
              {draft.destinationName}
            </p>
            <div
              style={{
                marginTop: 14,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
              }}
            >
              <span
                style={{
                  display: 'inline-block',
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '4px 10px',
                  borderRadius: 999,
                  background: 'rgba(255, 255, 255, 0.22)',
                }}
              >
                {resolveLineShortLabel(draft)}
              </span>
              <span style={{ fontSize: 13, fontWeight: 500, opacity: 0.92 }}>
                {formatTrainSubline(draft)}
              </span>
            </div>
          </section>
        )}

        {error && (
          <div
            style={{
              background: '#FEF2F2',
              border: '1px solid #FECACA',
              borderRadius: 12,
              padding: '12px 14px',
              fontSize: 14,
              color: '#B91C1C',
            }}
          >
            {error}
          </div>
        )}

        {waitingRank !== null && (
          <>
            <section
              style={{
                background: '#FFFFFF',
                borderRadius: 16,
                padding: '20px 18px',
                border: '1px solid #EBEBEB',
                textAlign: 'center',
              }}
            >
              <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: '#6B7280' }}>
                현재 대기 순위
              </p>
              <p
                style={{
                  margin: '12px 0 0',
                  fontSize: 52,
                  fontWeight: 800,
                  lineHeight: 1,
                  color: lineColor,
                  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                }}
              >
                {waitingRank}
                <span style={{ fontSize: 24, fontWeight: 700, marginLeft: 4 }}>위</span>
              </p>
              <div
                style={{
                  marginTop: 16,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                }}
              >
                <span className="wait-live-dot" aria-hidden />
                <span style={{ fontSize: 13, fontWeight: 600, color: '#6B7280' }}>
                  실시간 매칭 대기 중
                </span>
              </div>
            </section>

            {draft && (
              <section
                style={{
                  background: '#FFFFFF',
                  borderRadius: 16,
                  padding: '4px 18px',
                  border: '1px solid #EBEBEB',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    padding: '14px 0',
                    borderBottom: '1px solid #F3F4F6',
                  }}
                >
                  <span style={{ fontSize: 14, fontWeight: 500, color: '#6B7280' }}>
                    목적지까지 남은 역
                  </span>
                  <span
                    style={{
                      fontSize: 26,
                      fontWeight: 800,
                      color: lineColor,
                      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                    }}
                  >
                    {remainingStationsText}
                    <span style={{ fontSize: 16, fontWeight: 700, marginLeft: 2 }}>역</span>
                  </span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    padding: '14px 0',
                  }}
                >
                  <span style={{ fontSize: 14, fontWeight: 500, color: '#6B7280' }}>
                    매칭 유형
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#1A1A1A' }}>
                    교통약자 우선
                  </span>
                </div>
              </section>
            )}

            <section
              style={{
                background: '#FFFFFF',
                borderRadius: 16,
                padding: '18px',
                border: '1px solid #EBEBEB',
              }}
            >
              <p style={{ margin: '0 0 14px', fontSize: 13, fontWeight: 700, color: '#374151' }}>
                우선순위 기준
              </p>
              <ol style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {PRIORITY_CRITERIA.map((label, index) => (
                  <li
                    key={label}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '8px 0',
                    }}
                  >
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 24,
                        height: 24,
                        borderRadius: '50%',
                        background: lineColorLight,
                        color: lineColor,
                        fontSize: 12,
                        fontWeight: 800,
                        flexShrink: 0,
                      }}
                    >
                      {index + 1}
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 500, color: '#374151' }}>
                      {label}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          </>
        )}
      </main>

      <footer
        style={{
          padding: '16px 16px max(24px, env(safe-area-inset-bottom))',
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          onClick={handleCancel}
          style={{
            width: '100%',
            minHeight: 48,
            padding: '12px 0',
            background: '#FFFFFF',
            border: '1.5px solid #EBEBEB',
            borderRadius: 12,
            fontSize: 15,
            fontWeight: 700,
            color: '#374151',
            cursor: 'pointer',
          }}
        >
          요청 취소
        </button>
      </footer>

      <style jsx global>{`
        @keyframes wait-live-pulse {
          0%,
          100% {
            opacity: 1;
            transform: scale(1);
          }
          50% {
            opacity: 0.35;
            transform: scale(0.85);
          }
        }
        .wait-live-dot {
          display: inline-block;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #00a84d;
          animation: wait-live-pulse 1.4s ease-in-out infinite;
        }
      `}</style>
    </div>
  )
}
