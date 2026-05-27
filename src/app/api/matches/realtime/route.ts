import { getUserIdFromRequest } from '@/lib/api-auth'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import type { RealtimeChannel } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET /api/matches/realtime?request_id=
 * matches 테이블 INSERT를 Supabase Realtime으로 감지해 SSE 전송
 */
export async function GET(request: Request) {
  const userId = getUserIdFromRequest(request)
  if (!userId) {
    return new Response('Unauthorized', { status: 401 })
  }

  const requestId = new URL(request.url).searchParams.get('request_id')?.trim()
  if (!requestId) {
    return new Response('request_id required', { status: 400 })
  }

  const supabase = createSupabaseAdminClient()

  const { data: matchRequest } = await supabase
    .from('match_requests')
    .select('id, user_id, request_type')
    .eq('id', requestId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!matchRequest || matchRequest.request_type !== 'seat_seek') {
    return new Response('Forbidden', { status: 403 })
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: object) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)
        )
      }

      const { data: existingMatch } = await supabase
        .from('matches')
        .select('id, status')
        .eq('seat_seek_request_id', requestId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (existingMatch?.id) {
        send({ type: 'matched', match_id: existingMatch.id })
        controller.close()
        return
      }

      let channel: RealtimeChannel | null = null
      let closed = false

      const cleanup = () => {
        if (closed) return
        closed = true
        if (channel) {
          supabase.removeChannel(channel)
        }
        try {
          controller.close()
        } catch {
          // 이미 닫힌 스트림
        }
      }

      channel = supabase
        .channel(`matches-seeker-${requestId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'matches',
            filter: `seat_seek_request_id=eq.${requestId}`,
          },
          (payload) => {
            const row = payload.new as { id?: string }
            if (row.id) {
              send({ type: 'matched', match_id: row.id })
            }
            cleanup()
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'matches',
            filter: `seat_seek_request_id=eq.${requestId}`,
          },
          (payload) => {
            const row = payload.new as { id?: string; status?: string }
            if (row.id && row.status !== 'cancelled') {
              send({ type: 'matched', match_id: row.id })
              cleanup()
            }
          }
        )
        .subscribe((status) => {
          if (status === 'CHANNEL_ERROR') {
            send({ type: 'error', message: 'Realtime 연결에 실패했습니다.' })
            cleanup()
          }
        })

      request.signal.addEventListener('abort', cleanup)

      const keepAlive = setInterval(() => {
        if (closed) {
          clearInterval(keepAlive)
          return
        }
        send({ type: 'ping' })
      }, 25000)

      request.signal.addEventListener('abort', () => clearInterval(keepAlive))
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
