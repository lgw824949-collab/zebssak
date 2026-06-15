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
  /** 실시간 열차 현재 역 (양보자 열차 기준) */
  train_current_station_name: string | null
  /** 실시간 위치 API로 남은 역·현재역을 계산했는지 */
  position_is_live: boolean
  /** 양보자(자리 넘기기) 이동 방향 */
  provider_direction_label: string | null
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
    return '양보자 대기 중'
  }

  if (status === 'moving') {
    return '찾는 분 · 이동 중'
  }

  if (status === 'arrived') {
    return '찾는 분 · 도착'
  }

  return '찾는 분 · 출발 전'
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
