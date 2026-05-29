'use client'

import { Suspense, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import BoardingRequest from '@/components/BoardingRequest'

function BoardingPageContent() {
  const searchParams = useSearchParams()
  const lineLabelParam = searchParams.get('lineLabel')
  const lineLabel = lineLabelParam && lineLabelParam.trim() ? lineLabelParam.trim() : '서울 1호선'
  const type = searchParams.get('type')?.trim()

  useEffect(() => {
    if (typeof window === 'undefined') return
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
  }, [])

  return <BoardingRequest line={lineLabel} mode={type === 'leave' ? 'leave' : 'seek'} />
}

export default function BoardingPage() {
  return (
    <Suspense fallback={null}>
      <BoardingPageContent />
    </Suspense>
  )
}
