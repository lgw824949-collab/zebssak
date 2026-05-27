'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

/**
 * 구 /home 경로 — 신규 메인(/)으로 리다이렉트
 */
export default function HomeRedirectPage() {
  const router = useRouter()

  useEffect(() => {
    const token = localStorage.getItem('token')
    router.replace(token ? '/' : '/login')
  }, [router])

  return null
}
