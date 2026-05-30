'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

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

function downloadInternetShortcutFile() {
  const content = `[InternetShortcut]\r\nURL=${APP_ORIGIN}/\r\nIconIndex=0\r\nHotKey=0\r\n`
  const blob = new Blob([content], { type: 'application/internet-shortcut' })
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = '잽싸게.url'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(objectUrl)
}

interface InstallShortcutProps {
  compact?: boolean
}

/**
 * PWA 설치 또는 Windows .url 바로가기 다운로드
 */
export default function InstallShortcut({ compact = false }: InstallShortcutProps) {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isInstalled, setIsInstalled] = useState(false)
  const [message, setMessage] = useState('')
  const [isBusy, setIsBusy] = useState(false)

  const isIos = useMemo(() => isIosDevice(), [])

  useEffect(() => {
    if (isStandaloneDisplay()) {
      setIsInstalled(true)
    }

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
      setIsInstalled(true)
      setInstallPrompt(null)
      setMessage('바탕화면 바로가기가 설치되었습니다.')
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  const handleInstall = useCallback(async () => {
    setMessage('')
    setIsBusy(true)

    try {
      if (installPrompt) {
        await installPrompt.prompt()
        const choice = await installPrompt.userChoice
        if (choice.outcome === 'accepted') {
          setMessage('설치 중입니다. 바탕화면·시작 메뉴에 추가됩니다.')
          setInstallPrompt(null)
        } else {
          setMessage('설치를 취소했습니다. 아래 다운로드로 바로가기를 받을 수 있어요.')
        }
        return
      }

      if (isIos) {
        setMessage('Safari 공유(↑) → 「홈 화면에 추가」를 선택해 주세요.')
        return
      }

      downloadInternetShortcutFile()
      setMessage('「잽싸게.url」 파일을 바탕화면으로 옮기면 바로가기가 만들어집니다.')
    } finally {
      setIsBusy(false)
    }
  }, [installPrompt, isIos])

  if (isInstalled) {
    return (
      <div
        className={
          compact
            ? 'rounded-xl border border-[#D8DCE2] bg-white px-3 py-2.5 text-xs font-semibold text-[#6F7682]'
            : 'rounded-2xl border border-[#D8DCE2] bg-white px-4 py-3 text-sm font-semibold text-[#6F7682]'
        }
      >
        앱 바로가기가 설치되어 있습니다.
      </div>
    )
  }

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
        {installPrompt
          ? '한 번에 설치하면 PC·휴대폰 바탕화면에 잽싸게 아이콘이 생겨요.'
          : '다운로드 받아 바탕화면에 두면 앱처럼 바로 열 수 있어요.'}
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
        {installPrompt ? '바탕화면에 설치' : '바로가기 다운로드'}
      </button>
      {message ? (
        <p className="mt-2 text-xs font-semibold leading-relaxed text-[#2563EB]" role="status">
          {message}
        </p>
      ) : null}
    </div>
  )
}
