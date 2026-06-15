import { NextResponse } from 'next/server'
import {
  fetchRealtimePositionRows,
  getSeoulMetroPositionApiKey,
  mapPositionRowToTrainFields,
  type SeoulPositionRow,
} from '@/lib/seoul-metro'

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

function mapTrainRow(
  row: SeoulPositionRow,
  defaultLineName: string
): SeoulTrainPosition | null {
  const mapped = mapPositionRowToTrainFields(row, defaultLineName)
  if (!mapped) return null
  return mapped
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

    if (!getSeoulMetroPositionApiKey()) {
      return errorResponse(
        'SEOUL_METRO_POSITION_API_KEY 환경변수가 설정되지 않았습니다.',
        500
      )
    }

    const rows = await fetchRealtimePositionRows(request, lineName)
    const trains = rows
      .map((row) => mapTrainRow(row, lineName))
      .filter((train): train is SeoulTrainPosition => train !== null)

    return NextResponse.json({
      success: true,
      data: {
        line: lineName,
        line_param: lineParam,
        count: trains.length,
        trains,
        fetched_at: new Date().toISOString(),
      },
    })
  } catch {
    return errorResponse('서버 오류가 발생했습니다.', 500)
  }
}
