import { NextResponse } from 'next/server'
import { getUserIdFromRequest } from '@/lib/api-auth'
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
