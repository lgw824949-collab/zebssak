import { NextResponse } from 'next/server'
import { getUserIdFromRequest } from '@/lib/api-auth'
import {
  equivalentDirectionsForMatch,
  normalizeDirectionForStorage,
} from '@/lib/match-direction'
import { sendMatchPushNotifications } from '@/lib/push-server'
import { resolveAdjacentCarNumbers, resolveCarDistance } from '@/lib/match-movement-guide'
import {
  fetchRealtimePositionRows,
  normalizeSeoulTrainNo,
  resolveSeoulLineName,
} from '@/lib/seoul-metro'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import type { SupabaseClient } from '@supabase/supabase-js'

type ApiRole = 'seeker' | 'provider'
type RequestType = 'seat_seek' | 'leaving'

interface MatchRequestBody {
  role?: unknown
  train_id?: unknown
  direction?: unknown
  car_number?: unknown
  seat_side?: unknown
  seat_number?: unknown
  boarding_station_id?: unknown
  boarding_station_name?: unknown
  destination_id?: unknown
  remaining_stops?: unknown
  line_number?: unknown
  destination_name?: unknown
}

interface WaitingRequestRow {
  id: string
  user_id: string
  remaining_stations: number
  requested_at: string
  is_disabled: boolean
  total_points: number
  car_number: number
}

interface MatchRealtimeRequestRow {
  id: string
  direction: string
  origin_station: { station_code?: string } | { station_code?: string }[] | null
  destination_station:
    | { station_code?: string }
    | { station_code?: string }[]
    | null
}

function errorResponse(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status })
}

/** 역 코드에서 호선 접두사 추출 (예: s2-05 → s2, l1-03 → l1) */
function extractLinePrefixFromStationCode(stationCode: string): string | null {
  const match = stationCode.trim().toLowerCase().match(/^([a-z]+\d+)-/)
  return match?.[1] ?? null
}

function resolveLinePrefix(originCode: string, destinationCode: string): string | null {
  return (
    extractLinePrefixFromStationCode(destinationCode) ??
    extractLinePrefixFromStationCode(originCode)
  )
}

/** train_no + 호선 접두사로 trains 테이블 조회·저장 키 생성 */
function compositeTrainNo(linePrefix: string, trainNo: string): string {
  return `${linePrefix}:${trainNo}`
}

function normalizeTrainNoForStorage(linePrefix: string, trainNo: string): string {
  const raw = trainNo.trim()
  const isSeoul = /^s[1-9]$/u.test(linePrefix.trim().toLowerCase())
  if (!isSeoul) return raw
  const normalized = normalizeSeoulTrainNo(raw)
  return normalized || raw
}

function normalizeStationLabel(name: string | null | undefined): string {
  return (name ?? '')
    .trim()
    .replace(/역$/u, '')
    .replace(/\s+/g, '')
}

function resolveSeoulLineParamFromPrefix(linePrefix: string): string | null {
  const match = linePrefix.trim().toLowerCase().match(/^s([1-9])$/)
  if (!match?.[1]) return null
  return `seoul${match[1]}`
}

/** 입력 열차번호와 실시간 API trainNo를 느슨하게 비교합니다. */
function isSameRealtimeTrain(rowTrainNo: string, requestedTrainNo: string): boolean {
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

/**
 * 선택 열차가 실제 탑승 가능한 위치인지 서버에서 검증합니다.
 * - 서울 1~9호선은 실시간 API가 확보되어야만 진행
 * - 현재 열차 역이 탑승역과 다르면 "아직 탑승 전"으로 판단해 차단
 */
async function validateRealtimeBoardingContext(
  request: Request,
  input: {
    linePrefix: string
    trainNo: string
    boardingStationName: string
  }
): Promise<{ ok: true } | { ok: false; message: string }> {
  const lineParam = resolveSeoulLineParamFromPrefix(input.linePrefix)
  if (!lineParam) {
    return { ok: true }
  }

  const lineName = resolveSeoulLineName(lineParam)
  if (!lineName) {
    return { ok: true }
  }

  const boardingLabel = normalizeStationLabel(input.boardingStationName)
  if (!boardingLabel) {
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
      message: '선택한 열차의 실시간 위치를 확인할 수 없습니다. 열차 도착 후 다시 시도해 주세요.',
    }
  }

  const currentLabel = normalizeStationLabel(matchedTrain.statnNm)
  if (currentLabel !== boardingLabel) {
    return {
      ok: false,
      message: `선택한 열차는 현재 ${matchedTrain.statnNm}역입니다. ${input.boardingStationName}역 도착 후 등록해 주세요.`,
    }
  }

  return { ok: true }
}

function stationCodeFromJoin(
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

function stationOrderFromCode(stationCode: string): number | null {
  const match = stationCode.trim().toLowerCase().match(/-(\d+)$/u)
  if (!match?.[1]) return null
  const parsed = Number.parseInt(match[1], 10)
  return Number.isFinite(parsed) ? parsed : null
}

async function resolveCurrentStationOrder(
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

function isRequestInsideRealtimeWindow(
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
 * API role → DB request_type
 */
function mapRole(role: ApiRole): RequestType {
  return role === 'seeker' ? 'seat_seek' : 'leaving'
}

/**
 * 역 정보를 DB에 upsert 후 UUID 반환
 */
async function ensureStation(
  supabase: SupabaseClient,
  stationCode: string,
  stationName: string,
  lineNumber: number,
  stationOrder: number
): Promise<string | null> {
  const { data, error } = await supabase
    .from('stations')
    .upsert(
      {
        station_code: stationCode,
        station_name: stationName,
        line_number: lineNumber,
        station_order: stationOrder,
      },
      { onConflict: 'station_code' }
    )
    .select('id')
    .single()

  if (error || !data) {
    return null
  }

  return data.id as string
}

/**
 * 열차 번호 + 호선 접두사로 trains 행을 조회·생성합니다.
 * 동일 train_no라도 호선 접두사(s1, s2, l1 등)가 다르면 별도 행으로 관리합니다.
 */
async function ensureTrain(
  supabase: SupabaseClient,
  linePrefix: string,
  trainNo: string,
  lineNumber: number
): Promise<string | null> {
  const normalizedTrainNo = normalizeTrainNoForStorage(linePrefix, trainNo)
  const storedTrainNo = compositeTrainNo(linePrefix, normalizedTrainNo)

  const { data: existingRows, error: selectError } = await supabase
    .from('trains')
    .select('id')
    .eq('train_no', storedTrainNo)
    .order('created_at', { ascending: true })
    .limit(1)

  if (selectError) {
    return null
  }

  if (existingRows?.[0]?.id) {
    return existingRows[0].id as string
  }

  const { data: inserted, error: insertError } = await supabase
    .from('trains')
    .insert({ train_no: storedTrainNo, line_number: lineNumber })
    .select('id')
    .single()

  if (inserted?.id) {
    return inserted.id as string
  }

  if (insertError) {
    const { data: retryRows, error: retryError } = await supabase
      .from('trains')
      .select('id')
      .eq('train_no', storedTrainNo)
      .order('created_at', { ascending: true })
      .limit(1)

    if (!retryError && retryRows?.[0]?.id) {
      return retryRows[0].id as string
    }
  }

  return null
}

/**
 * user_id 목록에 교통약자/매너포인트를 붙입니다.
 */
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

/**
 * 매칭 우선순위 정렬
 * 1) 교통약자(is_disabled=true) 우선
 * 2) total_points 높은 순
 * 3) 호차 거리 가까운 순 (같은 호차 → 옆 호차)
 * 4) 남은 역 수 많은 순
 * 5) 요청 시각 빠른 순
 */
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

/**
 * 대기 순위 계산 (교통약자 → 포인트 → 남은 역 수 → 요청 시각)
 */
async function calculateQueuePosition(
  supabase: SupabaseClient,
  requestType: RequestType,
  currentRequestId: string
): Promise<number> {
  const { data, error } = await supabase
    .from('match_requests')
    .select('id, user_id, remaining_stations, requested_at, car_number')
    .eq('status', 'waiting')
    .eq('request_type', requestType)

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

/**
 * 반대 유형 waiting 요청과 매칭 시도 후 matches 행 생성
 */
async function tryCreateMatch(
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

/**
 * POST /api/match-requests — 매칭 요청 등록
 */
export async function POST(request: Request) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return errorResponse('로그인이 필요합니다.', 401)
    }

    let body: MatchRequestBody
    try {
      body = (await request.json()) as MatchRequestBody
    } catch {
      return errorResponse('요청 본문이 올바른 JSON이 아닙니다.', 400)
    }

    const role = body.role
    if (role !== 'seeker' && role !== 'provider') {
      return errorResponse('role은 seeker 또는 provider여야 합니다.', 400)
    }

    const trainNo = typeof body.train_id === 'string' ? body.train_id.trim() : ''
    const direction = typeof body.direction === 'string' ? body.direction.trim() : ''
    const destinationCode =
      typeof body.destination_id === 'string' ? body.destination_id.trim() : ''
    const boardingStationCode =
      typeof body.boarding_station_id === 'string'
        ? body.boarding_station_id.trim()
        : ''
    const boardingStationName =
      typeof body.boarding_station_name === 'string'
        ? body.boarding_station_name.trim()
        : ''
    const destinationName =
      typeof body.destination_name === 'string'
        ? body.destination_name.trim()
        : destinationCode
    const lineNumber =
      typeof body.line_number === 'number' ? body.line_number : Number(body.line_number)
    const carNumber =
      typeof body.car_number === 'number' ? body.car_number : Number(body.car_number)
    const remainingStops =
      typeof body.remaining_stops === 'number'
        ? body.remaining_stops
        : Number(body.remaining_stops)

    if (!trainNo || !direction || !destinationCode) {
      return errorResponse('train_id, direction, destination_id는 필수입니다.', 400)
    }
    if (!Number.isInteger(lineNumber) || (lineNumber !== 1 && lineNumber !== 2)) {
      return errorResponse('line_number는 1 또는 2여야 합니다.', 400)
    }
    if (!Number.isInteger(carNumber) || carNumber < 1) {
      return errorResponse('car_number가 올바르지 않습니다.', 400)
    }
    if (!Number.isInteger(remainingStops) || remainingStops < 3) {
      return errorResponse('목적지까지 최소 3역 이상 남아야 합니다.', 400)
    }

    const seatSideRaw = body.seat_side
    let seatSide: 'A' | 'B' | null = null
    if (seatSideRaw !== undefined && seatSideRaw !== null && seatSideRaw !== '') {
      if (seatSideRaw !== 'A' && seatSideRaw !== 'B') {
        return errorResponse('seat_side는 A 또는 B여야 합니다.', 400)
      }
      seatSide = seatSideRaw
    }

    const seatNumberRaw = body.seat_number
    let seatNumber: number | null = null
    if (seatNumberRaw !== undefined && seatNumberRaw !== null && seatNumberRaw !== '') {
      const parsedSeatNumber =
        typeof seatNumberRaw === 'number' ? seatNumberRaw : Number(seatNumberRaw)
      if (!Number.isInteger(parsedSeatNumber) || parsedSeatNumber < 1) {
        return errorResponse('seat_number가 올바르지 않습니다.', 400)
      }
      seatNumber = parsedSeatNumber
    }

    if (role === 'seeker') {
      if (!seatSide || seatNumber === null) {
        return errorResponse('seat_side와 seat_number는 필수입니다.', 400)
      }
    } else if (
      (seatSide !== null && seatNumber === null) ||
      (seatSide === null && seatNumber !== null)
    ) {
      return errorResponse('seat_side와 seat_number는 함께 보내야 합니다.', 400)
    }

    const supabase = createSupabaseAdminClient()

    const { data: userRow, error: userError } = await supabase
      .from('users')
      .select('suspended_until')
      .eq('id', userId)
      .single()

    if (userError || !userRow) {
      return errorResponse('사용자 정보를 확인할 수 없습니다.', 400)
    }

    if (
      userRow.suspended_until &&
      new Date(userRow.suspended_until as string) > new Date()
    ) {
      return errorResponse('이용 정지된 계정입니다.', 403)
    }

    const { data: halted } = await supabase.rpc('is_congestion_halted', {
      p_line_number: lineNumber,
    })

    if (halted === true) {
      return errorResponse('혼잡도 7 이상으로 매칭 기능이 정지되었습니다.', 503)
    }

    const originCode = boardingStationCode || `l${lineNumber}-01`
    const originName = boardingStationName || `기점(${lineNumber}호선)`
    const linePrefix = resolveLinePrefix(originCode, destinationCode)
    if (!linePrefix) {
      return errorResponse(
        'destination_id 또는 boarding_station_id에 호선 접두사(s1, s2, l1 등)가 필요합니다.',
        400
      )
    }

    const normalizedTrainNo = normalizeTrainNoForStorage(linePrefix, trainNo)

    const boardingRealtimeCheck = await validateRealtimeBoardingContext(request, {
      linePrefix,
      trainNo: normalizedTrainNo,
      boardingStationName: originName,
    })
    if (!boardingRealtimeCheck.ok) {
      return errorResponse(boardingRealtimeCheck.message, 409)
    }

    const originOrderMatch = originCode.match(/-(\d+)$/)
    const originOrder = originOrderMatch ? Number(originOrderMatch[1]) : 1
    const destinationOrderMatch = destinationCode.match(/-(\d+)$/)
    const destinationOrder = destinationOrderMatch
      ? Number(destinationOrderMatch[1])
      : remainingStops + 1

    const originStationId = await ensureStation(
      supabase,
      originCode,
      originName,
      lineNumber,
      originOrder
    )
    const destinationStationId = await ensureStation(
      supabase,
      destinationCode,
      destinationName,
      lineNumber,
      destinationOrder
    )

    if (!originStationId || !destinationStationId) {
      return errorResponse('역 정보를 저장할 수 없습니다.', 500)
    }

    const trainUuid = await ensureTrain(
      supabase,
      linePrefix,
      normalizedTrainNo,
      lineNumber
    )
    if (!trainUuid) {
      return errorResponse('열차 정보를 저장할 수 없습니다.', 500)
    }

    await supabase
      .from('match_requests')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('status', 'waiting')

    const requestType = mapRole(role)
    const directionStored = normalizeDirectionForStorage(direction)

    const insertPayload: Record<string, unknown> = {
      user_id: userId,
      train_id: trainUuid,
      direction: directionStored,
      request_type: requestType,
      origin_station_id: originStationId,
      destination_station_id: destinationStationId,
      remaining_stations: remainingStops,
      status: 'waiting',
      car_number: carNumber,
    }

    if (seatSide !== null && seatNumber !== null) {
      insertPayload.seat_side = seatSide
      insertPayload.seat_number = seatNumber
    }

    const { data: created, error: insertError } = await supabase
      .from('match_requests')
      .insert(insertPayload)
      .select('id')
      .single()

    if (insertError || !created) {
      if (insertError?.message?.includes('car_number')) {
        return errorResponse(
          'DB에 car_number 컬럼이 없습니다. migration 003을 실행해주세요.',
          500
        )
      }
      if (
        insertError?.message?.includes('seat_side') ||
        insertError?.message?.includes('seat_number')
      ) {
        return errorResponse(
          'DB에 seat_side, seat_number 컬럼이 없습니다. migration을 실행해주세요.',
          500
        )
      }
      if (insertError?.message?.includes('direction')) {
        return errorResponse(
          'DB에 direction 컬럼이 없습니다. Supabase에서 match_requests.direction(TEXT) 컬럼을 추가해주세요.',
          500
        )
      }
      return errorResponse('매칭 요청 등록에 실패했습니다.', 500)
    }

    const matchId = await tryCreateMatch(
      request,
      supabase,
      created.id as string,
      requestType,
      trainUuid,
      normalizedTrainNo,
      carNumber,
      linePrefix,
      directionStored
    )

    const queuePosition =
      role === 'seeker' && !matchId
        ? await calculateQueuePosition(supabase, requestType, created.id as string)
        : matchId
          ? 1
          : null

    return NextResponse.json(
      {
        success: true,
        data: {
          match_request_id: created.id,
          queue_position: queuePosition,
          match_id: matchId,
          matched: Boolean(matchId),
        },
      },
      { status: 201 }
    )
  } catch {
    return errorResponse('서버 오류가 발생했습니다.', 500)
  }
}
