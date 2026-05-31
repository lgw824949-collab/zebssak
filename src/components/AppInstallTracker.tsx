'use client'

import { useEffect } from 'react'
import { recordAppInstall, registerPwaInstallListener } from '@/lib/app-stats'

/** 앱 최초 방문·PWA 설치를 서버에 1회 기록합니다. */
export default function AppInstallTracker() {
  useEffect(() => {
    void recordAppInstall('visit')
    return registerPwaInstallListener()
  }, [])

  return null
}
