/** 인접 호차 이동 예상 시간(분) */
export const ADJACENT_CAR_WALK_MINUTES = 1

/** 매칭 가능한 최대 호차 간격 (같은 호차=0, 옆 호차=1) */
export const MAX_MATCH_CAR_DISTANCE = 1

export function resolveAdjacentCarNumbers(carNumber: number): number[] {
  if (!Number.isInteger(carNumber) || carNumber < 1) {
    return []
  }

  return [carNumber - 1, carNumber, carNumber + 1].filter((value) => value >= 1)
}

export function resolveCarDistance(
  requesterCarNumber: number,
  candidateCarNumber: number
): number {
  if (
    !Number.isInteger(requesterCarNumber) ||
    !Number.isInteger(candidateCarNumber) ||
    requesterCarNumber < 1 ||
    candidateCarNumber < 1
  ) {
    return Number.MAX_SAFE_INTEGER
  }

  return Math.abs(requesterCarNumber - candidateCarNumber)
}

/** 착석 희망자 이동 안내 — 같은 호차·인접 호차 구분 */
export function resolveSeekerMovementLocationLine(input: {
  selfCarNumber?: number | null
  targetCarNumber?: number | null
  targetDoorLabel?: string | null
}): string | null {
  const targetCar = input.targetCarNumber
  const selfCar = input.selfCarNumber
  const door = input.targetDoorLabel?.trim()

  if (targetCar == null || !Number.isInteger(targetCar) || targetCar < 1) {
    return door || null
  }

  const doorPart = door ? ` · ${door}` : ''

  if (selfCar == null || !Number.isInteger(selfCar) || selfCar < 1 || selfCar === targetCar) {
    return `${targetCar}호차${doorPart}`
  }

  const distance = Math.abs(selfCar - targetCar)
  if (distance === 1) {
    return `${selfCar}호차 → ${targetCar}호차${doorPart} (약 ${ADJACENT_CAR_WALK_MINUTES}분)`
  }

  return `${targetCar}호차${doorPart}`
}
