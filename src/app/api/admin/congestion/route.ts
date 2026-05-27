import { NextResponse } from 'next/server'
import { adminErrorResponse, requireAdmin } from '@/app/api/admin/_utils'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

interface CongestionBody {
  line_number?: unknown
  congestion_level?: unknown
}

/**
 * GET /api/admin/congestion — 호선별 최신 혼잡도
 */
export async function GET(request: Request) {
  try {
    const denied = requireAdmin(request)
    if (denied) {
      return denied
    }

    const supabase = createSupabaseAdminClient()
    const lines = [1, 2] as const
    const latestByLine: Record<number, unknown> = {}

    for (const lineNumber of lines) {
      const { data, error } = await supabase
        .from('congestion_logs')
        .select('id, line_number, congestion_level, recorded_at')
        .eq('line_number', lineNumber)
        .order('recorded_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (error) {
        return adminErrorResponse('혼잡도 정보를 불러올 수 없습니다.', 500)
      }

      latestByLine[lineNumber] = data
    }

    const { data: recent, error: recentError } = await supabase
      .from('congestion_logs')
      .select('id, line_number, congestion_level, recorded_at')
      .order('recorded_at', { ascending: false })
      .limit(20)

    if (recentError) {
      return adminErrorResponse('혼잡도 이력을 불러올 수 없습니다.', 500)
    }

    return NextResponse.json({
      success: true,
      data: {
        latest_by_line: latestByLine,
        recent: recent ?? [],
      },
    })
  } catch {
    return adminErrorResponse('서버 오류가 발생했습니다.', 500)
  }
}

/**
 * POST /api/admin/congestion — 혼잡도 수동 입력
 */
export async function POST(request: Request) {
  try {
    const denied = requireAdmin(request)
    if (denied) {
      return denied
    }

    let body: CongestionBody
    try {
      body = (await request.json()) as CongestionBody
    } catch {
      return adminErrorResponse('요청 본문이 올바른 JSON이 아닙니다.', 400)
    }

    const lineNumber =
      typeof body.line_number === 'number'
        ? body.line_number
        : Number(body.line_number)
    const congestionLevel =
      typeof body.congestion_level === 'number'
        ? body.congestion_level
        : Number(body.congestion_level)

    if (!Number.isInteger(lineNumber) || (lineNumber !== 1 && lineNumber !== 2)) {
      return adminErrorResponse('line_number는 1 또는 2여야 합니다.', 400)
    }

    if (
      !Number.isInteger(congestionLevel) ||
      congestionLevel < 1 ||
      congestionLevel > 10
    ) {
      return adminErrorResponse('congestion_level은 1~10 사이여야 합니다.', 400)
    }

    const supabase = createSupabaseAdminClient()

    const { data, error } = await supabase
      .from('congestion_logs')
      .insert({
        line_number: lineNumber,
        congestion_level: congestionLevel,
      })
      .select('id, line_number, congestion_level, recorded_at')
      .single()

    if (error || !data) {
      return adminErrorResponse('혼잡도 기록에 실패했습니다.', 500)
    }

    return NextResponse.json({ success: true, data }, { status: 201 })
  } catch {
    return adminErrorResponse('서버 오류가 발생했습니다.', 500)
  }
}
