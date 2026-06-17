'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import AppHamburgerMenu from '@/components/AppHamburgerMenu'
import { handleUnauthorizedResponse } from '@/lib/auth-client'
import {
  clearMatchClientSession,
  resolveActiveMatchNavigationTarget,
} from '@/lib/match-session'
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
  presenceMode?: 'onboard' | 'platform_waiting'
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
const PROVIDER_REGISTERED_FLAG_KEY = 'providerRegistered'

/** 하차 예정(provider) 등록 여부 확인 */
function isProviderRegisteredFlag(): boolean {
  const raw = sessionStorage.getItem(PROVIDER_REGISTERED_FLAG_KEY)
  if (!raw || raw === 'false') return false
  if (raw === 'true') return true
  try {
    const parsed = JSON.parse(raw) as { matchRequestId?: string }
    return Boolean(parsed.matchRequestId)
  } catch {
    return true
  }
}

function resolveDraftRole(draft: BoardingDraft | null): 'seeker' | 'provider' | null {
  if (!draft?.role) return null
  if (draft.role === 'provider') return 'provider'
  if (draft.role === 'seeker') return 'seeker'
  return null
}

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

/** session에 draft가 없을 때 서버의 현재 요청으로 draft를 복원합니다. */
async function loadCurrentRequestSnapshot(
  token: string,
  signal?: AbortSignal
): Promise<{ draft: BoardingDraft; requestId: string } | null> {
  try {
    const response = await fetch('/api/match-requests/current', {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal,
    })

    const payload = (await response.json()) as {
      success?: boolean
      data?: {
        id?: string
        request_type?: string | null
        train_no?: string | null
        line_number?: number | null
        car_number?: number | null
        destination_station_name?: string | null
        remaining_stations?: number | null
        presence_mode?: string | null
      }
    }

    if (!response.ok || !payload.success || !payload.data?.id) {
      return null
    }

    const data = payload.data
    const isProvider = data.request_type === 'leaving'
    const lineNumber = typeof data.line_number === 'number' ? data.line_number : 7

    const draft: BoardingDraft = {
      role: isProvider ? 'provider' : 'seeker',
      presenceMode:
        data.presence_mode === 'platform_waiting' ? 'platform_waiting' : 'onboard',
      lineNumber,
      lineLabel: `서울 ${lineNumber}호선`,
      lineKey: lineNumber === 7 ? 'seoul7' : undefined,
      trainNo: data.train_no?.trim() || '-',
      carNumber: typeof data.car_number === 'number' ? data.car_number : 1,
      destinationId: '',
      destinationName: data.destination_station_name?.trim() || '목적지',
      remainingStations:
        typeof data.remaining_stations === 'number' ? data.remaining_stations : 0,
    }

    return { draft, requestId: data.id as string }
  } catch {
    return null
  }
}

function persistWaitingSession(draft: BoardingDraft, requestId: string): void {
  sessionStorage.setItem(ACTIVE_REQUEST_KEY, requestId)
  sessionStorage.setItem(WAITING_DRAFT_KEY, JSON.stringify(draft))
  if (draft.role === 'provider') {
    sessionStorage.setItem(PROVIDER_REGISTERED_FLAG_KEY, 'true')
  } else {
    sessionStorage.setItem(REGISTERED_FLAG_KEY, 'true')
  }
}

/** 취소·거절 후 대기/매칭 session을 정리합니다. */
function clearWaitingMatchSession(): void {
  clearMatchClientSession()
}

type MatchNavigationTarget = 'matching' | 'matched' | 'none'

/** 활성 매칭 화면 이동 여부를 판별합니다. */
function resolveMatchNavigationTarget(
  matchStatus: string | undefined,
  requestStatus: string | undefined
): MatchNavigationTarget {
  if (requestStatus === 'cancelled') {
    return 'none'
  }

  if (matchStatus === 'accepted') {
    return 'matched'
  }

  if (matchStatus === 'pending' && requestStatus === 'matched') {
    return 'matching'
  }

  return 'none'
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

/** lineKey가 없을 때 lineLabel에서 호선 키를 복원합니다. */
function resolveLineKeyFromDraft(draft: BoardingDraft): BoardingLineKey | null {
  if (draft.lineKey) return draft.lineKey

  const fromLabel = (draft.lineLabel || '').replace(/\s+/g, '')
  const seoulFromLabel = fromLabel.match(/^서울([1-9])호선$/)
  if (seoulFromLabel?.[1]) {
    return `seoul${seoulFromLabel[1]}` as BoardingLineKey
  }
  const incheonFromLabel = fromLabel.match(/^인천([12])호선$/)
  if (incheonFromLabel?.[1]) {
    return `incheon${incheonFromLabel[1]}` as BoardingLineKey
  }
  if (fromLabel === '서울1호선') return 'seoul1'
  if (fromLabel === '서울2호선') return 'seoul2'

  return null
}

function getDirectionDisplay(draft: BoardingDraft): string {
  const direction = normalizeDirection(draft.direction)
  const lineKey = resolveLineKeyFromDraft(draft)

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
  if (lineKey === 'seoul7') return direction === '1' ? '장암 방면' : direction === '2' ? '석남 방면' : ''
  if (lineKey === 'seoul8') return direction === '1' ? '암사 방면' : direction === '2' ? '모란 방면' : ''
  if (lineKey === 'seoul9') return direction === '1' ? '개화 방면' : direction === '2' ? '중앙보훈병원 방면' : ''
  if (lineKey === 'incheon1') {
    return direction === '1' ? '검단호수공원 방면' : direction === '2' ? '국제업무지구 방면' : ''
  }
  if (lineKey === 'incheon2') return direction === '1' ? '운연 방면' : direction === '2' ? '검단오류 방면' : ''

  // lineNumber만으로는 2호선·7호선을 구분할 수 없어 lineLabel 기반으로만 폴백합니다.
  const fromLabel = (draft.lineLabel || '').replace(/\s+/g, '')
  if (fromLabel === '서울1호선' || fromLabel === '인천1호선') {
    return direction === '1' ? '소요산 방면' : direction === '2' ? '인천·신창 방면' : ''
  }
  if (fromLabel === '서울2호선' || fromLabel === '인천2호선') {
    return direction === '1' ? '내선순환' : direction === '2' ? '외선순환' : ''
  }

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
  return isLineTwo(draft) ? '#747F00' : '#747F00'
}

function resolveLineShortLabel(draft: BoardingDraft): string {
  const fromLabel = (draft.lineLabel || '').replace(/\s+/g, '')
  const seoulFromLabel = fromLabel.match(/^서울([1-9])호선$/)
  if (seoulFromLabel?.[1]) return `${seoulFromLabel[1]}호선`
  const incheonFromLabel = fromLabel.match(/^인천([12])호선$/)
  if (incheonFromLabel?.[1]) return `인천${incheonFromLabel[1]}호선`
  if (/^[1-9]호선$/.test(fromLabel)) return fromLabel

  const lineKey = draft.lineKey || ''
  const seoulFromKey = lineKey.match(/^seoul([1-9])$/)
  if (seoulFromKey?.[1]) return `${seoulFromKey[1]}호선`
  const incheonFromKey = lineKey.match(/^incheon([12])$/)
  if (incheonFromKey?.[1]) return `인천${incheonFromKey[1]}호선`
  if (lineKey === 's2' || lineKey === 'line2') return '2호선'
  if (lineKey === 'line1') return '1호선'

  return '7호선'
}

function formatTrainSubline(draft: BoardingDraft): string {
  const directionDisplay = getDirectionDisplay(draft)
  const parts = [`열차번호 ${draft.trainNo}`, `${draft.carNumber}호차`]
  if (directionDisplay) {
    parts.push(directionDisplay)
  }
  return parts.join(' · ')
}

const MATCH_GUIDE_BY_ROLE = {
  provider: [
    '착석 희망자가 등록되면 자동 연결',
    '연결되면 알림 화면으로 이동',
    '이 화면을 나가도 대기는 유지됩니다',
  ],
  seeker: [
    '하차 예정자가 등록되면 자동 연결',
    '연결되면 알림 화면으로 이동',
    '이 화면을 나가도 대기는 유지됩니다',
  ],
} as const

const MATCH_PROGRESS_GUIDE_BY_ROLE = {
  provider: [
    '착석 희망자와 연결되었어요',
    '알림에서 수락해 주세요',
    '앞에 사람 있으면 양보가 불편할 수 있어요',
  ],
  seeker: [
    '하차 예정자와 연결되었어요',
    '표시된 호차로 이동해 주세요',
    '도착 후 수락해 주세요',
  ],
} as const

const WAITING_SUBTITLE_BY_ROLE = {
  provider: '착석 희망자가 등록되면 알려드려요',
  seeker: '하차 예정자가 등록되면 알려드려요',
} as const

const PLATFORM_WAITING_SUBTITLE = '열차에 탑승하면 매칭이 시작됩니다'

const PLATFORM_WAITING_GUIDE = [
  '지금은 플랫폼 대기 상태입니다',
  '호차·좌석 위치를 미리 확인해 주세요',
  '탑승 후 「탑승했어요」를 눌러 매칭을 시작합니다',
] as const

const CONNECTED_SUBTITLE_BY_ROLE = {
  provider: '착석 희망자와 연결 · 알림에서 확인',
  seeker: '하차 예정자와 연결 · 이동 후 수락',
} as const

type WaitMatchPhase = 'waiting' | 'connected' | 'accepted'

/** 요청·매칭 상태로 내 상태 화면 진행 단계를 판별합니다. */
function resolveWaitMatchPhase(
  requestStatus?: string | null,
  matchStatus?: string | null
): WaitMatchPhase {
  if (matchStatus === 'accepted') {
    return 'accepted'
  }

  if (requestStatus === 'matched') {
    return 'connected'
  }

  return 'waiting'
}

const MATCH_TYPE_LABEL_BY_ROLE = {
  provider: '하차 예정 등록',
  seeker: '착석 희망 등록',
} as const

const ACCEPT_STATUS_POLL_MS = 3000
const PENDING_MATCH_POLL_MS = 3000

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

const MOBILE_PAGE_X = 16

/** 대기 화면 레이아웃 — 전역 MobileAppShell 안에서 콘텐츠만 담당 */
function WaitingPageLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className="wait-page-layout"
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        background: '#F7F8FA',
        color: '#1A1A1A',
        fontFamily: "'Pretendard', 'Apple SD Gothic Neo', sans-serif",
        paddingLeft: `max(${MOBILE_PAGE_X}px, env(safe-area-inset-left))`,
        paddingRight: `max(${MOBILE_PAGE_X}px, env(safe-area-inset-right))`,
      }}
    >
      {children}
    </div>
  )
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

function WaitingPageHeader({ onBack }: { onBack: () => void }) {
  return (
    <header
      className="zeb-app-header"
      style={{
        marginLeft: `-${MOBILE_PAGE_X}px`,
        marginRight: `-${MOBILE_PAGE_X}px`,
        paddingLeft: MOBILE_PAGE_X,
        paddingRight: MOBILE_PAGE_X,
        justifyContent: 'space-between',
      }}
    >
      <button
        type="button"
        onClick={onBack}
        className="zeb-touch-target flex shrink-0 items-center text-sm font-medium text-[#6B7280]"
        aria-label="뒤로가기"
      >
        ← 뒤로
      </button>
      <h1
        style={{
          margin: 0,
          flex: 1,
          fontSize: 17,
          fontWeight: 700,
          color: '#1A1A1A',
          textAlign: 'center',
        }}
      >
        내 상태
      </h1>
      <AppHamburgerMenu />
    </header>
  )
}

function WaitingLoading({ onBack }: { onBack: () => void }) {
  return (
    <WaitingPageLayout>
      <WaitingPageHeader onBack={onBack} />
      <div className="flex flex-1 flex-col items-center justify-center gap-4">
        <div className="w-full max-w-[12rem] space-y-2" aria-hidden>
          <div className="zeb-track zeb-track--line1" />
          <div className="zeb-track zeb-track--line2" />
        </div>
        <p className="zeb-caption" style={{ fontSize: 'var(--font-size-lg)' }}>
          로딩 중...
        </p>
      </div>
    </WaitingPageLayout>
  )
}

/**
 * 착석 희망·하차 예정 대기 화면
 */
export default function WaitingPage() {
  const router = useRouter()
  const [draft, setDraft] = useState<BoardingDraft | null>(null)
  const [waitingRank, setWaitingRank] = useState<number | null>(null)
  const [isProviderWaiting, setIsProviderWaiting] = useState(false)
  const [isSeekerWaiting, setIsSeekerWaiting] = useState(false)
  const [error, setError] = useState('')
  const [isReady, setIsReady] = useState(false)
  const [partnerAcceptedNotice, setPartnerAcceptedNotice] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [matchPhase, setMatchPhase] = useState<WaitMatchPhase>('waiting')
  const [presenceMode, setPresenceMode] = useState<'onboard' | 'platform_waiting'>('onboard')
  const [isConfirmingOnboard, setIsConfirmingOnboard] = useState(false)

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
        let parsedDraft = loadBoardingDraft()
        let existingRequestId = sessionStorage.getItem(ACTIVE_REQUEST_KEY)

        if (!parsedDraft || !existingRequestId) {
          const snapshot = await loadCurrentRequestSnapshot(
            authToken,
            abortController.signal
          )
          if (cancelled) {
            return
          }
          if (snapshot) {
            if (!parsedDraft) {
              parsedDraft = snapshot.draft
            }
            if (!existingRequestId) {
              existingRequestId = snapshot.requestId
            }

            const snapshotStatusResponse = await fetch(
              `/api/match-requests/status?request_id=${encodeURIComponent(snapshot.requestId)}`,
              {
                headers: { Authorization: `Bearer ${authToken}` },
                cache: 'no-store',
                signal: abortController.signal,
              }
            )

            if (cancelled) {
              return
            }

            const snapshotStatus = (await snapshotStatusResponse.json()) as {
              success?: boolean
              data?: {
                match_request?: { status?: string } | null
                match?: { status?: string } | null
              }
            }

            if (
              snapshotStatusResponse.ok &&
              snapshotStatus.success &&
              snapshotStatus.data?.match_request?.status === 'cancelled'
            ) {
              clearWaitingMatchSession()
              router.replace('/')
              return
            }

            if (snapshotStatusResponse.ok && snapshotStatus.success) {
              setMatchPhase(
                resolveWaitMatchPhase(
                  snapshotStatus.data?.match_request?.status,
                  snapshotStatus.data?.match?.status
                )
              )
            }

            persistWaitingSession(snapshot.draft, snapshot.requestId)
            if (!cancelled) {
              setDraft(parsedDraft)
            }
          }
        }

        const draftRole = resolveDraftRole(parsedDraft)
        const isProviderRole = draftRole === 'provider'
        const isRegistered = isProviderRole
          ? isProviderRegisteredFlag()
          : sessionStorage.getItem(REGISTERED_FLAG_KEY) === 'true'

        if (!parsedDraft && !existingRequestId) {
          router.replace('/home')
          return
        }

        if (parsedDraft) {
          if (!draftRole) {
            router.replace('/home')
            return
          }
          if (!cancelled) {
            setDraft(parsedDraft)
            if (parsedDraft.presenceMode) {
              setPresenceMode(parsedDraft.presenceMode)
            }
          }
          sessionStorage.setItem(WAITING_DRAFT_KEY, JSON.stringify(parsedDraft))
        }

        // 하차 예정(provider) — 등록 직후 API 응답 전에 대기 화면을 먼저 표시
        if (isProviderRole && parsedDraft && !cancelled) {
          setDraft(parsedDraft)
          setIsProviderWaiting(true)
          setIsSeekerWaiting(false)
          setWaitingRank(null)
          setIsReady(true)
        }

        let requestId = existingRequestId

        const storedMatchId = sessionStorage.getItem('activeMatchId')?.trim()
        if (storedMatchId) {
          const navigationTarget = await resolveActiveMatchNavigationTarget(
            authToken,
            storedMatchId,
            existingRequestId,
            abortController.signal
          )

          if (cancelled) {
            return
          }

          if (navigationTarget === 'matching') {
            router.replace(`/matching?matchId=${encodeURIComponent(storedMatchId)}`)
            return
          }

          if (navigationTarget === 'matched') {
            router.replace('/matched')
            return
          }

          clearWaitingMatchSession()
          existingRequestId = null
          parsedDraft = loadBoardingDraft()
        }

        if (!isRegistered || !requestId) {
          if (!parsedDraft) {
            router.replace('/home')
            return
          }

          if (isProviderRole) {
            const providerSeat = resolveSeatFromDraft(parsedDraft)
            const providerBody: Record<string, unknown> = {
              role: 'provider',
              presence_mode: 'onboard',
              train_id: parsedDraft.trainNo,
              direction: resolveRequestDirection(parsedDraft),
              car_number: parsedDraft.carNumber,
              destination_id: parsedDraft.destinationId,
              remaining_stops: parsedDraft.remainingStations,
              line_number: parsedDraft.lineNumber,
              destination_name: parsedDraft.destinationName,
            }
            if (parsedDraft.boardingStationId) {
              providerBody.boarding_station_id = parsedDraft.boardingStationId
            }
            if (parsedDraft.boardingStationName) {
              providerBody.boarding_station_name = parsedDraft.boardingStationName
            }
            if (providerSeat) {
              providerBody.seat_side = providerSeat.seatSide
              providerBody.seat_number = providerSeat.seatNumber
            }

            const response = await fetch('/api/match-requests', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${authToken}`,
              },
              body: JSON.stringify(providerBody),
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
                presence_mode?: string
              }
            }

            if (!response.ok || !result.success || !result.data?.match_request_id) {
              setError(result.error ?? '하차 등록에 실패했습니다.')
              setIsReady(true)
              return
            }

            requestId = result.data.match_request_id
            persistWaitingSession(parsedDraft, requestId)

            if (result.data.matched && result.data.match_id) {
              sessionStorage.setItem('activeMatchId', result.data.match_id)
              router.replace('/matching')
              return
            }

            if (!cancelled) {
              setIsProviderWaiting(true)
              setIsSeekerWaiting(false)
              setWaitingRank(null)
            }
          } else {
            const seat = resolveSeatFromDraft(parsedDraft) ?? {
              seatSide: 'A' as const,
              seatNumber: 1,
            }

            const response = await fetch('/api/match-requests', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${authToken}`,
              },
              body: JSON.stringify({
                role: 'seeker',
                presence_mode: parsedDraft.presenceMode ?? 'platform_waiting',
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
                presence_mode?: string
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
              const nextPresence =
                result.data.presence_mode === 'onboard' ? 'onboard' : 'platform_waiting'
              setPresenceMode(nextPresence)
              setWaitingRank(result.data.queue_position ?? 1)
              setIsSeekerWaiting(true)
              setIsProviderWaiting(false)
            }
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
                match?: { id: string; status?: string } | null
                match_request?: {
                  status?: string
                  presence_mode?: string
                } | null
              }
          }

          if (!statusResponse.ok || !statusResult.success) {
            setError(statusResult.error ?? '대기 상태를 불러올 수 없습니다.')
            setIsReady(true)
            return
          }

          if (statusResult.data?.match_request?.status === 'cancelled') {
            clearWaitingMatchSession()
            router.replace('/')
            return
          }

          const navigationTarget = resolveMatchNavigationTarget(
            statusResult.data?.match?.status,
            statusResult.data?.match_request?.status
          )
          const requestStatus = statusResult.data?.match_request?.status
          const matchStatus = statusResult.data?.match?.status
          setMatchPhase(resolveWaitMatchPhase(requestStatus, matchStatus))

          if (navigationTarget !== 'none' && statusResult.data?.match?.id) {
            sessionStorage.setItem('activeMatchId', statusResult.data.match.id)
            router.replace(
              navigationTarget === 'matched' ? '/matched' : '/matching'
            )
            return
          }

          if (!cancelled) {
            const requestPresence =
              statusResult.data?.match_request?.presence_mode === 'platform_waiting'
                ? 'platform_waiting'
                : 'onboard'
            setPresenceMode(requestPresence)

            if (isProviderRole) {
              const requestStatus = statusResult.data?.match_request?.status
              setIsProviderWaiting(requestStatus === 'waiting' || !requestStatus)
              setIsSeekerWaiting(false)
              setWaitingRank(null)
            } else {
              const requestStatus = statusResult.data?.match_request?.status
              setIsProviderWaiting(false)
              setIsSeekerWaiting(requestStatus === 'waiting' || !requestStatus)
              setWaitingRank(statusResult.data?.queue_position ?? 1)
            }
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
            void (async () => {
              const navigationTarget = await resolveActiveMatchNavigationTarget(
                authToken,
                matchId,
                requestId,
                abortController.signal
              )
              if (cancelled || navigationTarget !== 'matching') {
                return
              }
              sessionStorage.setItem('activeMatchId', matchId)
              router.replace('/matching')
            })()
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

  // 수락(accepted) 상태 폴링 — 상대 수락 시 완료 화면으로 이동
  useEffect(() => {
    if (!isReady) {
      return
    }

    const token = localStorage.getItem('token')
    const requestId = sessionStorage.getItem(ACTIVE_REQUEST_KEY)
    if (!token || !requestId) {
      return
    }

    let cancelled = false

    async function pollAcceptStatus() {
      try {
        const statusResponse = await fetch(
          `/api/match-requests/status?request_id=${encodeURIComponent(requestId as string)}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
          }
        )

        if (cancelled) return

        if (handleUnauthorizedResponse(statusResponse)) {
          return
        }

        const statusResult = (await statusResponse.json()) as {
          success?: boolean
          data?: {
            match?: { id?: string; status?: string } | null
            match_request?: { status?: string } | null
          }
        }

        if (!statusResponse.ok || !statusResult.success) {
          return
        }

        const match = statusResult.data?.match
        const requestStatus = statusResult.data?.match_request?.status
        setMatchPhase(resolveWaitMatchPhase(requestStatus, match?.status))

        if (requestStatus === 'cancelled') {
          clearWaitingMatchSession()
          router.replace('/')
          return
        }

        if (!match?.id) {
          return
        }

        sessionStorage.setItem('activeMatchId', match.id)

        if (match.status === 'accepted') {
          router.replace('/matched')
          return
        }

        if (match.status === 'pending' && requestStatus === 'matched') {
          router.replace('/matching')
        }
      } catch {
        // 폴링 실패 시 다음 주기에 재시도합니다.
      }
    }

    void pollAcceptStatus()
    const timerId = window.setInterval(() => {
      void pollAcceptStatus()
    }, ACCEPT_STATUS_POLL_MS)

    return () => {
      cancelled = true
      window.clearInterval(timerId)
    }
  }, [isReady, router])

  // 매칭 성공(pending) 감지 — Realtime 보조 폴링으로 /matching 이동
  useEffect(() => {
    if (!isReady) {
      return
    }

    const token = localStorage.getItem('token')
    const requestId = sessionStorage.getItem(ACTIVE_REQUEST_KEY)
    if (!token || !requestId) {
      return
    }

    let cancelled = false

    async function pollPendingMatch() {
      try {
        const statusResponse = await fetch(
          `/api/match-requests/status?request_id=${encodeURIComponent(requestId as string)}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
          }
        )

        if (cancelled) return

        if (handleUnauthorizedResponse(statusResponse)) {
          return
        }

        const statusResult = (await statusResponse.json()) as {
          success?: boolean
          data?: {
            match?: { id?: string; status?: string } | null
            match_request?: { status?: string } | null
          }
        }

        if (!statusResponse.ok || !statusResult.success) {
          return
        }

        const match = statusResult.data?.match
        const requestStatus = statusResult.data?.match_request?.status
        setMatchPhase(resolveWaitMatchPhase(requestStatus, match?.status))

        if (requestStatus === 'cancelled') {
          clearWaitingMatchSession()
          router.replace('/')
          return
        }

        if (!match?.id) {
          return
        }

        sessionStorage.setItem('activeMatchId', match.id)

        if (match.status === 'accepted') {
          router.replace('/matched')
          return
        }

        if (match.status === 'pending' && requestStatus === 'matched') {
          router.replace(`/matching?matchId=${encodeURIComponent(match.id)}`)
        }
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
  }, [isReady, router])

  // 수락 SSE — /waiting 에서도 수락 알림 수신 후 /matched 이동
  useEffect(() => {
    if (!isReady || partnerAcceptedNotice) {
      return
    }

    const token = localStorage.getItem('token')
    const matchId = sessionStorage.getItem('activeMatchId')?.trim()
    if (!token || !matchId) {
      return
    }

    const abortController = new AbortController()

    void subscribeMatchAcceptSse(
      matchId,
      token,
      (acceptedMatchId) => {
        setPartnerAcceptedNotice(true)
        sessionStorage.setItem('activeMatchId', acceptedMatchId)
        window.setTimeout(() => {
          router.replace('/matched')
        }, 1500)
      },
      (message) => {
        setError(message)
      },
      abortController.signal
    ).catch(() => {
      // Strict Mode cleanup abort — 무시
    })

    return () => {
      abortController.abort()
    }
  }, [isReady, partnerAcceptedNotice, router])

  async function handleConfirmOnboard() {
    if (isConfirmingOnboard) {
      return
    }

    const token = localStorage.getItem('token')
    const requestId = sessionStorage.getItem(ACTIVE_REQUEST_KEY)
    if (!token || !requestId) {
      setError('탑승 확인에 필요한 정보가 없습니다.')
      return
    }

    setIsConfirmingOnboard(true)
    setError('')

    try {
      const response = await fetch(
        `/api/match-requests/${encodeURIComponent(requestId)}/onboard`,
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}` },
        }
      )

      const result = (await response.json()) as {
        success?: boolean
        error?: string
        data?: {
          presence_mode?: string
          queue_position?: number | null
          match_id?: string | null
          matched?: boolean
        }
      }

      if (handleUnauthorizedResponse(response)) {
        return
      }

      if (!response.ok || !result.success) {
        setError(result.error ?? '탑승 확인에 실패했습니다.')
        return
      }

      setPresenceMode('onboard')
      if (draft) {
        const nextDraft = { ...draft, presenceMode: 'onboard' as const }
        setDraft(nextDraft)
        sessionStorage.setItem(WAITING_DRAFT_KEY, JSON.stringify(nextDraft))
        sessionStorage.setItem('boardingDraft', JSON.stringify(nextDraft))
      }

      if (result.data?.matched && result.data.match_id) {
        sessionStorage.setItem('activeMatchId', result.data.match_id)
        router.replace('/matching')
        return
      }

      setWaitingRank(result.data?.queue_position ?? 1)
      setIsSeekerWaiting(true)
    } catch {
      setError('탑승 확인 중 오류가 발생했습니다.')
    } finally {
      setIsConfirmingOnboard(false)
    }
  }

  async function handleCancel() {
    if (isCancelling) {
      return
    }

    if (!window.confirm('요청을 취소하시겠습니까?')) {
      return
    }

    setIsCancelling(true)

    const token = localStorage.getItem('token')
    const requestId = sessionStorage.getItem(ACTIVE_REQUEST_KEY)

    try {
      if (token && requestId) {
        const response = await fetch('/api/match-requests/status', {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            request_id: requestId,
            status: 'cancelled',
          }),
        })

        const result = (await response.json()) as {
          success?: boolean
          error?: string
        }

        if (!response.ok || !result.success) {
          setError(result.error ?? '요청 취소에 실패했습니다.')
          return
        }
      }
    } catch {
      setError('요청 취소 중 오류가 발생했습니다.')
      return
    } finally {
      setIsCancelling(false)
    }

    sessionStorage.removeItem('boardingDraft')
    sessionStorage.removeItem(WAITING_DRAFT_KEY)
    sessionStorage.removeItem(ACTIVE_REQUEST_KEY)
    sessionStorage.removeItem(REGISTERED_FLAG_KEY)
    sessionStorage.removeItem(PROVIDER_REGISTERED_FLAG_KEY)
    sessionStorage.removeItem('activeMatchId')
    router.push('/home')
  }

  const goBack = () => {
    router.push('/')
  }

  if (!isReady && !error) {
    return <WaitingLoading onBack={goBack} />
  }

  if (!draft && !error) {
    return (
      <WaitingPageLayout>
        <WaitingPageHeader onBack={goBack} />
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4">
          <p className="text-center text-sm font-medium text-[#475569]">
            진행 중인 등록이 없습니다.
          </p>
        </div>
      </WaitingPageLayout>
    )
  }

  const lineColor = draft ? resolveLineColor(draft) : '#747F00'
  const lineColorLight = 'rgba(116, 127, 0, 0.14)'
  const remainingStations = draft ? resolveRemainingStations(draft) : null
  const remainingStationsText =
    remainingStations === null ? '미확인' : `${remainingStations}`
  const isProviderDraft = draft?.role === 'provider'
  const waitingRole = isProviderDraft ? 'provider' : 'seeker'
  const isWaitingPanelVisible = isProviderDraft ? isProviderWaiting : isSeekerWaiting
  const showStatusPanel = matchPhase !== 'waiting' || isWaitingPanelVisible
  const isPlatformWaitingSeeker =
    !isProviderDraft && presenceMode === 'platform_waiting' && matchPhase === 'waiting'
  const statusTitle =
    matchPhase === 'accepted'
      ? '연결 완료'
      : matchPhase === 'connected'
        ? '연결됨'
        : isPlatformWaitingSeeker
          ? '플랫폼 대기 중'
          : '대기 중'
  const statusSubtitle =
    matchPhase === 'accepted'
      ? '좌석 안내 화면으로 이동합니다'
      : matchPhase === 'connected'
        ? CONNECTED_SUBTITLE_BY_ROLE[waitingRole]
        : isPlatformWaitingSeeker
          ? PLATFORM_WAITING_SUBTITLE
          : WAITING_SUBTITLE_BY_ROLE[waitingRole]
  const liveStatusLabel =
    matchPhase === 'waiting'
      ? isPlatformWaitingSeeker
        ? '탑승 전 대기'
        : '실시간 대기 중'
      : '진행 중'
  const guideItems =
    matchPhase === 'connected' || matchPhase === 'accepted'
      ? MATCH_PROGRESS_GUIDE_BY_ROLE[waitingRole]
      : isPlatformWaitingSeeker
        ? PLATFORM_WAITING_GUIDE
        : MATCH_GUIDE_BY_ROLE[waitingRole]
  const guideTitle =
    matchPhase === 'connected' || matchPhase === 'accepted' ? '진행 안내' : '이용 안내'
  return (
    <WaitingPageLayout>
      <WaitingPageHeader onBack={goBack} />

      <main
        className="zeb-no-scrollbar"
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          padding: '16px 0 0',
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

        {partnerAcceptedNotice ? (
          <div
            style={{
              background: '#F7F8F2',
              border: '1px solid #D5DDB8',
              borderRadius: 12,
              padding: '12px 14px',
              fontSize: 14,
              color: '#5F6B2E',
              fontWeight: 600,
            }}
            role="status"
          >
            상대방이 수락했습니다. 잠시 후 완료 화면으로 이동합니다.
          </div>
        ) : null}

        {showStatusPanel && (
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
                현재 상태
              </p>
              <p
                style={{
                  margin: '12px 0 0',
                  fontSize: 28,
                  fontWeight: 800,
                  lineHeight: 1.25,
                  color: lineColor,
                }}
              >
                {statusTitle}
              </p>
              <p style={{ margin: '10px 0 0', fontSize: 14, fontWeight: 500, color: '#6B7280' }}>
                {statusSubtitle}
              </p>
              {matchPhase === 'waiting' && !isProviderDraft && waitingRank != null ? (
                <p style={{ margin: '8px 0 0', fontSize: 13, fontWeight: 600, color: '#9CA3AF' }}>
                  대기 순위 {waitingRank}위
                </p>
              ) : null}
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
                  {liveStatusLabel}
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
                    등록 유형
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#1A1A1A' }}>
                    {MATCH_TYPE_LABEL_BY_ROLE[waitingRole]}
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
                {guideTitle}
              </p>
              <ol style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {guideItems.map((label, index) => (
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
          padding: `16px 0 max(24px, env(safe-area-inset-bottom))`,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        {isPlatformWaitingSeeker ? (
          <button
            type="button"
            disabled={isConfirmingOnboard}
            onClick={() => {
              void handleConfirmOnboard()
            }}
            style={{
              width: '100%',
              minHeight: 48,
              padding: '12px 0',
              background: lineColor,
              border: 'none',
              borderRadius: 12,
              fontSize: 15,
              fontWeight: 700,
              color: '#FFFFFF',
              cursor: isConfirmingOnboard ? 'not-allowed' : 'pointer',
              opacity: isConfirmingOnboard ? 0.7 : 1,
            }}
          >
            {isConfirmingOnboard ? '탑승 확인 중...' : '탑승했어요 — 매칭 시작'}
          </button>
        ) : null}
        <button
          type="button"
          disabled={isCancelling}
          onClick={() => {
            void handleCancel()
          }}
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
            cursor: isCancelling ? 'not-allowed' : 'pointer',
            opacity: isCancelling ? 0.6 : 1,
          }}
        >
          {isCancelling ? '취소 중...' : '요청 취소'}
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
          background: #747F00;
          animation: wait-live-pulse 1.4s ease-in-out infinite;
        }
      `}</style>
    </WaitingPageLayout>
  )
}
