import { NextResponse } from 'next/server'
import { getSeoulMetroApiKey } from '@/lib/seoul-metro'

const SEOUL_METRO_DIRECT_HOST = 'http://swopenAPI.seoul.go.kr'
const PROXY_TIMEOUT_MS = 12000

/**
 * 서울 지하철 Open API HTTP 프록시 (런타임 env 사용)
 * GET /api/_seoul-metro/json/realtimeStationArrival/0/20/간석
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ path: string[] }> }
) {
  const apiKey = getSeoulMetroApiKey()
  if (!apiKey) {
    return NextResponse.json(
      { success: false, error: 'SEOUL_METRO_API_KEY 환경변수가 설정되지 않았습니다.' },
      { status: 500 }
    )
  }

  const { path } = await context.params
  const pathSegments = Array.isArray(path) ? path : []
  if (pathSegments.length === 0) {
    return NextResponse.json(
      { success: false, error: '프록시 경로가 비어 있습니다.' },
      { status: 400 }
    )
  }

  const upstreamPath = pathSegments.map((segment) => encodeURIComponent(segment)).join('/')
  const search = new URL(request.url).search
  const upstreamUrl = `${SEOUL_METRO_DIRECT_HOST}/api/subway/${encodeURIComponent(apiKey)}/${upstreamPath}${search}`

  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
    })

    const body = await upstreamResponse.text()
    return new NextResponse(body, {
      status: upstreamResponse.status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
      },
    })
  } catch {
    return NextResponse.json(
      { success: false, error: '서울 지하철 API 프록시 요청에 실패했습니다.' },
      { status: 502 }
    )
  }
}
