/** 양보자 하차 N역 전부터 착석 가능 단계로 전환합니다. */
export const HANDOFF_READY_STATION_THRESHOLD = 1

/** 같은·인접 호차는 도보 약 1분 — 수락 후 즉시 이동 안내 */
export function isHandoffMoveDue(
  handoffRemainingStations: number | null | undefined
): boolean {
  if (handoffRemainingStations == null || handoffRemainingStations < 0) {
    return false
  }

  return true
}

export function isHandoffReady(
  handoffRemainingStations: number | null | undefined
): boolean {
  if (handoffRemainingStations == null || handoffRemainingStations < 0) {
    return false
  }

  return handoffRemainingStations <= HANDOFF_READY_STATION_THRESHOLD
}
