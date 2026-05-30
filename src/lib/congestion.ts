export const CONGESTION_HALT_THRESHOLD = 7

export type LineNumberBucket = 1 | 2

export interface CongestionApiPayload {
  lines?: Array<{ line_number: number; congestion_level: number }>
  latest_by_line?: Record<string, { congestion_level?: number } | null>
  halted_by_line?: Record<string, boolean | undefined>
}

export interface CongestionStatus {
  halted: boolean
  haltedByLine: Record<LineNumberBucket, boolean>
  levelsByLine: Record<LineNumberBucket, number>
  maxLevel: number
}

/** BoardingRequest·매칭 API와 동일한 line_number 버킷 */
export function resolveLineNumberFromLabel(lineLabel: string): LineNumberBucket {
  const normalized = (lineLabel || '').replace(/\s+/g, '')
  if (normalized === '인천1호선' || /^서울1호선$/.test(normalized)) return 1
  return 2
}

export function parseCongestionApiData(data: CongestionApiPayload | undefined): CongestionStatus {
  const levelsByLine: Record<LineNumberBucket, number> = { 1: 0, 2: 0 }
  const haltedByLine: Record<LineNumberBucket, boolean> = { 1: false, 2: false }

  if (data?.halted_by_line) {
    haltedByLine[1] = data.halted_by_line['1'] === true
    haltedByLine[2] = data.halted_by_line['2'] === true
  }

  if (Array.isArray(data?.lines)) {
    for (const row of data.lines) {
      const bucket = row.line_number === 1 ? 1 : 2
      levelsByLine[bucket] = row.congestion_level ?? 0
      if (!data?.halted_by_line && row.congestion_level >= CONGESTION_HALT_THRESHOLD) {
        haltedByLine[bucket] = true
      }
    }
  } else if (data?.latest_by_line) {
    for (const key of Object.keys(data.latest_by_line)) {
      const bucket = key === '1' ? 1 : 2
      const level = data.latest_by_line[key]?.congestion_level
      if (typeof level === 'number') {
        levelsByLine[bucket] = level
        if (!data?.halted_by_line && level >= CONGESTION_HALT_THRESHOLD) {
          haltedByLine[bucket] = true
        }
      }
    }
  }

  const maxLevel = Math.max(levelsByLine[1], levelsByLine[2], 0)

  return {
    halted: haltedByLine[1] || haltedByLine[2],
    haltedByLine,
    levelsByLine,
    maxLevel,
  }
}

export function isLineHalted(
  status: CongestionStatus | null | undefined,
  lineLabel: string
): boolean {
  if (!status) return false
  const bucket = resolveLineNumberFromLabel(lineLabel)
  return status.haltedByLine[bucket]
}

export async function fetchCongestionStatus(
  authToken?: string | null
): Promise<CongestionStatus | null> {
  try {
    const headers: HeadersInit = authToken
      ? { Authorization: `Bearer ${authToken}` }
      : {}
    const response = await fetch('/api/congestion', {
      headers,
      cache: 'no-store',
    })

    if (!response.ok) return null

    const json = (await response.json()) as {
      success?: boolean
      data?: CongestionApiPayload
    }

    if (!json.success || !json.data) return null
    return parseCongestionApiData(json.data)
  } catch {
    return null
  }
}
