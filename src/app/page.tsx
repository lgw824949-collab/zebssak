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

  if (!isAuthChecked) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#F7F8FA] text-[#888888]">
        <p className="text-sm font-semibold">로딩 중...</p>
      </div>
    )
  }

  return (
    <div className="mx-auto flex h-dvh max-h-dvh w-full max-w-[480px] flex-col overflow-hidden bg-[#F7F8FA]">
      <CongestionHaltModal
        open={showCongestionModal}
        onClose={() => setShowCongestionModal(false)}
        congestionLevel={congestionStatus?.levelsByLine[resolveLineNumberFromLabel(selectedLineLabel)]}
      />
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain pb-[max(2.75rem,env(safe-area-inset-bottom))] pl-[max(1.25rem,env(safe-area-inset-left))] pr-[max(1.25rem,env(safe-area-inset-right))] pt-5">
        <header className="mb-2 flex shrink-0 items-center justify-end">
            <Link
              href={isLoggedIn ? '/profile' : '/login'}
              className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-[#EBEBEB] bg-white text-sm font-bold text-[#888888]"
              aria-label={isLoggedIn ? '프로필' : '로그인'}
            >
              {isLoggedIn ? displayName!.slice(0, 1).toUpperCase() : '👤'}
            </Link>
          </header>

        <div className="flex flex-col gap-5 pb-6 pt-1">
            <section>
              <span
                className="inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-[14px] font-bold"
                style={{
                  borderColor: `${LINE7_OLIVE}33`,
                  backgroundColor: `${LINE7_OLIVE}14`,
                  color: LINE7_OLIVE,
                }}
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: LINE7_OLIVE }}
                  aria-hidden
                />
                7호선 실증 운영중
              </span>

              <h1 className="mt-5 whitespace-pre-line text-[42px] font-extrabold leading-[1.08] tracking-tight text-[#1A1A1A]">
                {'빈자리,\n잽싸게'}
              </h1>
              <p className="mt-3 text-[17px] font-medium leading-relaxed text-[#5C6570]">
                지하철 착석 공유 플랫폼
              </p>

              <ol className="mt-5 flex gap-2">
                {[
                  { step: 1, label: '7호선 데이터 확보', active: true },
                  { step: 2, label: '서울 전 노선 적용', active: false },
                  { step: 3, label: '수도권 확대', active: false },
                ].map((item) => (
                  <li
                    key={item.step}
                    className="flex min-w-0 flex-1 flex-col rounded-xl border px-3 py-3"
                    style={
                      item.active
                        ? {
                            borderColor: LINE7_OLIVE,
                            backgroundColor: `${LINE7_OLIVE}12`,
                          }
                        : { borderColor: '#EBEBEB', backgroundColor: '#FFFFFF' }
                    }
                  >
                    <span
                      className="text-[14px] font-bold uppercase tracking-wide"
                      style={{ color: item.active ? LINE7_OLIVE : '#B0B5BD' }}
                    >
                      {item.step}단계
                    </span>
                    <span
                      className="mt-1 truncate text-[15px] font-extrabold"
                      style={{ color: item.active ? '#1A1A1A' : '#888888' }}
                    >
                      {item.label}
                    </span>
                    <span
                      className="mt-0.5 text-[14px] font-semibold"
                      style={{ color: item.active ? LINE7_OLIVE : '#B0B5BD' }}
                    >
                      {item.active ? '운영 중' : '예정'}
                    </span>
                  </li>
                ))}
              </ol>
            </section>

            <section className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-[#EBEBEB] bg-white p-4 shadow-[0_2px_12px_rgba(26,26,26,0.04)]">
                <p className="text-[14px] font-semibold text-[#888888]">환승역 수</p>
                <p className="zeb-mono mt-1.5 text-[30px] font-extrabold leading-none" style={{ color: LINE7_OLIVE }}>
                  66개
                </p>
              </div>
              <div className="rounded-xl border border-[#EBEBEB] bg-white p-4 shadow-[0_2px_12px_rgba(26,26,26,0.04)]">
                <p className="text-[14px] font-semibold text-[#888888]">평균착석 시간</p>
                <p className="zeb-mono mt-1.5 text-[30px] font-extrabold leading-none" style={{ color: LINE7_OLIVE }}>
                  30분
                </p>
              </div>
            </section>

            <section className="rounded-xl border border-[#EBEBEB] bg-white p-4 shadow-[0_2px_12px_rgba(26,26,26,0.04)]">
              <h2 className="text-[17px] font-extrabold text-[#1A1A1A]">왜 7호선인가?</h2>
              <ul className="mt-3 space-y-3">
                {[
                  '서울교통공사 혼잡도 데이터 분석 결과',
                  '착석 수요·장거리 이용 최적 노선',
                ].map((text) => (
                  <li key={text} className="flex items-start gap-2.5 text-[16px] font-medium leading-snug text-[#5C6570]">
                    <span
                      className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: LINE7_OLIVE }}
                      aria-hidden
                    />
                    {text}
                  </li>
                ))}
              </ul>
            </section>

            <section className="flex shrink-0 flex-col gap-3 pt-1">
              <button
                type="button"
                disabled={isMatchingPaused}
                onClick={() => handleModeSelect('seek')}
                className="zeb-touch-target flex h-[3.25rem] w-full items-center justify-center rounded-xl text-[19px] font-extrabold text-white transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
                style={{
                  backgroundColor: LINE7_OLIVE,
                  boxShadow: `0 6px 18px ${LINE7_OLIVE}40`,
                }}
              >
                앉고 싶어요
              </button>

              <button
                type="button"
                disabled={isMatchingPaused}
                onClick={() => handleModeSelect('leave')}
                className="zeb-touch-target flex h-[3rem] w-full items-center justify-center rounded-xl border border-[#EBEBEB] bg-white text-[18px] font-semibold text-[#1A1A1A] transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
              >
                내릴게요
              </button>

              {isMatchingPaused ? (
                <p
                  className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-3 py-2.5 text-xs font-bold text-[#DC2626]"
                  role="alert"
                >
                  현재 매칭 기능이 일시 정지되었습니다. 잠시 후 다시 시도해주세요.
                </p>
              ) : null}
            </section>
          </div>

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
