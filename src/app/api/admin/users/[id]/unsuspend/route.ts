import { NextResponse } from 'next/server'
import { adminErrorResponse, requireAdmin } from '@/app/api/admin/_utils'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

/**
 * POST /api/admin/users/[id]/unsuspend — 이용 정지 해제
 */
export async function POST(
  request: Request,
  context: { params: { id: string } }
) {
  try {
    const denied = requireAdmin(request)
    if (denied) {
      return denied
    }

    const userId = context.params.id?.trim()
    if (!userId) {
      return adminErrorResponse('유저 ID가 필요합니다.', 400)
    }

    const supabase = createSupabaseAdminClient()

    const { data, error } = await supabase
      .from('users')
      .update({ suspended_until: null })
      .eq('id', userId)
      .select('id, username, no_show_count, suspended_until')
      .maybeSingle()

    if (error) {
      return adminErrorResponse('정지 해제에 실패했습니다.', 500)
    }

    if (!data) {
      return adminErrorResponse('유저를 찾을 수 없습니다.', 404)
    }

    return NextResponse.json({ success: true, data })
  } catch {
    return adminErrorResponse('서버 오류가 발생했습니다.', 500)
  }
}
