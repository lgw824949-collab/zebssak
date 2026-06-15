import {
  fetchRealtimePositionRows,
  normalizeSeoulTrainNo,
  resolveSeoulLineName,
} from '@/lib/seoul-metro'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

function normalizeStationLabel(name: string | null | undefined): string {
  return (name ?? '').trim().replace(/역$/u, '')
}

function resolveSeoulLineParam(lineNumber: number | null | undefined): string | null {
  if (lineNumber == null || lineNumber < 1 || lineNumber > 9) {
    return null
  }

  return `seoul${lineNumber}`
}

async function resolveStationOrder(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  stationCode: string | null | undefined,
  stationName: string | null | undefined,
  lineNumber: number | null | undefined
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
  if (!label || lineNumber == null) {
    return null
  }

  const { data: rows } = await supabase
    .from('stations')
    .select('station_order, station_name')
    .eq('line_number', lineNumber)

  if (!rows?.length) {
    return null
  }

  const matched = rows.find(
    (row) => normalizeStationLabel(String(row.station_name ?? '')) === label
  )

  return typeof matched?.station_order === 'number' ? matched.station_order : null
}

export interface LiveHandoffRouteContext {
  handoff_remaining_stations: number | null
  current_station_name: string | null
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

  const lineParam = resolveSeoulLineParam(input.lineNumber)
  const lineName = lineParam ? resolveSeoulLineName(lineParam) : null
  const trainNo = (input.trainNo ?? '').trim()

  if (!lineName || !trainNo) {
    return {
      handoff_remaining_stations: fallback,
      current_station_name: null,
    }
  }

  try {
    const destinationOrder = await resolveStationOrder(
      supabase,
      input.destinationStationCode,
      input.destinationStationName,
      input.lineNumber
    )

    if (destinationOrder == null) {
      return {
        handoff_remaining_stations: fallback,
        current_station_name: null,
      }
    }

    const positionRows = await fetchRealtimePositionRows(request, lineName)
    const normalizedTarget = normalizeSeoulTrainNo(trainNo)
    const positionRow = positionRows.find((row) => {
      const rowTrain = normalizeSeoulTrainNo(String(row.trainNo ?? ''))
      return rowTrain === normalizedTarget
    })

    if (!positionRow?.statnNm) {
      return {
        handoff_remaining_stations: fallback,
        current_station_name: null,
      }
    }

    const currentStationName = normalizeStationLabel(positionRow.statnNm)
    const currentOrder = await resolveStationOrder(
      supabase,
      null,
      positionRow.statnNm,
      input.lineNumber
    )

    if (currentOrder == null) {
      return {
        handoff_remaining_stations: fallback,
        current_station_name: currentStationName ? `${currentStationName}역` : null,
      }
    }

    const remaining = Math.max(0, Math.abs(destinationOrder - currentOrder))
    return {
      handoff_remaining_stations: remaining,
      current_station_name: currentStationName ? `${currentStationName}역` : null,
    }
  } catch {
    return {
      handoff_remaining_stations: fallback,
      current_station_name: null,
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

