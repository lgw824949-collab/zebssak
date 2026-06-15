'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'

type StatusBadge = 'none' | 'match'

const LINE7_COLOR = '#747F00'

/** 하단 탭을 표시하는 경로 */
const BOTTOM_NAV_PATHS = new Set(['/', '/waiting', '/profile'])

function isBottomNavPath(pathname: string | null): boolean {
  if (!pathname) return false
  return BOTTOM_NAV_PATHS.has(pathname)
}

/** session·API로 매칭 대기(수락 필요) 시에만 내 상태 탭 배지를 표시합니다. */
async function resolveStatusBadge(): Promise<StatusBadge> {
  if (typeof window === 'undefined') {
    return 'none'
  }

  try {
    const token = localStorage.getItem('token')
    if (!token) {
      return 'none'
    }

    let requestId = sessionStorage.getItem('activeMatchRequestId')?.trim() ?? ''

    if (!requestId) {
      const currentResponse = await fetch('/api/match-requests/current', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const currentPayload = (await currentResponse.json()) as {
        success?: boolean
        data?: { id?: string }
      }
      if (currentResponse.ok && currentPayload.success && currentPayload.data?.id) {
        requestId = currentPayload.data.id
      }
    }

    if (!requestId) {
      return 'none'
    }

    const response = await fetch(
      `/api/match-requests/status?request_id=${encodeURIComponent(requestId)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      }
    )

    const payload = (await response.json()) as {
      success?: boolean
      data?: {
        match_request?: { status?: string } | null
        match?: { id?: string; status?: string } | null
      }
    }

    if (!response.ok || !payload.success) {
      return 'none'
    }

    if (payload.data?.match_request?.status === 'cancelled') {
      return 'none'
    }

    if (payload.data?.match?.status === 'pending' && payload.data.match.id) {
      return 'match'
    }

    return 'none'
  } catch {
    return 'none'
  }
}

function NavIconHome({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z"
        stroke={active ? LINE7_COLOR : '#9CA3AF'}
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function NavIconStatus({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle
        cx="12"
        cy="12"
        r="8"
        stroke={active ? LINE7_COLOR : '#9CA3AF'}
        strokeWidth="1.8"
      />
      <path
        d="M12 8v4l2.5 2.5"
        stroke={active ? LINE7_COLOR : '#9CA3AF'}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}

function NavIconProfile({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle
        cx="12"
        cy="9"
        r="3.5"
        stroke={active ? LINE7_COLOR : '#9CA3AF'}
        strokeWidth="1.8"
      />
      <path
        d="M5 20c1.5-3 4-4.5 7-4.5s5.5 1.5 7 4.5"
        stroke={active ? LINE7_COLOR : '#9CA3AF'}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}

export default function BottomNav() {
  const pathname = usePathname()
  const [statusBadge, setStatusBadge] = useState<StatusBadge>('none')
  const [isLoggedIn, setIsLoggedIn] = useState(false)

  const refreshBadge = useCallback(async () => {
    const badge = await resolveStatusBadge()
    setStatusBadge(badge)
  }, [])

  useEffect(() => {
    if (!isBottomNavPath(pathname)) {
      return
    }

    try {
      setIsLoggedIn(Boolean(localStorage.getItem('token')))
    } catch {
      setIsLoggedIn(false)
    }

    void refreshBadge()

    const intervalId = window.setInterval(() => {
      void refreshBadge()
    }, 15000)

    const onStorage = () => {
      void refreshBadge()
    }

    window.addEventListener('storage', onStorage)
    window.addEventListener('focus', onStorage)

    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('focus', onStorage)
    }
  }, [pathname, refreshBadge])

  if (!isBottomNavPath(pathname)) {
    return null
  }

  const profileHref = isLoggedIn ? '/profile' : '/login'
  const tabs = [
    { href: '/', label: '홈', active: pathname === '/', icon: NavIconHome },
    {
      href: '/waiting',
      label: '내 상태',
      active: pathname === '/waiting',
      icon: NavIconStatus,
      badge: statusBadge,
    },
    {
      href: profileHref,
      label: '내 정보',
      active: pathname === '/profile' || pathname === '/login',
      icon: NavIconProfile,
    },
  ] as const

  return (
    <nav
      className="zeb-bottom-nav"
      aria-label="하단 메뉴"
    >
      {tabs.map((tab) => {
        const Icon = tab.icon
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`zeb-bottom-nav__item${tab.active ? ' zeb-bottom-nav__item--active' : ''}`}
            aria-current={tab.active ? 'page' : undefined}
          >
            <span className="relative inline-flex">
              <Icon active={tab.active} />
              {'badge' in tab && tab.badge === 'match' ? (
                <span
                  className="absolute -right-1.5 -top-1 flex h-2.5 w-2.5 rounded-full bg-[#E85D04]"
                  aria-hidden
                />
              ) : null}
            </span>
            <span className="zeb-bottom-nav__label">{tab.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
