/** 역 코드 접두사 → 화면용 노선명 */
export function lineLabelFromStationCode(stationCode: string | null | undefined): string | null {
  const code = (stationCode ?? '').trim().toLowerCase()
  if (!code) return null
  if (code.startsWith('s1')) return '서울 1호선'
  if (code.startsWith('s2')) return '서울 2호선'
  const seoulN = code.match(/^s([3-9])/)
  if (seoulN?.[1]) return `서울 ${seoulN[1]}호선`
  if (code.startsWith('l1') || code.startsWith('i1')) return '인천 1호선'
  if (code.startsWith('l2') || code.startsWith('i2')) return '인천 2호선'
  return null
}

/** 역 코드 접두사 → 좌석 맵 문 구간당 좌석 수 */
export function seatsPerSectionFromStationCode(stationCode: string | null | undefined): number {
  const code = (stationCode ?? '').trim().toLowerCase()
  if (code.startsWith('s1')) return 8
  return 7
}

/** API seat_number → 문 번호(1~4) */
export function doorNumberFromApiSeat(
  seatNumber: number,
  seatsPerSection: number
): number | null {
  if (!Number.isInteger(seatNumber) || seatNumber < 1) return null
  const door = Math.floor((seatNumber - 1) / seatsPerSection) + 1
  return door >= 1 && door <= 4 ? door : null
}

/** 앱 전체와 동일한 칸-문 표기 (예: 3-1) */
export function formatCarDoorPosition(
  carNumber: number,
  seatSide: 'A' | 'B',
  seatNumber: number,
  seatsPerSection: number
): string | null {
  const door = doorNumberFromApiSeat(seatNumber, seatsPerSection)
  if (door == null || !Number.isInteger(carNumber) || carNumber < 1) return null
  const sideLabel = seatSide === 'A' ? 'A측' : 'B측'
  return `${carNumber}-${door}번 문 옆 (${sideLabel})`
}

export function formatStationDisplayName(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim()
  if (!trimmed) return '미확인'
  return trimmed.endsWith('역') ? trimmed : `${trimmed}역`
}
