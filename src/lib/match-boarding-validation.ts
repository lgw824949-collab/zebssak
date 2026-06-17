import { normalizeDirectionForStorage } from '@/lib/match-direction'
import {
  getDevMockStationName,
  getDevMockTrainNo,
  isDevRealtimeBypassEnabled,
} from '@/lib/presence-mode'
import {
  fetchRealtimePositionRows,
  normalizeSeoulTrainNo,
  resolveSeoulLineName,
} from '@/lib/seoul-metro'
import type { SupabaseClient } from '@supabase/supabase-js'

export function normalizeStationLabel(name: string | null | undefined): string {
  return (name ?? '')
    .trim()
    .replace(/역$/u, '')
    .replace(/\s+/g, '')
}

export function extractLinePrefixFromStationCode(stationCode: string): string | null {
  const match = stationCode.trim().toLowerCase().match(/^([a-z]+\d+)-/)
  return match?.[1] ?? null
}

export function stationCodeFromJoin(
  station:
    | { station_code?: string }
    | { station_code?: string }[]
    | null
    | undefined
): string {
  if (Array.isArray(station)) {
    return station[0]?.station_code?.trim() ?? ''
  }
  return station?.station_code?.trim() ?? ''
}

export function stationOrderFromCode(stationCode: string): number | null {
  const match = stationCode.trim().toLowerCase().match(/-(\d+)$/u)
  if (!match?.[1]) return null
  const parsed = Number.parseInt(match[1], 10)
  return Number.isFinite(parsed) ? parsed : null
}

function resolveSeoulLineParamFromPrefix(linePrefix: string): string | null {
  const match = linePrefix.trim().toLowerCase().match(/^s([1-9])$/)
  if (!match?.[1]) return null
  return `seoul${match[1]}`
}

/** 입력 열차번호와 실시간 API trainNo를 느슨하게 비교합니다. */
export function isSameRealtimeTrain(rowTrainNo: string, requestedTrainNo: string): boolean {
  const rowRaw = rowTrainNo.trim()
  const reqRaw = requestedTrainNo.trim()
  if (!rowRaw || !reqRaw) return false

  const rowNorm = normalizeSeoulTrainNo(rowRaw)
  const reqNorm = normalizeSeoulTrainNo(reqRaw)
  if (rowNorm && reqNorm && rowNorm === reqNorm) return true

  const rowDigits = rowRaw.replace(/\D/g, '')
  const reqDigits = reqRaw.replace(/\D/g, '')
  if (rowDigits && reqDigits) {
    if (rowDigits === reqDigits) return true
    if (rowDigits.endsWith(reqDigits) || reqDigits.endsWith(rowDigits)) return true
  }

  return false
}

export async function resolveCurrentStationOrder(
  supabase: SupabaseClient,
  linePrefix: string,
  currentStationName: string
): Promise<number | null> {
  const normalizedName = normalizeStationLabel(currentStationName)
  if (!normalizedName) return null

  const { data: rows, error } = await supabase
    .from('stations')
    .select('station_name, station_order, station_code')
    .ilike('station_code', `${linePrefix}-%`)

  if (error || !rows?.length) return null

  const matched = rows.find((row) => {
    const code = String(row.station_code ?? '').trim().toLowerCase()
    if (!code.startsWith(linePrefix)) return false
    return normalizeStationLabel(String(row.station_name ?? '')) === normalizedName
  })

  if (!matched || typeof matched.station_order !== 'number') return null
  return matched.station_order
}

export interface MatchRealtimeRequestRow {
  id?: string
  direction: string
  origin_station: { station_code?: string } | { station_code?: string }[] | null
  destination_station:
    | { station_code?: string }
    | { station_code?: string }[]
    | null
}

/** 실시간 열차 위치가 출발~목적지 구간 안인지 확인 */
export function isRequestInsideRealtimeWindow(
  row: MatchRealtimeRequestRow,
  currentOrder: number
): boolean {
  const originCode = stationCodeFromJoin(row.origin_station)
  const destinationCode = stationCodeFromJoin(row.destination_station)
  const originOrder = stationOrderFromCode(originCode)
  const destinationOrder = stationOrderFromCode(destinationCode)
  if (originOrder == null || destinationOrder == null) return false

  const minOrder = Math.min(originOrder, destinationOrder)
  const maxOrder = Math.max(originOrder, destinationOrder)
  if (currentOrder < minOrder || currentOrder > maxOrder) return false

  const directionBucket = normalizeDirectionForStorage(row.direction)
  if (directionBucket === '1') {
    return currentOrder <= originOrder && currentOrder >= destinationOrder
  }
  if (directionBucket === '2') {
    return currentOrder >= originOrder && currentOrder <= destinationOrder
  }
  return false
}

/**
 * 탑승 중(onboard) 등록·전환 시 실시간 검증
 * - 열차가 실시간 API에 존재하고 탑승 구간(출발~목적지) 안에 있어야 함
 */
export async function validateOnboardBoardingContext(
  request: Request,
  supabase: SupabaseClient,
  input: {
    linePrefix: string
    trainNo: string
    direction: string
    originStationCode: string
    destinationStationCode: string
  }
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (isDevRealtimeBypassEnabled()) {
    return { ok: true }
  }

  const mockStation = getDevMockStationName()
  const mockTrain = getDevMockTrainNo()
  if (mockTrain && isSameRealtimeTrain(mockTrain, input.trainNo)) {
    return { ok: true }
  }
  if (mockStation && mockTrain) {
    // mock 역·열차가 모두 있을 때만 부분 mock 허용
    void mockStation
  }

  const lineParam = resolveSeoulLineParamFromPrefix(input.linePrefix)
  if (!lineParam) {
    return { ok: true }
  }

  const lineName = resolveSeoulLineName(lineParam)
  if (!lineName) {
    return { ok: true }
  }

  const positionRows = await fetchRealtimePositionRows(request, lineName)
  if (!positionRows.length) {
    return {
      ok: false,
      message: '실시간 열차 위치를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.',
    }
  }

  const matchedTrain = positionRows.find((row) =>
    isSameRealtimeTrain(String(row.trainNo ?? ''), input.trainNo)
  )
  if (!matchedTrain?.statnNm) {
    return {
      ok: false,
      message:
        '선택한 열차의 실시간 위치를 확인할 수 없습니다. 열차에 탑승한 뒤 다시 시도해 주세요.',
    }
  }

  const currentOrder = await resolveCurrentStationOrder(
    supabase,
    input.linePrefix,
    matchedTrain.statnNm
  )
  if (currentOrder == null) {
    return {
      ok: false,
      message: '열차 위치를 역 정보와 대조할 수 없습니다. 잠시 후 다시 시도해 주세요.',
    }
  }

  const inside = isRequestInsideRealtimeWindow(
    {
      direction: input.direction,
      origin_station: { station_code: input.originStationCode },
      destination_station: { station_code: input.destinationStationCode },
    },
    currentOrder
  )

  if (!inside) {
    return {
      ok: false,
      message:
        '선택한 열차가 아직 탑승 구간에 들어오지 않았습니다. 열차에 탑승한 뒤 다시 시도해 주세요.',
    }
  }

  return { ok: true }
}
