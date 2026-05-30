'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const SHORTCUT_DISMISSED_KEY = 'zebShortcutDismissed'

const APP_ORIGIN =
  typeof window !== 'undefined' ? window.location.origin : 'https://zebssak.vercel.app'

function isIosDevice() {
  if (typeof navigator === 'undefined') return false
  return /iPad|iPhone|iPod/u.test(navigator.userAgent)
}

function isStandaloneDisplay() {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

export function isShortcutDismissed() {
  if (typeof window === 'undefined') return false
  if (isStandaloneDisplay()) return true
  try {
    return localStorage.getItem(SHORTCUT_DISMISSED_KEY) === 'true'
  } catch {
    return false
  }
}

export function dismissShortcut() {
  try {
    localStorage.setItem(SHORTCUT_DISMISSED_KEY, 'true')
  } catch {
    // localStorage 실패 시 화면만 숨깁니다.
  }
}

export function useInstallShortcutVisible() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    setVisible(!isShortcutDismissed())
  }, [])

  const hide = useCallback(() => {
    dismissShortcut()
    setVisible(false)
  }, [])

  return { visible, hide }
}

function downloadInternetShortcutFile() {
  const content = `[InternetShortcut]\r\nURL=${APP_ORIGIN}/\r\nIconIndex=0\r\nHotKey=0\r\n`
  const blob = new Blob([content], { type: 'application/octet-stream' })
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = '잽싸게.url'
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  window.setTimeout(() => {
    anchor.remove()
    URL.revokeObjectURL(objectUrl)
  }, 0)
}

interface InstallShortcutProps {
  compact?: boolean
  onDismiss?: () => void
}

/**
 * PWA 설치 또는 Windows .url 바로가기 다운로드
 */
export default function InstallShortcut({ compact = false, onDismiss }: InstallShortcutProps) {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isBusy, setIsBusy] = useState(false)

  const isIos = useMemo(() => isIosDevice(), [])

  const completeAndHide = useCallback(() => {
    dismissShortcut()
    onDismiss?.()
  }, [onDismiss])

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.register('/sw.js').catch(() => {
        // SW 등록 실패 시 .url 다운로드로 폴백합니다.
      })
    }

    function handleBeforeInstallPrompt(event: Event) {
      event.preventDefault()
      setInstallPrompt(event as BeforeInstallPromptEvent)
    }

    function handleAppInstalled() {
      completeAndHide()
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [completeAndHide])

  const handleInstall = useCallback(async () => {
    setIsBusy(true)

    try {
      if (installPrompt) {
        await installPrompt.prompt()
        const choice = await installPrompt.userChoice
        if (choice.outcome === 'accepted') {
          completeAndHide()
        }
        return
      }

      if (isIos) {
        completeAndHide()
        return
      }

      downloadInternetShortcutFile()
      completeAndHide()
    } finally {
      setIsBusy(false)
    }
  }, [completeAndHide, installPrompt, isIos])

  const buttonLabel = installPrompt ? '바탕화면에 설치' : '바로가기 다운로드'

  return (
    <div
      className={
        compact
          ? 'rounded-xl border border-[#D8DCE2] bg-white p-3'
          : 'rounded-2xl border border-[#D8DCE2] bg-white p-4 shadow-sm'
      }
    >
      <p className="text-sm font-bold text-[#0B1F4B]">바탕화면 바로가기</p>
      <p className="mt-1 text-xs font-medium leading-relaxed text-[#6F7682]">
        다운로드 또는 설치하면 바탕화면에서 앱처럼 바로 열 수 있어요.
      </p>
      <button
        type="button"
        disabled={isBusy}
        onClick={() => {
          void handleInstall()
        }}
        className="zeb-touch-target mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#0B1F4B] px-4 py-3 text-sm font-extrabold text-white transition active:scale-[0.98] disabled:opacity-60"
      >
        <span aria-hidden>⬇️</span>
        {buttonLabel}
      </button>
    </div>
  )
}
