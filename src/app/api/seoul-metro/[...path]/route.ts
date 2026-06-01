import { NextResponse } from 'next/server'
import { fetchSeoulMetroUpstream, getSeoulMetroApiKey } from '@/lib/seoul-metro'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET /api/seoul-metro/json/... — 서울 지하철 Open API 프록시
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ path: string[] }> }
) {
  if (!getSeoulMetroApiKey()) {
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

  const pathAfterKey = pathSegments.join('/')
  const body = await fetchSeoulMetroUpstream(request, pathAfterKey)
  if (!body) {
    return NextResponse.json(
      { success: false, error: '서울 지하철 API 프록시 요청에 실패했습니다.' },
      { status: 502 }
    )
  }

  return new NextResponse(body, {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}
