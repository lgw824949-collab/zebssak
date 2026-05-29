import { NextResponse } from 'next/server'
import { getUserIdFromRequest } from '@/lib/api-auth'
import {
  doorNumberFromApiSeat,
  formatCarDoorPosition,
  formatStationDisplayName,
  lineLabelFromStationCode,
  seatsPerSectionFromStationCode,
} from '@/lib/match-display'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

interface MatchRow {
  id: string
  status: string
  seat_seek_request_id: string
  leaving_request_id: string
}

interface MatchRequestUserRow {
  id: string
  user_id: string
}

interface PatchBody {
  action?: unknown
}

interface MatchRequestDetailRow {
  id: string
  user_id: string
  request_type: string
  car_number: number | null
  seat_side: string | null
  seat_number: number | null
  remaining_stations: number | null
  train:
    | { train_no?: string; line_number?: number }
    | { train_no?: string; line_number?: number }[]
    | null
  destination_station:
    | { station_name?: string; station_code?: string }
    | { station_name?: string; station_code?: string }[]
    | null
}

function unwrapRelation<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null
  return Array.isArray(value) ? value[0] ?? null : value
}

function buildRequestSummary(row: MatchRequestDetailRow) {
  const train = unwrapRelation(row.train)
  const destination = unwrapRelation(row.destination_station)
  const stationCode = destination?.station_code ?? null
  const seatsPerSection = seatsPerSectionFromStationCode(stationCode)
  const seatSide = row.seat_side === 'A' || row.seat_side === 'B' ? row.seat_side : null
  const seatNumber =
    typeof row.seat_number === 'number' ? row.seat_number : Number(row.seat_number)
  const carNumber =
    typeof row.car_number === 'number' ? row.car_number : Number(row.car_number)

  const doorNumber =
    seatSide && Number.isInteger(seatNumber)
      ? doorNumberFromApiSeat(seatNumber, seatsPerSection)
      : null

  const seatPositionLabel =
    seatSide &&
    Number.isInteger(seatNumber) &&
    Number.isInteger(carNumber) &&
    carNumber >= 1
      ? formatCarDoorPosition(carNumber, seatSide, seatNumber, seatsPerSection)
      : null

  const carDoorShort =
    doorNumber != null && Number.isInteger(carNumber) && carNumber >= 1
      ? `${carNumber}-${doorNumber}`
      : null

  return {
    request_id: row.id,
    request_type: row.request_type,
    car_number: Number.isInteger(carNumber) ? carNumber : null,
    car_door_short: carDoorShort,
    seat_side: seatSide,
    seat_number: Number.isInteger(seatNumber) ? seatNumber : null,
    seat_position_label: seatPositionLabel,
    remaining_stations: row.remaining_stations ?? null,
    train_no: train?.train_no ?? null,
    line_label: lineLabelFromStationCode(stationCode),
    destination_station_name: formatStationDisplayName(destination?.station_name),
    destination_station_code: stationCode,
  }
}

function errorResponse(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status })
}

/**
 * 매칭 당사자 여부 확인
 */
async function isMatchParticipant(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  match: MatchRow,
  userId: string
): Promise<boolean> {
  const requestIds = [match.seat_seek_request_id, match.leaving_request_id]

  const { data, error } = await supabase
    .from('match_requests')
    .select('id')
    .in('id', requestIds)
    .eq('user_id', userId)
    .limit(1)

  if (error) {
    return false
  }

  return Boolean(data?.length)
}

/**
 * 착석 희망 요청자(seat_seek) 여부 — 수락/거절은 희망자만 가능
 */
async function isSeatSeekerForMatch(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  match: MatchRow,
  userId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('match_requests')
    .select('user_id, request_type')
    .eq('id', match.seat_seek_request_id)
    .maybeSingle()

  if (error || !data) {
    return false
  }

  const row = data as { user_id: string; request_type: string }
  return row.user_id === userId && row.request_type === 'seat_seek'
}

/**
 * GET /api/matches/[id] — 매칭 결과(양보·착석 상대 정보) 조회
 */
export async function GET(
  request: Request,
  context: { params: { id: string } }
) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return errorResponse('로그인이 필요합니다.', 401)
    }

    const matchId = context.params.id?.trim()
    if (!matchId) {
      return errorResponse('매칭 ID가 필요합니다.', 400)
    }

    const supabase = createSupabaseAdminClient()

    const { data: matchRaw, error: matchError } = await supabase
      .from('matches')
      .select(
        `
        id,
        status,
        seat_seek_request_id,
        leaving_request_id,
        seat_seek:match_requests!seat_seek_request_id(
          id,
          user_id,
          request_type,
          car_number,
          seat_side,
          seat_number,
          remaining_stations,
          train:trains!train_id(train_no, line_number),
          destination_station:stations!destination_station_id(station_name, station_code)
        ),
        leaving:match_requests!leaving_request_id(
          id,
          user_id,
          request_type,
          car_number,
          seat_side,
          seat_number,
          remaining_stations,
          train:trains!train_id(train_no, line_number),
          destination_station:stations!destination_station_id(station_name, station_code)
        )
      `
      )
      .eq('id', matchId)
      .maybeSingle()

    if (matchError) {
      return errorResponse('매칭 정보를 조회할 수 없습니다.', 500)
    }

    if (!matchRaw) {
      return errorResponse('매칭을 찾을 수 없습니다.', 404)
    }

    const match = matchRaw as MatchRow & {
      seat_seek: MatchRequestDetailRow | MatchRequestDetailRow[] | null
      leaving: MatchRequestDetailRow | MatchRequestDetailRow[] | null
    }

    const participant = await isMatchParticipant(supabase, match, userId)
    if (!participant) {
      return errorResponse('이 매칭에 접근할 수 없습니다.', 403)
    }

    const seatSeekRow = unwrapRelation(match.seat_seek)
    const leavingRow = unwrapRelation(match.leaving)

    if (!seatSeekRow || !leavingRow) {
      return errorResponse('매칭 요청 정보가 불완전합니다.', 500)
    }

    const isSeeker = seatSeekRow.user_id === userId
    const partnerRow = isSeeker ? leavingRow : seatSeekRow
    const selfRow = isSeeker ? seatSeekRow : leavingRow

    return NextResponse.json({
      success: true,
      data: {
        match_id: match.id,
        status: match.status,
        viewer_role: isSeeker ? 'seeker' : 'provider',
        partner: buildRequestSummary(partnerRow),
        self: buildRequestSummary(selfRow),
      },
    })
  } catch {
    return errorResponse('서버 오류가 발생했습니다.', 500)
  }
}

/**
 * PATCH /api/matches/[id] — 수락(accepted) / 거절 처리
 * 참고: 스키마(matches.status)에 rejected 값이 없어 거절은 cancelled로 저장합니다.
 */
export async function PATCH(
  request: Request,
  context: { params: { id: string } }
) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return errorResponse('로그인이 필요합니다.', 401)
    }

    const matchId = context.params.id?.trim()
    if (!matchId) {
      return errorResponse('매칭 ID가 필요합니다.', 400)
    }

    let body: PatchBody
    try {
      body = (await request.json()) as PatchBody
    } catch {
      return errorResponse('요청 본문이 올바른 JSON이 아닙니다.', 400)
    }

    const action = body.action
    if (action !== 'accept' && action !== 'reject') {
      return errorResponse('action은 accept 또는 reject 여야 합니다.', 400)
    }

    const supabase = createSupabaseAdminClient()

    const { data: matchRaw, error: matchError } = await supabase
      .from('matches')
      .select('id, status, seat_seek_request_id, leaving_request_id')
      .eq('id', matchId)
      .maybeSingle()

    if (matchError) {
      return errorResponse('매칭 정보를 조회할 수 없습니다.', 500)
    }

    if (!matchRaw) {
      return errorResponse('매칭을 찾을 수 없습니다.', 404)
    }

    const match = matchRaw as MatchRow

    const participant = await isMatchParticipant(supabase, match, userId)
    if (!participant) {
      return errorResponse('이 매칭에 접근할 수 없습니다.', 403)
    }

    const isSeeker = await isSeatSeekerForMatch(supabase, match, userId)
    if (!isSeeker) {
      return errorResponse('수락·거절은 착석 희망 요청자만 할 수 있습니다.', 403)
    }

    if (match.status !== 'pending') {
      return errorResponse('처리할 수 없는 매칭 상태입니다.', 409)
    }

    if (action === 'accept') {
      const { data: leavingReq, error: leavingErr } = await supabase
        .from('match_requests')
        .select('id, user_id')
        .eq('id', match.leaving_request_id)
        .maybeSingle()

      if (leavingErr || !leavingReq) {
        return errorResponse('하차 예정 요청 정보를 찾을 수 없습니다.', 500)
      }

      const leaving = leavingReq as MatchRequestUserRow
      const leavingUserId = leaving.user_id

      const { data: userRow, error: userErr } = await supabase
        .from('users')
        .select('total_points')
        .eq('id', leavingUserId)
        .maybeSingle()

      if (userErr || userRow == null) {
        return errorResponse('양보자 포인트 정보를 조회할 수 없습니다.', 500)
      }

      const prevPoints = Number((userRow as { total_points: number }).total_points ?? 0)
      const nextPoints = prevPoints + 10
      const acceptedAt = new Date().toISOString()

      const { error: updateMatchError } = await supabase
        .from('matches')
        .update({ status: 'accepted', accepted_at: acceptedAt })
        .eq('id', matchId)
        .eq('status', 'pending')

      if (updateMatchError) {
        return errorResponse('매칭 수락 처리에 실패했습니다.', 500)
      }

      const { error: pointsUserError } = await supabase
        .from('users')
        .update({ total_points: nextPoints })
        .eq('id', leavingUserId)

      if (pointsUserError) {
        await supabase
          .from('matches')
          .update({ status: 'pending', accepted_at: null })
          .eq('id', matchId)
          .eq('status', 'accepted')

        return errorResponse('포인트 지급에 실패했습니다.', 500)
      }

      const { error: ledgerError } = await supabase.from('points').insert({
        user_id: leavingUserId,
        amount: 10,
        balance_after: nextPoints,
        reason: 'match_accept_yield',
        match_id: matchId,
      })

      if (ledgerError) {
        await supabase
          .from('users')
          .update({ total_points: prevPoints })
          .eq('id', leavingUserId)
        await supabase
          .from('matches')
          .update({ status: 'pending', accepted_at: null })
          .eq('id', matchId)

        return errorResponse('포인트 내역 저장에 실패했습니다.', 500)
      }

      return NextResponse.json({
        success: true,
        data: {
          match_id: matchId,
          status: 'accepted',
          leaving_user_points: nextPoints,
        },
      })
    }

    // 거절 — 스키마에 rejected 없음 → cancelled 사용
    const { error: reopenError } = await supabase
      .from('match_requests')
      .update({ status: 'waiting' })
      .in('id', [match.seat_seek_request_id, match.leaving_request_id])
      .eq('status', 'matched')

    if (reopenError) {
      return errorResponse('매칭 요청 복구에 실패했습니다.', 500)
    }

    const { error: rejectMatchError } = await supabase
      .from('matches')
      .update({ status: 'cancelled' })
      .eq('id', matchId)
      .eq('status', 'pending')

    if (rejectMatchError) {
      await supabase
        .from('match_requests')
        .update({ status: 'matched' })
        .in('id', [match.seat_seek_request_id, match.leaving_request_id])
        .eq('status', 'waiting')

      return errorResponse('매칭 거절 처리에 실패했습니다.', 500)
    }

    return NextResponse.json({
      success: true,
      data: {
        match_id: matchId,
        status: 'cancelled',
        note: 'DB 제약으로 rejected 대신 cancelled 저장',
      },
    })
  } catch {
    return errorResponse('서버 오류가 발생했습니다.', 500)
  }
}
