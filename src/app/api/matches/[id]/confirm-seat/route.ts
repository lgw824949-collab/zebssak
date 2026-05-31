import { NextResponse } from 'next/server'
import { getUserIdFromRequest } from '@/lib/api-auth'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

interface MatchRow {
  id: string
  status: string
  seat_seek_request_id: string
  leaving_request_id: string
}

interface ConfirmBody {
  seated?: unknown
}

function errorResponse(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status })
}

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
 * POST /api/matches/[id]/confirm-seat — 착석 희망자 자리 확인
 */
export async function POST(
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

    let body: ConfirmBody
    try {
      body = (await request.json()) as ConfirmBody
    } catch {
      return errorResponse('요청 본문이 올바른 JSON이 아닙니다.', 400)
    }

    if (typeof body.seated !== 'boolean') {
      return errorResponse('seated는 true 또는 false 여야 합니다.', 400)
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

    const isSeeker = await isSeatSeekerForMatch(supabase, match, userId)
    if (!isSeeker) {
      return errorResponse('자리 확인은 착석 희망자만 할 수 있습니다.', 403)
    }

    if (!['accepted', 'completed'].includes(match.status)) {
      return errorResponse('확인할 수 없는 매칭 상태입니다.', 409)
    }

    const { data: existing, error: existingError } = await supabase
      .from('match_seat_confirmations')
      .select('id, seated')
      .eq('match_id', matchId)
      .eq('user_id', userId)
      .maybeSingle()

    if (existingError) {
      return errorResponse('확인 내역을 조회할 수 없습니다.', 500)
    }

    if (existing) {
      return NextResponse.json({
        success: true,
        data: {
          match_id: matchId,
          seated: existing.seated as boolean,
          already_submitted: true,
        },
      })
    }

    const { error: insertError } = await supabase.from('match_seat_confirmations').insert({
      match_id: matchId,
      user_id: userId,
      seated: body.seated,
    })

    if (insertError) {
      return errorResponse('자리 확인 저장에 실패했습니다.', 500)
    }

    if (match.status === 'accepted') {
      await supabase
        .from('matches')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
        })
        .eq('id', matchId)
        .eq('status', 'accepted')
    }

    return NextResponse.json({
      success: true,
      data: {
        match_id: matchId,
        seated: body.seated,
        already_submitted: false,
      },
    })
  } catch {
    return errorResponse('서버 오류가 발생했습니다.', 500)
  }
}
