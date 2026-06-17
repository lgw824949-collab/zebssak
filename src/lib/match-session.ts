/** 매칭·대기 관련 sessionStorage 키 (완료 힌트는 별도 관리) */
export const MATCH_CLIENT_SESSION_KEYS = [
  'activeMatchId',
  'activeMatchRequestId',
  'boardingDraft',
  'waitingDraft',
  'providerRegistered',
  'seekerMatchRequestRegistered',
] as const

/** 로그아웃·거절·취소 시 매칭 클라이언트 session을 정리합니다. */
export function clearMatchClientSession(): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    for (const key of MATCH_CLIENT_SESSION_KEYS) {
      sessionStorage.removeItem(key)
    }
  } catch {
    // sessionStorage 정리 실패 시 무시합니다.
  }
}

export type ActiveMatchNavigationTarget = 'matching' | 'matched' | 'none'

/**
 * 저장된 matchId가 아직 활성 매칭인지 서버에서 확인합니다.
 */
export async function resolveActiveMatchNavigationTarget(
  token: string,
  matchId: string,
  requestId?: string | null,
  signal?: AbortSignal
): Promise<ActiveMatchNavigationTarget> {
  try {
    if (requestId) {
      const statusResponse = await fetch(
        `/api/match-requests/status?request_id=${encodeURIComponent(requestId)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
          signal,
        }
      )

      const statusPayload = (await statusResponse.json()) as {
        success?: boolean
        data?: {
          match_request?: { status?: string } | null
          match?: { id?: string; status?: string } | null
        }
      }

      if (!statusResponse.ok || !statusPayload.success) {
        return 'none'
      }

      const requestStatus = statusPayload.data?.match_request?.status
      if (requestStatus === 'cancelled') {
        return 'none'
      }

      const match = statusPayload.data?.match
      if (!match?.id || match.id !== matchId) {
        return 'none'
      }

      if (match.status === 'accepted') {
        return 'matched'
      }

      if (match.status === 'pending' && requestStatus === 'matched') {
        return 'matching'
      }

      return 'none'
    }

    const matchResponse = await fetch(`/api/matches/${encodeURIComponent(matchId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal,
    })

    const matchPayload = (await matchResponse.json()) as {
      success?: boolean
      data?: {
        status?: string
        self?: { request_id?: string }
      }
    }

    if (!matchResponse.ok || !matchPayload.success) {
      return 'none'
    }

    const matchStatus = matchPayload.data?.status
    const selfRequestId = matchPayload.data?.self?.request_id

    if (selfRequestId) {
      const statusResponse = await fetch(
        `/api/match-requests/status?request_id=${encodeURIComponent(selfRequestId)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
          signal,
        }
      )

      const statusPayload = (await statusResponse.json()) as {
        success?: boolean
        data?: {
          match_request?: { status?: string } | null
          match?: { id?: string; status?: string } | null
        }
      }

      if (statusResponse.ok && statusPayload.success) {
        const requestStatus = statusPayload.data?.match_request?.status
        if (requestStatus === 'cancelled') {
          return 'none'
        }

        const linkedMatch = statusPayload.data?.match
        if (linkedMatch?.id === matchId) {
          if (linkedMatch.status === 'accepted') {
            return 'matched'
          }
          if (linkedMatch.status === 'pending' && requestStatus === 'matched') {
            return 'matching'
          }
        }
      }
    }

    if (matchStatus === 'accepted') {
      return 'matched'
    }

    if (matchStatus === 'pending') {
      return 'none'
    }

    return 'none'
  } catch {
    return 'none'
  }
}
