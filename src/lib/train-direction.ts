export type DirectionKey = 'up' | 'down'

export function normalizeStationNameForTrain(name: string): string {
  return name.trim().replace(/\s+/g, '').replace(/역$/u, '')
}

export function normalizeDirectionKey(direction: string): DirectionKey | null {
  const value = direction.trim()
  if (value === '상행' || value === '내선' || value === '1') return 'up'
  if (value === '하행' || value === '외선' || value === '2') return 'down'
  if (value === '0') return 'down'
  return null
}

function buildStationIndexMap(stationOrder: readonly string[]): Map<string, number> {
  const map = new Map<string, number>()
  stationOrder.forEach((name, index) => {
    map.set(normalizeStationNameForTrain(name), index)
  })
  return map
}

/**
 * 탑승역 → 목적지(또는 하차역) 구간에 맞는 열차 방향(up/down)을 계산합니다.
 * - 2호선: 순환선 최단 경로
 * - 그 외: 역순서 배열 기준 앞/뒤
 */
export function resolveRequiredDirectionKey(
  line: string,
  stationOrder: readonly string[],
  fromStation: string,
  toStation: string
): DirectionKey | null {
  if (!stationOrder.length) return null

  const stationIndexMap = buildStationIndexMap(stationOrder)
  const fromIdx = stationIndexMap.get(normalizeStationNameForTrain(fromStation))
  const toIdx = stationIndexMap.get(normalizeStationNameForTrain(toStation))

  if (fromIdx === undefined || toIdx === undefined || fromIdx === toIdx) {
    return null
  }

  const count = stationOrder.length

  if (line === 'seoul2') {
    const distDown = (toIdx - fromIdx + count) % count
    const distUp = (fromIdx - toIdx + count) % count
    if (distDown < distUp) return 'down'
    if (distUp < distDown) return 'up'
    return null
  }

  if (toIdx > fromIdx) return 'down'
  if (toIdx < fromIdx) return 'up'
  return null
}

export function filterTrainsTowardDestination<T extends { direction: string }>(
  trains: T[],
  line: string,
  stationOrder: readonly string[],
  fromStation: string | null,
  toStation: string | null
): T[] {
  if (!fromStation?.trim() || !toStation?.trim()) {
    return trains
  }

  const required = resolveRequiredDirectionKey(
    line,
    stationOrder,
    fromStation.trim(),
    toStation.trim()
  )
  if (!required) {
    return trains
  }

  return trains.filter((train) => normalizeDirectionKey(train.direction) === required)
}
