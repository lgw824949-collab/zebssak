import http from 'node:http'

const SEOUL_METRO_DIRECT_HOST = 'http://swopenAPI.seoul.go.kr'
const SEOUL_METRO_FETCH_TIMEOUT_MS = 4500

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

export const SEOUL_LINE_NAME_BY_PARAM: Record<string, string> = {
  seoul1: '1호선',
  seoul1_incheon: '1호선',
  seoul1_cheonan: '1호선',
  seoul2: '2호선',
  seoul3: '3호선',
  seoul4: '4호선',
  seoul5: '5호선',
  seoul6: '6호선',
  seoul7: '7호선',
  seoul8: '8호선',
  seoul9: '9호선',
}

export function resolveSeoulLineName(lineParam: string): string | null {
  return SEOUL_LINE_NAME_BY_PARAM[lineParam] ?? null
}

/** 2호선은 내선/외선, 그 외 호선은 상행/하행 */
export function mapSeoulDirectionLabel(updnLine: string, subwayName: string): string {
  if (subwayName.includes('2호선')) {
    if (updnLine === '0') return '외선'
    if (updnLine === '1') return '내선'
    return '방향 미상'
  }
  if (updnLine === '0') return '상행'
  if (updnLine === '1') return '하행'
  return '방향 미상'
}

export function mapPositionRowToTrainFields(
  row: SeoulPositionRow,
  defaultLineName: string
): {
  train_no: string
  station_name: string
  direction: string
  direction_code: string
  is_express: boolean
} | null {
  const trainNo = row.trainNo?.trim()
  const stationName = row.statnNm?.trim()
  if (!trainNo || !stationName) return null

  const directionCode = row.updnLine?.trim() ?? ''
  const subwayName = row.subwayNm?.trim() ?? defaultLineName
  const directAt = row.directAt?.trim() ?? '0'

  return {
    train_no: trainNo,
    station_name: stationName,
    direction: mapSeoulDirectionLabel(directionCode, subwayName),
    direction_code: directionCode,
    is_express: directAt === '1',
  }
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
 * /api/seoul-metro 런타임 프록시를 우선 사용합니다.
 */
export function buildSeoulMetroApiUrl(
  request: Request,
  pathAfterKey: string
): string | null {
  const key = getSeoulMetroApiKey()
  if (!key) return null

  const normalizedPath = pathAfterKey.replace(/^\/+/, '')
  return new URL(`/api/seoul-metro/${normalizedPath}`, request.url).toString()
}

export function buildSeoulMetroDirectUrl(pathAfterKey: string): string | null {
  const key = getSeoulMetroApiKey()
  if (!key) return null
  const normalizedPath = pathAfterKey.replace(/^\/+/, '')
  return `${SEOUL_METRO_DIRECT_HOST}/api/subway/${encodeURIComponent(key)}/${normalizedPath}`
}

function fetchSeoulMetroHttpText(directUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.get(
      directUrl,
      { timeout: SEOUL_METRO_FETCH_TIMEOUT_MS },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          body += chunk
        })
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(body)
            return
          }
          reject(new Error(`HTTP ${res.statusCode ?? 'unknown'}`))
        })
      }
    )
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('timeout'))
    })
  })
}

async function fetchSeoulMetroJsonFromUrl<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(SEOUL_METRO_FETCH_TIMEOUT_MS),
    })
    if (!response.ok) return null
    return (await response.json()) as T
  } catch {
    return null
  }
}

/** 프록시·직접 URL을 병렬 호출해 먼저 성공한 응답을 사용합니다. */
export async function fetchSeoulMetroJson<T>(
  primaryUrl: string,
  fallbackUrl?: string | null
): Promise<T | null> {
  const urls = [primaryUrl, fallbackUrl].filter(Boolean) as string[]
  if (urls.length === 0) return null

  const results = await Promise.all(urls.map((url) => fetchSeoulMetroJsonFromUrl<T>(url)))
  for (const result of results) {
    if (result) return result
  }

  const directUrl = urls.find((url) => url.startsWith(SEOUL_METRO_DIRECT_HOST))
  if (!directUrl) return null

  try {
    const text = await fetchSeoulMetroHttpText(directUrl)
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

/** swopenAPI 직접 HTTP → 앱 프록시 순으로 호출 */
export async function fetchSeoulMetroUpstream(
  request: Request,
  pathAfterKey: string
): Promise<string | null> {
  const directUrl = buildSeoulMetroDirectUrl(pathAfterKey)
  const proxyUrl = buildSeoulMetroApiUrl(request, pathAfterKey)

  const tasks: Promise<string | null>[] = []
  if (directUrl) {
    tasks.push(
      fetchSeoulMetroHttpText(directUrl).catch(() => null)
    )
  }
  if (proxyUrl) {
    tasks.push(
      fetch(proxyUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(SEOUL_METRO_FETCH_TIMEOUT_MS),
      })
        .then((response) => (response.ok ? response.text() : null))
        .catch(() => null)
    )
  }

  if (tasks.length === 0) return null

  const results = await Promise.all(tasks)
  return results.find((value) => Boolean(value)) ?? null
}

export function extractResultCode(payload: {
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
  realtimePosition?: {
    row?: SeoulPositionRow | SeoulPositionRow[]
    RESULT?: { code?: string }
  }
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
  realtimeArrival?: {
    row?: SeoulArrivalRow | SeoulArrivalRow[]
    RESULT?: { code?: string }
  }
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
  const station = stationName.trim().replace(/역$/u, '')
  if (!station) return []

  const path = `json/realtimeStationArrival/0/10/${encodeURIComponent(station)}`
  const raw = await fetchSeoulMetroUpstream(request, path)
  if (!raw) return []

  let payload: {
    errorMessage?: { code?: string }
    realtimeArrival?: { RESULT?: { code?: string } }
    realtimeArrivalList?: SeoulArrivalRow[]
  }
  try {
    payload = JSON.parse(raw) as typeof payload
  } catch {
    return []
  }

  if (!isSeoulApiSuccess(extractResultCode(payload))) {
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
