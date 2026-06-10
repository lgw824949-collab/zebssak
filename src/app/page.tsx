'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CongestionHaltModal from '@/components/CongestionHaltModal'
import {
  fetchCongestionStatus,
  isLineHalted,
  resolveLineNumberFromLabel,
  type CongestionStatus,
} from '@/lib/congestion'
import { formatStationDisplayName } from '@/lib/match-display'
import {
  isSubwayOperatingHours,
  SUBWAY_OUTSIDE_OPERATING_HOURS_MESSAGE,
} from '@/lib/subway-operating-hours'
import { getSupabase } from '@/lib/supabase'

interface StoredUser {
  username: string
  nickname?: string | null
  total_points?: number
}

/** 홈 GPS 프리페치 — 탑승 화면 캐시와 동일한 1km 기준 */
const GPS_MAX_RADIUS_KM = 1
/** 배포 후 구 UI 캐시(SW·브라우저) 1회 갱신 */
const HOME_UI_VERSION = '2026-06-04-mobile-refresh-v28'
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
type HomeTab = 'seek' | 'leave'

/** 환승 많은 역 — fetch 실패·데이터 없음 시 기본값 */
const DEFAULT_TRANSFER_STATIONS = [
  '건대입구역',
  '노원역',
  '가산디지털단지역',
  '고속터미널역',
  '도봉산역',
] as const

// const VOICE_PARSE_PENDING_KEY = 'voiceParsePending'
/** 홈 화면 확대 단계 — localStorage에 저장 */
const HOME_ZOOM_STORAGE_KEY = 'zeb_home_zoom_scale'
const HOME_ZOOM_STEPS = [1, 1.1, 1.25] as const
type HomeZoomScale = (typeof HOME_ZOOM_STEPS)[number]

function parseStoredHomeZoom(raw: string | null): HomeZoomScale {
  const parsed = Number(raw)
  if (HOME_ZOOM_STEPS.includes(parsed as HomeZoomScale)) {
    return parsed as HomeZoomScale
  }
  return 1
}

function getNextHomeZoomScale(current: HomeZoomScale): HomeZoomScale {
  const index = HOME_ZOOM_STEPS.indexOf(current)
  return HOME_ZOOM_STEPS[(index + 1) % HOME_ZOOM_STEPS.length]
}

function RefreshIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M20 12a8 8 0 10-2.34 5.66M20 12V7m0 5h-5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ZoomInIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="M16 16l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M11 8v6M8 11h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

type TransferStationRow = {
  destination_station?:
    | { station_name?: string | null }
    | Array<{ station_name?: string | null }>
    | null
}

/** 목적지 역명 빈도 상위 N개 추출 */
function pickTopStationNames(rows: TransferStationRow[], limit = 5): string[] {
  const counts = new Map<string, number>()

  for (const row of rows) {
    const destination = row.destination_station
    const station = Array.isArray(destination) ? destination[0] : destination
    const raw = station?.station_name?.trim()
    if (!raw) {
      continue
    }
    const displayName = formatStationDisplayName(raw)
    counts.set(displayName, (counts.get(displayName) ?? 0) + 1)
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name]) => name)
}

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

type HomeWaitPhase = 'waiting_seek' | 'waiting_leave' | 'match_alert' | 'match_done'

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
  trainNo: string | null
  carNumber: number | null
}

/** 내 등록 상태 카드 — ①진행상태 ②무엇·어디까지 ③매칭 여부 */
function resolveHomeMyRegistrationCard(view: HomeWaitView): {
  statusBadge: string
  purposeLine: string
  progressLine: string
} {
  const destination = view.destinationName || '목적지 미확인'

  if (view.phase === 'match_done') {
    if (view.registrationKind === 'leave') {
      return {
        statusBadge: '완료',
        purposeLine: `하차 알림 · ${destination}까지`,
        progressLine:
          '목적지 전에도 다시 등록해 주세요. 다른 분과 또 연결될 수 있어요.',
      }
    }

    return {
      statusBadge: '완료',
      purposeLine: `자리 찾기 · ${destination}까지`,
      progressLine: '다시 등록하면 다른 빈자리와 또 연결될 수 있어요.',
    }
  }

  if (view.phase === 'match_alert') {
    return {
      statusBadge: '매칭 도착',
      purposeLine:
        view.registrationKind === 'leave'
          ? `하차 알림 · ${destination}까지`
          : `자리 찾기 · ${destination}까지`,
      progressLine: '지금 확인하면 연결됩니다',
    }
  }

  if (view.phase === 'waiting_leave') {
    const poolText =
      view.waitingCount > 0 ? `${view.waitingCount}명` : '모이는 중'
    return {
      statusBadge: '진행 중',
      purposeLine: `하차 알림 · ${destination}까지`,
      progressLine: `매칭 대기 중 · 착석 희망자 ${poolText}`,
    }
  }

  const rankText = view.queuePosition != null ? `${view.queuePosition}번째` : '순서 확인 중'
  const totalText = view.waitingCount > 0 ? ` / ${view.waitingCount}명` : ''

  return {
    statusBadge: '진행 중',
    purposeLine: `자리 찾기 · ${destination}까지`,
    progressLine: `매칭 대기 중 · ${rankText}${totalText}`,
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
    trainNo: null,
    carNumber: null,
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
      requestType: null,
      requestStatus: null,
    }
  }

  const pendingMatchId =
    statusPayload.data?.match?.status === 'pending'
      ? (statusPayload.data.match?.id ?? null)
      : null

  return {
    queuePosition: statusPayload.data?.queue_position ?? null,
    pendingMatchId,
    requestType: statusPayload.data?.match_request?.request_type ?? null,
    requestStatus: statusPayload.data?.match_request?.status ?? null,
  }
}

/** 대기 중인 match_request를 cancelled로 변경합니다. */
async function cancelHomeMatchRequest(
  token: string,
  requestId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch('/api/match-requests/status', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ request_id: requestId }),
      cache: 'no-store',
    })

    const payload = (await response.json()) as {
      success?: boolean
      error?: string
    }

    if (!response.ok || !payload.success) {
      return {
        success: false,
        error: payload.error ?? '요청 취소에 실패했습니다.',
      }
    }

    return { success: true }
  } catch {
    return { success: false, error: '요청 취소 중 오류가 발생했습니다.' }
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
  trainNo: string | null
  carNumber: number | null
}): HomeWaitView | null {
  const registrationKind: 'seek' | 'leave' =
    input.requestType === 'leaving' ? 'leave' : 'seek'

  if (input.pendingMatchId) {
    return {
      requestId: input.requestId,
      phase: 'match_alert',
      registrationKind,
      destinationName: input.destinationName,
      queuePosition: input.queuePosition,
      waitingCount: input.waitingCount,
      matchId: input.pendingMatchId,
      trainNo: input.trainNo,
      carNumber: input.carNumber,
    }
  }

  if (input.requestStatus && input.requestStatus !== 'waiting') {
    return null
  }

  const phase =
    input.requestType === 'leaving' ? 'waiting_leave' : 'waiting_seek'

  return {
    requestId: input.requestId,
    phase,
    registrationKind,
    destinationName: input.destinationName,
    queuePosition: input.queuePosition,
    waitingCount: input.waitingCount,
    matchId: null,
    trainNo: input.trainNo,
    carNumber: input.carNumber,
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

  const view = buildHomeWaitView({
    requestId,
    requestType,
    requestStatus,
    destinationName,
    queuePosition: status.queuePosition,
    waitingCount,
    pendingMatchId: status.pendingMatchId,
    trainNo,
    carNumber,
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
  const mainScrollRef = useRef<HTMLElement>(null)
  const [user, setUser] = useState<StoredUser | null>(null)
  const [isAuthChecked, setIsAuthChecked] = useState(false)
  const [isLoadingData, setIsLoadingData] = useState(true)
  const [isMatchingPaused, setIsMatchingPaused] = useState(false)
  const [congestionStatus, setCongestionStatus] = useState<CongestionStatus | null>(null)
  const [showCongestionModal, setShowCongestionModal] = useState(false)
  const [selectedLineLabel, setSelectedLineLabel] = useState<string>('서울 7호선')
  const [homeMode, setHomeMode] = useState<HomeFlowMode | null>(null)
  const [activeTab, setActiveTab] = useState<HomeTab>('seek')
  const [menuOpen, setMenuOpen] = useState(false)
  const [transferStationsLoading, setTransferStationsLoading] = useState(true)
  const [transferStations, setTransferStations] = useState<string[]>([...DEFAULT_TRANSFER_STATIONS])
  const [selectedTransferStation, setSelectedTransferStation] = useState<string | null>(null)
  const [homeZoomScale, setHomeZoomScale] = useState<HomeZoomScale>(1)
  const [isHomeRefreshing, setIsHomeRefreshing] = useState(false)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [pullStartY, setPullStartY] = useState(0)
  const [pulling, setPulling] = useState(false)
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

  const loadTransferStations = useCallback(async () => {
    setTransferStationsLoading(true)

    try {
      const supabase = getSupabase()
      const { data, error } = await supabase
        .from('match_requests')
        .select('destination_station:stations!destination_station_id(station_name)')
        .order('created_at', { ascending: false })
        .limit(100)

      if (error || !data?.length) {
        setTransferStations([...DEFAULT_TRANSFER_STATIONS])
        return
      }

      const topStations = pickTopStationNames(data as TransferStationRow[])
      setTransferStations(
        topStations.length > 0 ? topStations : [...DEFAULT_TRANSFER_STATIONS]
      )
    } catch {
      setTransferStations([...DEFAULT_TRANSFER_STATIONS])
    } finally {
      setTransferStationsLoading(false)
    }
  }, [])

  const handleHomeRefresh = useCallback(async () => {
    if (isHomeRefreshing) {
      return
    }

    setIsHomeRefreshing(true)

    try {
      let token: string | null = null
      try {
        token = localStorage.getItem('token')
      } catch {
        token = null
      }

      await Promise.all([
        loadHomeData(token),
        loadTransferStations(),
        loadHomeWaitStatus(token),
      ])
    } catch {
      // 새로고침 실패 시에도 화면은 유지합니다.
    } finally {
      setIsHomeRefreshing(false)
    }
  }, [isHomeRefreshing, loadHomeData, loadTransferStations, loadHomeWaitStatus])

  const handleHomeZoomCycle = useCallback(() => {
    setHomeZoomScale((current) => {
      const next = getNextHomeZoomScale(current)
      try {
        localStorage.setItem(HOME_ZOOM_STORAGE_KEY, String(next))
      } catch {
        // 저장 실패 시에도 확대 단계는 적용합니다.
      }
      return next
    })
  }, [])

  useEffect(() => {
    const paused = isLineHalted(congestionStatus, DEFAULT_HOME_LINE_LABEL)
    setIsMatchingPaused(paused)
  }, [congestionStatus, isLoadingData])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const versionKey = 'zeb_home_ui_version'
    const reloadOnceKey = `zeb_home_reloaded_${HOME_UI_VERSION}`
    const previous = localStorage.getItem(versionKey)
    if (previous === HOME_UI_VERSION || sessionStorage.getItem(reloadOnceKey)) return

    localStorage.setItem(versionKey, HOME_UI_VERSION)
    const hadServiceWorker = Boolean(navigator.serviceWorker?.controller)

    void (async () => {
      try {
        if ('caches' in window) {
          const keys = await caches.keys()
          await Promise.all(keys.map((key) => caches.delete(key)))
        }
        if ('serviceWorker' in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations()
          await Promise.all(registrations.map((registration) => registration.unregister()))
        }
      } catch {
        // 캐시 정리 실패 시에도 화면은 계속 표시합니다.
      }

      const versionChanged = previous != null && previous !== HOME_UI_VERSION
      if (versionChanged || hadServiceWorker) {
        sessionStorage.setItem(reloadOnceKey, '1')
        window.location.reload()
      }
    })()
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return
    }

    void navigator.serviceWorker
      .register(`/sw.js?v=${HOME_UI_VERSION}`)
      .then((registration) => registration.update())
      .catch(() => {
        // SW 갱신 실패 시에도 화면은 계속 표시합니다.
      })
  }, [])

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

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    try {
      setHomeZoomScale(parseStoredHomeZoom(localStorage.getItem(HOME_ZOOM_STORAGE_KEY)))
    } catch {
      setHomeZoomScale(1)
    }
  }, [])

  useEffect(() => {
    if (!menuOpen) {
      return
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMenuOpen(false)
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [menuOpen])

  const displayName = user?.username ?? null
  const isLoggedIn = Boolean(displayName)

  useEffect(() => {
    let token: string | null = null
    try {
      token = localStorage.getItem('token')
    } catch {
      token = null
    }

    const timer = window.setInterval(() => {
      void loadHomeWaitStatus(token)
    }, 20000)

    return () => window.clearInterval(timer)
  }, [loadHomeWaitStatus])

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

  // 등록 유형과 탭을 맞춰 하차 알림·자리 찾기가 어긋나 보이지 않게 합니다.
  useEffect(() => {
    if (!homeWaitView) {
      return
    }
    setActiveTab(homeWaitView.registrationKind === 'leave' ? 'leave' : 'seek')
  }, [homeWaitView])
  const homeZoomPercentLabel = `${Math.round(homeZoomScale * 100)}%`

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
    setHomeMode(mode)
    // 단독 노선(서울 7호선) — 노선 선택 단계 생략
    // setHomeStep('line')
    handleLinePick(DEFAULT_HOME_LINE_LABEL, mode, destination)
  }

  function handleTransferStationClick(stationName: string) {
    if (isMatchingPaused) {
      return
    }

    setSelectedTransferStation(stationName)
    setActiveTab('seek')
    setToastMessage(`${stationName}을 목적지로 설정했어요 📍`)
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

    handleModeSelect('seek', stationName)
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

  function closeMenu() {
    setMenuOpen(false)
  }

  async function handleCancelHomeWaitRequest() {
    if (!homeWaitView?.requestId) {
      return
    }

    if (
      homeWaitView.phase !== 'waiting_seek' &&
      homeWaitView.phase !== 'waiting_leave'
    ) {
      return
    }

    if (!window.confirm('요청을 취소하시겠습니까?')) {
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
      const result = await cancelHomeMatchRequest(token, homeWaitView.requestId)
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
      try {
        sessionStorage.setItem('activeMatchId', homeWaitView.matchId)
      } catch {
        // sessionStorage 실패 시에도 매칭 화면으로 이동합니다.
      }
      router.push('/matching')
      return
    }

    router.push('/waiting')
  }

  async function handleLogout() {
    closeMenu()
    const token = localStorage.getItem('token')

    try {
      if (token) {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        })
      }
    } catch {
      // 로컬 로그아웃은 토큰 삭제로 처리
    } finally {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      sessionStorage.removeItem('boardingDraft')
      sessionStorage.removeItem('providerRegistered')
      setUser(null)
      router.replace('/login')
    }
  }

  // function handleBackToModeStep() {
  //   setHomeStep('mode')
  //   setHomeMode(null)
  // }

  async function proceedToBoarding(
    lineLabel: string,
    modeOverride?: HomeFlowMode,
    destination?: string
  ) {
    const mode = modeOverride ?? homeMode
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
    const mode = modeOverride ?? homeMode
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

  return (
    <div
      className="mx-auto flex h-dvh max-h-dvh w-full max-w-[480px] flex-col overflow-hidden bg-[#f5f5f0]"
      style={{ zoom: homeZoomScale }}
    >
      {pulling ? (
        <div className="text-center py-2 text-sm text-[#6b9e3f] font-medium">
          ↓ 당기면 새로고침
        </div>
      ) : null}
      <CongestionHaltModal
        open={showCongestionModal}
        onClose={() => setShowCongestionModal(false)}
        congestionLevel={congestionStatus?.levelsByLine[resolveLineNumberFromLabel(selectedLineLabel)]}
      />

      {toastMessage ? (
        <p className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-sm px-4 py-2 rounded-full">
          {toastMessage}
        </p>
      ) : null}

      {menuOpen ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 bg-black/30"
            aria-label="메뉴 닫기"
            onClick={closeMenu}
          />
          <nav
            className="fixed left-0 top-0 z-50 flex h-full w-64 flex-col bg-white pt-[max(3.5rem,env(safe-area-inset-top))] shadow-xl"
            aria-label="메인 메뉴"
          >
            <div className="border-b border-[#EBEBEB] px-4 pb-4">
              <p className="text-[17px] font-bold text-[#1A1A1A]">메뉴</p>
            </div>
            <div className="flex flex-col px-2 py-3">
              <Link
                href={isLoggedIn ? '/profile' : '/login'}
                onClick={closeMenu}
                className="rounded-lg px-3 py-3 text-[15px] font-semibold text-[#1A1A1A] transition hover:bg-[#f5f5f0]"
              >
                {isLoggedIn ? '프로필' : '로그인'}
              </Link>
              {isLoggedIn ? (
                <button
                  type="button"
                  onClick={() => {
                    void handleLogout()
                  }}
                  className="rounded-lg px-3 py-3 text-left text-[15px] font-semibold text-[#1A1A1A] transition hover:bg-[#f5f5f0]"
                >
                  로그아웃
                </button>
              ) : null}
            </div>
          </nav>
        </>
      ) : null}

      <header className="flex shrink-0 items-center justify-between border-b border-[#EBEBEB] bg-white px-4 py-3 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]">
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center text-[#1A1A1A]"
          aria-label="메뉴"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(true)}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>

        <p className="min-w-0 flex-1 truncate px-1 text-center text-[17px] font-bold text-[#1A1A1A]">
          빈자리, 잽싸게
        </p>

        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            disabled={isHomeRefreshing}
            onClick={() => {
              void handleHomeRefresh()
            }}
            className="flex h-9 w-9 items-center justify-center text-[#1A1A1A] transition active:scale-95 disabled:opacity-45"
            aria-label={isHomeRefreshing ? '새로고침 중' : '새로고침'}
            aria-busy={isHomeRefreshing}
          >
            <span className={isHomeRefreshing ? 'animate-spin' : undefined}>
              <RefreshIcon />
            </span>
          </button>
          <button
            type="button"
            onClick={handleHomeZoomCycle}
            className="flex h-9 w-9 items-center justify-center text-[#1A1A1A] transition active:scale-95"
            aria-label={`화면 확대, 현재 ${homeZoomPercentLabel}`}
          >
            <ZoomInIcon />
          </button>
          <Link
            href={isLoggedIn ? '/profile' : '/login'}
            className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-[#EBEBEB] bg-[#f5f5f0] text-sm font-bold text-[#1A1A1A]"
            aria-label={isLoggedIn ? '프로필' : '로그인'}
          >
            {isLoggedIn ? displayName!.slice(0, 1).toUpperCase() : 'L'}
          </Link>
        </div>
      </header>

      <main
        ref={mainScrollRef}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain"
        onTouchStart={(e) => setPullStartY(e.touches[0].clientY)}
        onTouchEnd={(e) => {
          const diff = e.changedTouches[0].clientY - pullStartY
          if (diff > 80 && (mainScrollRef.current?.scrollTop ?? 0) <= 0) {
            window.location.reload()
          }
          setPulling(false)
        }}
        onTouchMove={(e) => {
          if ((mainScrollRef.current?.scrollTop ?? 0) > 0) {
            setPulling(false)
            return
          }
          const diff = e.touches[0].clientY - pullStartY
          if (diff > 30) setPulling(true)
        }}
      >
        <div className="w-full">
          <img
            src={`/images/subway-hero.png?v=${HOME_UI_VERSION}`}
            alt="지하철 7호선 실내"
            className="max-h-[260px] w-full object-contain"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none'
            }}
          />
        </div>

        {/* 탭 */}
        <section className="mx-4 mt-2 flex border-b border-[#E8E8E8]">
          <button
            type="button"
            onClick={() => setActiveTab('seek')}
            className={`flex-1 pb-2.5 text-center text-base font-bold transition ${
              activeTab === 'seek'
                ? 'border-b-2 border-[#747F00] text-[#1A1A1A]'
                : 'text-[#888888]'
            }`}
          >
            자리 찾기
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('leave')}
            className={`flex-1 pb-2.5 text-center text-base font-bold transition ${
              activeTab === 'leave'
                ? 'border-b-2 border-[#747F00] text-[#1A1A1A]'
                : 'text-[#888888]'
            }`}
          >
            내릴게요
          </button>
        </section>

        {/* 액션 버튼 */}
        <section className="mx-4 mt-2">
          {activeTab === 'seek' ? (
            <button
              type="button"
              disabled={
                isMatchingPaused ||
                isOutsideOperatingHours ||
                homeWaitView?.phase === 'waiting_seek'
              }
              onClick={() => handleModeSelect('seek')}
              className="zeb-touch-target flex w-full items-center justify-center rounded-xl bg-[#747F00] py-4 text-xl font-bold text-white transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
            >
              바로 앉기 등록
            </button>
          ) : null}

          {activeTab === 'seek' &&
          homeWaitView?.phase === 'waiting_seek' &&
          !isMatchingPaused &&
          !isOutsideOperatingHours ? (
            <p className="mt-2 text-center text-xs font-semibold leading-relaxed text-[#5F6B2E]">
              이미 등록 중이에요. 아래에서 대기 상태를 확인해 주세요.
            </p>
          ) : null}

          {activeTab === 'leave' ? (
            <button
              type="button"
              disabled={
                isMatchingPaused ||
                isOutsideOperatingHours ||
                homeWaitView?.phase === 'waiting_leave'
              }
              onClick={() => handleModeSelect('leave')}
              className="zeb-touch-target flex w-full items-center justify-center rounded-xl bg-[#747F00] py-4 text-xl font-bold text-white transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
            >
              내릴게요 등록
            </button>
          ) : null}

          {activeTab === 'leave' &&
          homeWaitView?.phase === 'waiting_leave' &&
          !isMatchingPaused &&
          !isOutsideOperatingHours ? (
            <p className="mt-2 text-center text-xs font-semibold leading-relaxed text-[#5F6B2E]">
              이미 등록 중이에요. 아래에서 대기 상태를 확인해 주세요.
            </p>
          ) : null}

          {homeWaitView?.phase === 'match_alert' ? (
            <button
              type="button"
              onClick={handleHomeWaitStatusClick}
              className="zeb-touch-target mt-2 flex w-full items-center justify-center rounded-xl bg-[#E85D04] py-3.5 text-lg font-bold text-white transition active:scale-[0.98]"
            >
              매칭 확인하기
            </button>
          ) : null}

          {isOutsideOperatingHours ? (
            <p
              className="mt-3 rounded-xl border border-[#D5DDB8] bg-[#F7F8F2] px-3 py-2.5 text-xs font-bold text-[#5F6B2E]"
              role="alert"
            >
              {SUBWAY_OUTSIDE_OPERATING_HOURS_MESSAGE}
            </p>
          ) : null}

          {isMatchingPaused ? (
            <p
              className="mt-3 rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-3 py-2.5 text-xs font-bold text-[#DC2626]"
              role="alert"
            >
              현재 매칭 기능이 일시 정지되었습니다. 잠시 후 다시 시도해주세요.
            </p>
          ) : null}
        </section>

        {/* 환승 많은 역 */}
        <section className="mx-4 mt-4" aria-label="환승 많은 역">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-base font-bold text-[#1A1A1A]">환승 많은 역</h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="text-[#AAAAAA]"
                aria-label="이전"
                onClick={() => scrollTransferStations('prev')}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button
                type="button"
                className="text-[#AAAAAA]"
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
                  selectedTransferStation === station ||
                  (selectedTransferStation === null && index === 0)

                return (
                  <button
                    key={`${station}-${index}`}
                    type="button"
                    disabled={isMatchingPaused}
                    onClick={() => handleTransferStationClick(station)}
                    className={`shrink-0 rounded-full px-3 py-1 text-base font-bold transition disabled:cursor-not-allowed disabled:opacity-45 ${
                      isSelected
                        ? 'bg-[#747F00] text-white'
                        : 'border border-gray-200 bg-white text-gray-600'
                    }`}
                  >
                    {station}
                  </button>
                )
              })
            )}
          </div>
        </section>

        <div className="mx-4 mt-4 mb-4 rounded-2xl bg-white px-4 py-4">
          <p className="text-base font-bold text-gray-800 mb-1">🚇 왜 7호선인가?</p>
          <p className="mb-3 text-[12px] font-medium text-[#888888]">서울 7호선 단독 운영</p>
          <div className="flex flex-col gap-2">
            <div className="flex items-start gap-2">
              <span className="text-[#747F00] mt-0.5">•</span>
              <p className="text-base text-gray-600">서울교통공사 혼잡도 데이터 분석 결과</p>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-[#747F00] mt-0.5">•</span>
              <p className="text-base text-gray-600">착석 수요·장거리 이용 최적 노선</p>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-[#747F00] mt-0.5">•</span>
              <p className="text-base text-gray-600">환승역 66개, 평균 착석 시간 30분</p>
            </div>
          </div>
        </div>

        {homeWaitView ? (
          <section
            className="mx-4 mb-16 rounded-2xl border border-[#D5DDB8] bg-[#F7F8F2] px-4 py-4"
            aria-label="내 등록 상태"
          >
            {(() => {
              const card = resolveHomeMyRegistrationCard(homeWaitView)
              const showCancelButton =
                (homeWaitView.phase === 'waiting_seek' ||
                  homeWaitView.phase === 'waiting_leave') &&
                Boolean(homeWaitView.requestId)

              return (
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <span
                      className={`inline-block rounded-full px-2.5 py-0.5 text-[12px] font-bold text-white ${
                        homeWaitView.phase === 'match_done'
                          ? 'bg-[#8A9A5B]'
                          : 'bg-[#747F00]'
                      }`}
                    >
                      {card.statusBadge}
                    </span>
                    <p className="mt-2 text-[16px] font-extrabold text-[#1A1A1A]">
                      {card.purposeLine}
                    </p>
                    <p className="mt-1 text-[14px] font-semibold text-[#5F6B2E]">
                      {card.progressLine}
                    </p>
                  </div>
                  {showCancelButton ? (
                    <button
                      type="button"
                      disabled={isCancellingHomeWait}
                      onClick={() => {
                        void handleCancelHomeWaitRequest()
                      }}
                      className="shrink-0 text-xs text-red-400 font-medium disabled:opacity-50"
                    >
                      취소
                    </button>
                  ) : null}
                </div>
              )
            })()}
          </section>
        ) : (
          <div className="mb-16" aria-hidden />
        )}

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
                {homeMode === 'leave' ? '하차 알리기' : '빈자리 찾기'}
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
    </div>
  )
}
