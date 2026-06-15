import {
  resolveSeoulLineNumberFromStationCode,
  resolveStationLinePrefix,
} from '@/lib/match-display'
import {
  fetchRealtimePositionRows,
  normalizeSeoulTrainNo,
  resolveSeoulLineName,
} from '@/lib/seoul-metro'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

function normalizeStationLabel(name: string | null | undefined): string {
  return (name ?? '').trim().replace(/역$/u, '')
}

/** DB trains.train_no (s7:2202) → API 열차번호 (2202) */
function resolveApiTrainNo(storedTrainNo: string | null | undefined): string {
  const trimmed = (storedTrainNo ?? '').trim()
  if (!trimmed) {
    return ''
  }

  const colonIndex = trimmed.indexOf(':')
  if (colonIndex >= 0) {
    return trimmed.slice(colonIndex + 1).trim()
  }

  return trimmed
}

function resolveSeoulLineParam(
  destinationStationCode: string | null | undefined,
  trainLineNumber: number | null | undefined
): string | null {
  const seoulLine = resolveSeoulLineNumberFromStationCode(destinationStationCode)
  if (seoulLine != null) {
    return `seoul${seoulLine}`
  }

  if (
    trainLineNumber != null &&
    trainLineNumber >= 1 &&
    trainLineNumber <= 9
  ) {
    return `seoul${trainLineNumber}`
  }

  return null
}

async function resolveStationOrder(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  stationCode: string | null | undefined,
  stationName: string | null | undefined,
  lineStationPrefix: string | null
): Promise<number | null> {
  if (stationCode) {
    const { data: byCode } = await supabase
      .from('stations')
      .select('station_order')
      .eq('station_code', stationCode)
      .maybeSingle()

    if (typeof byCode?.station_order === 'number') {
      return byCode.station_order
    }
  }

  const label = normalizeStationLabel(stationName)
  if (!label) {
    return null
  }

  const { data: rows } = await supabase
    .from('stations')
    .select('station_order, station_name, station_code')
    .eq('line_number', 2)

  if (!rows?.length) {
    return null
  }

  const scopedRows = lineStationPrefix
    ? rows.filter((row) =>
        String(row.station_code ?? '')
          .trim()
          .toLowerCase()
          .startsWith(lineStationPrefix)
      )
    : rows

  const matched = scopedRows.find(
    (row) => normalizeStationLabel(String(row.station_name ?? '')) === label
  )

  return typeof matched?.station_order === 'number' ? matched.station_order : null
}

function resolveDirectionalRemaining(
  currentOrder: number,
  destinationOrder: number
): number {
  if (currentOrder === destinationOrder) {
    return 0
  }

  return Math.abs(destinationOrder - currentOrder)
}

export interface LiveHandoffRouteContext {
  handoff_remaining_stations: number | null
  current_station_name: string | null
  /** 실시간 열차 위치 API로 계산했는지 */
  position_is_live: boolean
}

/**
 * 실시간 열차 위치·역 순서로 양보자 하차까지 남은 역 수와 현재 역을 계산합니다.
 */
export async function resolveLiveHandoffRouteContext(
  request: Request,
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  input: {
    trainNo: string | null | undefined
    lineNumber: number | null | undefined
    destinationStationCode: string | null | undefined
    destinationStationName: string | null | undefined
    fallbackRemaining: number | null | undefined
  }
): Promise<LiveHandoffRouteContext> {
  const fallback =
    typeof input.fallbackRemaining === 'number' && input.fallbackRemaining >= 0
      ? Math.floor(input.fallbackRemaining)
      : null

  const lineStationPrefix = resolveStationLinePrefix(input.destinationStationCode)
  const lineParam = resolveSeoulLineParam(
    input.destinationStationCode,
    input.lineNumber
  )
  const lineName = lineParam ? resolveSeoulLineName(lineParam) : null
  const apiTrainNo = resolveApiTrainNo(input.trainNo)

  if (!lineName || !apiTrainNo) {
    return {
      handoff_remaining_stations: fallback,
      current_station_name: null,
      position_is_live: false,
    }
  }

  try {
    const destinationOrder = await resolveStationOrder(
      supabase,
      input.destinationStationCode,
      input.destinationStationName,
      lineStationPrefix
    )

    if (destinationOrder == null) {
      return {
        handoff_remaining_stations: fallback,
        current_station_name: null,
        position_is_live: false,
      }
    }

    const positionRows = await fetchRealtimePositionRows(request, lineName)
    const normalizedTarget = normalizeSeoulTrainNo(apiTrainNo)
    const positionRow = positionRows.find((row) => {
      const rowTrain = normalizeSeoulTrainNo(String(row.trainNo ?? ''))
      return rowTrain === normalizedTarget
    })

    if (!positionRow?.statnNm) {
      return {
        handoff_remaining_stations: fallback,
        current_station_name: null,
        position_is_live: false,
      }
    }

    const currentStationName = normalizeStationLabel(positionRow.statnNm)
    const currentOrder = await resolveStationOrder(
      supabase,
      null,
      positionRow.statnNm,
      lineStationPrefix
    )

    if (currentOrder == null) {
      return {
        handoff_remaining_stations: fallback,
        current_station_name: currentStationName ? `${currentStationName}역` : null,
        position_is_live: true,
      }
    }

    const remaining = resolveDirectionalRemaining(currentOrder, destinationOrder)
    return {
      handoff_remaining_stations: remaining,
      current_station_name: currentStationName ? `${currentStationName}역` : null,
      position_is_live: true,
    }
  } catch {
    return {
      handoff_remaining_stations: fallback,
      current_station_name: null,
      position_is_live: false,
    }
  }
}

/**
 * 실시간 열차 위치·역 순서로 양보자 하차까지 남은 역 수를 계산합니다.
 */
export async function resolveLiveHandoffRemainingStations(
  request: Request,
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  input: {
    trainNo: string | null | undefined
    lineNumber: number | null | undefined
    destinationStationCode: string | null | undefined
    destinationStationName: string | null | undefined
    fallbackRemaining: number | null | undefined
  }
): Promise<number | null> {
  const context = await resolveLiveHandoffRouteContext(request, supabase, input)
  return context.handoff_remaining_stations
}
