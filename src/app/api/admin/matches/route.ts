import { NextResponse } from 'next/server'
import { adminErrorResponse, requireAdmin } from '@/app/api/admin/_utils'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

type MatchPeriod = 'today' | '7d' | 'all'
type MatchStatusFilter = 'pending' | 'active' | 'completed' | 'expired' | 'all'

/** 한국 시간 기준 오늘 00:00 (ISO) */
function getKoreaStartOfDayIso(): string {
  const dateKey = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
  return new Date(`${dateKey}T00:00:00+09:00`).toISOString()
}

function parsePeriod(value: string | null): MatchPeriod {
  if (value === '7d' || value === 'all') {
    return value
  }
  return 'today'
}

function parseStatusFilter(value: string | null): MatchStatusFilter {
  if (
    value === 'active' ||
    value === 'completed' ||
    value === 'expired' ||
    value === 'all'
  ) {
    return value
  }
  return 'pending'
}

/**
 * GET /api/admin/matches — 매칭 현황 목록
 * Query: period=today|7d|all (기본 today), status=pending|active|completed|expired|all (기본 pending)
 */
export async function GET(request: Request) {
  try {
    const denied = requireAdmin(request)
    if (denied) {
      return denied
    }

    const { searchParams } = new URL(request.url)
    const period = parsePeriod(searchParams.get('period'))
    const statusFilter = parseStatusFilter(searchParams.get('status'))

    const supabase = createSupabaseAdminClient()

    let query = supabase
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

    if (period === 'today') {
      query = query.gte('created_at', getKoreaStartOfDayIso())
    } else if (period === '7d') {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
      query = query.gte('created_at', weekAgo)
    }

    if (statusFilter === 'active') {
      query = query.in('status', ['pending', 'accepted'])
    } else if (statusFilter !== 'all') {
      query = query.eq('status', statusFilter)
    }

    const { data, error } = await query
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
