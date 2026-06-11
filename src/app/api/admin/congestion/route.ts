import { NextResponse } from 'next/server'
import { adminErrorResponse, requireAdmin } from '@/app/api/admin/_utils'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

interface CongestionBody {
  line_number?: unknown
  congestion_level?: unknown
}

/** 어드민·매칭 API 공통 — 서울 7호선 (DB line_number 버킷 2) */
const SERVICE_LINE_NUMBER = 2

/**
 * GET /api/admin/congestion — 서울 7호선 최신 혼잡도
 */
export async function GET(request: Request) {
  try {
    const denied = requireAdmin(request)
    if (denied) {
      return denied
    }

    const supabase = createSupabaseAdminClient()
    const latestByLine: Record<number, unknown> = {}

    const { data: latest, error } = await supabase
      .from('congestion_logs')
      .select('id, line_number, congestion_level, recorded_at')
      .eq('line_number', SERVICE_LINE_NUMBER)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      return adminErrorResponse('혼잡도 정보를 불러올 수 없습니다.', 500)
    }

    latestByLine[SERVICE_LINE_NUMBER] = latest

    const { data: recent, error: recentError } = await supabase
      .from('congestion_logs')
      .select('id, line_number, congestion_level, recorded_at')
      .eq('line_number', SERVICE_LINE_NUMBER)
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

    const lineNumberRaw = body.line_number
    if (
      lineNumberRaw !== undefined &&
      lineNumberRaw !== null &&
      lineNumberRaw !== '' &&
      Number(lineNumberRaw) !== SERVICE_LINE_NUMBER
    ) {
      return adminErrorResponse('현재 서울 7호선만 입력할 수 있습니다.', 400)
    }

    const congestionLevel =
      typeof body.congestion_level === 'number'
        ? body.congestion_level
        : Number(body.congestion_level)

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
        line_number: SERVICE_LINE_NUMBER,
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
