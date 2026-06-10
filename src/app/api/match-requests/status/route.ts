import { NextResponse } from 'next/server'
import { getUserIdFromRequest } from '@/lib/api-auth'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

function errorResponse(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status })
}

/**
 * GET /api/match-requests/status?request_id= — 대기 요청 상태 조회
 */
export async function GET(request: Request) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return errorResponse('로그인이 필요합니다.', 401)
    }

    const requestId = new URL(request.url).searchParams.get('request_id')?.trim()
    if (!requestId) {
      return errorResponse('request_id가 필요합니다.', 400)
    }

    const supabase = createSupabaseAdminClient()

    const { data: matchRequest, error: requestError } = await supabase
      .from('match_requests')
      .select(
        'id, request_type, status, remaining_stations, destination_station_id, train_id, car_number'
      )
      .eq('id', requestId)
      .eq('user_id', userId)
      .maybeSingle()

    if (requestError || !matchRequest) {
      return errorResponse('매칭 요청을 찾을 수 없습니다.', 404)
    }

    const { data: match } = await supabase
      .from('matches')
      .select('id, status, notify_expires_at')
      .or(
        `seat_seek_request_id.eq.${requestId},leaving_request_id.eq.${requestId}`
      )
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    let queuePosition: number | null = null
    if (matchRequest.request_type === 'seat_seek' && matchRequest.status === 'waiting') {
      const { data: waitingList } = await supabase
        .from('match_requests')
        .select('id, remaining_stations, requested_at, users(is_vulnerable)')
        .eq('status', 'waiting')
        .eq('request_type', 'seat_seek')

      if (waitingList) {
        const sorted = [...waitingList].sort((a, b) => {
          const aUser = Array.isArray(a.users) ? a.users[0] : a.users
          const bUser = Array.isArray(b.users) ? b.users[0] : b.users
          const aV = aUser?.is_vulnerable === true
          const bV = bUser?.is_vulnerable === true

          if (aV !== bV) return aV ? -1 : 1
          if (b.remaining_stations !== a.remaining_stations) {
            return b.remaining_stations - a.remaining_stations
          }
          return (
            new Date(a.requested_at as string).getTime() -
            new Date(b.requested_at as string).getTime()
          )
        })

        const index = sorted.findIndex((row) => row.id === requestId)
        queuePosition = index >= 0 ? index + 1 : sorted.length
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        match_request: matchRequest,
        queue_position: queuePosition,
        match: match ?? null,
      },
    })
  } catch {
    return errorResponse('서버 오류가 발생했습니다.', 500)
  }
}

interface PatchStatusBody {
  request_id?: unknown
  status?: unknown
}

/**
 * PATCH /api/match-requests/status — 대기 요청 취소
 */
export async function PATCH(request: Request) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return errorResponse('로그인이 필요합니다.', 401)
    }

    let body: PatchStatusBody
    try {
      body = (await request.json()) as PatchStatusBody
    } catch {
      return errorResponse('요청 본문이 올바른 JSON이 아닙니다.', 400)
    }

    const requestId =
      typeof body.request_id === 'string' ? body.request_id.trim() : ''
    const status =
      typeof body.status === 'string' ? body.status.trim() : 'cancelled'

    if (!requestId) {
      return errorResponse('request_id가 필요합니다.', 400)
    }

    if (status !== 'cancelled') {
      return errorResponse("status는 'cancelled'여야 합니다.", 400)
    }

    const supabase = createSupabaseAdminClient()

    const { data: updated, error: updateError } = await supabase
      .from('match_requests')
      .update({ status: 'cancelled' })
      .eq('id', requestId)
      .eq('user_id', userId)
      .select('id')
      .maybeSingle()

    if (updateError) {
      return errorResponse('요청 취소에 실패했습니다.', 500)
    }

    if (!updated) {
      return errorResponse('매칭 요청을 찾을 수 없습니다.', 404)
    }

    return NextResponse.json({ success: true })
  } catch {
    return errorResponse('서버 오류가 발생했습니다.', 500)
  }
}
