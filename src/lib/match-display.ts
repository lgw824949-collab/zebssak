import { resolveDirectionBucket } from '@/lib/match-direction'

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

/** 출입문 표시 — 예: 출1-1 */
export function formatExitDoorDisplayLabel(carNum: number, doorNo: number): string {
  return `출${carNum}-${doorNo}`
}

/** 앱 전체와 동일한 칸-문 표기 (예: 출3-1번 문 옆) */
export function formatCarDoorPosition(
  carNumber: number,
  seatSide: 'A' | 'B',
  seatNumber: number,
  seatsPerSection: number
): string | null {
  const door = doorNumberFromApiSeat(seatNumber, seatsPerSection)
  if (door == null || !Number.isInteger(carNumber) || carNumber < 1) return null
  const sideLabel = seatSide === 'A' ? 'A측' : 'B측'
  return `${formatExitDoorDisplayLabel(carNumber, door)}번 문 옆 (${sideLabel})`
}

/** 역 코드(s7-01 등) → 서울 호선 번호 1~9 */
export function resolveSeoulLineNumberFromStationCode(
  stationCode: string | null | undefined
): number | null {
  const match = (stationCode ?? '').trim().toLowerCase().match(/^s([1-9])/)
  if (!match?.[1]) {
    return null
  }

  const lineNumber = Number.parseInt(match[1], 10)
  return Number.isFinite(lineNumber) ? lineNumber : null
}

/** 역 코드 접두사(s7, l1 등) */
export function resolveStationLinePrefix(
  stationCode: string | null | undefined
): string | null {
  const match = (stationCode ?? '').trim().toLowerCase().match(/^(s[1-9]|l[12]|i[12])/)
  return match?.[1] ?? null
}

export function formatStationDisplayName(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim()
  if (!trimmed) return '미확인'
  return trimmed.endsWith('역') ? trimmed : `${trimmed}역`
}

/** 노선·방향 코드 → 화면용 방면 표기 (양보자 이동 방향) */
export function resolveDirectionDisplayLabel(
  lineNumber: number | null | undefined,
  direction: string | null | undefined,
  lineLabel?: string | null
): string | null {
  const bucket = resolveDirectionBucket(direction ?? '')
  const dirKey = bucket === 'up' ? '1' : bucket === 'down' ? '2' : null
  if (!dirKey) return null

  const compactLabel = (lineLabel ?? '').replace(/\s+/g, '')

  if (lineNumber === 1 || compactLabel === '서울1호선' || compactLabel === '인천1호선') {
    return dirKey === '1' ? '소요산 방면' : '인천·신창 방면'
  }
  if (lineNumber === 2 || compactLabel === '서울2호선' || compactLabel === '인천2호선') {
    return dirKey === '1' ? '내선순환' : '외선순환'
  }
  if (lineNumber === 3) return dirKey === '1' ? '대화 방면' : '오금 방면'
  if (lineNumber === 4) return dirKey === '1' ? '당고개 방면' : '오이도 방면'
  if (lineNumber === 5) return dirKey === '1' ? '방화 방면' : '마천 방면'
  if (lineNumber === 6) return dirKey === '1' ? '응암순환' : null
  if (lineNumber === 7) return dirKey === '1' ? '장암 방면' : '석남 방면'
  if (lineNumber === 8) return dirKey === '1' ? '암사 방면' : '모란 방면'
  if (lineNumber === 9) return dirKey === '1' ? '개화 방면' : '중앙보훈병원 방면'

  return null
}
