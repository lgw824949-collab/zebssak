import { finalizeMatchCompletion } from '@/lib/finalize-match-completion'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

type RepairResult = 'active' | 'cancelled' | 'waiting' | 'unchanged'

/**
 * matched 요청이 유효한 활성 매칭과 연결돼 있는지 확인하고 stale 상태를 복구합니다.
 */
export async function repairStaleMatchedRequest(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  requestId: string
): Promise<RepairResult> {
  const { data: requestRow, error: requestError } = await supabase
    .from('match_requests')
    .select('status')
    .eq('id', requestId)
    .maybeSingle()

  if (requestError || !requestRow) {
    return 'unchanged'
  }

  const requestStatus = String(requestRow.status ?? '')
  if (requestStatus !== 'matched') {
    return requestStatus === 'cancelled' ? 'cancelled' : 'unchanged'
  }

  const { data: latestMatch, error: matchError } = await supabase
    .from('matches')
    .select('id, status, seat_seek_request_id, leaving_request_id')
    .or(`seat_seek_request_id.eq.${requestId},leaving_request_id.eq.${requestId}`)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (matchError) {
    return 'unchanged'
  }

  const matchStatus = String(latestMatch?.status ?? '')
  if (matchStatus === 'pending' || matchStatus === 'accepted') {
    return 'active'
  }

  if (matchStatus === 'completed') {
    if (latestMatch?.id) {
      await finalizeMatchCompletion(supabase, latestMatch.id as string)
    }
    return 'cancelled'
  }

  if (matchStatus === 'cancelled') {
    await supabase
      .from('match_requests')
      .update({ status: 'cancelled' })
      .eq('id', requestId)
      .eq('status', 'matched')

    return 'cancelled'
  }

  await supabase
    .from('match_requests')
    .update({ status: 'waiting' })
    .eq('id', requestId)
    .eq('status', 'matched')

  return 'waiting'
}

/**
 * waiting 상태인데 최근 매칭이 이미 completed면 잘못 복구된 요청을 종료합니다.
 */
export async function repairWaitingRequestAfterCompletedMatch(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  requestId: string
): Promise<RepairResult> {
  const { data: requestRow, error: requestError } = await supabase
    .from('match_requests')
    .select('status')
    .eq('id', requestId)
    .maybeSingle()

  if (requestError || !requestRow) {
    return 'unchanged'
  }

  const requestStatus = String(requestRow.status ?? '')
  if (requestStatus !== 'waiting') {
    return requestStatus === 'cancelled' ? 'cancelled' : 'unchanged'
  }

  const { data: latestMatch, error: matchError } = await supabase
    .from('matches')
    .select('id, status')
    .or(`seat_seek_request_id.eq.${requestId},leaving_request_id.eq.${requestId}`)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (matchError) {
    return 'unchanged'
  }

  if (String(latestMatch?.status ?? '') === 'completed' && latestMatch?.id) {
    await finalizeMatchCompletion(supabase, latestMatch.id as string)
    return 'cancelled'
  }

  return 'unchanged'
}
