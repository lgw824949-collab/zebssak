import { NextResponse } from 'next/server'
import { adminErrorResponse, requireAdmin } from '@/app/api/admin/_utils'
import {
  classifyAdminUser,
  countUsersByCategory,
  filterUsersByCategory,
  parseUserCategoryFilter,
} from '@/app/api/admin/user-categories'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

const USER_FETCH_LIMIT = 300
const USER_RESPONSE_LIMIT = 200

/**
 * GET /api/admin/users — 유저 목록 (분류 포함)
 * Query: category=all|real|new|test|vulnerable|suspended|warning|risk (기본 real)
 */
export async function GET(request: Request) {
  try {
    const denied = requireAdmin(request)
    if (denied) {
      return denied
    }

    const { searchParams } = new URL(request.url)
    const categoryFilter = parseUserCategoryFilter(searchParams.get('category'))

    const supabase = createSupabaseAdminClient()

    const { data, error } = await supabase
      .from('users')
      .select(
        'id, username, nickname, is_vulnerable, no_show_count, suspended_until, total_points, created_at'
      )
      .order('created_at', { ascending: false })
      .limit(USER_FETCH_LIMIT)

    if (error) {
      return adminErrorResponse('유저 목록을 불러올 수 없습니다.', 500)
    }

    const enriched = (data ?? []).map((row) => ({
      ...row,
      categories: classifyAdminUser(row),
    }))

    const counts = countUsersByCategory(enriched)
    const filtered = filterUsersByCategory(enriched, categoryFilter).slice(
      0,
      USER_RESPONSE_LIMIT
    )

    return NextResponse.json({
      success: true,
      data: filtered,
      meta: {
        category: categoryFilter,
        total_fetched: enriched.length,
        counts,
      },
    })
  } catch {
    return adminErrorResponse('서버 오류가 발생했습니다.', 500)
  }
}
