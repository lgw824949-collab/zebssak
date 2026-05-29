import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

const PUBLIC_DATA_API_HOST = 'http://openapi.seoul.go.kr:8088'
const CACHE_ROW_ID = 'seoul_metro'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const PAGE_SIZE = 1000

/** Supabase SQL Editor에서 1회 실행 (quick_exit_cache 테이블) */
const QUICK_EXIT_CACHE_SETUP_SQL =
  "CREATE TABLE IF NOT EXISTS public.quick_exit_cache (id TEXT PRIMARY KEY DEFAULT 'seoul_metro', payload JSONB NOT NULL DEFAULT '[]'::jsonb, fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), total_count INTEGER NOT NULL DEFAULT 0, crtr_ymd TEXT);"

const JSON_UTF8_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
} as const

interface QuickExitCacheItem {
  qckgffMngNo: string | null
  lineNm: string
  stnCd: string | null
  stnNm: string
  stnNo: string | null
  crtrYmd: string | null
  upbdnbSe: string | null
  drtnInfo: string | null
  qckgffVhclDoorNo: string
  recommendedCar: number | null
  recommendedDoor: number | null
  plfmCmgFac: string | null
  facNo: string | null
  elvtrNo: string | null
  fwkPstnNm: string | null
  facPstnNm: string | null
}

interface QuickExitCacheRow {
  id: string
  payload: QuickExitCacheItem[] | null
  fetched_at: string
  total_count: number
  crtr_ymd: string | null
}

interface SeoulFstExitRawItem {
  qckgffMngNo?: string
  lineNm?: string
  stnCd?: string
  stnNm?: string
  stnNo?: string
  crtrYmd?: string
  upbdnbSe?: string
  drtnInfo?: string
  qckgffVhclDoorNo?: string
  plfmCmgFac?: string
  facNo?: string | null
  elvtrNo?: string | null
  fwkPstnNm?: string | null
  facPstnNm?: string | null
}

function errorResponse(message: string, status: number) {
  return NextResponse.json(
    { success: false, error: message },
    { status, headers: JSON_UTF8_HEADERS }
  )
}

function normalizeStationName(name: string): string {
  return name.trim().replace(/\s+/g, '').replace(/역$/, '')
}

function normalizeLineName(line: string): string {
  const trimmed = line.trim().replace(/\s+/g, '')
  const seoulMatch = trimmed.match(/^서울?([1-9])호선$/i) ?? trimmed.match(/^seoul([1-9])$/i)
  if (seoulMatch?.[1]) return `${seoulMatch[1]}호선`
  if (/^[1-9]호선$/.test(trimmed)) return trimmed
  if (/^[1-9]$/.test(trimmed)) return `${trimmed}호선`
  return trimmed
}

function normalizeDirection(value: string): string {
  return value.trim().replace(/\s+/g, '')
}

function parseCarDoorNo(value: string): { car: number | null; door: number | null } {
  const match = value.trim().match(/^(\d+)\s*-\s*(\d+)$/)
  if (!match) return { car: null, door: null }
  const car = Number.parseInt(match[1], 10)
  const door = Number.parseInt(match[2], 10)
  return {
    car: Number.isFinite(car) ? car : null,
    door: Number.isFinite(door) ? door : null,
  }
}

function mapRawItem(raw: SeoulFstExitRawItem): QuickExitCacheItem | null {
  const lineNm = raw.lineNm?.trim() ?? ''
  const stnNm = raw.stnNm?.trim() ?? ''
  const qckgffVhclDoorNo = raw.qckgffVhclDoorNo?.trim() ?? ''
  if (!lineNm || !stnNm || !qckgffVhclDoorNo) return null

  const { car, door } = parseCarDoorNo(qckgffVhclDoorNo)

  return {
    qckgffMngNo: raw.qckgffMngNo?.trim() ?? null,
    lineNm,
    stnCd: raw.stnCd?.trim() ?? null,
    stnNm,
    stnNo: raw.stnNo?.trim() ?? null,
    crtrYmd: raw.crtrYmd?.trim() ?? null,
    upbdnbSe: raw.upbdnbSe?.trim() ?? null,
    drtnInfo: raw.drtnInfo?.trim() ?? null,
    qckgffVhclDoorNo,
    recommendedCar: car,
    recommendedDoor: door,
    plfmCmgFac: raw.plfmCmgFac?.trim() ?? null,
    facNo: raw.facNo?.trim() ?? null,
    elvtrNo: raw.elvtrNo?.trim() ?? null,
    fwkPstnNm: raw.fwkPstnNm?.trim() ?? null,
    facPstnNm: raw.facPstnNm?.trim() ?? null,
  }
}

function buildFstExitApiUrl(apiKey: string, pageNo: number, numOfRows: number): string {
  return `${PUBLIC_DATA_API_HOST}/${encodeURIComponent(apiKey)}/json/getFstExit/${pageNo}/${numOfRows}/`
}

async function fetchFstExitPage(
  apiKey: string,
  pageNo: number
): Promise<{ items: SeoulFstExitRawItem[]; totalCount: number }> {
  const response = await fetch(buildFstExitApiUrl(apiKey, pageNo, PAGE_SIZE), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(20000),
  })

  if (!response.ok) {
    throw new Error(`getFstExit API HTTP ${response.status}`)
  }

  const payload = (await response.json()) as {
    response?: {
      header?: { resultCode?: string; resultMsg?: string }
      body?: {
        items?: { item?: SeoulFstExitRawItem | SeoulFstExitRawItem[] }
        totalCount?: number | string
      }
    }
  }

  const header = payload.response?.header
  if (header?.resultCode && header.resultCode !== '00') {
    throw new Error(header.resultMsg ?? `getFstExit API 오류 (${header.resultCode})`)
  }

  const rawItem = payload.response?.body?.items?.item
  const items = rawItem
    ? Array.isArray(rawItem)
      ? rawItem
      : [rawItem]
    : []
  const totalCount = Number(payload.response?.body?.totalCount ?? items.length)

  return { items, totalCount }
}

async function fetchAllFstExitItems(apiKey: string): Promise<QuickExitCacheItem[]> {
  const merged: QuickExitCacheItem[] = []
  let pageNo = 1
  let expectedTotal = Infinity

  while (merged.length < expectedTotal) {
    const { items, totalCount } = await fetchFstExitPage(apiKey, pageNo)
    expectedTotal = Number.isFinite(totalCount) && totalCount > 0 ? totalCount : merged.length

    for (const raw of items) {
      const mapped = mapRawItem(raw)
      if (mapped) merged.push(mapped)
    }

    if (items.length < PAGE_SIZE) break
    pageNo += 1
    if (pageNo > 10) break
  }

  return merged
}

async function loadCacheRow(): Promise<QuickExitCacheRow | null> {
  const supabase = createSupabaseAdminClient()
  const { data, error } = await supabase
    .from('quick_exit_cache')
    .select('id, payload, fetched_at, total_count, crtr_ymd')
    .eq('id', CACHE_ROW_ID)
    .maybeSingle()

  if (error) {
    if (error.code === 'PGRST205' || error.message.toLowerCase().includes('quick_exit_cache')) {
      throw new Error(
        `quick_exit_cache 테이블이 없습니다. Supabase SQL Editor에서 다음을 실행하세요: ${QUICK_EXIT_CACHE_SETUP_SQL}`
      )
    }
    throw new Error('quick_exit_cache 조회에 실패했습니다.')
  }

  if (!data) return null

  const payload = Array.isArray(data.payload) ? (data.payload as QuickExitCacheItem[]) : []

  return {
    id: String(data.id),
    payload,
    fetched_at: String(data.fetched_at),
    total_count: Number(data.total_count ?? payload.length),
    crtr_ymd: data.crtr_ymd ? String(data.crtr_ymd) : null,
  }
}

function isCacheStale(fetchedAt: string): boolean {
  const fetchedMs = Date.parse(fetchedAt)
  if (!Number.isFinite(fetchedMs)) return true
  return Date.now() - fetchedMs >= CACHE_TTL_MS
}

async function saveCacheRow(items: QuickExitCacheItem[]): Promise<QuickExitCacheRow> {
  const supabase = createSupabaseAdminClient()
  const crtrYmd = items.find((item) => item.crtrYmd)?.crtrYmd ?? null
  const fetchedAt = new Date().toISOString()

  const { data, error } = await supabase
    .from('quick_exit_cache')
    .upsert(
      {
        id: CACHE_ROW_ID,
        payload: items,
        fetched_at: fetchedAt,
        total_count: items.length,
        crtr_ymd: crtrYmd,
      },
      { onConflict: 'id' }
    )
    .select('id, payload, fetched_at, total_count, crtr_ymd')
    .single()

  if (error || !data) {
    if (error?.code === 'PGRST205' || error?.message?.toLowerCase().includes('quick_exit_cache')) {
      throw new Error(
        `quick_exit_cache 테이블이 없습니다. Supabase SQL Editor에서 다음을 실행하세요: ${QUICK_EXIT_CACHE_SETUP_SQL}`
      )
    }
    throw new Error('quick_exit_cache 저장에 실패했습니다.')
  }

  const payload = Array.isArray(data.payload) ? (data.payload as QuickExitCacheItem[]) : items

  return {
    id: String(data.id),
    payload,
    fetched_at: String(data.fetched_at),
    total_count: Number(data.total_count ?? payload.length),
    crtr_ymd: data.crtr_ymd ? String(data.crtr_ymd) : crtrYmd,
  }
}

async function ensureFreshCache(forceRefresh: boolean): Promise<{
  row: QuickExitCacheRow
  refreshed: boolean
}> {
  const apiKey = process.env.PUBLIC_DATA_API_KEY?.trim()
  if (!apiKey) {
    throw new Error('PUBLIC_DATA_API_KEY가 설정되지 않았습니다.')
  }

  const existing = await loadCacheRow()
  if (existing && !forceRefresh && !isCacheStale(existing.fetched_at)) {
    return { row: existing, refreshed: false }
  }

  const items = await fetchAllFstExitItems(apiKey)
  if (items.length === 0) {
    throw new Error('getFstExit API에서 유효한 데이터를 받지 못했습니다.')
  }

  const row = await saveCacheRow(items)
  return { row, refreshed: true }
}

function filterCacheItems(
  items: QuickExitCacheItem[],
  params: {
    station?: string
    line?: string
    direction?: string
    drtnInfo?: string
  }
): QuickExitCacheItem[] {
  const stationKey = params.station ? normalizeStationName(params.station) : null
  const lineKey = params.line ? normalizeLineName(params.line) : null
  const directionKey = params.direction ? normalizeDirection(params.direction) : null
  const drtnKey = params.drtnInfo ? normalizeDirection(params.drtnInfo) : null

  return items.filter((item) => {
    if (stationKey && normalizeStationName(item.stnNm) !== stationKey) return false
    if (lineKey && normalizeLineName(item.lineNm) !== lineKey) return false
    if (directionKey && normalizeDirection(item.upbdnbSe ?? '') !== directionKey) return false
    if (drtnKey && normalizeDirection(item.drtnInfo ?? '') !== drtnKey) return false
    return true
  })
}

function verifyAdminRefresh(request: Request): boolean {
  const secret = process.env.ADMIN_SECRET?.trim()
  if (!secret) return false
  const key = request.headers.get('x-admin-key')?.trim()
  return key === secret
}

/**
 * GET /api/quick-exit
 * - station / stnNm (역명)
 * - line / lineNm (호선, 예: 2호선 · seoul2 · 2)
 * - direction / upbdnbSe (상행/하행)
 * - drtn (진행 방향 역명, drtnInfo)
 * - refresh=1 + x-admin-key: 강제 갱신
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const station =
      searchParams.get('station')?.trim() ??
      searchParams.get('stnNm')?.trim() ??
      ''
    const line =
      searchParams.get('line')?.trim() ?? searchParams.get('lineNm')?.trim() ?? ''
    const direction =
      searchParams.get('direction')?.trim() ??
      searchParams.get('upbdnbSe')?.trim() ??
      ''
    const drtnInfo = searchParams.get('drtn')?.trim() ?? searchParams.get('drtnInfo')?.trim() ?? ''
    const forceRefresh =
      searchParams.get('refresh') === '1' && verifyAdminRefresh(request)

    if (!station && !line && !direction && !drtnInfo) {
      return errorResponse('station, line, direction, drtn 중 하나 이상의 조회 조건이 필요합니다.', 400)
    }

    const { row, refreshed } = await ensureFreshCache(forceRefresh)
    const items = filterCacheItems(row.payload ?? [], {
      station: station || undefined,
      line: line || undefined,
      direction: direction || undefined,
      drtnInfo: drtnInfo || undefined,
    })

    return NextResponse.json(
      {
        success: true,
        cachedAt: row.fetched_at,
        refreshed,
        totalCached: row.total_count,
        crtrYmd: row.crtr_ymd,
        count: items.length,
        items,
      },
      { headers: JSON_UTF8_HEADERS }
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : '서버 오류가 발생했습니다.'
    return errorResponse(message, 500)
  }
}
