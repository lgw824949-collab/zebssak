export const APP_STATS_CLIENT_ID_KEY = 'zeb_client_id'

export interface PublicAppStats {
  visitor_count: number
  member_count: number
  pwa_install_count: number
  display_count: number
}

export function getOrCreateClientId(): string {
  if (typeof window === 'undefined') {
    return ''
  }

  try {
    const existing = localStorage.getItem(APP_STATS_CLIENT_ID_KEY)
    if (existing && isValidClientId(existing)) {
      return existing
    }

    const clientId = crypto.randomUUID()
    localStorage.setItem(APP_STATS_CLIENT_ID_KEY, clientId)
    return clientId
  } catch {
    return ''
  }
}

function isValidClientId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  )
}

export async function recordAppInstall(source: 'visit' | 'pwa_install'): Promise<void> {
  const clientId = getOrCreateClientId()
  if (!clientId) {
    return
  }

  try {
    await fetch('/api/stats/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, source }),
      keepalive: true,
    })
  } catch {
    // 집계 실패는 앱 이용에 영향을 주지 않습니다.
  }
}

export function registerPwaInstallListener(): () => void {
  if (typeof window === 'undefined') {
    return () => undefined
  }

  function handleAppInstalled() {
    void recordAppInstall('pwa_install')
  }

  window.addEventListener('appinstalled', handleAppInstalled)
  return () => window.removeEventListener('appinstalled', handleAppInstalled)
}

export async function fetchPublicAppStats(): Promise<PublicAppStats | null> {
  try {
    const response = await fetch('/api/stats/public', { cache: 'no-store' })
    if (!response.ok) {
      return null
    }

    const json = (await response.json()) as {
      success?: boolean
      data?: PublicAppStats
    }

    if (!json.success || !json.data) {
      return null
    }

    return json.data
  } catch {
    return null
  }
}
