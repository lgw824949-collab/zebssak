'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import BoardingRequest from '@/components/BoardingRequest'
import CongestionHaltModal from '@/components/CongestionHaltModal'
import {
  fetchCongestionStatus,
  isLineHalted,
  resolveLineNumberFromLabel,
  type CongestionStatus,
} from '@/lib/congestion'

const BOARDING_UI_VERSION = '2026-06-01-seek-flow-v12'

function BoardingPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const lineLabelParam = searchParams.get('lineLabel')
  const lineLabel = lineLabelParam && lineLabelParam.trim() ? lineLabelParam.trim() : '서울 1호선'
  const type = searchParams.get('type')?.trim()
  const [congestionStatus, setCongestionStatus] = useState<CongestionStatus | null>(null)
  const [showCongestionModal, setShowCongestionModal] = useState(false)
  const [isCongestionChecked, setIsCongestionChecked] = useState(false)

  const isHalted = isLineHalted(congestionStatus, lineLabel)

  useEffect(() => {
    if (typeof window === 'undefined') return

    const token = localStorage.getItem('token')
    if (!token) {
      const params = new URLSearchParams({
        type: type === 'leave' ? 'leave' : 'seek',
        lineLabel,
      })
      router.replace(`/register?${params.toString()}`)
      return
    }

    // 호선·모드가 바뀌면 이전 탑승/대기 draft를 비워 열차 등록이 꼬이지 않게 합니다.
    const flowKey = `${lineLabel}|${type === 'leave' ? 'leave' : 'seek'}`
    const prevFlowKey = sessionStorage.getItem('boardingFlowKey')
    if (prevFlowKey !== flowKey) {
      sessionStorage.removeItem('boardingDraft')
      sessionStorage.removeItem('waitingDraft')
      sessionStorage.removeItem('activeMatchRequestId')
      sessionStorage.removeItem('seekerMatchRequestRegistered')
      sessionStorage.removeItem('activeMatchId')
      sessionStorage.setItem('boardingFlowKey', flowKey)
    }

    if (!navigator.geolocation) return

    navigator.geolocation.getCurrentPosition(
      (position) => {
        try {
          sessionStorage.setItem(
            'boardingCurrentPosition',
            JSON.stringify({
              lat: position.coords.latitude,
              lng: position.coords.longitude,
              ts: Date.now(),
            })
          )
        } catch {
          // 위치 저장 실패 시 무시
        }
      },
      () => {
        // 위치 권한 거부·오류 시 무시
      },
      {
        enableHighAccuracy: false,
        timeout: 3000,
        maximumAge: 120000,
      }
    )
  }, [router, lineLabel, type])

  useEffect(() => {
    let active = true

    void (async () => {
      const token = localStorage.getItem('token')
      const status = await fetchCongestionStatus(token)
      if (!active) return
      setCongestionStatus(status)
      setIsCongestionChecked(true)
      if (isLineHalted(status, lineLabel)) {
        setShowCongestionModal(true)
      }
    })()

    return () => {
      active = false
    }
  }, [lineLabel])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const versionKey = 'zeb_boarding_ui_version'
    const reloadOnceKey = `zeb_boarding_reloaded_${BOARDING_UI_VERSION}`
    const previous = localStorage.getItem(versionKey)
    if (previous === BOARDING_UI_VERSION) return
    if (sessionStorage.getItem(reloadOnceKey)) return

    localStorage.setItem(versionKey, BOARDING_UI_VERSION)

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
        for (let i = sessionStorage.length - 1; i >= 0; i -= 1) {
          const key = sessionStorage.key(i)
          if (key?.startsWith('zeb_boarding_reloaded_')) {
            sessionStorage.removeItem(key)
          }
        }
      } catch {
        // ignore
      } finally {
        sessionStorage.setItem(reloadOnceKey, '1')
        window.location.reload()
      }
    })()
  }, [])

  const mode = type === 'leave' ? 'leave' : 'seek'

  return (
    <>
      <CongestionHaltModal
        open={showCongestionModal}
        onClose={() => {
          setShowCongestionModal(false)
          router.replace('/')
        }}
        congestionLevel={congestionStatus?.levelsByLine[resolveLineNumberFromLabel(lineLabel)]}
      />
      {isCongestionChecked && !isHalted ? (
        <BoardingRequest key={`${lineLabel}-${mode}`} line={lineLabel} mode={mode} />
      ) : !isCongestionChecked ? (
        <div className="flex min-h-dvh items-center justify-center bg-[#F7F8FA] text-sm font-semibold text-[#888888]">
          로딩 중...
        </div>
      ) : null}
    </>
  )
}

export default function BoardingPage() {
  return (
    <Suspense fallback={null}>
      <BoardingPageContent />
    </Suspense>
  )
}
