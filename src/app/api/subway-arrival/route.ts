import { NextResponse } from 'next/server'
import {
  extractArrivalRows,
  extractResultCode,
  fetchSeoulMetroUpstream,
  getSeoulMetroApiKey,
  isSeoulApiSuccess,
} from '@/lib/seoul-metro'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET /api/subway-arrival?station=간석
 */
export async function GET(request: Request) {
  const station = new URL(request.url).searchParams.get('station')?.trim().replace(/역$/u, '')
  if (!station) {
    return NextResponse.json({ success: false, error: 'station 파라미터가 필요합니다.', rows: [] }, { status: 400 })
  }

  if (!getSeoulMetroApiKey()) {
    return NextResponse.json(
      { success: false, error: 'SEOUL_METRO_API_KEY가 설정되지 않았습니다.', rows: [] },
      { status: 500 }
    )
  }

  const path = `json/realtimeStationArrival/0/10/${encodeURIComponent(station)}`
  const raw = await fetchSeoulMetroUpstream(request, path)
  if (!raw) {
    return NextResponse.json(
      { success: false, error: '서울 지하철 도착 API 조회에 실패했습니다.', rows: [] },
      { status: 502 }
    )
  }

  let payload: {
    errorMessage?: { code?: string }
    realtimeArrival?: { RESULT?: { code?: string } }
    realtimeArrivalList?: import('@/lib/seoul-metro').SeoulArrivalRow[]
  }
  try {
    payload = JSON.parse(raw) as typeof payload
  } catch {
    return NextResponse.json(
      { success: false, error: '도착 API JSON 파싱 실패', rows: [] },
      { status: 502 }
    )
  }

  if (!isSeoulApiSuccess(extractResultCode(payload))) {
    return NextResponse.json(
      { success: false, error: '서울 지하철 도착 API 오류 응답', rows: [] },
      { status: 502 }
    )
  }

  return NextResponse.json({
    success: true,
    station,
    rows: extractArrivalRows(payload),
  })
}
