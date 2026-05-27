'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'

interface StoredUser {
  username: string
  nickname?: string | null
  total_points?: number
}

interface CongestionLine {
  line_number: number
  congestion_level: number
}

interface CongestionApiData {
  lines?: CongestionLine[]
  latest_by_line?: Record<string, { congestion_level?: number } | null>
}

/** 홈 화면 표시용 실시간 이용자 수 (대기 인원과 별개) */
const ACTIVE_USER_DISPLAY_BASE = 6000

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` }
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
  const [activeUserCount, setActiveUserCount] = useState(ACTIVE_USER_DISPLAY_BASE)

  const loadHomeData = useCallback(async (token: string) => {
    setIsLoadingData(true)
    setActiveUserCount(getDisplayActiveUserCount())

    let matchingPaused = false

    try {
      const congestionRes = await fetch('/api/congestion', {
        headers: authHeaders(token),
        cache: 'no-store',
      })

      if (congestionRes.ok) {
        const congestionJson = (await congestionRes.json()) as {
          success?: boolean
          data?: CongestionApiData
        }

        if (congestionJson.success && congestionJson.data) {
          const data = congestionJson.data

          if (Array.isArray(data.lines)) {
            for (const row of data.lines) {
              if (row.congestion_level >= 7) matchingPaused = true
            }
          } else if (data.latest_by_line) {
            for (const key of Object.keys(data.latest_by_line)) {
              const level = data.latest_by_line[key]?.congestion_level
              if (typeof level === 'number' && level >= 7) {
                matchingPaused = true
                break
              }
            }
          }
        }
      }
    } catch {
      // 혼잡도 API 미연동 시 무시
    }

    setIsMatchingPaused(matchingPaused)
    setIsLoadingData(false)
  }, [])

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

  if (!isAuthChecked) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#F7F8FA] text-[#888888]">
        <p className="text-sm font-semibold">로딩 중...</p>
      </div>
    )
  }

  return (
    <div className="mx-auto min-h-dvh w-full max-w-[480px] bg-[#F7F8FA]">
      <main className="px-4 pb-8 pt-5">
        <header className="mb-5 flex items-center justify-between">
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

        <section className="mb-6 rounded-2xl border border-[#E6E8EB] bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-lg font-extrabold text-[#1A1A1A]">빠른 시작</h2>
          <p className="text-sm font-medium text-[#6F7682]">
            1) 역할 선택 → 2) 호선/열차/방향 선택 → 3) 좌석/목적지 입력
          </p>
          {isMatchingPaused && (
            <p
              className="mt-3 rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-3 py-2.5 text-xs font-bold text-[#DC2626]"
              role="alert"
            >
              현재 매칭 기능이 일시 정지되었습니다. 잠시 후 다시 시도해주세요.
            </p>
          )}
        </section>

        <section className="mb-6 space-y-3">
          <button
            type="button"
            disabled={isMatchingPaused}
            onClick={() => router.push('/boarding?type=seek')}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#0B1F4B] py-5 text-xl font-extrabold text-white shadow-[0_8px_20px_rgba(11,31,75,0.24)] transition duration-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
          >
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/20">
              🧍
            </span>
            앉고 싶어요
          </button>

          <button
            type="button"
            disabled={isMatchingPaused}
            onClick={() => router.push('/boarding?type=leave')}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-[#D8DCE2] bg-white py-5 text-xl font-extrabold text-[#0B1F4B] transition duration-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
          >
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#EEF3FB]">
              <ChevronRightIcon />
            </span>
            내릴게요
          </button>
        </section>

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
