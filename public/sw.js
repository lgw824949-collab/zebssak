const SW_VERSION = '2026-06-11-push-only-v2'

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.map((key) => caches.delete(key)))
      await self.clients.claim()
      const clients = await self.clients.matchAll({ type: 'window' })
      for (const client of clients) {
        client.postMessage({ type: 'SW_ACTIVATED', version: SW_VERSION })
      }
    })()
  )
})

// fetch 가로채기 제거 — 앱 스크롤·청크 로딩은 브라우저가 직접 처리 (푸시 전용 SW)

self.addEventListener('push', (event) => {
  let payload = {
    title: '잽싸게',
    body: '매칭 알림이 도착했습니다.',
    url: '/matching',
    matchId: null,
  };

  try {
    if (event.data) {
      const parsed = event.data.json();
      payload = {
        title: parsed.title || payload.title,
        body: parsed.body || payload.body,
        url: parsed.url || payload.url,
        matchId: parsed.matchId || null,
      };
    }
  } catch {
    // JSON 파싱 실패 시 기본 문구 사용
  }

  const targetUrl = payload.matchId
    ? `/matching?matchId=${encodeURIComponent(payload.matchId)}`
    : payload.url || '/matching';

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.matchId ? `match-${payload.matchId}` : 'zebssak-match',
      data: {
        url: targetUrl,
        matchId: payload.matchId,
      },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || '/matching';

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      for (const client of clients) {
        if ('focus' in client) {
          await client.focus();
          if ('navigate' in client) {
            await client.navigate(targetUrl);
          }
          return;
        }
      }

      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl);
      }
    })()
  );
});
