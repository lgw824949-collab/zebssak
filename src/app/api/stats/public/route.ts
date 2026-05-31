import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

const EMPTY_STATS = {
  visitor_count: 0,
  member_count: 0,
  pwa_install_count: 0,
  display_count: 0,
}

async function countTable(
  table: string,
  filter?: { column: string; value: string }
): Promise<number | null> {
  try {
    const supabase = createSupabaseAdminClient()
    let query = supabase.from(table).select('id', { count: 'exact', head: true })

    if (filter) {
      query = query.eq(filter.column, filter.value)
    }

    const { count, error } = await query
    if (error) {
      return null
    }

    return count ?? 0
  } catch {
    return null
  }
}

/**
 * GET /api/stats/public — 홈 화면 누적 이용·가입·설치 수
 */
export async function GET() {
  try {
    const [visitorCount, memberCount, pwaInstallCount] = await Promise.all([
      countTable('app_installs'),
      countTable('users'),
      countTable('app_installs', { column: 'install_source', value: 'pwa_install' }),
    ])

    const visitor_count = visitorCount ?? 0
    const member_count = memberCount ?? 0
    const pwa_install_count = pwaInstallCount ?? 0
    const display_count = Math.max(visitor_count, member_count)

    return NextResponse.json({
      success: true,
      data: {
        visitor_count,
        member_count,
        pwa_install_count,
        display_count,
      },
    })
  } catch {
    return NextResponse.json({
      success: true,
      data: EMPTY_STATS,
    })
  }
}
