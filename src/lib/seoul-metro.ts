const SEOUL_METRO_DIRECT_HOST = 'http://swopenAPI.seoul.go.kr'
const SEOUL_METRO_FETCH_TIMEOUT_MS = 12000

const SEOUL_SUBWAY_ID_BY_LINE: Record<string, string> = {
  seoul1: '1001',
  seoul2: '1002',
  seoul3: '1003',
  seoul4: '1004',
  seoul5: '1005',
  seoul6: '1006',
  seoul7: '1007',
  seoul8: '1008',
  seoul9: '1009',
}

export interface SeoulArrivalRow {
  subwayId?: string
  updnLine?: string
  btrainNo?: string
  barvlDt?: string
  arvlMsg2?: string
  recptnDt?: string
  bstatnNm?: string
  trainLineNm?: string
  btrainSttus?: string
}

export interface SeoulPositionRow {
  trainNo?: string
  statnNm?: string
  updnLine?: string
  directAt?: string
  subwayNm?: string
}

export function getSeoulMetroApiKey(): string | null {
  const key = process.env.SEOUL_METRO_API_KEY?.trim()
  return key ? key : null
}

export function resolveSeoulSubwayId(lineParam: string): string | null {
  if (lineParam === 'seoul1_incheon' || lineParam === 'seoul1_cheonan') {
    return SEOUL_SUBWAY_ID_BY_LINE.seoul1
  }
  return SEOUL_SUBWAY_ID_BY_LINE[lineParam] ?? null
}

/** 열차번호 비교용 (앞자리 0 보정) */
export function normalizeSeoulTrainNo(trainNo: string): string {
  const digits = trainNo.replace(/\D/g, '')
  if (!digits) return ''
  return digits.padStart(4, '0')
}

/**
 * Vercel 등에서 swopenAPI 직접 HTTP 호출이 실패할 수 있어
 * next.config rewrites 프록시(/api/_seoul-metro)를 우선 사용합니다.
 */
export function buildSeoulMetroApiUrl(
  request: Request,
  pathAfterKey: string
): string | null {
  const key = getSeoulMetroApiKey()
  if (!key) return null

  const normalizedPath = pathAfterKey.replace(/^\/+/, '')
  return new URL(`/api/_seoul-metro/${normalizedPath}`, request.url).toString()
}

export function buildSeoulMetroDirectUrl(pathAfterKey: string): string | null {
  const key = getSeoulMetroApiKey()
  if (!key) return null
  const normalizedPath = pathAfterKey.replace(/^\/+/, '')
  return `${SEOUL_METRO_DIRECT_HOST}/api/subway/${encodeURIComponent(key)}/${normalizedPath}`
}

export async function fetchSeoulMetroJson<T>(
  primaryUrl: string,
  fallbackUrl?: string | null
): Promise<T | null> {
  for (const url of [primaryUrl, fallbackUrl].filter(Boolean) as string[]) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(SEOUL_METRO_FETCH_TIMEOUT_MS),
      })
      if (!response.ok) continue
      return (await response.json()) as T
    } catch {
      // 다음 URL 시도
    }
  }
  return null
}

function extractResultCode(payload: {
  errorMessage?: { code?: string }
  realtimePosition?: { RESULT?: { code?: string } }
  realtimeArrival?: { RESULT?: { code?: string } }
}): string | undefined {
  return (
    payload.errorMessage?.code?.trim() ||
    payload.realtimePosition?.RESULT?.code?.trim() ||
    payload.realtimeArrival?.RESULT?.code?.trim()
  )
}

export function isSeoulApiSuccess(code: string | undefined): boolean {
  return !code || code === 'INFO-000'
}

export function extractPositionRows(payload: {
  realtimePositionList?: SeoulPositionRow[]
  realtimePosition?: { row?: SeoulPositionRow | SeoulPositionRow[] }
}): SeoulPositionRow[] {
  if (Array.isArray(payload.realtimePositionList)) {
    return payload.realtimePositionList
  }
  const row = payload.realtimePosition?.row
  if (!row) return []
  return Array.isArray(row) ? row : [row]
}

export function extractArrivalRows(payload: {
  realtimeArrivalList?: SeoulArrivalRow[]
  realtimeArrival?: { row?: SeoulArrivalRow | SeoulArrivalRow[] }
}): SeoulArrivalRow[] {
  if (Array.isArray(payload.realtimeArrivalList)) {
    return payload.realtimeArrivalList
  }
  const row = payload.realtimeArrival?.row
  if (!row) return []
  return Array.isArray(row) ? row : [row]
}

/** recptnDt 시차만큼 barvlDt 보정 (서울시 API 안내) */
export function adjustBarvlDtSeconds(
  barvlDtRaw: string | undefined,
  recptnDtRaw: string | undefined
): number | null {
  const barvl = Number.parseInt(String(barvlDtRaw ?? '').trim(), 10)
  if (!Number.isFinite(barvl) || barvl < 0) return null

  if (!recptnDtRaw?.trim()) return barvl

  const recptn = new Date(recptnDtRaw.trim().replace(' ', 'T'))
  if (Number.isNaN(recptn.getTime())) return barvl

  const lagSeconds = Math.max(0, Math.floor((Date.now() - recptn.getTime()) / 1000))
  return Math.max(0, barvl - lagSeconds)
}

export async function fetchRealtimePositionRows(
  request: Request,
  lineName: string
): Promise<SeoulPositionRow[]> {
  const path = `json/realtimePosition/0/100/${encodeURIComponent(lineName)}`
  const proxyUrl = buildSeoulMetroApiUrl(request, path)
  const directUrl = buildSeoulMetroDirectUrl(path)
  if (!proxyUrl) return []

  const payload = await fetchSeoulMetroJson<{
    errorMessage?: { code?: string }
    realtimePosition?: { RESULT?: { code?: string } }
    realtimePositionList?: SeoulPositionRow[]
  }>(proxyUrl, directUrl)

  if (!payload || !isSeoulApiSuccess(extractResultCode(payload))) {
    return []
  }

  return extractPositionRows(payload)
}

export async function fetchRealtimeArrivalRows(
  request: Request,
  stationName: string
): Promise<SeoulArrivalRow[]> {
  const path = `json/realtimeStationArrival/0/20/${encodeURIComponent(stationName.trim())}`
  const proxyUrl = buildSeoulMetroApiUrl(request, path)
  const directUrl = buildSeoulMetroDirectUrl(path)
  if (!proxyUrl) return []

  const payload = await fetchSeoulMetroJson<{
    errorMessage?: { code?: string }
    realtimeArrival?: { RESULT?: { code?: string } }
    realtimeArrivalList?: SeoulArrivalRow[]
  }>(proxyUrl, directUrl)

  if (!payload || !isSeoulApiSuccess(extractResultCode(payload))) {
    return []
  }

  return extractArrivalRows(payload)
}

export function filterArrivalsBySubwayId(
  rows: SeoulArrivalRow[],
  subwayId: string | null
): SeoulArrivalRow[] {
  if (!subwayId) return rows
  return rows.filter((row) => String(row.subwayId ?? '').trim() === subwayId)
}
