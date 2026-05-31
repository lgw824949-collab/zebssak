'use client'

import { useEffect } from 'react'

/** 로컬 개발 시 예전 PWA SW가 Next 청크 요청을 망가뜨리지 않도록 해제합니다. */
export default function DevServiceWorkerCleanup() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return
    if (!('serviceWorker' in navigator)) return

    void navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => {
        void registration.unregister()
      })
    })
  }, [])

  return null
}
