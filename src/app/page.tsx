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
import { fetchPublicAppStats, type PublicAppStats } from '@/lib/app-stats'

interface StoredUser {
  username: string
  nickname?: string | null
  total_points?: number
}

/** 홈 GPS 프리페치 — 탑승 화면 캐시와 동일한 1km 기준 */
const GPS_MAX_RADIUS_KM = 1
/** 홈 2단계 — 현재 서울 1·2호선만 노출 (다른 노선은 준비 중) */
const HOME_LINE_OPTIONS = [
  { label: '서울 1호선', shortLabel: '1호선', badge: '1', color: '#0052A4' },
  { label: '서울 2호선', shortLabel: '2호선', badge: '2', color: '#00A84D' },
] as const

type HomeFlowMode = 'seek' | 'leave'
type HomeStep = 'mode' | 'line'

function ChevronRightIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0 text-[#B0B5BD]">
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

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
  const [appStats, setAppStats] = useState<PublicAppStats | null>(null)
  const [selectedLineLabel, setSelectedLineLabel] = useState<string>('서울 1호선')
  const [homeStep, setHomeStep] = useState<HomeStep>('mode')
  const [homeMode, setHomeMode] = useState<HomeFlowMode | null>(null)
  const loadHomeData = useCallback(async (token: string | null) => {
    setIsLoadingData(true)

    const [status, stats] = await Promise.all([
      fetchCongestionStatus(token),
      fetchPublicAppStats(),
    ])

    setCongestionStatus(status)
    setAppStats(stats)
    setIsLoadingData(false)
  }, [])

  useEffect(() => {
    const lineLabel = homeStep === 'line' ? selectedLineLabel : '서울 1호선'
    const paused = isLineHalted(congestionStatus, lineLabel)
    setIsMatchingPaused(paused)
    if (paused && !isLoadingData && homeStep === 'line') {
      setShowCongestionModal(true)
    }
  }, [congestionStatus, selectedLineLabel, isLoadingData, homeStep])

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
    setHomeStep('line')
  }

  function handleBackToModeStep() {
    setHomeStep('mode')
    setHomeMode(null)
  }

  async function proceedToBoarding(lineLabel: string) {
    if (!homeMode) return
    if (isLineHalted(congestionStatus, lineLabel)) {
      setSelectedLineLabel(lineLabel)
      setShowCongestionModal(true)
      return
    }
    setSelectedLineLabel(lineLabel)
    if (homeMode === 'seek') {
      void startSeekByLineSelection(lineLabel)
      return
    }
    void pushBoardingPage(lineLabel, 'leave')
  }

  function handleLinePick(lineLabel: string) {
    if (isMatchingPaused || !homeMode) return

    if (isLineHalted(congestionStatus, lineLabel)) {
      setSelectedLineLabel(lineLabel)
      setShowCongestionModal(true)
      return
    }

    const token = localStorage.getItem('token')
    if (!token) {
      const params = new URLSearchParams({
        type: homeMode,
        lineLabel,
      })
      router.push(`/register?${params.toString()}`)
      return
    }

    void proceedToBoarding(lineLabel)
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

  if (!isAuthChecked) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#F7F8FA] text-[#888888]">
        <p className="text-sm font-semibold">로딩 중...</p>
      </div>
    )
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col bg-[#F7F8FA]">
      <CongestionHaltModal
        open={showCongestionModal}
        onClose={() => setShowCongestionModal(false)}
        congestionLevel={congestionStatus?.levelsByLine[resolveLineNumberFromLabel(selectedLineLabel)]}
      />
      <main className="flex flex-1 flex-col pb-[max(1.25rem,env(safe-area-inset-bottom))] pl-[max(1.25rem,env(safe-area-inset-left))] pr-[max(1.25rem,env(safe-area-inset-right))] pt-5">
        {homeStep === 'mode' ? (
          <header className="mb-2 flex shrink-0 items-center justify-end">
            <Link
              href={isLoggedIn ? '/profile' : '/login'}
              className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-[#EBEBEB] bg-white text-sm font-bold text-[#888888]"
              aria-label={isLoggedIn ? '프로필' : '로그인'}
            >
              {isLoggedIn ? displayName!.slice(0, 1).toUpperCase() : '👤'}
            </Link>
          </header>
        ) : null}

        {homeStep === 'mode' ? (
          <div className="flex flex-1 flex-col justify-center pb-10">
            <section className="mb-10 text-center">
              <p className="mb-4 text-[32px] leading-none" aria-hidden>
                🚇
              </p>
              <h1 className="text-[32px] font-extrabold leading-[1.12] tracking-tight text-[#1A1A1A]">
                빈자리, 잽싸게
              </h1>
              <p className="mt-4 text-[15px] font-semibold leading-snug text-[#1A1A1A]">
                서울 1·2호선
                <br />
                실시간 자리 공유 서비스
              </p>
              <p className="mt-4 text-[14px] font-medium text-[#888888]">
                누적{' '}
                <span className="zeb-mono font-extrabold text-[#F97316]">
                  {isLoadingData ? '—' : `${(appStats?.display_count ?? 0).toLocaleString()}명`}
                </span>
                이 이용 중
              </p>
              {!isLoadingData && appStats ? (
                <p className="mt-1.5 text-[12px] font-medium text-[#B0B5BD]">
                  {appStats.member_count.toLocaleString()}명 가입 ·{' '}
                  {appStats.pwa_install_count.toLocaleString()}명 설치
                </p>
              ) : null}
            </section>

            <section>
              <button
                type="button"
                disabled={isMatchingPaused}
                onClick={() => handleModeSelect('seek')}
                className="zeb-touch-target flex h-[56px] w-full items-center justify-center rounded-xl bg-[#0B1F4B] text-[18px] font-extrabold text-white transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
              >
                앉고 싶어요
              </button>

              <button
                type="button"
                disabled={isMatchingPaused}
                onClick={() => handleModeSelect('leave')}
                className="zeb-touch-target mt-3 flex h-11 w-full items-center justify-center text-[15px] font-semibold text-[#888888] transition active:opacity-60 disabled:cursor-not-allowed disabled:opacity-45"
              >
                내릴게요
              </button>

              {isMatchingPaused ? (
                <p
                  className="mt-4 rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-3 py-2.5 text-xs font-bold text-[#DC2626]"
                  role="alert"
                >
                  현재 매칭 기능이 일시 정지되었습니다. 잠시 후 다시 시도해주세요.
                </p>
              ) : null}
            </section>
          </div>
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
                호선을 선택해 주세요
              </h2>
              <p className="mt-2 text-[13px] font-medium text-[#888888]">
                현재 서울 1·2호선만 운영 중입니다
              </p>
            </div>

            <div className="flex flex-col gap-2.5">
              {HOME_LINE_OPTIONS.map((line) => (
                <button
                  key={line.label}
                  type="button"
                  disabled={isMatchingPaused}
                  className="zeb-touch-target flex w-full items-center gap-4 rounded-xl bg-white px-4 py-[18px] transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
                  onClick={() => handleLinePick(line.label)}
                  aria-label={`${line.label} 선택`}
                >
                  <span
                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[15px] font-extrabold text-white"
                    style={{ background: line.color }}
                  >
                    {line.badge}
                  </span>
                  <span className="flex-1 text-left text-[16px] font-bold text-[#1A1A1A]">
                    {line.label}
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
      </main>
    </div>
  )
}
