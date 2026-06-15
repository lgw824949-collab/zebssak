export type MatchMovementStatus = 'idle' | 'moving' | 'arrived'

export interface MatchMovementState {
  status: MatchMovementStatus
  updated_at: string | null
}

export interface MatchRouteGuide {
  handoff_station_name: string
  handoff_remaining_stations: number | null
  self_destination_name: string
  self_remaining_stations: number | null
}

export interface MatchMovementPayload {
  self: MatchMovementState
  partner: MatchMovementState
  route_guide: MatchRouteGuide
}

/** 상대방 이동 상태 한글 라벨 */
export function resolvePartnerMovementLabel(
  status: MatchMovementStatus,
  partnerRole: 'seeker' | 'provider'
): string {
  if (partnerRole === 'provider') {
    return '양보자가 자리 대기 중입니다'
  }

  if (status === 'moving') {
    return '찾는 분이 이동 중입니다'
  }

  if (status === 'arrived') {
    return '찾는 분이 도착했습니다'
  }

  return '찾는 분이 아직 출발 전입니다'
}

/** 본인 이동 상태 한글 라벨 */
export function resolveSelfMovementLabel(status: MatchMovementStatus): string {
  if (status === 'moving') {
    return '이동 중'
  }

  if (status === 'arrived') {
    return '도착 완료'
  }

  return '이동 전'
}
