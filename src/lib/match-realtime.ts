/**
 * matches Realtime SSE 구독 (서버 프록시)
 */
function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}

export async function subscribeMatchRealtime(
  requestId: string,
  token: string,
  onMatched: (matchId: string) => void,
  onError: (message: string) => void,
  signal: AbortSignal
): Promise<void> {
  try {
    const response = await fetch(
      `/api/matches/realtime?request_id=${encodeURIComponent(requestId)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal,
      }
    )

    if (signal.aborted) {
      return
    }

    if (!response.ok || !response.body) {
      onError('Realtime 연결에 실패했습니다.')
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      buffer += decoder.decode(value, { stream: true })
      const chunks = buffer.split('\n\n')
      buffer = chunks.pop() ?? ''

      for (const chunk of chunks) {
        const line = chunk
          .split('\n')
          .find((entry) => entry.startsWith('data: '))
        if (!line) continue

        try {
          const payload = JSON.parse(line.slice(6)) as {
            type?: string
            match_id?: string
            message?: string
          }

          if (payload.type === 'matched' && payload.match_id) {
            onMatched(payload.match_id)
            return
          }
          if (payload.type === 'error' && payload.message) {
            onError(payload.message)
            return
          }
        } catch {
          onError('Realtime 메시지 처리에 실패했습니다.')
          return
        }
      }
    }
  } catch (err) {
    if (isAbortError(err) || signal.aborted) {
      return
    }
    onError('Realtime 연결에 실패했습니다.')
  }
}
