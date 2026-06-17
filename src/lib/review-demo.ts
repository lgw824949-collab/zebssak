/**
 * 심사·데모 기간 전용 — 실시간 탑승 검증 완화
 * Vercel에 MATCH_REVIEW_DEMO=true + MATCH_REVIEW_DEMO_UNTIL(선택) 설정
 * 심사 종료 후 env 제거 또는 기한 만료 시 자동 비활성화
 */

/** 심사용 데모 모드 활성 여부 (서버 env + 기한) */
export function isReviewDemoEnabled(): boolean {
  if (process.env.MATCH_REVIEW_DEMO?.trim() !== 'true') {
    return false
  }

  const untilRaw = process.env.MATCH_REVIEW_DEMO_UNTIL?.trim()
  if (!untilRaw) {
    return true
  }

  const until = new Date(`${untilRaw}T23:59:59+09:00`)
  if (Number.isNaN(until.getTime())) {
    return true
  }

  return Date.now() <= until.getTime()
}

/** 로컬 개발 또는 심사 데모 시 실시간 열차·탑승 검증 생략 */
export function isMatchRealtimeBypassEnabled(): boolean {
  return (
    process.env.MATCH_DEV_SKIP_REALTIME === 'true' || isReviewDemoEnabled()
  )
}

/** 심사 데모 상태 (안내 API용) */
export function getReviewDemoStatus(): {
  enabled: boolean
  until: string | null
  expired: boolean
} {
  const flagOn = process.env.MATCH_REVIEW_DEMO?.trim() === 'true'
  const until = process.env.MATCH_REVIEW_DEMO_UNTIL?.trim() || null

  if (!flagOn) {
    return { enabled: false, until, expired: false }
  }

  const active = isReviewDemoEnabled()
  return {
    enabled: active,
    until,
    expired: flagOn && !active && Boolean(until),
  }
}
