import { NextResponse } from 'next/server'
import { getUserIdFromRequest } from '@/lib/api-auth'
import type { MatchMovementStatus } from '@/lib/match-movement'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

interface MatchRow {
  id: string
  status: string
  seat_seek_request_id: string
  leaving_request_id: string
}

interface MovementBody {
  status?: unknown
}

const ALLOWED_STATUSES: MatchMovementStatus[] = ['moving', 'arrived']

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
 * PATCH /api/matches/[id]/movement-status — 착석 희망자 이동 상태 갱신
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

    let body: MovementBody
    try {
      body = (await request.json()) as MovementBody
    } catch {
      return errorResponse('요청 본문이 올바른 JSON이 아닙니다.', 400)
    }

    const status =
      typeof body.status === 'string' ? (body.status.trim() as MatchMovementStatus) : null

    if (!status || !ALLOWED_STATUSES.includes(status)) {
      return errorResponse("status는 'moving' 또는 'arrived' 여야 합니다.", 400)
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
      return errorResponse('이동 상태는 착석 희망자만 변경할 수 있습니다.', 403)
    }

    if (!['pending', 'accepted'].includes(match.status)) {
      return errorResponse('이동 상태를 변경할 수 없는 매칭입니다.', 409)
    }

    const updatedAt = new Date().toISOString()

    const { data: updatedRow, error: upsertError } = await supabase
      .from('match_movement_status')
      .upsert(
        {
          match_id: matchId,
          user_id: userId,
          status,
          updated_at: updatedAt,
        },
        { onConflict: 'match_id,user_id' }
      )
      .select('status, updated_at')
      .maybeSingle()

    if (upsertError || !updatedRow) {
      return errorResponse('이동 상태 저장에 실패했습니다.', 500)
    }

    return NextResponse.json({
      success: true,
      data: {
        match_id: matchId,
        status: updatedRow.status as MatchMovementStatus,
        updated_at: String(updatedRow.updated_at),
      },
    })
  } catch {
    return errorResponse('서버 오류가 발생했습니다.', 500)
  }
}
