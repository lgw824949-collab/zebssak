export interface PushPayload {
  title: string
  body: string
  url?: string
  matchId?: string
}

interface PushSubscriptionKeys {
  p256dh: string
  auth: string
}

export interface StoredPushSubscription {
  endpoint: string
  keys: PushSubscriptionKeys
}

/**
 * 클라이언트용 VAPID 공개키 (.env.local)
 */
export function getVapidPublicKey(): string {
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim()
  if (!key) {
    throw new Error('NEXT_PUBLIC_VAPID_PUBLIC_KEY가 설정되지 않았습니다.')
  }
  return key
}

/**
 * URL-safe Base64 → Uint8Array (PushManager.subscribe용)
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i)
  }
  return output
}

/**
 * 브라우저 푸시 구독 후 서버에 저장
 */
export async function subscribePush(authToken: string): Promise<boolean> {
  if (typeof window === 'undefined') {
    return false
  }

  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    return false
  }

  try {
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') {
      return false
    }

    const registration = await navigator.serviceWorker.ready
    const existing = await registration.pushManager.getSubscription()
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(getVapidPublicKey()) as BufferSource,
      }))

    const response = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ subscription: subscription.toJSON() }),
    })

    if (!response.ok) {
      return false
    }

    const result = (await response.json()) as { success?: boolean }
    return result.success === true
  } catch {
    return false
  }
}
