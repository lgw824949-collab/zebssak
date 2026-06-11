'use client'

import { usePathname } from 'next/navigation'
import { type ReactNode } from 'react'
import BottomNav from '@/components/BottomNav'

/** PC 등 넓은 화면에서도 휴대폰 폭으로 중앙 표시 (관리자 페이지 제외) */
export default function MobileAppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const isAdminRoute = pathname?.startsWith('/admin') ?? false

  if (isAdminRoute) {
    return <>{children}</>
  }

  return (
    <div className="mobile-app-frame">
      <div className="mobile-app-shell flex min-h-dvh flex-col">
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        <BottomNav />
      </div>
    </div>
  )
}
