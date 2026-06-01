import { NextResponse } from 'next/server'
import { getSeoulMetroApiKey } from '@/lib/seoul-metro'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET /api/health/seoul-metro?station=간석 — 도착 API·프록시 동작 여부 (키 값 미노출)
 */
export async function GET(request: Request) {
  const station =
    new URL(request.url).searchParams.get('station')?.trim().replace(/역$/u, '') || '간석'
  const hasKey = Boolean(getSeoulMetroApiKey())

  let proxyStatus: number | null = null
  let arrivalCount = 0
  let error: string | null = null

  if (hasKey) {
    try {
      const probeUrl = new URL('/api/subway-arrival', request.url)
      probeUrl.searchParams.set('station', station)
      const res = await fetch(probeUrl, {
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      })
      proxyStatus = res.status
      const body = (await res.json()) as { success?: boolean; rows?: unknown[]; error?: string }
      if (body.success && Array.isArray(body.rows)) {
        arrivalCount = body.rows.length
      } else {
        error = body.error ?? `HTTP ${res.status}`
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'probe failed'
    }
  }

  return NextResponse.json({
    success: hasKey && arrivalCount > 0,
    hasKey,
    proxyStatus,
    arrivalCount,
    error,
    hint: !hasKey
      ? 'Vercel에 SEOUL_METRO_API_KEY 추가 후 Redeploy'
      : arrivalCount === 0
        ? '프록시/도착 API 실패. main 최신 배포 후 Redeploy, /api/seoul-metro 404 여부 확인'
        : '도착 API 정상',
  })
}
