import { NextResponse } from 'next/server'
import { getUserIdFromRequest } from '@/lib/api-auth'
import {
  extractLinePrefixFromStationCode,
  validateOnboardBoardingContext,
} from '@/lib/match-boarding-validation'
import {
  calculateQueuePosition,
  tryCreateMatch,
} from '@/lib/match-create'
import { normalizeDirectionForStorage } from '@/lib/match-direction'
import { resolvePresenceModeForRole, type PresenceMode } from '@/lib/presence-mode'
import { normalizeSeoulTrainNo } from '@/lib/seoul-metro'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import type { SupabaseClient } from '@supabase/supabase-js'

type ApiRole = 'seeker' | 'provider'
type RequestType = 'seat_seek' | 'leaving'

interface MatchRequestBody {
  role?: unknown
  presence_mode?: unknown
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

function errorResponse(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status })
}

function resolveLinePrefix(originCode: string, destinationCode: string): string | null {
  return (
    extractLinePrefixFromStationCode(destinationCode) ??
    extractLinePrefixFromStationCode(originCode)
  )
}

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

function mapRole(role: ApiRole): RequestType {
  return role === 'seeker' ? 'seat_seek' : 'leaving'
}

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
 * POST /api/match-requests — 매칭 요청 등록
 * - platform_waiting: 플랫폼 대기(매칭 시도 없음)
 * - onboard: 탑승 중(실시간 검증 후 매칭 시도)
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

    const presenceMode: PresenceMode = resolvePresenceModeForRole(role, body.presence_mode)

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
    const directionStored = normalizeDirectionForStorage(direction)

    // 탑승 중만 실시간 검증 — 플랫폼 대기는 등록만 허용
    if (presenceMode === 'onboard') {
      const onboardCheck = await validateOnboardBoardingContext(request, supabase, {
        linePrefix,
        trainNo: normalizedTrainNo,
        direction: directionStored,
        originStationCode: originCode,
        destinationStationCode: destinationCode,
      })
      if (!onboardCheck.ok) {
        return errorResponse(onboardCheck.message, 409)
      }
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
      presence_mode: presenceMode,
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
      if (insertError?.message?.includes('presence_mode')) {
        return errorResponse(
          'DB에 presence_mode 컬럼이 없습니다. migration 014를 실행해주세요.',
          500
        )
      }
      return errorResponse('매칭 요청 등록에 실패했습니다.', 500)
    }

    let matchId: string | null = null
    if (presenceMode === 'onboard') {
      matchId = await tryCreateMatch(
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
    }

    const queuePosition =
      role === 'seeker' && !matchId
        ? await calculateQueuePosition(
            supabase,
            requestType,
            created.id as string,
            presenceMode
          )
        : matchId
          ? 1
          : null

    return NextResponse.json(
      {
        success: true,
        data: {
          match_request_id: created.id,
          presence_mode: presenceMode,
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
