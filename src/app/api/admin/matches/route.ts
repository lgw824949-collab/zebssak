import { NextResponse } from 'next/server'
import { adminErrorResponse, requireAdmin } from '@/app/api/admin/_utils'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

/**
 * GET /api/admin/matches — 매칭 현황 목록
 */
export async function GET(request: Request) {
  try {
    const denied = requireAdmin(request)
    if (denied) {
      return denied
    }

    const supabase = createSupabaseAdminClient()

    const { data, error } = await supabase
      .from('matches')
      .select(
        `
        id,
        status,
        notify_expires_at,
        accepted_at,
        completed_at,
        created_at,
        seat_seek_request:match_requests!seat_seek_request_id(
          id,
          status,
          request_type,
          car_number,
          user:users(id, username, nickname)
        ),
        leaving_request:match_requests!leaving_request_id(
          id,
          status,
          request_type,
          car_number,
          user:users(id, username, nickname)
        )
      `
      )
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) {
      return adminErrorResponse('매칭 목록을 불러올 수 없습니다.', 500)
    }

    return NextResponse.json({ success: true, data: data ?? [] })
  } catch {
    return adminErrorResponse('서버 오류가 발생했습니다.', 500)
  }
}
