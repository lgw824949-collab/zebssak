/** 양보자 하차 N역 전부터 착석 희망자 이동을 안내합니다. */
export const HANDOFF_MOVE_START_THRESHOLD = 3

/** 양보자 하차 N역 전부터 착석 가능 단계로 전환합니다. */
export const HANDOFF_READY_STATION_THRESHOLD = 1

export function isHandoffMoveDue(
  handoffRemainingStations: number | null | undefined
): boolean {
  if (handoffRemainingStations == null || handoffRemainingStations < 0) {
    return false
  }

  return handoffRemainingStations <= HANDOFF_MOVE_START_THRESHOLD
}

export function isHandoffReady(
  handoffRemainingStations: number | null | undefined
): boolean {
  if (handoffRemainingStations == null || handoffRemainingStations < 0) {
    return false
  }

  return handoffRemainingStations <= HANDOFF_READY_STATION_THRESHOLD
}
