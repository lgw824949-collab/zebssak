export type PresenceMode = 'onboard' | 'platform_waiting'

/** API 본문 presence_mode 파싱 */
export function parsePresenceMode(value: unknown): PresenceMode | null {
  if (value === 'onboard' || value === 'platform_waiting') {
    return value
  }
  return null
}

/** 역할·모드에 맞는 presence_mode 결정 */
export function resolvePresenceModeForRole(
  role: 'seeker' | 'provider',
  requested: unknown
): PresenceMode {
  if (role === 'provider') {
    return 'onboard'
  }
  return parsePresenceMode(requested) ?? 'platform_waiting'
}

/** 개발 환경: 실시간 검증 전면 생략 (.env.local) */
export function isDevRealtimeBypassEnabled(): boolean {
  return process.env.MATCH_DEV_SKIP_REALTIME === 'true'
}

/** 개발 환경: mock 역 이름 (.env.local) */
export function getDevMockStationName(): string | null {
  const station = process.env.MATCH_DEV_MOCK_STATION?.trim()
  return station || null
}

/** 개발 환경: mock 열차번호 (.env.local) */
export function getDevMockTrainNo(): string | null {
  const train = process.env.MATCH_DEV_MOCK_TRAIN?.trim()
  return train || null
}
