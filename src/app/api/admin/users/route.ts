import { NextResponse } from 'next/server'
import { adminErrorResponse, requireAdmin } from '@/app/api/admin/_utils'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

/**
 * GET /api/admin/users — 유저 목록
 */
export async function GET(request: Request) {
  try {
    const denied = requireAdmin(request)
    if (denied) {
      return denied
    }

    const supabase = createSupabaseAdminClient()

    const { data, error } = await supabase
      .from('users')
      .select(
        'id, username, nickname, is_vulnerable, no_show_count, suspended_until, total_points, created_at'
      )
      .order('created_at', { ascending: false })
      .limit(200)

    if (error) {
      return adminErrorResponse('유저 목록을 불러올 수 없습니다.', 500)
    }

    return NextResponse.json({ success: true, data: data ?? [] })
  } catch {
    return adminErrorResponse('서버 오류가 발생했습니다.', 500)
  }
}
