'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

const LINE7_COLOR = '#747F00'

const MENU_ITEMS = [
  { href: '/guide', label: '이용 방법', description: '빈자리 찾기·자리 넘기기 안내' },
  { href: '/points', label: '포인트 내역', description: '서비스 예정 · 미리보기' },
  { href: '/rules', label: '매칭·이용 규칙', description: '우선순위·패널티·혼잡도' },
] as const

/** 햄버거 메뉴 — 이용 방법·포인트·규칙 바로가기 */
export default function AppHamburgerMenu() {
  const [isOpen, setIsOpen] = useState(false)

  const closeMenu = useCallback(() => {
    setIsOpen(false)
  }, [])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMenu()
      }
    }

    window.addEventListener('keydown', onKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [closeMenu, isOpen])

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="zeb-touch-target flex shrink-0 flex-col items-center justify-center gap-[5px]"
        aria-label="메뉴 열기"
        aria-expanded={isOpen}
        aria-controls="app-side-menu"
      >
        <span className="block h-[2px] w-[18px] rounded-full bg-[#374151]" aria-hidden />
        <span className="block h-[2px] w-[18px] rounded-full bg-[#374151]" aria-hidden />
        <span className="block h-[2px] w-[18px] rounded-full bg-[#374151]" aria-hidden />
      </button>

      {isOpen ? (
        <div className="fixed inset-0 z-[60] flex justify-end" role="presentation">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="메뉴 닫기"
            onClick={closeMenu}
          />
          <nav
            id="app-side-menu"
            className="relative flex h-full w-[min(100%,280px)] flex-col bg-white shadow-xl"
            aria-label="앱 메뉴"
          >
            <div
              className="flex items-center justify-between border-b border-[#EBEBEB] px-4 py-4"
              style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}
            >
              <p className="text-[17px] font-bold text-[#1A1A1A]">메뉴</p>
              <button
                type="button"
                onClick={closeMenu}
                className="zeb-touch-target flex items-center justify-center text-2xl leading-none text-[#6B7280]"
                aria-label="메뉴 닫기"
              >
                ×
              </button>
            </div>

            <ul className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
              {MENU_ITEMS.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={closeMenu}
                    className="block rounded-xl px-3 py-3 transition active:bg-[#F7F8F2]"
                  >
                    <span className="block text-[15px] font-bold text-[#1A1A1A]">{item.label}</span>
                    <span className="mt-0.5 block text-[13px] font-medium text-[#6B7280]">
                      {item.description}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>

            <p
              className="border-t border-[#EBEBEB] px-4 py-3 text-center text-[12px] font-medium text-[#9CA3AF]"
              style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
            >
              서울 7호선 ·{' '}
              <span style={{ color: LINE7_COLOR }}>잽싸게</span>
            </p>
          </nav>
        </div>
      ) : null}
    </>
  )
}
