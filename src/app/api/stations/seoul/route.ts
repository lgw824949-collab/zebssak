import { NextResponse } from 'next/server'

const SEOUL_METRO_API_HOST = 'http://swopenAPI.seoul.go.kr'
const DEFAULT_START_INDEX = 0
const DEFAULT_END_INDEX = 100
const DEFAULT_LINE_PARAM = 'seoul2'

type SeoulLineParam =
  | 'seoul1'
  | 'seoul2'
  | 'seoul3'
  | 'seoul4'
  | 'seoul5'
  | 'seoul6'
  | 'seoul7'
  | 'seoul8'
  | 'seoul9'

const SEOUL_LINE_BY_PARAM: Record<SeoulLineParam, string> = {
  seoul1: '1호선',
  seoul2: '2호선',
  seoul3: '3호선',
  seoul4: '4호선',
  seoul5: '5호선',
  seoul6: '6호선',
  seoul7: '7호선',
  seoul8: '8호선',
  seoul9: '9호선',
}

const SEOUL_LINE_PARAMS = Object.keys(SEOUL_LINE_BY_PARAM) as SeoulLineParam[]

interface SeoulApiResult {
  code?: string
  message?: string
  status?: string
  total?: string
}

interface SeoulRealtimeRow {
  trainNo?: string
  statnNm?: string
  updnLine?: string
  directAt?: string
  subwayNm?: string
}

interface SeoulRealtimePositionPayload {
  errorMessage?: SeoulApiResult
  realtimePositionList?: SeoulRealtimeRow[]
  realtimePosition?: {
    RESULT?: SeoulApiResult
    row?: SeoulRealtimeRow | SeoulRealtimeRow[]
  }
}

export interface SeoulTrainPosition {
  train_no: string
  station_name: string
  direction: string
  direction_code: string
  is_express: boolean
}

function errorResponse(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status })
}

function getApiKey(): string | null {
  const key = process.env.SEOUL_METRO_API_KEY?.trim()
  return key ? key : null
}

function isSeoulLineParam(value: string): value is SeoulLineParam {
  return SEOUL_LINE_PARAMS.includes(value as SeoulLineParam)
}

function resolveSeoulLine(lineParam: string | null): {
  lineParam: SeoulLineParam
  lineName: string
} | { error: string } {
  const normalized = (lineParam?.trim() || DEFAULT_LINE_PARAM) as string

  if (!isSeoulLineParam(normalized)) {
    return {
      error: `지원하지 않는 line 값입니다. (${SEOUL_LINE_PARAMS.join(', ')})`,
    }
  }

  return {
    lineParam: normalized,
    lineName: SEOUL_LINE_BY_PARAM[normalized],
  }
}

function buildSeoulApiUrl(apiKey: string, lineName: string): string {
  const path = [
    'api',
    'subway',
    encodeURIComponent(apiKey),
    'json',
    'realtimePosition',
    String(DEFAULT_START_INDEX),
    String(DEFAULT_END_INDEX),
    encodeURIComponent(lineName),
  ].join('/')

  return `${SEOUL_METRO_API_HOST}/${path}`
}

function normalizeRows(
  row: SeoulRealtimeRow | SeoulRealtimeRow[] | undefined
): SeoulRealtimeRow[] {
  if (!row) {
    return []
  }

  return Array.isArray(row) ? row : [row]
}

function extractResultCode(payload: SeoulRealtimePositionPayload): string | undefined {
  return (
    payload.errorMessage?.code?.trim() ||
    payload.realtimePosition?.RESULT?.code?.trim()
  )
}

function extractResultMessage(payload: SeoulRealtimePositionPayload): string | undefined {
  return (
    payload.errorMessage?.message?.trim() ||
    payload.realtimePosition?.RESULT?.message?.trim()
  )
}

function extractTrainRows(payload: SeoulRealtimePositionPayload): SeoulRealtimeRow[] {
  if (Array.isArray(payload.realtimePositionList)) {
    return payload.realtimePositionList
  }

  return normalizeRows(payload.realtimePosition?.row)
}

/** 2호선은 내선/외선, 그 외 호선은 상행/하행으로 표기 */
function mapDirectionLabel(updnLine: string, subwayName: string): string {
  if (subwayName.includes('2호선')) {
    if (updnLine === '0') {
      return '외선'
    }
    if (updnLine === '1') {
      return '내선'
    }
    return '방향 미상'
  }

  if (updnLine === '0') {
    return '상행'
  }
  if (updnLine === '1') {
    return '하행'
  }

  return '방향 미상'
}

function mapTrainRow(
  row: SeoulRealtimeRow,
  defaultLineName: string
): SeoulTrainPosition | null {
  const trainNo = row.trainNo?.trim()
  const stationName = row.statnNm?.trim()

  if (!trainNo || !stationName) {
    return null
  }

  const directionCode = row.updnLine?.trim() ?? ''
  const subwayName = row.subwayNm?.trim() ?? defaultLineName
  const directAt = row.directAt?.trim() ?? '0'

  return {
    train_no: trainNo,
    station_name: stationName,
    direction: mapDirectionLabel(directionCode, subwayName),
    direction_code: directionCode,
    is_express: directAt === '1',
  }
}

async function fetchRealtimeTrains(
  apiKey: string,
  lineName: string
): Promise<SeoulTrainPosition[] | NextResponse> {
  const apiUrl = buildSeoulApiUrl(apiKey, lineName)
  let upstreamResponse: Response

  try {
    upstreamResponse = await fetch(apiUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    })
  } catch {
    return errorResponse('서울 지하철 API 요청에 실패했습니다.', 502)
  }

  if (!upstreamResponse.ok) {
    return errorResponse(
      `서울 지하철 API 응답 오류 (HTTP ${upstreamResponse.status})`,
      502
    )
  }

  let payload: SeoulRealtimePositionPayload
  try {
    payload = (await upstreamResponse.json()) as SeoulRealtimePositionPayload
  } catch {
    return errorResponse('서울 지하철 API 응답 JSON 파싱에 실패했습니다.', 502)
  }

  const resultCode = extractResultCode(payload)

  if (resultCode && resultCode !== 'INFO-000') {
    return errorResponse(
      extractResultMessage(payload) || '서울 지하철 API에서 오류를 반환했습니다.',
      502
    )
  }

  return extractTrainRows(payload)
    .map((row) => mapTrainRow(row, lineName))
    .filter((train): train is SeoulTrainPosition => train !== null)
}

/**
 * GET /api/stations/seoul?line=seoul1~seoul9 — 서울 1~9호선 실시간 열차 위치 조회
 */
export async function GET(request: Request) {
  try {
    const lineQuery = new URL(request.url).searchParams.get('line')
    const resolved = resolveSeoulLine(lineQuery)

    if ('error' in resolved) {
      return errorResponse(resolved.error, 400)
    }

    const { lineParam, lineName } = resolved

    const apiKey = getApiKey()
    if (!apiKey) {
      return errorResponse(
        'SEOUL_METRO_API_KEY 환경변수가 설정되지 않았습니다.',
        500
      )
    }

    const trainsOrError = await fetchRealtimeTrains(apiKey, lineName)
    if (trainsOrError instanceof NextResponse) {
      return trainsOrError
    }

    return NextResponse.json({
      success: true,
      data: {
        line: lineName,
        line_param: lineParam,
        count: trainsOrError.length,
        trains: trainsOrError,
        fetched_at: new Date().toISOString(),
      },
    })
  } catch {
    return errorResponse('서버 오류가 발생했습니다.', 500)
  }
}
