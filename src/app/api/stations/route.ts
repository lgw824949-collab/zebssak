import { NextResponse } from 'next/server'
import {
  MOCK_LINE_1_STATIONS,
  MOCK_LINE_2_STATIONS,
  MOCK_LINE_S1_STATIONS,
  MOCK_LINE_S2_STATIONS,
  MOCK_LINE_S3_STATIONS,
  MOCK_LINE_S4_STATIONS,
  MOCK_LINE_S5_STATIONS,
  MOCK_LINE_S6_STATIONS,
  MOCK_LINE_S7_STATIONS,
  MOCK_LINE_S8_STATIONS,
  MOCK_LINE_S9_STATIONS,
} from '@/lib/mockData'

type SupportedLine =
  | 'seoul1'
  | 'seoul2'
  | 'seoul3'
  | 'seoul4'
  | 'seoul5'
  | 'seoul6'
  | 'seoul7'
  | 'seoul8'
  | 'seoul9'
  | 'incheon1'
  | 'incheon2'

const PUBLIC_DATA_API_HOST = 'http://openapi.seoul.go.kr:8088'

const FALLBACK_STATIONS: Record<SupportedLine, readonly string[]> = {
  seoul1: MOCK_LINE_S1_STATIONS.map((s) => s.name),
  seoul2: MOCK_LINE_S2_STATIONS.map((s) => s.name),
  seoul3: MOCK_LINE_S3_STATIONS.map((s) => s.name),
  seoul4: MOCK_LINE_S4_STATIONS.map((s) => s.name),
  seoul5: MOCK_LINE_S5_STATIONS.map((s) => s.name),
  seoul6: MOCK_LINE_S6_STATIONS.map((s) => s.name),
  seoul7: MOCK_LINE_S7_STATIONS.map((s) => s.name),
  seoul8: MOCK_LINE_S8_STATIONS.map((s) => s.name),
  seoul9: MOCK_LINE_S9_STATIONS.map((s) => s.name),
  incheon1: MOCK_LINE_1_STATIONS.map((s) => s.name),
  incheon2: MOCK_LINE_2_STATIONS.map((s) => s.name),
}

const ROUTE_BY_LINE: Record<SupportedLine, string> = {
  seoul1: '1호선',
  seoul2: '2호선',
  seoul3: '3호선',
  seoul4: '4호선',
  seoul5: '5호선',
  seoul6: '6호선',
  seoul7: '7호선',
  seoul8: '8호선',
  seoul9: '9호선',
  incheon1: '인천1호선',
  incheon2: '인천2호선',
}

const ROUTES_BY_LINE: Record<SupportedLine, string[]> = {
  seoul1: ['1호선', '경부선', '경원선', '경인선', '장항선'],
  seoul2: ['2호선'],
  seoul3: ['3호선'],
  seoul4: ['4호선', '진접선', '안산선', '과천선'],
  seoul5: ['5호선'],
  seoul6: ['6호선'],
  seoul7: ['7호선'],
  seoul8: ['8호선'],
  seoul9: ['9호선'],
  incheon1: ['인천1호선'],
  incheon2: ['인천2호선'],
}

const JSON_UTF8_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
} as const

function errorResponse(message: string, status: number) {
  return NextResponse.json(
    { success: false, error: message },
    { status, headers: JSON_UTF8_HEADERS }
  )
}

function normalizeStationName(name: string): string {
  return name.trim().replace(/\s+/g, '').replace(/역$/, '')
}

function buildStationMasterApiUrl(apiKey: string): string {
  return `${PUBLIC_DATA_API_HOST}/${encodeURIComponent(apiKey)}/json/subwayStationMaster/1/1000`
}

async function fetchStationCoordinatesByLine(
  line: SupportedLine
): Promise<Map<string, { lat: number; lng: number }>> {
  const map = new Map<string, { lat: number; lng: number }>()
  const apiKey = process.env.PUBLIC_DATA_API_KEY?.trim()
  if (!apiKey) return map

  try {
    const response = await fetch(buildStationMasterApiUrl(apiKey), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) return map

    const payload = (await response.json()) as {
      subwayStationMaster?: {
        RESULT?: { CODE?: string }
        row?: Array<{ BLDN_NM?: string; ROUTE?: string; LAT?: string; LOT?: string }>
      }
    }
    const service = payload.subwayStationMaster
    if (service?.RESULT?.CODE !== 'INFO-000' || !Array.isArray(service.row)) return map

    const targetRoutes = ROUTES_BY_LINE[line] ?? [ROUTE_BY_LINE[line]]
    for (const row of service.row) {
      const route = row.ROUTE?.trim() ?? ''
      if (!targetRoutes.includes(route)) continue
      const name = row.BLDN_NM?.trim()
      const lat = Number.parseFloat(row.LAT ?? '')
      const lng = Number.parseFloat(row.LOT ?? '')
      if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) continue
      map.set(normalizeStationName(name), { lat, lng })
    }
  } catch {
    return map
  }

  return map
}

function interpolateCoordinates(
  ordered: readonly string[],
  coordinates: Map<string, { lat: number; lng: number }>
): Array<{ name: string; order: number; lat: number | null; lng: number | null }> {
  const rows = ordered.map((name, index) => {
    const coord = coordinates.get(normalizeStationName(name))
    return {
      name,
      order: index + 1,
      lat: coord?.lat ?? null,
      lng: coord?.lng ?? null,
    }
  })

  const knownIndices = rows
    .map((row, index) => (row.lat !== null && row.lng !== null ? index : -1))
    .filter((index) => index >= 0)

  if (knownIndices.length === 0) return rows

  for (let i = 0; i < rows.length; i += 1) {
    if (rows[i].lat !== null && rows[i].lng !== null) continue

    let prev = -1
    let next = -1
    for (const idx of knownIndices) {
      if (idx < i) prev = idx
      if (idx > i) {
        next = idx
        break
      }
    }

    if (prev >= 0 && next >= 0) {
      const ratio = (i - prev) / (next - prev)
      rows[i].lat =
        (rows[prev].lat as number) +
        ((rows[next].lat as number) - (rows[prev].lat as number)) * ratio
      rows[i].lng =
        (rows[prev].lng as number) +
        ((rows[next].lng as number) - (rows[prev].lng as number)) * ratio
      continue
    }

    if (prev >= 0) {
      rows[i].lat = rows[prev].lat
      rows[i].lng = rows[prev].lng
      continue
    }

    if (next >= 0) {
      rows[i].lat = rows[next].lat
      rows[i].lng = rows[next].lng
    }
  }

  return rows
}

/**
 * GET /api/stations?line=seoul2
 */
export async function GET(request: Request) {
  try {
    const line = new URL(request.url).searchParams.get('line')?.trim() as SupportedLine | undefined
    if (!line) return errorResponse('line 파라미터가 필요합니다.', 400)
    if (!(line in FALLBACK_STATIONS)) {
      return errorResponse('지원하지 않는 line 값입니다.', 400)
    }

    // 역 순서는 호선별 기준 목록(FALLBACK)을 단일 소스로 고정해 일관성 보장
    // - seoul1: 소요산→인천/신창
    // - seoul4: 당고개→오이도
    // - seoul7: 장암→부천종합운동장
    // - incheon2: 운연→검단오류
    const ordered = FALLBACK_STATIONS[line]
    const coords = await fetchStationCoordinatesByLine(line)
    const stations = interpolateCoordinates(ordered, coords)

    return NextResponse.json(
      {
        success: true,
        line,
        stations,
      },
      { headers: JSON_UTF8_HEADERS }
    )
  } catch {
    return errorResponse('서버 오류가 발생했습니다.', 500)
  }
}
