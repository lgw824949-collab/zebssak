import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

function buildDefaultCongestionPayload() {
  return {
    latest_by_line: {
      1: null,
      2: null,
    },
    lines: [
      { line_number: 1, congestion_level: 0, recorded_at: null },
      { line_number: 2, congestion_level: 0, recorded_at: null },
    ],
    halted_by_line: { 1: false, 2: false },
    waiting_count: 0,
    degraded: true as const,
  }
}

/**
 * GET /api/congestion
 * - congestion_logs 최신 혼잡도
 * - 대기 인원(waiting_count)
 * - DB·RPC 오류 시 기본값 반환 (로컬·일시 장애에서도 화면은 동작)
 */
export async function GET() {
  try {
    const supabase = createSupabaseAdminClient()

    const lines = [1, 2] as const
    const latestByLine: Record<number, { congestion_level: number; recorded_at: string } | null> = {
      1: null,
      2: null,
    }

    for (const lineNumber of lines) {
      const { data, error } = await supabase
        .from('congestion_logs')
        .select('line_number, congestion_level, recorded_at')
        .eq('line_number', lineNumber)
        .order('recorded_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (error) {
        return NextResponse.json({
          success: true,
          data: buildDefaultCongestionPayload(),
        })
      }

      if (data) {
        latestByLine[lineNumber] = {
          congestion_level: Number(data.congestion_level ?? 0),
          recorded_at: String(data.recorded_at),
        }
      }
    }

    const lineSummaries = lines.map((lineNumber) => ({
      line_number: lineNumber,
      congestion_level: latestByLine[lineNumber]?.congestion_level ?? 0,
      recorded_at: latestByLine[lineNumber]?.recorded_at ?? null,
    }))

    const haltedByLine: Record<number, boolean> = { 1: false, 2: false }
    for (const lineNumber of lines) {
      const { data: halted, error: haltError } = await supabase.rpc('is_congestion_halted', {
        p_line_number: lineNumber,
      })
      if (haltError) {
        return NextResponse.json({
          success: true,
          data: {
            latest_by_line: latestByLine,
            lines: lineSummaries,
            halted_by_line: haltedByLine,
            waiting_count: 0,
            degraded: true,
          },
        })
      }
      haltedByLine[lineNumber] = halted === true
    }

    const { count: waitingCountRaw, error: waitingCountError } = await supabase
      .from('match_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'waiting')
      .eq('request_type', 'seat_seek')

    if (waitingCountError) {
      return NextResponse.json({
        success: true,
        data: {
          latest_by_line: latestByLine,
          lines: lineSummaries,
          halted_by_line: haltedByLine,
          waiting_count: 0,
          degraded: true,
        },
      })
    }

    return NextResponse.json({
      success: true,
      data: {
        latest_by_line: latestByLine,
        lines: lineSummaries,
        halted_by_line: haltedByLine,
        waiting_count: waitingCountRaw ?? 0,
      },
    })
  } catch {
    return NextResponse.json({
      success: true,
      data: buildDefaultCongestionPayload(),
    })
  }
}
