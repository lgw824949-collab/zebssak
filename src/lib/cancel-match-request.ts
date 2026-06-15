import type { SupabaseClient } from '@supabase/supabase-js'

type CancelResult =
  | { ok: true; alreadyCancelled?: boolean }
  | { ok: false; message: string; status: number }

interface MatchLinkRow {
  id: string
  status: string
  seat_seek_request_id: string
  leaving_request_id: string
}

/**
 * match_request 취소 — 대기·수락 대기·진행 중 매칭 모두 처리합니다.
 * 연결된 매칭이 있으면 cancelled로 종료하고 상대 요청은 waiting으로 복귀시킵니다.
 */
export async function cancelMatchRequestForUser(
  supabase: SupabaseClient,
  requestId: string,
  userId: string
): Promise<CancelResult> {
  const { data: requestRow, error: requestError } = await supabase
    .from('match_requests')
    .select('id, status')
    .eq('id', requestId)
    .eq('user_id', userId)
    .maybeSingle()

  if (requestError) {
    return { ok: false, message: '매칭 요청 조회에 실패했습니다.', status: 500 }
  }

  if (!requestRow) {
    return { ok: false, message: '매칭 요청을 찾을 수 없습니다.', status: 404 }
  }

  const currentStatus = String(requestRow.status ?? '')

  if (currentStatus === 'cancelled') {
    return { ok: true, alreadyCancelled: true }
  }

  if (currentStatus !== 'waiting' && currentStatus !== 'matched') {
    return { ok: false, message: '취소할 수 없는 요청 상태입니다.', status: 409 }
  }

  const cancelledAt = new Date().toISOString()

  const { data: matchRaw, error: matchError } = await supabase
    .from('matches')
    .select('id, status, seat_seek_request_id, leaving_request_id')
    .or(`seat_seek_request_id.eq.${requestId},leaving_request_id.eq.${requestId}`)
    .in('status', ['pending', 'accepted'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (matchError) {
    return { ok: false, message: '연결된 매칭 조회에 실패했습니다.', status: 500 }
  }

  const linkedMatch = matchRaw as MatchLinkRow | null

  if (linkedMatch?.id) {
    const partnerRequestId =
      linkedMatch.seat_seek_request_id === requestId
        ? linkedMatch.leaving_request_id
        : linkedMatch.seat_seek_request_id

    const { data: cancelledSelf, error: cancelSelfError } = await supabase
      .from('match_requests')
      .update({ status: 'cancelled', cancelled_at: cancelledAt })
      .eq('id', requestId)
      .eq('user_id', userId)
      .in('status', ['waiting', 'matched'])
      .select('id')
      .maybeSingle()

    if (cancelSelfError) {
      return { ok: false, message: '요청 취소에 실패했습니다.', status: 500 }
    }

    if (!cancelledSelf) {
      return { ok: false, message: '취소할 매칭 요청 상태를 찾을 수 없습니다.', status: 409 }
    }

    const { error: reopenPartnerError } = await supabase
      .from('match_requests')
      .update({ status: 'waiting' })
      .eq('id', partnerRequestId)
      .eq('status', 'matched')

    if (reopenPartnerError) {
      await supabase
        .from('match_requests')
        .update({ status: 'matched', cancelled_at: null })
        .eq('id', requestId)
        .eq('status', 'cancelled')

      return { ok: false, message: '상대방 매칭 요청 복구에 실패했습니다.', status: 500 }
    }

    const { data: cancelledMatchRows, error: cancelMatchError } = await supabase
      .from('matches')
      .update({ status: 'cancelled' })
      .eq('id', linkedMatch.id)
      .in('status', ['pending', 'accepted'])
      .select('id')

    if (cancelMatchError) {
      await supabase
        .from('match_requests')
        .update({ status: 'matched', cancelled_at: null })
        .eq('id', requestId)
        .eq('status', 'cancelled')
      await supabase
        .from('match_requests')
        .update({ status: 'matched' })
        .eq('id', partnerRequestId)
        .eq('status', 'waiting')

      return { ok: false, message: '연결된 매칭 취소에 실패했습니다.', status: 500 }
    }

    if (!cancelledMatchRows?.length) {
      return { ok: false, message: '취소할 수 없는 매칭 상태입니다.', status: 409 }
    }

    return { ok: true }
  }

  const { data: cancelledWaiting, error: cancelWaitingError } = await supabase
    .from('match_requests')
    .update({ status: 'cancelled', cancelled_at: cancelledAt })
    .eq('id', requestId)
    .eq('user_id', userId)
    .eq('status', 'waiting')
    .select('id')
    .maybeSingle()

  if (cancelWaitingError) {
    return { ok: false, message: '요청 취소에 실패했습니다.', status: 500 }
  }

  if (!cancelledWaiting) {
    return { ok: false, message: '매칭 요청을 찾을 수 없습니다.', status: 404 }
  }

  return { ok: true }
}

/** 클라이언트에서 match_request 취소 API를 호출합니다. */
export async function cancelMatchRequestClient(
  token: string,
  requestId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch('/api/match-requests/status', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ request_id: requestId, status: 'cancelled' }),
      cache: 'no-store',
    })

    const payload = (await response.json()) as {
      success?: boolean
      error?: string
    }

    if (!response.ok || !payload.success) {
      return {
        success: false,
        error: payload.error ?? '요청 취소에 실패했습니다.',
      }
    }

    return { success: true }
  } catch {
    return { success: false, error: '요청 취소 중 오류가 발생했습니다.' }
  }
}
