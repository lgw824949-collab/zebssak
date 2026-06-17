import type { SupabaseClient } from '@supabase/supabase-js'

interface MatchRow {
  id: string
  status: string
  seat_seek_request_id: string
  leaving_request_id: string
}

/** 매칭 완료 시 matches·match_requests를 종료 상태로 정리합니다. */
export async function finalizeMatchCompletion(
  supabase: SupabaseClient,
  matchId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data: matchRaw, error: matchError } = await supabase
    .from('matches')
    .select('id, status, seat_seek_request_id, leaving_request_id')
    .eq('id', matchId)
    .maybeSingle()

  if (matchError || !matchRaw) {
    return { ok: false, message: '매칭을 찾을 수 없습니다.' }
  }

  const match = matchRaw as MatchRow
  if (!['accepted', 'completed'].includes(match.status)) {
    return { ok: false, message: '완료할 수 없는 매칭 상태입니다.' }
  }

  const completedAt = new Date().toISOString()

  if (match.status === 'accepted') {
    const { error: updateMatchError } = await supabase
      .from('matches')
      .update({
        status: 'completed',
        completed_at: completedAt,
      })
      .eq('id', matchId)
      .eq('status', 'accepted')

    if (updateMatchError) {
      return { ok: false, message: '매칭 완료 처리에 실패했습니다.' }
    }
  }

  const requestIds = [match.seat_seek_request_id, match.leaving_request_id]
  await supabase
    .from('match_requests')
    .update({ status: 'cancelled', cancelled_at: completedAt })
    .in('id', requestIds)
    .in('status', ['matched', 'waiting'])

  return { ok: true }
}
