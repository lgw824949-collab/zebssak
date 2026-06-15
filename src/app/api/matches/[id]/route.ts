import { NextResponse } from 'next/server'
import { getUserIdFromRequest } from '@/lib/api-auth'
import {
  doorNumberFromApiSeat,
  formatCarDoorPosition,
  formatStationDisplayName,
  lineLabelFromStationCode,
  seatsPerSectionFromStationCode,
} from '@/lib/match-display'
import type {
  MatchMovementPayload,
  MatchMovementState,
  MatchMovementStatus,
  MatchRouteGuide,
} from '@/lib/match-movement'
import { resolveLiveHandoffRemainingStations } from '@/lib/match-handoff-remaining-server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import type { RealtimeChannel } from '@supabase/supabase-js'

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
      ? `출${carNumber}-${doorNumber}`
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

async function loadMatchMovementPayload(
  request: Request,
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  matchId: string,
  userId: string,
  seatSeekRow: MatchRequestDetailRow,
  leavingRow: MatchRequestDetailRow
): Promise<MatchMovementPayload> {
  const isSeeker = seatSeekRow.user_id === userId
  const selfRow = isSeeker ? seatSeekRow : leavingRow
  const partnerRow = isSeeker ? leavingRow : seatSeekRow

  const { data: movementRows, error: movementError } = await supabase
    .from('match_movement_status')
    .select('user_id, status, updated_at')
    .eq('match_id', matchId)

  const rowByUser = new Map<string, MatchMovementState>()
  if (!movementError && movementRows) {
    for (const row of movementRows) {
      const status = row.status as MatchMovementStatus
      if (status === 'idle' || status === 'moving' || status === 'arrived') {
        rowByUser.set(row.user_id as string, {
          status,
          updated_at: String(row.updated_at),
        })
      }
    }
  }

  const resolveState = (
    targetUserId: string,
    role: 'seeker' | 'provider'
  ): MatchMovementState => {
    const stored = rowByUser.get(targetUserId)
    if (stored) {
      return stored
    }

    if (role === 'provider') {
      return { status: 'idle', updated_at: null }
    }

    return { status: 'idle', updated_at: null }
  }

  const partnerRole: 'seeker' | 'provider' =
    partnerRow.request_type === 'leaving' ? 'provider' : 'seeker'
  const selfRole: 'seeker' | 'provider' =
    selfRow.request_type === 'leaving' ? 'provider' : 'seeker'

  const leavingTrain = unwrapRelation(leavingRow.train)
  const leavingDestination = unwrapRelation(leavingRow.destination_station)
  const handoffRemaining = await resolveLiveHandoffRemainingStations(request, supabase, {
    trainNo: leavingTrain?.train_no ?? null,
    lineNumber:
      typeof leavingTrain?.line_number === 'number' ? leavingTrain.line_number : null,
    destinationStationCode: leavingDestination?.station_code ?? null,
    destinationStationName: leavingDestination?.station_name ?? null,
    fallbackRemaining: leavingRow.remaining_stations ?? null,
  })

  const routeGuide: MatchRouteGuide = {
    handoff_station_name:
      formatStationDisplayName(leavingDestination?.station_name) || '양보 역',
    handoff_remaining_stations: handoffRemaining,
    self_destination_name:
      formatStationDisplayName(
        unwrapRelation(selfRow.destination_station)?.station_name
      ) || '목적지',
    self_remaining_stations: selfRow.remaining_stations ?? null,
  }

  return {
    self: resolveState(selfRow.user_id, selfRole),
    partner: resolveState(partnerRow.user_id, partnerRole),
    route_guide: routeGuide,
  }
}

function errorResponse(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status })
}

/** pending이 아닌 매칭 상태 — 프론트에서 code로 분기합니다 */
function conflictResponse(code: string, message: string) {
  return NextResponse.json({ success: false, error: message, code }, { status: 409 })
}

function matchStatusConflictResponse(status: string) {
  if (status === 'accepted') {
    return conflictResponse('already_accepted', '이미 수락된 매칭입니다.')
  }
  if (status === 'expired') {
    return conflictResponse('already_expired', '수락 시간이 만료된 매칭입니다.')
  }
  if (status === 'cancelled') {
    return conflictResponse('already_cancelled', '취소된 매칭입니다.')
  }
  return conflictResponse('invalid_status', '처리할 수 없는 매칭 상태입니다.')
}

async function resolveMatchStatusConflict(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  matchId: string
) {
  const { data: latest, error: latestError } = await supabase
    .from('matches')
    .select('status')
    .eq('id', matchId)
    .maybeSingle()

  if (latestError || !latest) {
    return errorResponse('매칭 정보를 조회할 수 없습니다.', 500)
  }

  return matchStatusConflictResponse(String(latest.status))
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
 * 수락(accepted) 완료 SSE — 상대 수락 시 type: accepted 이벤트 전송
 */
function createMatchAcceptSseResponse(
  request: Request,
  matchId: string,
  userId: string
): Response {
  const supabase = createSupabaseAdminClient()
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
      }

      let channel: RealtimeChannel | null = null
      let closed = false

      const cleanup = () => {
        if (closed) return
        closed = true
        if (channel) {
          supabase.removeChannel(channel)
        }
        try {
          controller.close()
        } catch {
          // 이미 닫힌 스트림
        }
      }

      try {
        const { data: matchRaw, error: matchError } = await supabase
          .from('matches')
          .select('id, status, seat_seek_request_id, leaving_request_id')
          .eq('id', matchId)
          .maybeSingle()

        if (matchError || !matchRaw) {
          send({ type: 'error', message: '매칭을 찾을 수 없습니다.' })
          cleanup()
          return
        }

        const match = matchRaw as MatchRow
        const participant = await isMatchParticipant(supabase, match, userId)
        if (!participant) {
          send({ type: 'error', message: '이 매칭에 접근할 수 없습니다.' })
          cleanup()
          return
        }

        if (match.status === 'accepted') {
          send({ type: 'accepted', match_id: matchId })
          cleanup()
          return
        }

        channel = supabase
          .channel(`match-accept-sse-${matchId}-${userId}`)
          .on(
            'postgres_changes',
            {
              event: 'UPDATE',
              schema: 'public',
              table: 'matches',
              filter: `id=eq.${matchId}`,
            },
            (payload) => {
              const row = payload.new as { id?: string; status?: string }
              if (row.id && row.status === 'accepted') {
                send({ type: 'accepted', match_id: matchId })
                cleanup()
              }
            }
          )
          .subscribe((status) => {
            if (status === 'CHANNEL_ERROR') {
              send({ type: 'error', message: 'Realtime 연결에 실패했습니다.' })
              cleanup()
            }
          })

        request.signal.addEventListener('abort', cleanup)

        // Realtime 실패 대비 — DB 상태 폴링으로 수락 감지
        const acceptPoll = setInterval(async () => {
          if (closed) {
            clearInterval(acceptPoll)
            return
          }

          try {
            const { data: latest, error: latestError } = await supabase
              .from('matches')
              .select('id, status')
              .eq('id', matchId)
              .maybeSingle()

            if (latestError || !latest) {
              return
            }

            if (latest.status === 'accepted') {
              send({ type: 'accepted', match_id: matchId })
              cleanup()
            }
          } catch {
            // 폴링 실패 시 다음 주기에 재시도합니다.
          }
        }, 2000)

        request.signal.addEventListener('abort', () => clearInterval(acceptPoll))

        const keepAlive = setInterval(() => {
          if (closed) {
            clearInterval(keepAlive)
            return
          }
          send({ type: 'ping' })
        }, 25000)

        request.signal.addEventListener('abort', () => clearInterval(keepAlive))
      } catch {
        send({ type: 'error', message: '서버 오류가 발생했습니다.' })
        cleanup()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
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

    const sseMode = new URL(request.url).searchParams.get('sse')
    if (sseMode === 'accept') {
      return createMatchAcceptSseResponse(request, matchId, userId)
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

    let seat_confirmation: { seated: boolean; created_at: string } | null = null
    if (isSeeker) {
      const { data: confirmationRow, error: confirmationError } = await supabase
        .from('match_seat_confirmations')
        .select('seated, created_at')
        .eq('match_id', matchId)
        .eq('user_id', userId)
        .maybeSingle()

      if (!confirmationError && confirmationRow) {
        seat_confirmation = {
          seated: Boolean(confirmationRow.seated),
          created_at: String(confirmationRow.created_at),
        }
      }
    }

    const movement = await loadMatchMovementPayload(
      request,
      supabase,
      matchId,
      userId,
      seatSeekRow,
      leavingRow
    )

    return NextResponse.json({
      success: true,
      data: {
        match_id: match.id,
        status: match.status,
        viewer_role: isSeeker ? 'seeker' : 'provider',
        partner: buildRequestSummary(partnerRow),
        self: buildRequestSummary(selfRow),
        seat_confirmation,
        movement,
      },
    })
  } catch {
    return errorResponse('서버 오류가 발생했습니다.', 500)
  }
}

/**
 * PATCH /api/matches/[id] — 수락(accepted) / 거절 처리 (매칭 당사자 모두 가능)
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

    if (match.status !== 'pending') {
      return matchStatusConflictResponse(match.status)
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

      const { data: acceptedRows, error: updateMatchError } = await supabase
        .from('matches')
        .update({ status: 'accepted', accepted_at: acceptedAt })
        .eq('id', matchId)
        .eq('status', 'pending')
        .select('id')

      if (updateMatchError) {
        return errorResponse('매칭 수락 처리에 실패했습니다.', 500)
      }

      if (!acceptedRows?.length) {
        return resolveMatchStatusConflict(supabase, matchId)
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

    // 거절 — 거절한 사용자 요청은 cancelled, 상대는 waiting으로 복귀
    const { data: participantRows, error: participantError } = await supabase
      .from('match_requests')
      .select('id, user_id')
      .in('id', [match.seat_seek_request_id, match.leaving_request_id])

    if (participantError || !participantRows?.length) {
      return errorResponse('매칭 요청 정보를 찾을 수 없습니다.', 500)
    }

    const rejecterRequest = participantRows.find((row) => row.user_id === userId)
    const partnerRequest = participantRows.find((row) => row.user_id !== userId)

    if (!rejecterRequest || !partnerRequest) {
      return errorResponse('매칭 참여자 정보를 찾을 수 없습니다.', 500)
    }

    const { data: rejecterCurrent, error: rejecterCurrentError } = await supabase
      .from('match_requests')
      .select('status')
      .eq('id', rejecterRequest.id)
      .maybeSingle()

    if (rejecterCurrentError) {
      return errorResponse('매칭 요청 상태를 조회할 수 없습니다.', 500)
    }

    const alreadyCancelled = rejecterCurrent?.status === 'cancelled'

    if (!alreadyCancelled) {
      const { data: cancelledRejecterRows, error: cancelRejecterError } = await supabase
        .from('match_requests')
        .update({ status: 'cancelled' })
        .eq('id', rejecterRequest.id)
        .in('status', ['matched', 'waiting'])
        .select('id')

      if (cancelRejecterError) {
        return errorResponse('매칭 요청 취소에 실패했습니다.', 500)
      }

      if (!cancelledRejecterRows?.length) {
        return errorResponse('거절할 매칭 요청 상태를 찾을 수 없습니다.', 409)
      }

      const { error: reopenPartnerError } = await supabase
        .from('match_requests')
        .update({ status: 'waiting' })
        .eq('id', partnerRequest.id)
        .eq('status', 'matched')

      if (reopenPartnerError) {
        await supabase
          .from('match_requests')
          .update({ status: 'matched' })
          .eq('id', rejecterRequest.id)
          .eq('status', 'cancelled')

        return errorResponse('상대방 매칭 요청 복구에 실패했습니다.', 500)
      }
    }

    const { data: cancelledRows, error: rejectMatchError } = await supabase
      .from('matches')
      .update({ status: 'cancelled' })
      .eq('id', matchId)
      .eq('status', 'pending')
      .select('id')

    if (rejectMatchError) {
      await supabase
        .from('match_requests')
        .update({ status: 'matched' })
        .in('id', [rejecterRequest.id, partnerRequest.id])

      return errorResponse('매칭 거절 처리에 실패했습니다.', 500)
    }

    if (!cancelledRows?.length) {
      return resolveMatchStatusConflict(supabase, matchId)
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
