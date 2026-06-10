import type { SupabaseClient } from '@supabase/supabase-js'
import type { PushPayload, StoredPushSubscription } from '@/lib/push'

const VAPID_SUBJECT_FALLBACK = 'mailto:admin@zebssak.local'

/**
 * 서버 web-push VAPID 설정
 */
async function configureWebPush(): Promise<typeof import('web-push')> {
  const webpush = await import('web-push')
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim()
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim()
  const subject = process.env.VAPID_SUBJECT?.trim() || VAPID_SUBJECT_FALLBACK

  if (!publicKey || !privateKey) {
    throw new Error('VAPID 키가 설정되지 않았습니다.')
  }

  webpush.setVapidDetails(subject, publicKey, privateKey)
  return webpush
}

/**
 * 단일 구독에 푸시 전송
 */
export async function sendPushNotification(
  subscription: StoredPushSubscription,
  payload: PushPayload
): Promise<boolean> {
  try {
    const webpush = await configureWebPush()
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
        },
      },
      JSON.stringify({
        title: payload.title,
        body: payload.body,
        url: payload.url ?? '/matching',
        matchId: payload.matchId,
      })
    )
    return true
  } catch {
    return false
  }
}

/**
 * 매칭 성공 시 양쪽 사용자에게 푸시 알림 전송
 */
export async function sendMatchPushNotifications(
  supabase: SupabaseClient,
  matchId: string,
  seatSeekRequestId: string,
  leavingRequestId: string
): Promise<void> {
  try {
    const { data: requests, error: requestError } = await supabase
      .from('match_requests')
      .select('user_id')
      .in('id', [seatSeekRequestId, leavingRequestId])

    if (requestError || !requests?.length) {
      return
    }

    const userIds = Array.from(
      new Set(requests.map((row) => String(row.user_id)).filter(Boolean))
    )

    const payload: PushPayload = {
      title: '매칭 성공!',
      body: '30초 안에 매칭 화면에서 확인해 주세요.',
      url: '/matching',
      matchId,
    }

    for (const userId of userIds) {
      const { data: rows, error: subError } = await supabase
        .from('push_subscriptions')
        .select('endpoint, p256dh, auth_key')
        .eq('user_id', userId)

      if (subError || !rows?.length) {
        continue
      }

      for (const row of rows) {
        const endpoint = String(row.endpoint ?? '')
        const p256dh = String(row.p256dh ?? '')
        const authKey = String(row.auth_key ?? '')
        if (!endpoint || !p256dh || !authKey) {
          continue
        }

        const sent = await sendPushNotification(
          { endpoint, keys: { p256dh, auth: authKey } },
          payload
        )

        if (!sent) {
          await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint)
        }
      }
    }
  } catch {
    // 푸시 실패해도 매칭 처리는 유지합니다.
  }
}
