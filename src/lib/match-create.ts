import {
  equivalentDirectionsForMatch,
} from '@/lib/match-direction'
import { resolveAdjacentCarNumbers, resolveCarDistance } from '@/lib/match-movement-guide'
import {
  extractLinePrefixFromStationCode,
  isRequestInsideRealtimeWindow,
  isSameRealtimeTrain,
  resolveCurrentStationOrder,
  stationCodeFromJoin,
  type MatchRealtimeRequestRow,
} from '@/lib/match-boarding-validation'
import { sendMatchPushNotifications } from '@/lib/push-server'
import { fetchRealtimePositionRows, resolveSeoulLineName } from '@/lib/seoul-metro'
import type { SupabaseClient } from '@supabase/supabase-js'

type RequestType = 'seat_seek' | 'leaving'

interface WaitingRequestRow {
  id: string
  user_id: string
  remaining_stations: number
  requested_at: string
  is_disabled: boolean
  total_points: number
  car_number: number
}

async function attachPriorityFields(
  supabase: SupabaseClient,
  rows: Array<{
    id: string
    user_id: string
    remaining_stations: number
    requested_at: string
    car_number: number
  }>
): Promise<WaitingRequestRow[]> {
  if (!rows.length) {
    return []
  }

  const userIds = Array.from(new Set(rows.map((row) => row.user_id)))
  const { data: usersByDisabled, error: disabledError } = await supabase
    .from('users')
    .select('id, is_disabled, total_points')
    .in('id', userIds)

  const { data: usersByVulnerable, error: vulnerableError } = await supabase
    .from('users')
    .select('id, is_vulnerable, total_points')
    .in('id', userIds)

  const disabledByUserId = new Map<string, boolean>()
  const pointsByUserId = new Map<string, number>()

  if (!disabledError && usersByDisabled) {
    for (const user of usersByDisabled) {
      disabledByUserId.set(user.id as string, (user as { is_disabled?: boolean }).is_disabled === true)
      pointsByUserId.set(user.id as string, Number((user as { total_points?: number }).total_points ?? 0))
    }
  } else if (!vulnerableError && usersByVulnerable) {
    for (const user of usersByVulnerable) {
      disabledByUserId.set(
        user.id as string,
        (user as { is_vulnerable?: boolean }).is_vulnerable === true
      )
      pointsByUserId.set(user.id as string, Number((user as { total_points?: number }).total_points ?? 0))
    }
  }

  return rows.map((row) => ({
    ...row,
    car_number:
      typeof row.car_number === 'number' && Number.isInteger(row.car_number)
        ? row.car_number
        : 1,
    is_disabled: disabledByUserId.get(row.user_id) === true,
    total_points: pointsByUserId.get(row.user_id) ?? 0,
  }))
}

function sortByMatchingPriority(
  rows: WaitingRequestRow[],
  requesterCarNumber: number
): WaitingRequestRow[] {
  return [...rows].sort((a, b) => {
    if (a.is_disabled !== b.is_disabled) {
      return a.is_disabled ? -1 : 1
    }
    if (b.total_points !== a.total_points) {
      return b.total_points - a.total_points
    }
    const carDistanceA = resolveCarDistance(requesterCarNumber, a.car_number)
    const carDistanceB = resolveCarDistance(requesterCarNumber, b.car_number)
    if (carDistanceA !== carDistanceB) {
      return carDistanceA - carDistanceB
    }
    if (b.remaining_stations !== a.remaining_stations) {
      return b.remaining_stations - a.remaining_stations
    }
    return new Date(a.requested_at).getTime() - new Date(b.requested_at).getTime()
  })
}

/** 대기 순위 (동일 presence_mode·request_type 기준) */
export async function calculateQueuePosition(
  supabase: SupabaseClient,
  requestType: RequestType,
  currentRequestId: string,
  presenceMode: 'onboard' | 'platform_waiting' = 'onboard'
): Promise<number> {
  const { data, error } = await supabase
    .from('match_requests')
    .select('id, user_id, remaining_stations, requested_at, car_number')
    .eq('status', 'waiting')
    .eq('request_type', requestType)
    .eq('presence_mode', presenceMode)

  if (error || !data) {
    return 1
  }

  const currentRow = data.find((row) => row.id === currentRequestId)
  const requesterCar =
    typeof currentRow?.car_number === 'number' ? currentRow.car_number : 1

  const rows = await attachPriorityFields(supabase, data)
  const sorted = sortByMatchingPriority(rows, requesterCar)
  const index = sorted.findIndex((row) => row.id === currentRequestId)
  return index >= 0 ? index + 1 : sorted.length
}

/** 반대 유형 onboard waiting 요청과 매칭 시도 */
export async function tryCreateMatch(
  request: Request,
  supabase: SupabaseClient,
  newRequestId: string,
  newRequestType: RequestType,
  trainUuid: string,
  trainNo: string,
  carNumber: number,
  linePrefix: string,
  direction: string
): Promise<string | null> {
  const oppositeType: RequestType =
    newRequestType === 'seat_seek' ? 'leaving' : 'seat_seek'

  const directionValues = equivalentDirectionsForMatch(direction)
  const adjacentCars = resolveAdjacentCarNumbers(carNumber)

  const { data: candidates, error } = await supabase
    .from('match_requests')
    .select(`
      id,
      user_id,
      remaining_stations,
      requested_at,
      car_number,
      direction,
      destination_station:stations!destination_station_id(station_code),
      origin_station:stations!origin_station_id(station_code)
    `)
    .eq('status', 'waiting')
    .eq('request_type', oppositeType)
    .eq('presence_mode', 'onboard')
    .eq('train_id', trainUuid)
    .in('car_number', adjacentCars.length ? adjacentCars : [carNumber])
    .in('direction', directionValues)
    .neq('id', newRequestId)

  if (error || !candidates?.length) {
    return null
  }

  const sameLineCandidates = candidates.filter((row) => {
    const destinationCode = stationCodeFromJoin(
      row.destination_station as
        | { station_code?: string }
        | { station_code?: string }[]
        | null
    )
    const originCode = stationCodeFromJoin(
      row.origin_station as
        | { station_code?: string }
        | { station_code?: string }[]
        | null
    )
    const candidatePrefix =
      extractLinePrefixFromStationCode(destinationCode) ??
      extractLinePrefixFromStationCode(originCode)
    return candidatePrefix === linePrefix
  })

  if (!sameLineCandidates.length) {
    return null
  }

  if (/^s[1-9]$/u.test(linePrefix)) {
    const lineName = resolveSeoulLineName(`seoul${linePrefix.slice(1)}`)
    if (!lineName) return null

    const positionRows = await fetchRealtimePositionRows(request, lineName)
    if (!positionRows.length) return null

    const matchedTrain = positionRows.find((row) =>
      isSameRealtimeTrain(String(row.trainNo ?? ''), trainNo)
    )
    if (!matchedTrain?.statnNm) return null

    const currentOrder = await resolveCurrentStationOrder(
      supabase,
      linePrefix,
      matchedTrain.statnNm
    )
    if (currentOrder == null) return null

    const { data: newRequestRow, error: newRequestError } = await supabase
      .from('match_requests')
      .select(`
        id,
        direction,
        origin_station:stations!origin_station_id(station_code),
        destination_station:stations!destination_station_id(station_code)
      `)
      .eq('id', newRequestId)
      .maybeSingle()

    if (newRequestError || !newRequestRow) return null

    const newRealtimeRow = newRequestRow as MatchRealtimeRequestRow
    if (!isRequestInsideRealtimeWindow(newRealtimeRow, currentOrder)) {
      return null
    }

    const realtimeCandidates = sameLineCandidates.filter((row) =>
      isRequestInsideRealtimeWindow(
        {
          id: String(row.id),
          direction: String((row as { direction?: string }).direction ?? direction),
          origin_station: row.origin_station as
            | { station_code?: string }
            | { station_code?: string }[]
            | null,
          destination_station: row.destination_station as
            | { station_code?: string }
            | { station_code?: string }[]
            | null,
        },
        currentOrder
      )
    )

    if (!realtimeCandidates.length) {
      return null
    }

    sameLineCandidates.length = 0
    sameLineCandidates.push(...realtimeCandidates)
  }

  const ranked = sortByMatchingPriority(
    await attachPriorityFields(supabase, sameLineCandidates),
    carNumber
  )
  const partner = ranked[0]
  if (!partner) {
    return null
  }

  const seatSeekId =
    newRequestType === 'seat_seek' ? newRequestId : partner.id
  const leavingId =
    newRequestType === 'leaving' ? newRequestId : partner.id

  const notifyExpiresAt = new Date(Date.now() + 30 * 1000).toISOString()

  const { data: match, error: matchError } = await supabase
    .from('matches')
    .insert({
      seat_seek_request_id: seatSeekId,
      leaving_request_id: leavingId,
      status: 'pending',
      notify_expires_at: notifyExpiresAt,
    })
    .select('id')
    .single()

  if (matchError || !match) {
    return null
  }

  const { error: updateError } = await supabase
    .from('match_requests')
    .update({ status: 'matched' })
    .in('id', [seatSeekId, leavingId])
    .eq('status', 'waiting')

  if (updateError) {
    await supabase.from('matches').delete().eq('id', match.id as string)
    return null
  }

  void sendMatchPushNotifications(
    supabase,
    match.id as string,
    seatSeekId,
    leavingId
  ).catch(() => {
    // 푸시 실패해도 매칭은 유지합니다.
  })

  return match.id as string
}

/** DB trains.train_no (s7:2202) → API 열차번호 */
export function extractApiTrainNoFromStored(storedTrainNo: string): string {
  const trimmed = storedTrainNo.trim()
  const colonIndex = trimmed.indexOf(':')
  if (colonIndex >= 0) {
    return trimmed.slice(colonIndex + 1).trim()
  }
  return trimmed
}
