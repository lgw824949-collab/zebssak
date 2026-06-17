import { NextResponse } from 'next/server'
import { getUserIdFromRequest } from '@/lib/api-auth'
import { finalizeMatchCompletion } from '@/lib/finalize-match-completion'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

function errorResponse(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status })
}

/**
 * PATCH /api/matches/[id]/complete — 양보·착석 완료 후 매칭 종료
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return errorResponse('로그인이 필요합니다.', 401)
    }

    const { id: matchId } = await context.params
    const trimmedId = matchId?.trim()
    if (!trimmedId) {
      return errorResponse('매칭 ID가 필요합니다.', 400)
    }

    const supabase = createSupabaseAdminClient()

    const { data: matchRaw, error: matchError } = await supabase
      .from('matches')
      .select('id, seat_seek_request_id, leaving_request_id')
      .eq('id', trimmedId)
      .maybeSingle()

    if (matchError || !matchRaw) {
      return errorResponse('매칭을 찾을 수 없습니다.', 404)
    }

    const { data: participantRows, error: participantError } = await supabase
      .from('match_requests')
      .select('user_id')
      .in('id', [matchRaw.seat_seek_request_id, matchRaw.leaving_request_id])

    if (participantError || !participantRows?.some((row) => row.user_id === userId)) {
      return errorResponse('이 매칭에 접근할 수 없습니다.', 403)
    }

    const result = await finalizeMatchCompletion(supabase, trimmedId)
    if (!result.ok) {
      return errorResponse(result.message, 409)
    }

    return NextResponse.json({
      success: true,
      data: { match_id: trimmedId, status: 'completed' },
    })
  } catch {
    return errorResponse('서버 오류가 발생했습니다.', 500)
  }
}
