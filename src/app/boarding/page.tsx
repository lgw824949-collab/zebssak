'use client'

import { Suspense, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import BoardingRequest from '@/components/BoardingRequest'

function BoardingPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const lineLabelParam = searchParams.get('lineLabel')
  const lineLabel = lineLabelParam && lineLabelParam.trim() ? lineLabelParam.trim() : '서울 1호선'
  const type = searchParams.get('type')?.trim()

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!localStorage.getItem('token')) {
      router.replace('/login')
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

  const mode = type === 'leave' ? 'leave' : 'seek'

  return (
    <BoardingRequest
      key={`${lineLabel}-${mode}`}
      line={lineLabel}
      mode={mode}
    />
  )
}

export default function BoardingPage() {
  return (
    <Suspense fallback={null}>
      <BoardingPageContent />
    </Suspense>
  )
}
