'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import CongestionHaltModal from '@/components/CongestionHaltModal'
import InstallShortcut, { useInstallShortcutVisible } from '@/components/InstallShortcut'
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
/** 홈 화면 표시용 실시간 이용자 수 (대기 인원과 별개) */
const ACTIVE_USER_DISPLAY_BASE = 6000
const SEEK_LINE_OPTIONS = [
  { label: '서울 1호선', shortLabel: '1호선', badge: '1', color: '#0052A4' },
  { label: '서울 2호선', shortLabel: '2호선', badge: '2', color: '#00A84D' },
  { label: '서울 3호선', shortLabel: '3호선', badge: '3', color: '#EF7C1C' },
  { label: '서울 4호선', shortLabel: '4호선', badge: '4', color: '#00A5DE' },
  { label: '서울 5호선', shortLabel: '5호선', badge: '5', color: '#996CAC' },
  { label: '서울 6호선', shortLabel: '6호선', badge: '6', color: '#CD7C2F' },
  { label: '서울 7호선', shortLabel: '7호선', badge: '7', color: '#747F00' },
  { label: '서울 8호선', shortLabel: '8호선', badge: '8', color: '#E6186C' },
  { label: '서울 9호선', shortLabel: '9호선', badge: '9', color: '#BDB092' },
  { label: '인천 1호선', shortLabel: '인천1', badge: '인1', color: '#759CCE' },
  { label: '인천 2호선', shortLabel: '인천2', badge: '인2', color: '#F5A200' },
] as const

function HomeGallery() {
  return (
    <section className="mb-6" aria-label="지하철 갤러리">
      <div className="overflow-hidden rounded-lg" style={{ aspectRatio: '16 / 10' }}>
        <img
          src="/home-gallery/hero.png"
          alt="지하철 객실 내부"
          className="h-full w-full object-cover"
          loading="eager"
          decoding="async"
        />
      </div>
    </section>
  )
}

/**
 * 시간대에 따라 소폭 변동되는 표시용 이용자 수 (~5,900–6,100명)
 */
function getDisplayActiveUserCount(): number {
  const now = new Date()
  const jitter =
    ((now.getHours() * 17 + now.getMinutes() * 3 + now.getDate() * 11) % 201) - 100
  return ACTIVE_USER_DISPLAY_BASE + jitter
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

function ChevronRightIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
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
  const [activeUserCount, setActiveUserCount] = useState(ACTIVE_USER_DISPLAY_BASE)
  const [selectedSeekLineLabel, setSelectedSeekLineLabel] = useState<string>('서울 1호선')
  const { visible: showInstallShortcut, hide: hideInstallShortcut } = useInstallShortcutVisible()

  const loadHomeData = useCallback(async (token: string) => {
    setIsLoadingData(true)
    setActiveUserCount(getDisplayActiveUserCount())

    const status = await fetchCongestionStatus(token)
    setCongestionStatus(status)
    setIsLoadingData(false)
  }, [])

  useEffect(() => {
    const paused = isLineHalted(congestionStatus, selectedSeekLineLabel)
    setIsMatchingPaused(paused)
    if (paused && !isLoadingData) {
      setShowCongestionModal(true)
    }
  }, [congestionStatus, selectedSeekLineLabel, isLoadingData])

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) {
      router.replace('/login')
      return
    }

    try {
      const raw = localStorage.getItem('user')
      if (raw) {
        setUser(JSON.parse(raw) as StoredUser)
      }
      setIsAuthChecked(true)
      void loadHomeData(token)
    } catch {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      router.replace('/login')
    }
  }, [router, loadHomeData])

  const displayName = user?.username ?? '회원'
  const mannerPoints = user?.total_points ?? 0

  async function pushSeekPage(lineLabel: string) {
    const params = new URLSearchParams({
      type: 'seek',
      lineLabel,
    })
    router.push(`/boarding?${params.toString()}`)
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
    setSelectedSeekLineLabel(lineLabel)
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
    <div className="mx-auto min-h-dvh w-full max-w-[480px] bg-[#F7F8FA] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pb-[max(2.5rem,env(safe-area-inset-bottom))]">
      <CongestionHaltModal
        open={showCongestionModal}
        onClose={() => setShowCongestionModal(false)}
        congestionLevel={congestionStatus?.levelsByLine[resolveLineNumberFromLabel(selectedSeekLineLabel)]}
      />
      <main className="px-4 pb-10 pt-6">
        <header className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#0052A4] text-white">
              <span className="text-sm font-extrabold">🚆</span>
            </div>
            <p className="text-2xl font-extrabold tracking-tight text-[#1A1A1A]">잽싸게</p>
          </div>
          <Link
            href="/profile"
            className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-white text-sm font-bold text-[#888888] shadow-sm"
            aria-label="프로필"
          >
            {displayName.slice(0, 1).toUpperCase()}
          </Link>
        </header>

        <HomeGallery />

        <section className="mb-6">
          <p className="mb-1 text-sm font-medium text-[#888888]">안녕하세요</p>
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-[28px] font-extrabold leading-tight tracking-tight text-[#1A1A1A]">
              {displayName}님
            </h1>
            <span className="shrink-0 rounded-full bg-[#FFEAD9] px-3 py-1.5 text-sm font-bold text-[#F97316]">
              매너포인트 {mannerPoints.toLocaleString()}
            </span>
          </div>
        </section>

        <section className="mb-6 space-y-3">
          <div className="rounded-2xl bg-white px-4 py-4 shadow-sm">
            <p className="mb-3 block text-xs font-bold text-[#6F7682]">노선 선택</p>
            <div className="grid grid-cols-3 gap-x-4 gap-y-5">
              {SEEK_LINE_OPTIONS.map((line) => {
                const selected = selectedSeekLineLabel === line.label
                return (
                  <button
                    key={line.label}
                    type="button"
                    className="zeb-touch-target flex min-h-11 min-w-11 flex-col items-center gap-1"
                    onClick={() => setSelectedSeekLineLabel(line.label)}
                    aria-label={line.label}
                  >
                    <span
                      className="inline-flex h-[58px] w-[58px] items-center justify-center rounded-full text-base font-extrabold text-white"
                      style={{
                        background: line.color,
                        boxShadow: selected ? `0 0 0 3px ${line.color}33` : 'none',
                        border: selected ? '2px solid #0B1F4B' : '2px solid transparent',
                      }}
                    >
                      {line.badge}
                    </span>
                    <span
                      className="text-xs font-bold leading-tight"
                      style={{ color: selected ? line.color : '#6F7682' }}
                    >
                      {line.shortLabel}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          <button
            type="button"
            disabled={isMatchingPaused}
            onClick={() => {
              void startSeekByLineSelection(selectedSeekLineLabel)
            }}
            className="zeb-touch-target flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-[#0B1F4B] py-5 text-xl font-extrabold text-white shadow-[0_8px_20px_rgba(11,31,75,0.24)] transition duration-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
          >
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/20">
              🧍
            </span>
            앉고 싶어요
          </button>
          {isMatchingPaused && (
            <p
              className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-3 py-2.5 text-xs font-bold text-[#DC2626]"
              role="alert"
            >
              현재 매칭 기능이 일시 정지되었습니다. 잠시 후 다시 시도해주세요.
            </p>
          )}

          <button
            type="button"
            disabled={isMatchingPaused}
            onClick={() => {
              if (isLineHalted(congestionStatus, selectedSeekLineLabel)) {
                setShowCongestionModal(true)
                return
              }
              const params = new URLSearchParams({
                type: 'leave',
                lineLabel: selectedSeekLineLabel,
              })
              router.push(`/boarding?${params.toString()}`)
            }}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-[#D8DCE2] bg-white py-4 text-lg font-extrabold text-[#0B1F4B] transition duration-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
          >
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#EEF3FB]">
              <ChevronRightIcon />
            </span>
            내릴게요
          </button>
        </section>

        {showInstallShortcut ? (
          <section className="mb-6">
            <InstallShortcut onDismiss={hideInstallShortcut} />
          </section>
        ) : null}

        <section className="rounded-2xl border border-[#E6E8EB] bg-white p-4 shadow-sm">
          <p className="mb-1 text-sm font-semibold text-[#888888]">지금 이용 중</p>
          <p className="text-4xl font-extrabold leading-none text-[#F97316]">
            {isLoadingData ? '—' : `${activeUserCount.toLocaleString()}명`}
          </p>
          <p className="mt-3 text-sm font-medium text-[#6F7682]">
            잽싸게를 함께 이용하고 있어요
          </p>
        </section>
      </main>
    </div>
  )
}
