'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AppHamburgerMenu from '@/components/AppHamburgerMenu'
import CongestionHaltModal from '@/components/CongestionHaltModal'
import HomeMatchProgressBar from '@/components/HomeMatchProgressBar'
import {
  fetchCongestionStatus,
  isLineHalted,
  resolveLineNumberFromLabel,
  type CongestionStatus,
} from '@/lib/congestion'
import { formatStationDisplayName } from '@/lib/match-display'
import { cancelMatchRequestClient } from '@/lib/cancel-match-request'
import {
  resolveHomeProgressBannerLabel,
  resolveHomeProgressStep,
  resolveHomeRegistrationPurposeLine,
  type HomeMatchProgress,
} from '@/lib/match-home-progress'
import { resolveMatchFlowStep } from '@/lib/match-flow-steps'
import type { MatchMovementPayload } from '@/lib/match-movement'
import { resolveActiveMatchNavigationTarget } from '@/lib/match-session'
import {
  isSubwayOperatingHours,
  SUBWAY_OUTSIDE_OPERATING_HOURS_MESSAGE,
} from '@/lib/subway-operating-hours'
interface StoredUser {
  username: string
  nickname?: string | null
  total_points?: number
}

/** 홈 GPS 프리페치 — 탑승 화면 캐시와 동일한 1km 기준 */
const GPS_MAX_RADIUS_KM = 1
/** 배포 후 구 UI 캐시(SW·브라우저) 1회 갱신 */
const HOME_UI_VERSION = '2026-06-11-first-visit-v32'
/** 홈 2단계 — 현재 서울 7호선만 노출 */
const HOME_LINE_OPTIONS = [
  // {
  //   label: '서울 1호선',
  //   shortLabel: '1호선',
  //   badge: '1',
  //   color: '#747F00',
  //   stationExamples: '서울역 · 종로 · 청량리',
  // },
  // {
  //   label: '서울 2호선',
  //   shortLabel: '2호선',
  //   badge: '2',
  //   color: '#747F00',
  //   stationExamples: '강남 · 잠실 · 홍대',
  // },
  // {
  //   label: '인천 1호선',
  //   shortLabel: '인천1',
  //   badge: '인1',
  //   color: '#7CA8D5',
  //   stationExamples: '부평 · 예술회관 · 원인재',
  // },
  // {
  //   label: '인천 2호선',
  //   shortLabel: '인천2',
  //   badge: '인2',
  //   color: '#ED8B00',
  //   stationExamples: '검단오류 · 주안 · 운연',
  // },
  {
    label: '서울 7호선',
    shortLabel: '7호선',
    badge: '7',
    color: '#747F00',
    stationExamples: '장암 · 논현 · 석남',
  },
] as const

/** 단독 운영 노선 — 노선 선택 단계 생략 시 사용 */
const DEFAULT_HOME_LINE_LABEL = HOME_LINE_OPTIONS[0].label

/** 서울 7호선 공식 색상 — 앱 전역과 동일 (#747F00) */
const LINE7_PRIMARY = '#747F00'
const LINE7_PRIMARY_DARK = '#5F6B2E'
const LINE7_PRIMARY_DEEP = '#4A5520'
const LINE7_SOFT_BG = '#F3F5E8'
const LINE7_MUTED_BG = '#EDF0DC'
const LINE7_SUCCESS_BG = '#E8EDCF'
const LINE7_BORDER = '#D5DDB8'
const LINE7_BORDER_STRONG = '#C4CE8F'
const LINE7_ACCENT = '#8A9A5B'

const HOME_ACTION_BTN_BASE =
  'zeb-touch-target flex min-h-[4.5rem] flex-col items-center justify-center rounded-xl border px-3 py-3 text-center transition-colors duration-150 disabled:cursor-not-allowed'

/** 빈자리 찾기·자리 넘기기 공통 — 7호선 색상 */
function resolveHomeActionButtonClass(isRegistering: boolean): string {
  if (isRegistering) {
    return `${HOME_ACTION_BTN_BASE} border-[#5F6B2E] bg-[#5F6B2E] text-white disabled:opacity-100`
  }
  return `${HOME_ACTION_BTN_BASE} border-[#747F00] bg-white text-[#747F00] hover:border-[#747F00] hover:bg-[#747F00] hover:text-white active:border-[#5F6B2E] active:bg-[#5F6B2E] active:text-white disabled:opacity-45`
}

/** 홈 노선 라벨 → API line 파라미터 */
function resolveHomeApiLine(lineLabel: string): string {
  const compact = lineLabel.replace(/\s+/g, '')
  const seoulMatch = compact.match(/^서울([1-9])호선$/)
  if (seoulMatch?.[1]) {
    return `seoul${seoulMatch[1]}`
  }

  const incheonMatch = compact.match(/^인천([12])호선$/)
  if (incheonMatch?.[1]) {
    return `incheon${incheonMatch[1]}`
  }

  return 'seoul7'
}

type HomeFlowMode = 'seek' | 'leave'

/** 환승 많은 역 — 노출 순위 고정 (1~5) */
const HOME_TRANSFER_STATIONS = [
  { label: '가산디지털단지역', destination: '가산디지털단지역' },
  { label: '철산역', destination: '철산역' },
  { label: '학동역', destination: '학동역' },
  { label: '광명사거리역', destination: '광명사거리역' },
  { label: '어린이대공원(세종대)역', destination: '어린이대공원역' },
] as const

// const VOICE_PARSE_PENDING_KEY = 'voiceParsePending'

// type HomeStep = 'mode' | 'line'

// function ChevronRightIcon() {
//   return (
//     <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0" style={{ color: LINE7_OLIVE }}>
//       <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
//     </svg>
//   )
// }

function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (v: number) => (v * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function mapLineLabelToApiLine(lineLabel: string): string | null {
  const normalized = lineLabel.replace(/\s+/g, '')
  if (normalized === '인천1호선') return 'incheon1'
  if (normalized === '인천2호선') return 'incheon2'
  const match = normalized.match(/^서울([1-9])호선$/)
  if (match?.[1]) return `seoul${match[1]}`
  return null
}

type HomeWaitPhase =
  | 'waiting_seek'
  | 'waiting_leave'
  | 'match_alert'
  | 'match_in_progress'
  | 'match_done'

const HOME_MATCH_COMPLETED_HINT_KEY = 'homeMatchCompletedHint'

interface HomeMatchCompletedHint {
  kind: 'seek' | 'leave'
  destinationName: string
  completedAt: number
}

interface HomeWaitView {
  requestId: string
  phase: HomeWaitPhase
  registrationKind: 'seek' | 'leave'
  destinationName: string
  queuePosition: number | null
  waitingCount: number
  matchId: string | null
  matchStatus: string | null
  trainNo: string | null
  carNumber: number | null
  homeProgress: HomeMatchProgress | null
}

type HomeMatchStatusBoxKind = 'waiting' | 'completed' | 'failed' | 'in_progress'

interface HomeMatchStatusBox {
  kind: HomeMatchStatusBoxKind
  label: string
  emoji: string
  backgroundColor: string
  textColor: string
}

/** Supabase 활성 매칭 데이터 기준 — 홈 상태 박스 표시 여부·스타일 */
function resolveHomeMatchStatusBox(view: HomeWaitView | null): HomeMatchStatusBox | null {
  if (!view) {
    return null
  }

  if (view.phase === 'match_in_progress' && view.homeProgress) {
    return {
      kind: 'in_progress',
      label: resolveHomeProgressBannerLabel({
        registrationKind: view.registrationKind,
        step: view.homeProgress.step,
        matchCompleted: view.homeProgress.matchCompleted,
      }),
      emoji: '●',
      backgroundColor: '#FFF8F0',
      textColor: '#8B6914',
    }
  }

  if (view.phase === 'match_done') {
    return {
      kind: 'completed',
      label: resolveHomeProgressBannerLabel({
        registrationKind: view.registrationKind,
        step: 'seated',
        matchCompleted: true,
      }),
      emoji: '✓',
      backgroundColor: LINE7_SUCCESS_BG,
      textColor: LINE7_PRIMARY_DEEP,
    }
  }

  if (view.matchStatus === 'expired' || view.matchStatus === 'cancelled') {
    return {
      kind: 'failed',
      label: '연결 실패',
      emoji: '✕',
      backgroundColor: '#F0EBE6',
      textColor: '#7D5A52',
    }
  }

  if (view.phase === 'match_alert' || view.matchStatus === 'pending') {
    return {
      kind: 'waiting',
      label: '연결됨',
      emoji: '●',
      backgroundColor: LINE7_SUCCESS_BG,
      textColor: LINE7_PRIMARY_DEEP,
    }
  }

  if (view.phase === 'waiting_seek' || view.phase === 'waiting_leave') {
    return {
      kind: 'waiting',
      label: '대기 중',
      emoji: '●',
      backgroundColor: LINE7_MUTED_BG,
      textColor: LINE7_PRIMARY_DARK,
    }
  }

  return null
}

/** 내 등록 상태 카드 — ①진행상태 ②무엇·어디까지 ③매칭 여부 */
function resolveHomeMyRegistrationCard(view: HomeWaitView): {
  statusBadge: string
  purposeLine: string
  progressLine: string
} {
  const purposeLine = resolveHomeRegistrationPurposeLine(
    view.registrationKind,
    view.destinationName
  )

  if (view.phase === 'match_done') {
    return {
      statusBadge:
        view.registrationKind === 'leave' ? '양보 완료' : '착석 완료',
      purposeLine,
      progressLine:
        view.registrationKind === 'leave'
          ? '목적지 전에도 다시 등록해 주세요. 다른 분과 또 연결될 수 있어요.'
          : '다시 등록하면 다른 빈자리와 또 연결될 수 있어요.',
    }
  }

  if (view.phase === 'match_in_progress') {
    return {
      statusBadge: '진행 중',
      purposeLine,
      progressLine: '탭하면 상세 화면으로 이동합니다',
    }
  }

  if (view.phase === 'match_alert') {
    return {
      statusBadge: '연결됨',
      purposeLine,
      progressLine:
        view.registrationKind === 'leave'
          ? '착석 희망자 확인 · 탭해서 수락'
          : '이동 후 수락해 주세요',
    }
  }

  if (view.phase === 'waiting_leave') {
    const poolText =
      view.waitingCount > 0 ? `${view.waitingCount}명` : '모이는 중'
    return {
      statusBadge: '대기 중',
      purposeLine,
      progressLine: `착석 희망자 ${poolText} 대기`,
    }
  }

  const rankText = view.queuePosition != null ? `${view.queuePosition}번째` : '순서 확인 중'
  const totalText = view.waitingCount > 0 ? ` / ${view.waitingCount}명` : ''

  return {
    statusBadge: '대기 중',
    purposeLine,
    progressLine: `대기 순서 ${rankText}${totalText}`,
  }
}

interface HomeWaitDraft {
  role?: string
  destinationName?: string
  trainNo?: string
  carNumber?: number
}

/** 등록 직후 sessionStorage에 남은 대기 정보를 읽습니다. */
function loadHomeWaitDraftFromSession(): {
  requestId: string
  draft: HomeWaitDraft
} | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const requestId = sessionStorage.getItem('activeMatchRequestId')?.trim()
    if (!requestId) {
      return null
    }

    const seekerRegistered =
      sessionStorage.getItem('seekerMatchRequestRegistered') === 'true'
    const providerRaw = sessionStorage.getItem('providerRegistered')
    const providerRegistered =
      providerRaw === 'true' ||
      Boolean(providerRaw && providerRaw !== 'false')

    if (!seekerRegistered && !providerRegistered) {
      return null
    }

    const rawDraft =
      sessionStorage.getItem('boardingDraft') ??
      sessionStorage.getItem('waitingDraft')
    if (!rawDraft) {
      return { requestId, draft: {} }
    }

    const parsed = JSON.parse(rawDraft) as HomeWaitDraft & {
      destination_name?: string
      train_no?: string
      car_number?: number
    }

    return {
      requestId,
      draft: {
        role: parsed.role,
        destinationName: parsed.destinationName ?? parsed.destination_name,
        trainNo: parsed.trainNo ?? parsed.train_no,
        carNumber: parsed.carNumber ?? parsed.car_number,
      },
    }
  } catch {
    return null
  }
}

/** 서버에 활성 요청이 없을 때 남은 등록 session을 정리합니다. */
function clearHomeMatchSession(): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    sessionStorage.removeItem('boardingDraft')
    sessionStorage.removeItem('waitingDraft')
    sessionStorage.removeItem('providerRegistered')
    sessionStorage.removeItem('activeMatchId')
    sessionStorage.removeItem('activeMatchRequestId')
    sessionStorage.removeItem('seekerMatchRequestRegistered')
  } catch {
    // sessionStorage 정리 실패 시 무시합니다.
  }
}

/** 매칭 완료 후 홈에서 재등록 안내를 표시하기 위한 힌트를 읽습니다. */
function loadHomeMatchCompletedHint(): HomeMatchCompletedHint | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const raw = sessionStorage.getItem(HOME_MATCH_COMPLETED_HINT_KEY)
    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as HomeMatchCompletedHint
    if (parsed.kind !== 'seek' && parsed.kind !== 'leave') {
      return null
    }

    if (!parsed.destinationName?.trim()) {
      return null
    }

    return parsed
  } catch {
    return null
  }
}

function clearHomeMatchCompletedHint(): void {
  if (typeof window === 'undefined') {
    return
  }

  sessionStorage.removeItem(HOME_MATCH_COMPLETED_HINT_KEY)
}

function buildHomeMatchDoneView(hint: HomeMatchCompletedHint): HomeWaitView {
  return {
    requestId: '',
    phase: 'match_done',
    registrationKind: hint.kind,
    destinationName: formatStationDisplayName(hint.destinationName.trim()),
    queuePosition: null,
    waitingCount: 0,
    matchId: null,
    matchStatus: 'accepted',
    trainNo: null,
    carNumber: null,
    homeProgress: {
      step: 'seated',
      flowStep: 'done',
      handoffRemaining: null,
      seatConfirmed: true,
      matchCompleted: true,
      trainCurrentStationName: null,
      providerDirectionLabel: null,
      positionIsLive: false,
    },
  }
}

function resolveHomeWaitViewFromCompletedHint(): HomeWaitView | null {
  const hint = loadHomeMatchCompletedHint()
  if (!hint) {
    return null
  }

  return buildHomeMatchDoneView(hint)
}

async function fetchMatchRequestStatus(
  token: string,
  requestId: string
): Promise<{
  queuePosition: number | null
  pendingMatchId: string | null
  acceptedMatchId: string | null
  matchStatus: string | null
  requestType: string | null
  requestStatus: string | null
}> {
  const statusResponse = await fetch(
    `/api/match-requests/status?request_id=${encodeURIComponent(requestId)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    }
  )

  const statusPayload = (await statusResponse.json()) as {
    success?: boolean
    data?: {
      queue_position?: number | null
      match?: { id?: string; status?: string } | null
      match_request?: { request_type?: string; status?: string } | null
    }
  }

  if (!statusResponse.ok || !statusPayload.success) {
    return {
      queuePosition: null,
      pendingMatchId: null,
      acceptedMatchId: null,
      matchStatus: null,
      requestType: null,
      requestStatus: null,
    }
  }

  const matchStatus = statusPayload.data?.match?.status ?? null
  const matchId = statusPayload.data?.match?.id ?? null
  const pendingMatchId = matchStatus === 'pending' ? matchId : null
  const acceptedMatchId = matchStatus === 'accepted' ? matchId : null

  return {
    queuePosition: statusPayload.data?.queue_position ?? null,
    pendingMatchId,
    acceptedMatchId,
    matchStatus,
    requestType: statusPayload.data?.match_request?.request_type ?? null,
    requestStatus: statusPayload.data?.match_request?.status ?? null,
  }
}

async function fetchHomeMatchProgress(
  token: string,
  matchId: string
): Promise<HomeMatchProgress | null> {
  try {
    const response = await fetch(`/api/matches/${encodeURIComponent(matchId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })

    const payload = (await response.json()) as {
      success?: boolean
      data?: {
        status?: string
        viewer_role?: 'seeker' | 'provider'
        movement?: MatchMovementPayload
        seat_confirmation?: { seated?: boolean } | null
      }
    }

    if (!response.ok || !payload.success || !payload.data) {
      return null
    }

    const data = payload.data
    const matchCompleted = data.status === 'completed'
    const handoffRemaining =
      data.movement?.route_guide.handoff_remaining_stations ?? null
    const seatConfirmed = data.seat_confirmation?.seated === true
    const viewerRole = data.viewer_role ?? 'seeker'
    const flowStep = resolveMatchFlowStep({
      matchStatus: data.status ?? 'accepted',
      viewerRole,
      selfMovementStatus: data.movement?.self.status,
      partnerMovementStatus: data.movement?.partner.status,
      handoffRemainingStations: handoffRemaining,
      seatConfirmed,
    })

    const step = resolveHomeProgressStep({
      flowStep,
      handoffRemaining,
      seatConfirmed,
      matchCompleted,
    })

    return {
      step,
      flowStep,
      handoffRemaining,
      seatConfirmed,
      matchCompleted,
      trainCurrentStationName:
        data.movement?.route_guide.train_current_station_name ?? null,
      providerDirectionLabel:
        data.movement?.route_guide.provider_direction_label ?? null,
      positionIsLive: data.movement?.route_guide.position_is_live === true,
    }
  } catch {
    return null
  }
}

function buildHomeWaitView(input: {
  requestId: string
  requestType: string | null
  requestStatus: string | null
  destinationName: string
  queuePosition: number | null
  waitingCount: number
  pendingMatchId: string | null
  acceptedMatchId: string | null
  matchStatus: string | null
  trainNo: string | null
  carNumber: number | null
  homeProgress: HomeMatchProgress | null
}): HomeWaitView | null {
  const registrationKind: 'seek' | 'leave' =
    input.requestType === 'leaving' ? 'leave' : 'seek'

  const baseView = {
    requestId: input.requestId,
    registrationKind,
    destinationName: input.destinationName,
    queuePosition: input.queuePosition,
    waitingCount: input.waitingCount,
    matchStatus: input.matchStatus,
    trainNo: input.trainNo,
    carNumber: input.carNumber,
    homeProgress: input.homeProgress,
  }

  if (input.requestStatus === 'cancelled') {
    return null
  }

  if (input.requestStatus === 'matched' && input.matchStatus !== 'accepted') {
    return {
      ...baseView,
      phase: 'match_alert',
      matchId: input.pendingMatchId,
      homeProgress: null,
    }
  }

  if (input.matchStatus === 'accepted') {
    const matchId = input.acceptedMatchId ?? input.pendingMatchId
    if (input.homeProgress?.matchCompleted) {
      return {
        ...baseView,
        phase: 'match_done',
        matchId,
        homeProgress: input.homeProgress,
      }
    }

    return {
      ...baseView,
      phase: 'match_in_progress',
      matchId,
      homeProgress:
        input.homeProgress ?? {
          step: 'matched',
          flowStep: 'move',
          handoffRemaining: null,
          seatConfirmed: false,
          matchCompleted: false,
          trainCurrentStationName: null,
          providerDirectionLabel: null,
          positionIsLive: false,
        },
    }
  }

  if (input.pendingMatchId) {
    return {
      ...baseView,
      phase: 'match_alert',
      matchId: input.pendingMatchId,
      homeProgress: null,
    }
  }

  if (
    input.matchStatus === 'expired' ||
    input.matchStatus === 'cancelled'
  ) {
    return {
      ...baseView,
      phase:
        input.requestType === 'leaving' ? 'waiting_leave' : 'waiting_seek',
      matchId: null,
      homeProgress: null,
    }
  }

  if (input.requestStatus && input.requestStatus !== 'waiting') {
    return null
  }

  return {
    ...baseView,
    phase: input.requestType === 'leaving' ? 'waiting_leave' : 'waiting_seek',
    matchId: null,
    homeProgress: null,
  }
}

/** 서버·sessionStorage에서 현재 매칭·대기 상태를 조회합니다. */
async function fetchHomeWaitView(token: string): Promise<HomeWaitView | null> {
  let requestId: string | null = null
  let requestType: string | null = null
  let requestStatus: string | null = null
  let destinationName = '목적지'
  let waitingCount = 0
  let trainNo: string | null = null
  let carNumber: number | null = null

  try {
    const currentResponse = await fetch('/api/match-requests/current', {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })

    const currentPayload = (await currentResponse.json()) as {
      success?: boolean
      data?: {
        id?: string
        status?: string
        request_type?: string | null
        destination_station_name?: string | null
        train_no?: string | null
        car_number?: number | null
        waiting_count?: number
      }
    }

    if (currentResponse.ok && currentPayload.success && currentPayload.data?.id) {
      const current = currentPayload.data
      requestId = current.id ?? null
      requestType = current.request_type ?? null
      requestStatus = current.status ?? null
      destinationName = formatStationDisplayName(
        current.destination_station_name?.trim() || '목적지'
      )
      waitingCount = current.waiting_count ?? 0
      trainNo = current.train_no ?? null
      carNumber = current.car_number ?? null
    }
  } catch {
    // current API 실패 시 sessionStorage로 이어갑니다.
  }

  if (!requestId) {
    const sessionSnapshot = loadHomeWaitDraftFromSession()
    if (!sessionSnapshot) {
      return null
    }

    requestId = sessionSnapshot.requestId
    requestType =
      sessionSnapshot.draft.role === 'provider' ? 'leaving' : 'seat_seek'
    requestStatus = 'waiting'
    destinationName = formatStationDisplayName(
      sessionSnapshot.draft.destinationName?.trim() || '목적지'
    )
    trainNo = sessionSnapshot.draft.trainNo ?? null
    carNumber = sessionSnapshot.draft.carNumber ?? null
  }

  const status = await fetchMatchRequestStatus(token, requestId)
  if (status.requestType) {
    requestType = status.requestType
  }
  if (status.requestStatus) {
    requestStatus = status.requestStatus
  }

  if (requestStatus === 'cancelled') {
    clearHomeMatchSession()
    return null
  }

  try {
    sessionStorage.setItem('activeMatchRequestId', requestId)
    if (status.pendingMatchId) {
      sessionStorage.setItem('activeMatchId', status.pendingMatchId)
    }
    if (requestType === 'leaving') {
      sessionStorage.setItem('providerRegistered', 'true')
    } else {
      sessionStorage.setItem('seekerMatchRequestRegistered', 'true')
    }
  } catch {
    // sessionStorage 실패 시 홈 표시만 유지합니다.
  }

  let homeProgress: HomeMatchProgress | null = null
  if (status.acceptedMatchId) {
    homeProgress = await fetchHomeMatchProgress(token, status.acceptedMatchId)
  }

  const view = buildHomeWaitView({
    requestId,
    requestType,
    requestStatus,
    destinationName,
    queuePosition: status.queuePosition,
    waitingCount,
    pendingMatchId: status.pendingMatchId,
    acceptedMatchId: status.acceptedMatchId,
    matchStatus: status.matchStatus,
    trainNo,
    carNumber,
    homeProgress,
  })

  if (!view) {
    clearHomeMatchSession()
  }

  return view
}

/**
 * 메인 홈
 */
export default function Home() {
  const router = useRouter()
  const pathname = usePathname()
  const transferScrollRef = useRef<HTMLDivElement>(null)
  const [user, setUser] = useState<StoredUser | null>(null)
  const [isAuthChecked, setIsAuthChecked] = useState(false)
  const [isLoadingData, setIsLoadingData] = useState(true)
  const [isMatchingPaused, setIsMatchingPaused] = useState(false)
  const [congestionStatus, setCongestionStatus] = useState<CongestionStatus | null>(null)
  const [showCongestionModal, setShowCongestionModal] = useState(false)
  const [selectedLineLabel, setSelectedLineLabel] = useState<string>('서울 7호선')
  const [activeTab, setActiveTab] = useState<HomeFlowMode | null>(null)
  const [transferStationsLoading, setTransferStationsLoading] = useState(false)
  const [transferStations, setTransferStations] = useState<
    (typeof HOME_TRANSFER_STATIONS)[number][]
  >([...HOME_TRANSFER_STATIONS])
  const [selectedTransferStation, setSelectedTransferStation] = useState<string | null>(null)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [homeWaitView, setHomeWaitView] = useState<HomeWaitView | null>(null)
  const [isCancellingHomeWait, setIsCancellingHomeWait] = useState(false)
  const isOutsideOperatingHours = useMemo(
    () => !isSubwayOperatingHours(resolveHomeApiLine(selectedLineLabel)),
    [selectedLineLabel]
  )
  const loadHomeData = useCallback(async (token: string | null) => {
    setIsLoadingData(true)

    const status = await fetchCongestionStatus(token)
    setCongestionStatus(status)
    setIsLoadingData(false)
  }, [])

  const loadHomeWaitStatus = useCallback(async (token: string | null) => {
    const applyCompletedHintOnly = () => {
      setHomeWaitView(resolveHomeWaitViewFromCompletedHint())
    }

    if (!token) {
      applyCompletedHintOnly()
      return
    }

    try {
      const view = await fetchHomeWaitView(token)
      if (view) {
        clearHomeMatchCompletedHint()
        setHomeWaitView(view)
        return
      }

      clearHomeMatchSession()
      applyCompletedHintOnly()
    } catch {
      clearHomeMatchSession()
      applyCompletedHintOnly()
    }
  }, [])

  const loadTransferStations = useCallback(() => {
    setTransferStations([...HOME_TRANSFER_STATIONS])
    setTransferStationsLoading(false)
  }, [])

  useEffect(() => {
    const paused = isLineHalted(congestionStatus, DEFAULT_HOME_LINE_LABEL)
    setIsMatchingPaused(paused)
  }, [congestionStatus, isLoadingData])

  useEffect(() => {
    try {
      const token = localStorage.getItem('token')
      const raw = localStorage.getItem('user')
      if (token && raw) {
        setUser(JSON.parse(raw) as StoredUser)
      } else {
        setUser(null)
      }
      setIsAuthChecked(true)
      void loadHomeData(token)
      void loadHomeWaitStatus(token)
    } catch {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      setUser(null)
      setIsAuthChecked(true)
      void loadHomeData(null)
      setHomeWaitView(null)
    }
  }, [loadHomeData, loadHomeWaitStatus])

  useEffect(() => {
    void loadTransferStations()
  }, [loadTransferStations])

  const displayName = user?.username ?? null
  const isLoggedIn = Boolean(displayName)

  useEffect(() => {
    let token: string | null = null
    try {
      token = localStorage.getItem('token')
    } catch {
      token = null
    }

    const intervalMs =
      homeWaitView?.phase === 'match_in_progress'
        ? 3000
        : homeWaitView?.phase === 'waiting_seek' ||
            homeWaitView?.phase === 'waiting_leave'
          ? 5000
          : 20000

    const timer = window.setInterval(() => {
      void loadHomeWaitStatus(token)
    }, intervalMs)

    return () => window.clearInterval(timer)
  }, [loadHomeWaitStatus, homeWaitView?.phase])

  useEffect(() => {
    function handleVisibilityRefresh() {
      if (document.visibilityState !== 'visible') {
        return
      }

      let token: string | null = null
      try {
        token = localStorage.getItem('token')
      } catch {
        token = null
      }

      void loadHomeWaitStatus(token)
    }

    document.addEventListener('visibilitychange', handleVisibilityRefresh)
    return () => document.removeEventListener('visibilitychange', handleVisibilityRefresh)
  }, [loadHomeWaitStatus])

  useEffect(() => {
    if (pathname !== '/') {
      return
    }

    let token: string | null = null
    try {
      token = localStorage.getItem('token')
    } catch {
      token = null
    }

    void loadHomeWaitStatus(token)
  }, [pathname, loadHomeWaitStatus])

  async function pushBoardingPage(
    lineLabel: string,
    mode: HomeFlowMode,
    destination?: string
  ) {
    const params = new URLSearchParams({
      type: mode,
      lineLabel,
    })
    if (destination) {
      params.set('destination', destination)
    }
    router.push(`/boarding?${params.toString()}`)
  }

  async function pushSeekPage(lineLabel: string, destination?: string) {
    await pushBoardingPage(lineLabel, 'seek', destination)
  }

  function handleModeSelect(mode: HomeFlowMode, destination?: string) {
    clearHomeMatchCompletedHint()
    setActiveTab(mode)
    // 단독 노선(서울 7호선) — 노선 선택 단계 생략
    // setHomeStep('line')
    handleLinePick(DEFAULT_HOME_LINE_LABEL, mode, destination)
  }

  function handleTransferStationClick(station: (typeof HOME_TRANSFER_STATIONS)[number]) {
    if (isMatchingPaused) {
      return
    }

    setSelectedTransferStation(station.label)
    setToastMessage(`${station.label}을 목적지로 설정했어요 📍`)
    setTimeout(() => {
      setToastMessage(null)
    }, 1500)

    if (typeof window !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          void (async () => {
            try {
              const apiLine = mapLineLabelToApiLine(DEFAULT_HOME_LINE_LABEL)

              if (apiLine) {
                const response = await fetch(`/api/stations?line=${encodeURIComponent(apiLine)}`, {
                  method: 'GET',
                  cache: 'default',
                })
                if (response.ok) {
                  const payload = (await response.json()) as {
                    success?: boolean
                    stations?: Array<{
                      name?: string
                      lat?: number | null
                      lng?: number | null
                    }>
                  }
                  if (payload.success && Array.isArray(payload.stations)) {
                    let nearestWithinRadius: { name: string; dist: number } | null = null
                    for (const station of payload.stations) {
                      if (
                        !station?.name ||
                        typeof station.lat !== 'number' ||
                        typeof station.lng !== 'number'
                      ) {
                        continue
                      }
                      const dist = distanceKm(
                        position.coords.latitude,
                        position.coords.longitude,
                        station.lat,
                        station.lng
                      )
                      if (dist <= GPS_MAX_RADIUS_KM) {
                        if (!nearestWithinRadius || dist < nearestWithinRadius.dist) {
                          nearestWithinRadius = { name: station.name, dist }
                        }
                      }
                    }
                    if (nearestWithinRadius?.name) {
                      await saveDetectedLocation(
                        DEFAULT_HOME_LINE_LABEL,
                        position.coords.latitude,
                        position.coords.longitude,
                        nearestWithinRadius.name,
                        true,
                        nearestWithinRadius.dist
                      )
                    }
                  }
                }
              }
            } catch {
              // 백그라운드 위치 저장 실패는 무시합니다.
            }
          })()
        },
        () => {
          // 위치 거부 시에도 바로 앉기 등록 흐름은 계속합니다.
        },
        {
          enableHighAccuracy: false,
          timeout: 3000,
          maximumAge: 120000,
        }
      )
    }

    handleModeSelect('seek', station.destination)
  }

  function scrollTransferStations(direction: 'prev' | 'next') {
    const container = transferScrollRef.current
    if (!container) {
      return
    }

    container.scrollBy({
      left: direction === 'next' ? 120 : -120,
      behavior: 'smooth',
    })
  }

  async function handleCancelHomeWaitRequest() {
    if (!homeWaitView?.requestId) {
      return
    }

    const isWaitingPhase =
      homeWaitView.phase === 'waiting_seek' || homeWaitView.phase === 'waiting_leave'
    const isActiveMatchPhase =
      homeWaitView.phase === 'match_in_progress' || homeWaitView.phase === 'match_alert'

    if (!isWaitingPhase && !isActiveMatchPhase) {
      return
    }

    const confirmMessage = isActiveMatchPhase
      ? '매칭을 취소하시겠습니까?\n급한 일로 중간에 내리면 상대방은 다시 매칭 대기로 돌아갑니다.'
      : '요청을 취소하시겠습니까?'

    if (!window.confirm(confirmMessage)) {
      return
    }

    let token: string | null = null
    try {
      token = localStorage.getItem('token')
    } catch {
      token = null
    }

    if (!token) {
      return
    }

    setIsCancellingHomeWait(true)

    try {
      const result = await cancelMatchRequestClient(token, homeWaitView.requestId)
      if (!result.success) {
        return
      }

      clearHomeMatchSession()
      setHomeWaitView(null)
    } catch {
      // 취소 실패 시 배너는 유지합니다.
    } finally {
      setIsCancellingHomeWait(false)
    }
  }

  function handleHomeWaitStatusClick() {
    if (!homeWaitView) {
      return
    }

    if (homeWaitView.phase === 'match_alert' && homeWaitView.matchId) {
      const token = localStorage.getItem('token')
      if (!token) {
        router.push('/login')
        return
      }

      void (async () => {
        const navigationTarget = await resolveActiveMatchNavigationTarget(
          token,
          homeWaitView.matchId as string,
          homeWaitView.requestId
        )

        if (navigationTarget === 'matching') {
          try {
            sessionStorage.setItem('activeMatchId', homeWaitView.matchId as string)
          } catch {
            // sessionStorage 실패 시에도 매칭 화면으로 이동합니다.
          }
          router.push('/matching')
          return
        }

        if (navigationTarget === 'matched') {
          router.push('/matched')
          return
        }

        clearHomeMatchSession()
        setHomeWaitView(null)
      })()
      return
    }

    if (homeWaitView.phase === 'match_in_progress') {
      router.push('/matched')
      return
    }

    router.push('/waiting')
  }

  // function handleBackToModeStep() {
  //   setHomeStep('mode')
  //   setActiveTab(null)
  // }

  async function proceedToBoarding(
    lineLabel: string,
    modeOverride?: HomeFlowMode,
    destination?: string
  ) {
    const mode = modeOverride ?? activeTab
    if (!mode) return
    if (isLineHalted(congestionStatus, lineLabel)) {
      setSelectedLineLabel(lineLabel)
      setShowCongestionModal(true)
      return
    }
    setSelectedLineLabel(lineLabel)
    if (mode === 'seek') {
      void startSeekByLineSelection(lineLabel, destination)
      return
    }
    void pushBoardingPage(lineLabel, mode, destination)
  }

  function handleLinePick(
    lineLabel: string,
    modeOverride?: HomeFlowMode,
    destination?: string
  ) {
    const mode = modeOverride ?? activeTab
    if (isMatchingPaused || !mode) return

    if (isLineHalted(congestionStatus, lineLabel)) {
      setSelectedLineLabel(lineLabel)
      setShowCongestionModal(true)
      return
    }

    const token = localStorage.getItem('token')
    if (!token) {
      const params = new URLSearchParams({
        type: mode,
        lineLabel,
      })
      if (destination) {
        params.set('destination', destination)
      }
      router.push(`/register?${params.toString()}`)
      return
    }

    void proceedToBoarding(lineLabel, mode, destination)
  }

  async function saveDetectedLocation(
    lineLabel: string,
    lat: number,
    lng: number,
    nearestStationName: string,
    within1km: boolean,
    distanceKm: number | null
  ) {
    try {
      sessionStorage.setItem(
        'boardingDetectedLocation',
        JSON.stringify({
          lineLabel,
          lat,
          lng,
          nearestStationName,
          detectedAt: Date.now(),
          within1km,
          distanceKm,
        })
      )
    } catch {
      // 저장 실패 시 탑승 흐름은 유지합니다.
    }
  }

  async function startSeekByLineSelection(lineLabel: string, destination?: string) {
    if (isLineHalted(congestionStatus, lineLabel)) {
      setShowCongestionModal(true)
      return
    }
    setSelectedLineLabel(lineLabel)
    // GPS·역 목록 조회를 기다리지 않고 바로 탑승 화면으로 이동합니다.
    void pushSeekPage(lineLabel, destination)

    if (typeof window === 'undefined' || !navigator.geolocation) {
      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        void (async () => {
          try {
            const apiLine = mapLineLabelToApiLine(lineLabel)

            if (apiLine) {
              const response = await fetch(`/api/stations?line=${encodeURIComponent(apiLine)}`, {
                method: 'GET',
                cache: 'default',
              })
              if (response.ok) {
                const payload = (await response.json()) as {
                  success?: boolean
                  stations?: Array<{
                    name?: string
                    lat?: number | null
                    lng?: number | null
                  }>
                }
                if (payload.success && Array.isArray(payload.stations)) {
                  let nearestWithinRadius: { name: string; dist: number } | null = null
                  for (const station of payload.stations) {
                    if (
                      !station?.name ||
                      typeof station.lat !== 'number' ||
                      typeof station.lng !== 'number'
                    ) {
                      continue
                    }
                    const dist = distanceKm(
                      position.coords.latitude,
                      position.coords.longitude,
                      station.lat,
                      station.lng
                    )
                    if (dist <= GPS_MAX_RADIUS_KM) {
                      if (!nearestWithinRadius || dist < nearestWithinRadius.dist) {
                        nearestWithinRadius = { name: station.name, dist }
                      }
                    }
                  }
                  if (nearestWithinRadius?.name) {
                    await saveDetectedLocation(
                      lineLabel,
                      position.coords.latitude,
                      position.coords.longitude,
                      nearestWithinRadius.name,
                      true,
                      nearestWithinRadius.dist
                    )
                  }
                }
              }
            }
          } catch {
            // 백그라운드 위치 저장 실패는 무시합니다.
          }
        })()
      },
      () => {
        // 위치 거부 시에도 탑승 화면 이동은 이미 완료됨
      },
      {
        enableHighAccuracy: false,
        timeout: 3000,
        maximumAge: 120000,
      }
    )
  }

  if (!isAuthChecked) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#f5f5f0] text-[#888888]">
        <p className="text-sm font-semibold">로딩 중...</p>
      </div>
    )
  }

  const homeMatchStatusBox = resolveHomeMatchStatusBox(homeWaitView)
  const isSeekRegistering = homeWaitView?.phase === 'waiting_seek'
  const isLeaveRegistering = homeWaitView?.phase === 'waiting_leave'

  return (
    <div className="mx-auto flex w-full max-w-[480px] flex-col bg-[#f5f5f0]">
      <CongestionHaltModal
        open={showCongestionModal}
        onClose={() => setShowCongestionModal(false)}
        congestionLevel={congestionStatus?.levelsByLine[resolveLineNumberFromLabel(selectedLineLabel)]}
      />

      {toastMessage ? (
        <p className="fixed bottom-[calc(var(--bottom-nav-height)+0.5rem)] left-1/2 z-30 -translate-x-1/2 rounded-full bg-gray-800 px-4 py-2 text-sm text-white">
          {toastMessage}
        </p>
      ) : null}

      <header className="zeb-app-header justify-between">
        <Link
          href={isLoggedIn ? '/profile' : '/login'}
          className="zeb-touch-target flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#EBEBEB] bg-[#f5f5f0] text-sm font-bold text-[#1A1A1A]"
          aria-label={isLoggedIn ? '내 정보' : '로그인'}
        >
          {isLoggedIn ? (
            displayName!.slice(0, 1).toUpperCase()
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle cx="12" cy="9" r="3.5" stroke="#6B7280" strokeWidth="1.8" />
              <path
                d="M5 20c1.5-3 4-4.5 7-4.5s5.5 1.5 7 4.5"
                stroke="#6B7280"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          )}
        </Link>

        <div className="min-w-0 flex-1 px-1 text-center">
          <p className="truncate text-[17px] font-bold text-[#1A1A1A]">빈자리, 잽싸게</p>
          <p className="mt-0.5 text-[13px] font-medium leading-snug text-[#6B7280]">
            <span className="font-bold text-[#747F00]">서울 7호선</span>
            <span className="text-[#9CA3AF]"> · </span>
            곧 비어질 좌석을 미리 확인하세요
          </p>
        </div>

        <AppHamburgerMenu />
      </header>

      <main className="flex flex-col pb-4">
        {/* 객실 일러스트 — 높이를 키워 3~4명이 보이게, 나머지는 좌우 스크롤 */}
        <section className="w-full shrink-0 bg-[#f5f5f0]" aria-label="지하철 객실 안내">
          <div className="zeb-no-scrollbar zeb-hero-pan-x" aria-label="객실 이미지 가로 스크롤">
            <img
              src={`/images/subway-hero.png?v=${HOME_UI_VERSION}`}
              alt="지하철 7호선 실내"
              className="block h-[min(72vw,300px)] min-h-[260px] w-auto max-w-none select-none"
              draggable={false}
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none'
              }}
            />
          </div>
        </section>

        {/* 등록 액션 — 빈자리 찾기 / 자리 넘기기 */}
        <section className="mx-4 mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={
              isMatchingPaused ||
              isOutsideOperatingHours ||
              isSeekRegistering
            }
            onClick={() => handleModeSelect('seek')}
            className={resolveHomeActionButtonClass(isSeekRegistering)}
          >
            {isSeekRegistering ? (
              <span className="flex items-center justify-center gap-1.5 text-[18px] font-bold leading-snug">
                <span
                  className="inline-block h-2 w-2 shrink-0 animate-pulse rounded-full bg-white"
                  aria-hidden
                />
                등록 중…
              </span>
            ) : (
              <span className="text-[18px] font-bold leading-snug">빈자리 찾기</span>
            )}
            {isSeekRegistering ? (
              <span className="mt-1 text-[12px] font-medium text-white/85">
                아래 카드에서 확인
              </span>
            ) : null}
          </button>
          <button
            type="button"
            disabled={
              isMatchingPaused ||
              isOutsideOperatingHours ||
              isLeaveRegistering
            }
            onClick={() => handleModeSelect('leave')}
            className={resolveHomeActionButtonClass(isLeaveRegistering)}
          >
            {isLeaveRegistering ? (
              <span className="flex items-center justify-center gap-1.5 text-[18px] font-bold leading-snug">
                <span
                  className="inline-block h-2 w-2 shrink-0 animate-pulse rounded-full bg-white"
                  aria-hidden
                />
                등록 중…
              </span>
            ) : (
              <span className="text-[18px] font-bold leading-snug">자리 넘기기</span>
            )}
            {isLeaveRegistering ? (
              <span className="mt-1 text-[12px] font-medium text-white/85">
                아래 카드에서 확인
              </span>
            ) : null}
          </button>
        </section>

        {isOutsideOperatingHours ? (
          <p
            className="mx-4 mt-2 rounded-xl border border-[#D5DDB8] bg-[#F7F8F2] px-3 py-2.5 text-xs font-bold text-[#5F6B2E]"
            role="alert"
          >
            {SUBWAY_OUTSIDE_OPERATING_HOURS_MESSAGE}
          </p>
        ) : null}

        {isMatchingPaused ? (
          <p
            className="mx-4 mt-2 rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-3 py-2.5 text-xs font-bold text-[#DC2626]"
            role="alert"
          >
            현재 매칭 기능이 일시 정지되었습니다. 잠시 후 다시 시도해주세요.
          </p>
        ) : null}

        {/* 환승 많은 역 */}
        <section className="mx-4 mt-3" aria-label="환승 많은 역">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-base font-bold text-[#1A1A1A]">환승 많은 역</h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="text-[#7A8460] transition-colors hover:text-[#747F00]"
                aria-label="이전"
                onClick={() => scrollTransferStations('prev')}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button
                type="button"
                className="text-[#7A8460] transition-colors hover:text-[#747F00]"
                aria-label="다음"
                onClick={() => scrollTransferStations('next')}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          </div>
          <div
            ref={transferScrollRef}
            className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {transferStationsLoading ? (
              <>
                <span
                  className="h-7 w-16 shrink-0 animate-pulse rounded-full bg-gray-200"
                  aria-hidden
                />
                <span
                  className="h-7 w-16 shrink-0 animate-pulse rounded-full bg-gray-200"
                  aria-hidden
                />
                <span
                  className="h-7 w-16 shrink-0 animate-pulse rounded-full bg-gray-200"
                  aria-hidden
                />
              </>
            ) : (
              transferStations.map((station, index) => {
                const isSelected =
                  selectedTransferStation === station.label ||
                  (selectedTransferStation === null && index === 0)

                return (
                  <button
                    key={`${station.label}-${index}`}
                    type="button"
                    disabled={isMatchingPaused}
                    onClick={() => handleTransferStationClick(station)}
                    className={`shrink-0 rounded-full px-3 py-1 text-base font-bold transition disabled:cursor-not-allowed disabled:opacity-45 ${
                      isSelected
                        ? 'bg-[#747F00] text-white'
                        : 'border border-[#D5DDB8] bg-white text-[#7A8460]'
                    }`}
                  >
                    {station.label}
                  </button>
                )
              })
            )}
          </div>
        </section>

        {homeMatchStatusBox ? (
          <section className="mx-4 mt-3" aria-label="매칭 상태">
            <p
              className={`rounded-xl border px-4 py-3 text-center text-sm font-bold ${
                homeMatchStatusBox.kind === 'in_progress' ? 'home-status-blink' : ''
              }`}
              style={{
                backgroundColor: homeMatchStatusBox.backgroundColor,
                borderColor: LINE7_BORDER,
                color: homeMatchStatusBox.textColor,
              }}
            >
              <span aria-hidden className="mr-1 opacity-80">
                {homeMatchStatusBox.emoji}
              </span>
              {homeMatchStatusBox.label}
            </p>
          </section>
        ) : null}

        {homeWaitView ? (
          <section className="mx-4 mt-2" aria-label="내 등록 상태">
            {(() => {
              const card = resolveHomeMyRegistrationCard(homeWaitView)
              const showCancelButton =
                (homeWaitView.phase === 'waiting_seek' ||
                  homeWaitView.phase === 'waiting_leave' ||
                  homeWaitView.phase === 'match_in_progress' ||
                  homeWaitView.phase === 'match_alert') &&
                Boolean(homeWaitView.requestId)
              const isMatchAlert = homeWaitView.phase === 'match_alert'
              const isMatchInProgress = homeWaitView.phase === 'match_in_progress'
              const isMatchDone = homeWaitView.phase === 'match_done'
              const showProgressBar =
                (isMatchInProgress || isMatchDone) && homeWaitView.homeProgress

              return (
                <div
                  className="w-full rounded-2xl border px-4 py-4 text-left"
                  style={
                    isMatchAlert || isMatchInProgress
                      ? {
                          borderColor: LINE7_BORDER_STRONG,
                          backgroundColor: LINE7_SOFT_BG,
                        }
                      : {
                          borderColor: LINE7_BORDER,
                          backgroundColor: '#F7F8F2',
                        }
                  }
                >
                  <div className="flex items-start justify-between gap-3">
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={handleHomeWaitStatusClick}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          handleHomeWaitStatusClick()
                        }
                      }}
                      className="min-w-0 flex-1 cursor-pointer transition active:opacity-90"
                    >
                      <span
                        className="inline-block rounded-full px-2.5 py-0.5 text-[12px] font-bold text-white"
                        style={{
                          backgroundColor: isMatchAlert
                            ? LINE7_PRIMARY
                            : isMatchDone
                              ? LINE7_ACCENT
                              : LINE7_PRIMARY,
                        }}
                      >
                        {card.statusBadge}
                      </span>
                      <p className="mt-2 text-[16px] font-extrabold text-[#1A1A1A]">
                        {card.purposeLine}
                      </p>
                      {!showProgressBar ? (
                        <p className="mt-1 text-[14px] font-semibold text-[#5F6B2E]">
                          {card.progressLine}
                        </p>
                      ) : null}
                      {showProgressBar ? (
                        <HomeMatchProgressBar
                          registrationKind={homeWaitView.registrationKind}
                          progress={homeWaitView.homeProgress as HomeMatchProgress}
                        />
                      ) : null}
                    </div>
                    {showCancelButton ? (
                      <button
                        type="button"
                        disabled={isCancellingHomeWait}
                        onClick={() => {
                          void handleCancelHomeWaitRequest()
                        }}
                        className="zeb-touch-target shrink-0 px-1 text-xs font-medium text-red-400 disabled:opacity-50"
                      >
                        취소
                      </button>
                    ) : null}
                  </div>
                </div>
              )
            })()}
          </section>
        ) : null}

        <details className="group mx-4 mt-3">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-bold text-[#1A1A1A] marker:content-none [&::-webkit-details-marker]:hidden">
            <span
              className="inline-block text-[10px] leading-none text-[#888888] transition-transform group-open:rotate-90"
              aria-hidden
            >
              ▶
            </span>
            왜 7호선인가?
          </summary>
          <section
            className="mt-3 rounded-2xl border border-[#EBEBEB] bg-white px-4 py-3.5"
            aria-label="서비스 안내"
          >
            <p className="text-[13px] font-medium leading-snug text-[#6B7280]">
              서울 7호선 단독 운영 · 혼잡도 데이터 기반 매칭
            </p>
            <ul className="mt-2.5 flex flex-col gap-1.5 text-[14px] leading-snug text-[#4B5563]">
              <li>· 착석 수요가 많은 장거리 노선</li>
              <li>· 환승역 66개 — 빈자리 찾기에 유리</li>
              <li>· 교통약자·일반 이용자 모두 이용 가능</li>
            </ul>
          </section>
        </details>

        <div className="h-1 shrink-0" aria-hidden />

        {/* 단독 노선 — 노선 선택 UI (복원 시 homeStep === 'line' 분기로 되돌리기)
        ) : (
          <section className="flex flex-1 flex-col">
            <div className="mb-8 flex items-center justify-between">
              <button
                type="button"
                onClick={handleBackToModeStep}
                className="text-[13px] font-semibold text-[#888888]"
              >
                ← 이전
              </button>
              <p className="text-[13px] font-medium text-[#888888]">
                {activeTab === 'leave' ? '하차 알리기' : '빈자리 찾기'}
              </p>
            </div>

            <div className="mb-5">
              <h2 className="text-[22px] font-extrabold tracking-tight text-[#1A1A1A]">
                어느 노선 타세요?
              </h2>
              <p className="mt-2 text-[14px] font-medium" style={{ color: LINE7_OLIVE }}>
                서울 7호선 단독 운영 중
              </p>
            </div>

            <div className="flex flex-col gap-2.5">
              {HOME_LINE_OPTIONS.map((line) => (
                <button
                  key={line.label}
                  type="button"
                  disabled={isMatchingPaused}
                  className="zeb-touch-target flex w-full items-center gap-4 rounded-xl bg-white px-4 py-4 transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
                  onClick={() => handleLinePick(line.label)}
                  aria-label={`${line.label} 선택`}
                >
                  <span
                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[15px] font-extrabold text-white"
                    style={{ background: line.color }}
                  >
                    {line.badge}
                  </span>
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block text-[16px] font-extrabold text-[#1A1A1A]">
                      {line.label}
                    </span>
                    <span className="mt-0.5 block text-[13px] font-medium text-[#888888]">
                      {line.stationExamples}
                    </span>
                  </span>
                  <ChevronRightIcon />
                </button>
              ))}
            </div>

            {isMatchingPaused ? (
              <p
                className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-3 py-2.5 text-xs font-bold text-[#DC2626]"
                role="alert"
              >
                현재 매칭 기능이 일시 정지되었습니다. 잠시 후 다시 시도해주세요.
              </p>
            ) : null}
          </section>
        )}
        */}
      </main>
      <style jsx global>{`
        @keyframes home-status-blink-keyframes {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.55;
          }
        }
        .home-status-blink {
          animation: home-status-blink-keyframes 1s ease-in-out infinite;
        }
      `}</style>
    </div>
  )
}
