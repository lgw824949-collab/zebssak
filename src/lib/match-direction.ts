export type DirectionBucket = 'up' | 'down'

/**
 * 열차/요청 direction 문자열을 상행(up)·하행(down) 버킷으로 통일합니다.
 * (내선↔상행, 외선↔하행)
 */
export function resolveDirectionBucket(direction: string): DirectionBucket | null {
  const value = direction.trim()
  if (!value) return null
  if (value === '1' || value === '상행' || value === '내선') return 'up'
  if (value === '2' || value === '하행' || value === '외선' || value === '0') return 'down'
  if (/내선|상행/u.test(value)) return 'up'
  if (/외선|하행/u.test(value)) return 'down'
  return null
}

/** DB 저장용 — waiting 화면·매칭 조회와 동일하게 1/2 사용 */
export function normalizeDirectionForStorage(direction: string): string {
  const bucket = resolveDirectionBucket(direction)
  if (bucket === 'up') return '1'
  if (bucket === 'down') return '2'
  const trimmed = direction.trim()
  return trimmed || '2'
}

/** 기존 행(상행/외선 등)과 신규 행(1/2) 모두 매칭되도록 */
export function equivalentDirectionsForMatch(direction: string): string[] {
  const bucket = resolveDirectionBucket(direction)
  if (bucket === 'up') return ['1', '상행', '내선']
  if (bucket === 'down') return ['2', '하행', '외선', '0']
  const trimmed = direction.trim()
  return trimmed ? [trimmed] : ['2']
}
