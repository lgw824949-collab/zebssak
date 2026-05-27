import { NextResponse } from 'next/server'
import { getUserIdFromRequest } from '@/lib/api-auth'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

interface MatchRow {
  id: string
  status: string
  seat_seek_request_id: string
  leaving_request_id: string
  notify_expires_at: string
}

interface MatchRequestUserRow {
  id: string
  user_id: string
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
 * POST /api/matches/[id]/expire — 30초 수락 타임아웃 시 매칭 만료·노쇼 처리
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

    const supabase = createSupabaseAdminClient()

    const { data: match, error: matchError } = await supabase
      .from('matches')
      .select(
        'id, status, seat_seek_request_id, leaving_request_id, notify_expires_at'
      )
      .eq('id', matchId)
      .maybeSingle()

    if (matchError) {
      return errorResponse('매칭 정보를 조회할 수 없습니다.', 500)
    }

    if (!match) {
      return errorResponse('매칭을 찾을 수 없습니다.', 404)
    }

    const matchRow = match as MatchRow

    const isParticipant = await isMatchParticipant(supabase, matchRow, userId)
    if (!isParticipant) {
      return errorResponse('이 매칭에 접근할 수 없습니다.', 403)
    }

    if (matchRow.status === 'expired') {
      return NextResponse.json({
        success: true,
        data: { match_id: matchId, already_expired: true },
      })
    }

    if (matchRow.status !== 'pending') {
      return errorResponse('만료할 수 없는 매칭 상태입니다.', 409)
    }

    const { data: seekerRequest, error: seekerError } = await supabase
      .from('match_requests')
      .select('id, user_id')
      .eq('id', matchRow.seat_seek_request_id)
      .maybeSingle()

    if (seekerError || !seekerRequest) {
      return errorResponse('착석 희망 요청 정보를 찾을 수 없습니다.', 500)
    }

    const seeker = seekerRequest as MatchRequestUserRow

    const { error: updateError } = await supabase
      .from('matches')
      .update({ status: 'expired' })
      .eq('id', matchId)
      .eq('status', 'pending')

    if (updateError) {
      return errorResponse('매칭 만료 처리에 실패했습니다.', 500)
    }

    const { error: noshowError } = await supabase.rpc('handle_noshow', {
      p_user_id: seeker.user_id,
    })

    if (noshowError) {
      if (noshowError.message?.includes('handle_noshow')) {
        return errorResponse(
          'handle_noshow 함수가 DB에 없습니다. Supabase migration을 실행해주세요.',
          500
        )
      }
      return errorResponse('노쇼 처리에 실패했습니다.', 500)
    }

    return NextResponse.json({
      success: true,
      data: {
        match_id: matchId,
        no_show_user_id: seeker.user_id,
      },
    })
  } catch {
    return errorResponse('서버 오류가 발생했습니다.', 500)
  }
}
