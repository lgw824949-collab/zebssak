'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import CongestionHaltModal from '@/components/CongestionHaltModal'
import {
  fetchCongestionStatus,
  isLineHalted,
  resolveLineNumberFromLabel,
  type CongestionStatus,
} from '@/lib/congestion'
import { formatStationDisplayName } from '@/lib/match-display'
import { getSupabase } from '@/lib/supabase'

interface StoredUser {
  username: string
  nickname?: string | null
  total_points?: number
}

/** 홈 GPS 프리페치 — 탑승 화면 캐시와 동일한 1km 기준 */
const GPS_MAX_RADIUS_KM = 1
const LINE7_OLIVE = '#747F00'
/** 배포 후 구 UI 캐시(SW·브라우저) 1회 갱신 */
const HOME_UI_VERSION = '2026-06-01-seek-flow-v14'
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

type HomeFlowMode = 'seek' | 'leave'
type HomeTab = 'seek' | 'leave'

/** 환승 많은 역 — fetch 실패·데이터 없음 시 기본값 */
const DEFAULT_TRANSFER_STATIONS = [
  '온수역',
  '가산디지털단지역',
  '건대입구역',
  '노원역',
  '도봉산역',
] as const

const BRAND_GREEN = '#6b9e3f'

interface RecentMatchItem {
  id: string
  createdAt: string
  routeLabel: string
}

/** Supabase 중첩 join 결과 단일 객체로 정리 */
function unwrapRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) {
    return null
  }
  return Array.isArray(value) ? (value[0] ?? null) : value
}

/** 경과 시간을 "N분 전" 형식으로 표시 */
function formatMinutesAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) {
    return '방금 전'
  }
  return `${minutes}분 전`
}

/** 오늘 00:00 (로컬) ISO 문자열 */
function getTodayStartIso(): string {
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  return todayStart.toISOString()
}

/** 통계 숫자 표시 — 로딩/에러 처리 */
function formatLiveStatValue(
  value: number | null,
  isLoading: boolean,
  hasError: boolean,
  suffix = ''
): string {
  if (isLoading) {
    return '...'
  }
  if (hasError || value === null) {
    return '-'
  }
  return `${value}${suffix}`
}

/** station_name 빈도 상위 N개 역명 추출 */
function pickTopStationNames(
  rows: Array<{ station_name?: string | null }>,
  limit = 5
): string[] {
  const counts = new Map<string, number>()

  for (const row of rows) {
    const raw = row.station_name?.trim()
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

/**
 * 메인 홈
 */
export default function Home() {
  const router = useRouter()
  const [user, setUser] = useState<StoredUser | null>(null)
  const [isAuthChecked, setIsAuthChecked] = useState(false)
  const [isLoadingData, setIsLoadingData] = useState(true)
  const [isMatchingPaused, setIsMatchingPaused] = useState(false)
  const [congestionStatus, setCongestionStatus] = useState<CongestionStatus | null>(null)
  const [showCongestionModal, setShowCongestionModal] = useState(false)
  const [selectedLineLabel, setSelectedLineLabel] = useState<string>('서울 7호선')
  const [homeMode, setHomeMode] = useState<HomeFlowMode | null>(null)
  const [activeTab, setActiveTab] = useState<HomeTab>('seek')
  const [liveStatsLoading, setLiveStatsLoading] = useState(true)
  const [liveStatsError, setLiveStatsError] = useState(false)
  const [pendingCount, setPendingCount] = useState<number | null>(null)
  const [todayMatchedCount, setTodayMatchedCount] = useState<number | null>(null)
  const [successRate, setSuccessRate] = useState<number | null>(null)
  const [recentMatches, setRecentMatches] = useState<RecentMatchItem[]>([])
  const [transferStationsLoading, setTransferStationsLoading] = useState(true)
  const [transferStations, setTransferStations] = useState<string[]>([...DEFAULT_TRANSFER_STATIONS])
  const loadHomeData = useCallback(async (token: string | null) => {
    setIsLoadingData(true)

    const status = await fetchCongestionStatus(token)
    setCongestionStatus(status)
    setIsLoadingData(false)
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

      if (previous || hadServiceWorker) {
        sessionStorage.setItem(reloadOnceKey, '1')
        window.location.reload()
      }
    })()
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
    } catch {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      setUser(null)
      setIsAuthChecked(true)
      void loadHomeData(null)
    }
  }, [loadHomeData])

  useEffect(() => {
    let cancelled = false

    async function loadLiveMatchingStats() {
      setLiveStatsLoading(true)
      setLiveStatsError(false)

      try {
        const supabase = getSupabase()
        const todayIso = getTodayStartIso()

        const [
          pendingResult,
          todayCompletedResult,
          completedAllResult,
          failedAllResult,
          recentResult,
        ] = await Promise.all([
          supabase
            .from('match_requests')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'waiting'),
          supabase
            .from('matches')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'completed')
            .gte('created_at', todayIso),
          supabase
            .from('matches')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'completed'),
          supabase
            .from('matches')
            .select('id', { count: 'exact', head: true })
            .in('status', ['expired', 'cancelled']),
          supabase
            .from('matches')
            .select(
              `
              id,
              created_at,
              seat_seek_request:match_requests!seat_seek_request_id(
                origin_station:stations!origin_station_id(station_name),
                destination_station:stations!destination_station_id(station_name)
              )
            `
            )
            .eq('status', 'completed')
            .order('created_at', { ascending: false })
            .limit(5),
        ])

        if (cancelled) {
          return
        }

        const hasError =
          pendingResult.error != null ||
          todayCompletedResult.error != null ||
          completedAllResult.error != null ||
          failedAllResult.error != null ||
          recentResult.error != null

        if (hasError) {
          setLiveStatsError(true)
          setPendingCount(null)
          setTodayMatchedCount(null)
          setSuccessRate(null)
          setRecentMatches([])
          return
        }

        const completedTotal = completedAllResult.count ?? 0
        const failedTotal = failedAllResult.count ?? 0
        const decisionTotal = completedTotal + failedTotal
        const calculatedRate =
          decisionTotal > 0 ? Math.round((completedTotal / decisionTotal) * 100) : 0

        setPendingCount(pendingResult.count ?? 0)
        setTodayMatchedCount(todayCompletedResult.count ?? 0)
        setSuccessRate(calculatedRate)

        const parsedRecent: RecentMatchItem[] = (recentResult.data ?? []).flatMap((row) => {
          const record = row as {
            id?: string
            created_at?: string
            seat_seek_request?:
              | {
                  origin_station?: { station_name?: string } | Array<{ station_name?: string }>
                  destination_station?: { station_name?: string } | Array<{ station_name?: string }>
                }
              | Array<{
                  origin_station?: { station_name?: string } | Array<{ station_name?: string }>
                  destination_station?: { station_name?: string } | Array<{ station_name?: string }>
                }>
          }

          if (!record.id || !record.created_at) {
            return []
          }

          const seekRequest = unwrapRelation(record.seat_seek_request)
          const origin = unwrapRelation(seekRequest?.origin_station)
          const destination = unwrapRelation(seekRequest?.destination_station)
          const originName = formatStationDisplayName(origin?.station_name)
          const destinationName = formatStationDisplayName(destination?.station_name)

          return [
            {
              id: record.id,
              createdAt: record.created_at,
              routeLabel: `${originName} → ${destinationName}`,
            },
          ]
        })

        setRecentMatches(parsedRecent)
      } catch {
        if (!cancelled) {
          setLiveStatsError(true)
          setPendingCount(null)
          setTodayMatchedCount(null)
          setSuccessRate(null)
          setRecentMatches([])
        }
      } finally {
        if (!cancelled) {
          setLiveStatsLoading(false)
        }
      }
    }

    void loadLiveMatchingStats()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadTransferStations() {
      setTransferStationsLoading(true)

      try {
        const supabase = getSupabase()
        const { data, error } = await supabase
          .from('match_requests')
          .select('station_name')
          .order('created_at', { ascending: false })
          .limit(100)

        if (cancelled) {
          return
        }

        if (error || !data?.length) {
          setTransferStations([...DEFAULT_TRANSFER_STATIONS])
          return
        }

        const topStations = pickTopStationNames(
          data as Array<{ station_name?: string | null }>
        )
        setTransferStations(
          topStations.length > 0 ? topStations : [...DEFAULT_TRANSFER_STATIONS]
        )
      } catch {
        if (!cancelled) {
          setTransferStations([...DEFAULT_TRANSFER_STATIONS])
        }
      } finally {
        if (!cancelled) {
          setTransferStationsLoading(false)
        }
      }
    }

    void loadTransferStations()

    return () => {
      cancelled = true
    }
  }, [])

  const displayName = user?.username ?? null
  const isLoggedIn = Boolean(displayName)

  async function pushBoardingPage(lineLabel: string, mode: HomeFlowMode) {
    const params = new URLSearchParams({
      type: mode,
      lineLabel,
    })
    router.push(`/boarding?${params.toString()}`)
  }

  async function pushSeekPage(lineLabel: string) {
    await pushBoardingPage(lineLabel, 'seek')
  }

  function handleModeSelect(mode: HomeFlowMode) {
    setHomeMode(mode)
    // 단독 노선(서울 7호선) — 노선 선택 단계 생략
    // setHomeStep('line')
    handleLinePick(DEFAULT_HOME_LINE_LABEL, mode)
  }

  // function handleBackToModeStep() {
  //   setHomeStep('mode')
  //   setHomeMode(null)
  // }

  async function proceedToBoarding(lineLabel: string, modeOverride?: HomeFlowMode) {
    const mode = modeOverride ?? homeMode
    if (!mode) return
    if (isLineHalted(congestionStatus, lineLabel)) {
      setSelectedLineLabel(lineLabel)
      setShowCongestionModal(true)
      return
    }
    setSelectedLineLabel(lineLabel)
    if (mode === 'seek') {
      void startSeekByLineSelection(lineLabel)
      return
    }
    void pushBoardingPage(lineLabel, mode)
  }

  function handleLinePick(lineLabel: string, modeOverride?: HomeFlowMode) {
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
      router.push(`/register?${params.toString()}`)
      return
    }

    void proceedToBoarding(lineLabel, mode)
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

  async function startSeekByLineSelection(lineLabel: string) {
    if (isLineHalted(congestionStatus, lineLabel)) {
      setShowCongestionModal(true)
      return
    }
    setSelectedLineLabel(lineLabel)
    // GPS·역 목록 조회를 기다리지 않고 바로 탑승 화면으로 이동합니다.
    void pushSeekPage(lineLabel)

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

  function handleSearchClick() {
    const params = new URLSearchParams({
      type: 'seek',
      lineLabel: DEFAULT_HOME_LINE_LABEL,
    })
    router.push(`/boarding?${params.toString()}`)
  }

  function handleExploreSeats() {
    if (isMatchingPaused) return
    const token = localStorage.getItem('token')
    const params = new URLSearchParams({
      type: 'seek',
      lineLabel: DEFAULT_HOME_LINE_LABEL,
    })
    if (!token) {
      router.push(`/register?${params.toString()}`)
      return
    }
    router.push(`/boarding?${params.toString()}`)
  }

  if (!isAuthChecked) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#f5f5f0] text-[#888888]">
        <p className="text-sm font-semibold">로딩 중...</p>
      </div>
    )
  }

  return (
    <div className="mx-auto flex h-dvh max-h-dvh w-full max-w-[480px] flex-col overflow-hidden bg-[#f5f5f0]">
      <CongestionHaltModal
        open={showCongestionModal}
        onClose={() => setShowCongestionModal(false)}
        congestionLevel={congestionStatus?.levelsByLine[resolveLineNumberFromLabel(selectedLineLabel)]}
      />

      <header className="flex shrink-0 items-center justify-between border-b border-[#EBEBEB] bg-white px-4 py-3 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]">
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center text-[#1A1A1A]"
          aria-label="메뉴"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>

        <p className="text-[17px] font-bold text-[#1A1A1A]">빈자리, 잽싸게</p>

        <Link
          href={isLoggedIn ? '/profile' : '/login'}
          className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-[#EBEBEB] bg-[#f5f5f0] text-sm font-bold text-[#1A1A1A]"
          aria-label={isLoggedIn ? '프로필' : '로그인'}
        >
          {isLoggedIn ? displayName!.slice(0, 1).toUpperCase() : 'L'}
        </Link>
      </header>

      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain pb-[max(2.75rem,env(safe-area-inset-bottom))]">
        {/* 검색 카드 */}
        <section className="mx-4 mt-4 overflow-hidden rounded-2xl bg-white shadow-sm">
          <button
            type="button"
            onClick={handleSearchClick}
            className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="shrink-0 text-[#888888]" aria-hidden>
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
              <path d="M16 16l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span className="text-[15px] text-[#AAAAAA]">어디로 갈까요?</span>
          </button>

          <div className="mx-4 border-t border-[#F0F0F0]" />

          <div className="flex items-center gap-3 px-4 py-3">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="shrink-0 text-[#AAAAAA]" aria-hidden>
              <path
                d="M12 21s-6-5.2-6-10a6 6 0 1112 0c0 4.8-6 10-6 10z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
              />
              <circle cx="12" cy="11" r="2" fill="currentColor" />
            </svg>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium text-[#AAAAAA]">출발역</p>
              <p className="text-[15px] font-semibold text-[#1A1A1A]">7호선 온수역</p>
            </div>
          </div>

          <div className="mx-4 border-t border-[#F0F0F0]" />

          <div className="flex items-center gap-3 px-4 py-3">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="shrink-0" style={{ color: BRAND_GREEN }} aria-hidden>
              <path
                d="M12 21s-6-5.2-6-10a6 6 0 1112 0c0 4.8-6 10-6 10z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
              />
              <circle cx="12" cy="11" r="2" fill="currentColor" />
            </svg>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium text-[#AAAAAA]">도착역</p>
              <p className="text-[15px] font-semibold text-[#1A1A1A]">가산디지털단지역</p>
            </div>
          </div>
        </section>

        {/* 탭 */}
        <section className="mx-4 mt-4 flex border-b border-[#E8E8E8]">
          <button
            type="button"
            onClick={() => setActiveTab('seek')}
            className={`flex-1 pb-2.5 text-center text-[15px] transition ${
              activeTab === 'seek'
                ? 'border-b-2 border-[#6b9e3f] font-bold text-[#1A1A1A]'
                : 'font-medium text-[#888888]'
            }`}
          >
            자리 찾기
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('leave')}
            className={`flex-1 pb-2.5 text-center text-[15px] transition ${
              activeTab === 'leave'
                ? 'border-b-2 border-[#6b9e3f] font-bold text-[#1A1A1A]'
                : 'font-medium text-[#888888]'
            }`}
          >
            내릴게요
          </button>
        </section>

        {/* 액션 버튼 */}
        <section className="mx-4 mt-3">
          {activeTab === 'seek' ? (
            <div className="flex gap-3">
              <button
                type="button"
                disabled={isMatchingPaused}
                onClick={() => handleModeSelect('seek')}
                className="zeb-touch-target flex flex-1 items-center justify-center rounded-xl bg-[#6b9e3f] py-4 text-[16px] font-bold text-white transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
              >
                바로 앉기
              </button>
              <button
                type="button"
                disabled={isMatchingPaused}
                onClick={handleExploreSeats}
                className="zeb-touch-target flex flex-1 items-center justify-center rounded-xl border border-[#6b9e3f] py-4 text-[16px] font-bold text-[#6b9e3f] transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
              >
                자리 탐색
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={isMatchingPaused}
              onClick={() => handleModeSelect('leave')}
              className="zeb-touch-target flex w-full items-center justify-center rounded-xl bg-[#6b9e3f] py-4 text-[16px] font-bold text-white transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
            >
              내릴게요 등록
            </button>
          )}

          {isMatchingPaused ? (
            <p
              className="mt-3 rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-3 py-2.5 text-xs font-bold text-[#DC2626]"
              role="alert"
            >
              현재 매칭 기능이 일시 정지되었습니다. 잠시 후 다시 시도해주세요.
            </p>
          ) : null}
        </section>

        {/* 실시간 통계 바 */}
        <section className="mx-4 mt-3 flex items-center justify-between rounded-xl bg-white px-4 py-3">
          <div>
            <p className="text-[13px] font-medium text-[#888888]">실시간 대기</p>
            <p className="mt-0.5 text-[18px] font-extrabold text-[#6b9e3f]">3개</p>
          </div>
          <div className="text-right">
            <p className="text-[13px] font-medium text-[#888888]">매칭 성공률</p>
            <p className="mt-0.5 text-[18px] font-extrabold text-[#6b9e3f]">98%</p>
          </div>
        </section>

        {/* 환승 많은 역 */}
        <section className="mx-4 mt-4" aria-label="환승 많은 역">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[16px] font-bold text-[#1A1A1A]">환승 많은 역</h2>
            <div className="flex items-center gap-2">
              <button type="button" className="text-[#AAAAAA]" aria-label="이전">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button type="button" className="text-[#AAAAAA]" aria-label="다음">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
              transferStations.map((station, index) => (
                <button
                  key={`${station}-${index}`}
                  type="button"
                  className={`shrink-0 rounded-full px-3 py-1 text-[13px] font-semibold ${
                    index === 0
                      ? 'bg-[#6b9e3f] text-white'
                      : 'border border-gray-200 bg-white text-gray-600'
                  }`}
                >
                  {station}
                </button>
              ))
            )}
          </div>
        </section>

        {/* 실시간 매칭 현황 */}
        <section aria-label="실시간 매칭 현황" className="pb-6">
          <div className="mx-4 mt-6 flex items-center justify-between">
            <h2 className="text-base font-bold text-[#1A1A1A]">실시간 매칭 현황</h2>
            <span className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 animate-pulse rounded-full bg-[#6b9e3f]"
                aria-hidden
              />
              <span className="text-xs text-[#6b9e3f]">LIVE</span>
            </span>
          </div>

          <div className="mx-4 mt-2 grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-white p-3 text-center">
              <p className="text-2xl font-bold text-[#6b9e3f]">
                {formatLiveStatValue(pendingCount, liveStatsLoading, liveStatsError)}
              </p>
              <p className="mt-1 text-xs text-gray-400">대기중</p>
            </div>
            <div className="rounded-xl bg-white p-3 text-center">
              <p className="text-2xl font-bold text-[#6b9e3f]">
                {formatLiveStatValue(todayMatchedCount, liveStatsLoading, liveStatsError)}
              </p>
              <p className="mt-1 text-xs text-gray-400">오늘 매칭</p>
            </div>
            <div className="rounded-xl bg-white p-3 text-center">
              <p className="text-2xl font-bold text-[#6b9e3f]">
                {formatLiveStatValue(successRate, liveStatsLoading, liveStatsError, '%')}
              </p>
              <p className="mt-1 text-xs text-gray-400">성공률</p>
            </div>
          </div>

          <div className="mx-4 mt-2 divide-y overflow-hidden rounded-2xl bg-white">
            <p className="px-4 pt-3 text-sm font-medium text-[#1A1A1A]">최근 매칭</p>

            {liveStatsLoading ? (
              <p className="py-6 text-center text-sm text-gray-400">...</p>
            ) : liveStatsError ? (
              <p className="py-6 text-center text-sm text-gray-400">-</p>
            ) : recentMatches.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-400">아직 매칭 기록이 없어요</p>
            ) : (
              recentMatches.map((match) => (
                <div
                  key={match.id}
                  className="flex items-center justify-between px-4 py-3"
                >
                  <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-[#1A1A1A]">
                    <span aria-hidden>🚇</span>
                    <span className="truncate">{match.routeLabel}</span>
                  </span>
                  <span className="shrink-0 text-xs text-gray-400">
                    {formatMinutesAgo(match.createdAt)}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>

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
