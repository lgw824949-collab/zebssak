import { NextResponse } from 'next/server'
import {
  adjustBarvlDtSeconds,
  fetchRealtimeArrivalRows,
  fetchRealtimePositionRows,
  filterArrivalsBySubwayId,
  mapPositionRowToTrainFields,
  normalizeSeoulTrainNo,
  resolveSeoulLineName,
  resolveSeoulSubwayId,
  type SeoulArrivalRow,
} from '@/lib/seoul-metro'
import {
  filterTrainsTowardDestination,
  normalizeDirectionKey,
} from '@/lib/train-direction'
import {
  isSubwayOperatingHours,
  SUBWAY_OUTSIDE_OPERATING_HOURS_MESSAGE,
} from '@/lib/subway-operating-hours'
import {
  MOCK_LINE_1_STATIONS,
  MOCK_LINE_2_STATIONS,
  MOCK_LINE_S1_STATIONS,
  MOCK_LINE_S2_STATIONS,
  MOCK_LINE_S3_STATIONS,
  MOCK_LINE_S4_STATIONS,
  MOCK_LINE_S5_STATIONS,
  MOCK_LINE_S6_STATIONS,
  MOCK_LINE_S7_STATIONS,
  MOCK_LINE_S8_STATIONS,
  MOCK_LINE_S9_STATIONS,
} from '@/lib/mockData'

type SeoulLineParam =
  | 'seoul1'
  | 'seoul1_incheon'
  | 'seoul1_cheonan'
  | 'seoul2'
  | 'seoul3'
  | 'seoul4'
  | 'seoul5'
  | 'seoul6'
  | 'seoul7'
  | 'seoul8'
  | 'seoul9'

type SupportedLine = SeoulLineParam | 'incheon1' | 'incheon2'

export interface TrainListItem {
  train_no: string
  station_name: string
  direction: string
  direction_display: string
  is_express: boolean
  barvl_dt?: number | null
  arvl_msg2?: string | null
}

interface SeoulStationsApiTrain {
  train_no?: string
  station_name?: string
  direction?: string
  direction_code?: string
  is_express?: boolean
}

class TrainsApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'TrainsApiError'
  }
}

const SEOUL_LINES: SeoulLineParam[] = [
  'seoul1',
  'seoul1_incheon',
  'seoul1_cheonan',
  'seoul2',
  'seoul3',
  'seoul4',
  'seoul5',
  'seoul6',
  'seoul7',
  'seoul8',
  'seoul9',
]

const SUPPORTED_LINES: SupportedLine[] = [...SEOUL_LINES, 'incheon1', 'incheon2']
const SEOUL_LINE_NUM_BY_PARAM: Record<SeoulLineParam, string> = {
  seoul1: '01호선',
  seoul1_incheon: '01호선',
  seoul1_cheonan: '01호선',
  seoul2: '02호선',
  seoul3: '03호선',
  seoul4: '04호선',
  seoul5: '05호선',
  seoul6: '06호선',
  seoul7: '07호선',
  seoul8: '08호선',
  seoul9: '09호선',
}
const PUBLIC_DATA_API_HOST = 'http://openapi.seoul.go.kr:8088'
const STATION_ORDER_CACHE_TTL_MS = 1000 * 60 * 60 * 12
const stationOrderCache = new Map<
  SeoulLineParam,
  { orderedStations: readonly string[]; expiresAt: number }
>()

const STATION_ORDER_BY_LINE: Record<SupportedLine, readonly string[]> = {
  seoul1: MOCK_LINE_S1_STATIONS.map((s) => s.name),
  seoul1_incheon: MOCK_LINE_S1_STATIONS.map((s) => s.name),
  seoul1_cheonan: MOCK_LINE_S1_STATIONS.map((s) => s.name),
  seoul2: MOCK_LINE_S2_STATIONS.map((s) => s.name),
  seoul3: MOCK_LINE_S3_STATIONS.map((s) => s.name),
  seoul4: MOCK_LINE_S4_STATIONS.map((s) => s.name),
  seoul5: MOCK_LINE_S5_STATIONS.map((s) => s.name),
  seoul6: MOCK_LINE_S6_STATIONS.map((s) => s.name),
  seoul7: MOCK_LINE_S7_STATIONS.map((s) => s.name),
  seoul8: MOCK_LINE_S8_STATIONS.map((s) => s.name),
  seoul9: MOCK_LINE_S9_STATIONS.map((s) => s.name),
  incheon1: MOCK_LINE_1_STATIONS.map((s) => s.name),
  incheon2: MOCK_LINE_2_STATIONS.map((s) => s.name),
}


/** 상행·내선(1) / 하행·외선(2) 종착역명 (현재 위치 → 해당 방면) */
const TERMINAL_BY_LINE: Record<SupportedLine, { up: string; down: string }> = {
  seoul1: { up: '소요산', down: '인천·신창' },
  seoul1_incheon: { up: '소요산', down: '인천' },
  seoul1_cheonan: { up: '소요산', down: '천안·신창' },
  seoul3: { up: '대화', down: '오금' },
  seoul4: { up: '당고개', down: '오이도' },
  seoul5: { up: '방화', down: '마천·하남' },
  seoul6: { up: '응암', down: '신내' },
  seoul7: { up: '장암', down: '부천종합운동장' },
  seoul8: { up: '암사', down: '모란' },
  seoul9: { up: '개화', down: '중앙보훈병원' },
  incheon1: { up: '검단호수공원', down: '국제업무지구' },
  incheon2: { up: '운연', down: '검단오류' },
  seoul2: { up: '', down: '' },
}

const S1_INCHEON_BRANCH_STATIONS = new Set([
  '구로',
  '구일',
  '개봉',
  '오류동',
  '온수',
  '역곡',
  '소사',
  '부천',
  '중동',
  '송내',
  '부개',
  '부평',
  '백운',
  '동암',
  '간석',
  '주안',
  '도화',
  '제물포',
  '도원',
  '동인천',
  '인천',
].map(normalizeStationName))

const S1_CHEONAN_BRANCH_STATIONS = new Set([
  '구로',
  '가산디지털단지',
  '독산',
  '금천구청',
  '석수',
  '관악',
  '안양',
  '명학',
  '금정',
  '군포',
  '당정',
  '의왕',
  '성균관대',
  '화서',
  '수원',
  '세류',
  '병점',
  '세마',
  '오산대',
  '오산',
  '진위',
  '송탄',
  '서정리',
  '지제',
  '평택',
  '성환',
  '직산',
  '두정',
  '천안',
  '봉명',
  '쌍용',
  '아산',
  '배방',
  '온양온천',
  '신창',
].map(normalizeStationName))

/** 인천 1호선 목업 (API 미승인) */
const INCHEON1_MOCK_TRAINS: Omit<TrainListItem, 'direction_display'>[] = [
  { train_no: '1101', station_name: '부평', direction: '상행', is_express: false },
  { train_no: '1102', station_name: '예술회관', direction: '하행', is_express: false },
  { train_no: '1103', station_name: '국제업무지구', direction: '상행', is_express: false },
  { train_no: '1104', station_name: '계양', direction: '하행', is_express: false },
]

/** 인천 2호선 목업 (API 미승인) */
const INCHEON2_MOCK_TRAINS: Omit<TrainListItem, 'direction_display'>[] = [
  { train_no: '2201', station_name: '검단오류', direction: '상행', is_express: false },
  { train_no: '2202', station_name: '석남', direction: '하행', is_express: false },
  { train_no: '2203', station_name: '운연', direction: '상행', is_express: false },
  { train_no: '2204', station_name: '왕길', direction: '하행', is_express: false },
]

const JSON_UTF8_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
} as const

function errorResponse(message: string, status: number) {
  return NextResponse.json(
    { success: false, error: message },
    { status, headers: JSON_UTF8_HEADERS }
  )
}

function isSeoulLine(value: string): value is SeoulLineParam {
  return SEOUL_LINES.includes(value as SeoulLineParam)
}

function isSupportedLine(value: string): value is SupportedLine {
  return SUPPORTED_LINES.includes(value as SupportedLine)
}

function toBaseSeoulLine(seoulLine: SeoulLineParam): 'seoul1' | 'seoul2' | 'seoul3' | 'seoul4' | 'seoul5' | 'seoul6' | 'seoul7' | 'seoul8' | 'seoul9' {
  if (seoulLine === 'seoul1_incheon' || seoulLine === 'seoul1_cheonan') return 'seoul1'
  return seoulLine
}

function normalizeStationName(name: string): string {
  return name.trim().replace(/\s+/g, '').replace(/역$/u, '')
}

function getPublicDataApiKey(): string | null {
  const key = process.env.PUBLIC_DATA_API_KEY?.trim()
  return key ? key : null
}

function buildStationInfoApiUrl(apiKey: string, stationName: string): string {
  const encodedStation = encodeURIComponent(stationName.trim())
  return `${PUBLIC_DATA_API_HOST}/${encodeURIComponent(apiKey)}/json/SearchInfoBySubwayNameService/1/20/${encodedStation}`
}

function parseFrCodeOrder(frCode: string | undefined): number | null {
  if (!frCode) return null
  const normalized = frCode.replace(/[^\d]/g, '')
  if (!normalized) return null
  const order = Number.parseInt(normalized, 10)
  return Number.isFinite(order) ? order : null
}

async function fetchStationOrderFromPublicData(
  line: SeoulLineParam
): Promise<readonly string[] | null> {
  const cached = stationOrderCache.get(line)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.orderedStations
  }

  const apiKey = getPublicDataApiKey()
  if (!apiKey) return null

  const lineNum = SEOUL_LINE_NUM_BY_PARAM[line]
  const fallbackOrder = STATION_ORDER_BY_LINE[line]
  const rows: Array<{ name: string; order: number }> = []

  await Promise.all(
    fallbackOrder.map(async (stationName) => {
      try {
        const response = await fetch(buildStationInfoApiUrl(apiKey, stationName), {
          method: 'GET',
          headers: { Accept: 'application/json' },
          cache: 'no-store',
          signal: AbortSignal.timeout(3000),
        })
        if (!response.ok) return

        const payload = (await response.json()) as {
          SearchInfoBySubwayNameService?: {
            RESULT?: { CODE?: string }
            row?: Array<{ STATION_NM?: string; LINE_NUM?: string; FR_CODE?: string }>
          }
        }
        const service = payload.SearchInfoBySubwayNameService
        if (service?.RESULT?.CODE !== 'INFO-000' || !Array.isArray(service.row)) return

        const matched = service.row.find((item) => item.LINE_NUM?.trim() === lineNum)
        const order = parseFrCodeOrder(matched?.FR_CODE)
        const name = matched?.STATION_NM?.trim()
        if (!name || order === null) return
        rows.push({ name, order })
      } catch {
        // 공공데이터 API 일부 실패 시 목업 역순서로 폴백합니다.
      }
    })
  )

  const orderedStations = rows
    .sort((a, b) => a.order - b.order)
    .map((row) => row.name)
    .filter((name, index, arr) => arr.indexOf(name) === index)

  if (orderedStations.length < Math.max(8, Math.floor(fallbackOrder.length * 0.6))) {
    return null
  }

  stationOrderCache.set(line, {
    orderedStations,
    expiresAt: Date.now() + STATION_ORDER_CACHE_TTL_MS,
  })
  return orderedStations
}

function resolveStationIndex(
  stationName: string | null,
  stationIndexMap: Map<string, number>
): number | null {
  if (!stationName) return null
  const index = stationIndexMap.get(normalizeStationName(stationName))
  return index === undefined ? null : index
}

/**
 * 현재 위치 기준 방향 표기.
 * - 2호선: 내선 → 기준역 순환상 이전역, 외선 → 다음역 (예: 교대 → 강남/서초 방면)
 * - 그 외: 상행·내선 → 종착 상단, 하행·외선 → 종착 하단
 */
function computeDirectionDisplay(
  line: SupportedLine,
  direction: string,
  currentStation: string | null,
  trainStation: string
): string {
  const dirKey = normalizeDirectionKey(direction)
  if (!dirKey) return '방향 미상'

  const stationOrder = STATION_ORDER_BY_LINE[line]
  const stationIndexMap = buildStationIndexMap(stationOrder)

  if (line === 'seoul2') {
    const refIdx =
      resolveStationIndex(currentStation, stationIndexMap) ??
      resolveStationIndex(trainStation, stationIndexMap)
    if (refIdx === null) return '방향 미상'

    const count = stationOrder.length
    const adjacentIdx =
      dirKey === 'up' ? (refIdx - 1 + count) % count : (refIdx + 1) % count
    return `${stationOrder[adjacentIdx]} 방면`
  }

  const terminals = TERMINAL_BY_LINE[line]
  const terminalName = dirKey === 'up' ? terminals.up : terminals.down
  return terminalName ? `${terminalName} 방면` : '방향 미상'
}

function buildStationIndexMap(stationOrder: readonly string[]): Map<string, number> {
  const map = new Map<string, number>()
  stationOrder.forEach((name, index) => {
    map.set(normalizeStationName(name), index)
  })
  return map
}

function stationDistance(
  stationIndexMap: Map<string, number>,
  fromStation: string | null,
  trainStation: string
): number {
  if (!fromStation) return Number.POSITIVE_INFINITY

  const fromIndex = stationIndexMap.get(normalizeStationName(fromStation))
  const trainIndex = stationIndexMap.get(normalizeStationName(trainStation))

  if (fromIndex === undefined || trainIndex === undefined) {
    return Number.POSITIVE_INFINITY
  }

  return Math.abs(fromIndex - trainIndex)
}

function resolveTrainArrivalSortKey(barvlDt: number | null | undefined): number {
  if (barvlDt == null || !Number.isFinite(barvlDt) || barvlDt < 0) {
    return Number.POSITIVE_INFINITY
  }
  return barvlDt
}

/** 탑승역 기준 열차 목록 — 도착 시간 빠른 순, 동률 시 현재 위치 거리순 */
function sortTrainsForBoarding(
  trains: TrainListItem[],
  stationOrder: readonly string[],
  currentStation: string | null
): TrainListItem[] {
  const stationIndexMap = buildStationIndexMap(stationOrder)

  return [...trains].sort((a, b) => {
    const arrivalA = resolveTrainArrivalSortKey(a.barvl_dt)
    const arrivalB = resolveTrainArrivalSortKey(b.barvl_dt)

    if (arrivalA !== arrivalB) {
      return arrivalA - arrivalB
    }

    const distA = stationDistance(stationIndexMap, currentStation, a.station_name)
    const distB = stationDistance(stationIndexMap, currentStation, b.station_name)

    if (distA !== distB) return distA - distB

    // 기본 목록은 완행을 먼저 보여 줍니다(급행 자동 우선 방지).
    return (a.is_express ? 1 : 0) - (b.is_express ? 1 : 0)
  })
}

/** 서울 실시간 API 지연·오류 시 목업 열차로 즉시 응답 */
function buildSeoulFallbackTrains(
  seoulLine: SeoulLineParam,
  currentStation: string | null
): TrainListItem[] {
  const order = STATION_ORDER_BY_LINE[seoulLine]
  const stationIndexMap = buildStationIndexMap(order)
  const refIdx =
    resolveStationIndex(currentStation, stationIndexMap) ??
    Math.floor(order.length / 2)
  const baseIdx = refIdx >= 0 ? refIdx : 0
  const lineDigits = toBaseSeoulLine(seoulLine).replace('seoul', '')
  const templates: Omit<TrainListItem, 'direction_display'>[] = [
    {
      train_no: `${lineDigits}01`,
      station_name: order[baseIdx] ?? order[0],
      direction: '상행',
      is_express: false,
    },
    {
      train_no: `${lineDigits}02`,
      station_name: order[(baseIdx + 1) % order.length] ?? order[0],
      direction: '하행',
      is_express: false,
    },
    {
      train_no: `${lineDigits}03`,
      station_name: order[(baseIdx + 2) % order.length] ?? order[0],
      direction: '상행',
      is_express: false,
    },
    {
      train_no: `${lineDigits}04`,
      station_name: order[(baseIdx + 3) % order.length] ?? order[0],
      direction: '하행',
      is_express: false,
    },
  ]

  const enriched = templates.map((train) => enrichTrain(train, seoulLine, currentStation))
  return applyEstimatedArrivalToTrains(enriched, seoulLine, currentStation)
}

function enrichTrain(
  train: Omit<TrainListItem, 'direction_display'>,
  line: SupportedLine,
  currentStation: string | null
): TrainListItem {
  return {
    ...train,
    direction_display: computeDirectionDisplay(
      line,
      train.direction,
      currentStation,
      train.station_name
    ),
  }
}

function buildArrivalLookup(rows: SeoulArrivalRow[]): Map<string, SeoulArrivalRow> {
  const map = new Map<string, SeoulArrivalRow>()
  for (const row of rows) {
    const trainNo = row.btrainNo?.trim()
    if (!trainNo) continue
    const key = normalizeSeoulTrainNo(trainNo)
    if (!map.has(key)) {
      map.set(key, row)
    }
  }
  return map
}

function mergeArrivalIntoTrains(
  trains: TrainListItem[],
  arrivals: SeoulArrivalRow[]
): TrainListItem[] {
  const lookup = buildArrivalLookup(arrivals)
  if (lookup.size === 0) return trains

  return trains.map((train) => {
    const arrival = lookup.get(normalizeSeoulTrainNo(train.train_no))
    if (!arrival) return train

    return {
      ...train,
      barvl_dt: adjustBarvlDtSeconds(arrival.barvlDt, arrival.recptnDt),
      arvl_msg2: arrival.arvlMsg2?.trim() || null,
    }
  })
}

function mapArrivalToTrain(
  row: SeoulArrivalRow,
  line: SeoulLineParam,
  currentStation: string
): TrainListItem | null {
  const trainNo = row.btrainNo?.trim()
  const direction = row.updnLine?.trim()
  if (!trainNo || !direction) return null

  return enrichTrain(
    {
      train_no: trainNo,
      station_name: currentStation,
      direction,
      is_express: row.btrainSttus?.includes('급행') ?? false,
      barvl_dt: adjustBarvlDtSeconds(row.barvlDt, row.recptnDt),
      arvl_msg2: row.arvlMsg2?.trim() || null,
    },
    line,
    currentStation
  )
}

function isFallbackMockTrain(train: TrainListItem): boolean {
  return /^10[1-4]$/.test(train.train_no)
}

function applyEstimatedArrivalToTrains(
  trains: TrainListItem[],
  seoulLine: SeoulLineParam,
  currentStation: string | null
): TrainListItem[] {
  if (!currentStation?.trim()) return trains

  const stationOrder = STATION_ORDER_BY_LINE[seoulLine]
  const stationIndexMap = buildStationIndexMap(stationOrder)
  const currentIdx = resolveStationIndex(currentStation, stationIndexMap)
  if (currentIdx === null) return trains

  const count = stationOrder.length
  const secondsPerStation = seoulLine === 'seoul2' ? 90 : 120

  return trains.map((train) => {
    if (train.barvl_dt != null || train.arvl_msg2) return train

    const trainIdx = resolveStationIndex(train.station_name, stationIndexMap)
    if (trainIdx === null) return train

    const linear = Math.abs(trainIdx - currentIdx)
    const wrap = count > 0 ? count - linear : linear
    const distance = seoulLine === 'seoul2' ? Math.min(linear, wrap) : linear
    const seconds = distance === 0 ? 45 : distance * secondsPerStation

    return {
      ...train,
      barvl_dt: seconds,
    }
  })
}

async function enrichSeoulTrainsWithArrival(
  seoulLine: SeoulLineParam,
  trains: TrainListItem[],
  currentStation: string | null,
  arrivalsPreloaded?: SeoulArrivalRow[]
): Promise<TrainListItem[]> {
  if (!currentStation?.trim()) {
    return applyEstimatedArrivalToTrains(trains, seoulLine, currentStation)
  }

  const stationName = currentStation.trim().replace(/역$/u, '')
  const subwayId = resolveSeoulSubwayId(seoulLine)
  const arrivals = filterArrivalsBySubwayId(arrivalsPreloaded ?? [], subwayId)

  if (arrivals.length > 0) {
    const arrivalTrains = arrivals
      .map((row) => mapArrivalToTrain(row, seoulLine, stationName))
      .filter((train): train is TrainListItem => train !== null)

    if (arrivalTrains.length > 0) {
      const positionByNo = new Map(
        trains.map((train) => [normalizeSeoulTrainNo(train.train_no), train])
      )

      const mergedFromArrival = arrivalTrains.map((train) => {
        const position = positionByNo.get(normalizeSeoulTrainNo(train.train_no))
        if (!position) return train
        return {
          ...train,
          station_name: position.station_name,
          is_express: position.is_express,
        }
      })

      return mergedFromArrival.sort((a, b) => (a.barvl_dt ?? 99999) - (b.barvl_dt ?? 99999))
    }
  }

  const merged = mergeArrivalIntoTrains(trains, arrivals)
  const usingFallbackOnly =
    trains.length > 0 && trains.every(isFallbackMockTrain) && merged.every(isFallbackMockTrain)

  if (usingFallbackOnly) {
    const fromArrival = arrivals
      .map((row) => mapArrivalToTrain(row, seoulLine, stationName))
      .filter((train): train is TrainListItem => train !== null)
    if (fromArrival.length > 0) {
      return fromArrival.sort((a, b) => (a.barvl_dt ?? 99999) - (b.barvl_dt ?? 99999))
    }
  }

  return applyEstimatedArrivalToTrains(merged, seoulLine, currentStation)
}

function mapSeoulTrain(
  train: SeoulStationsApiTrain,
  line: SeoulLineParam,
  currentStation: string | null
): TrainListItem | null {
  const trainNo = train.train_no?.trim()
  const stationName = train.station_name?.trim()
  const direction = train.direction?.trim()

  if (!trainNo || !stationName || !direction) {
    return null
  }

  return enrichTrain(
    {
      train_no: trainNo,
      station_name: stationName,
      direction,
      is_express: train.is_express === true,
    },
    line,
    currentStation
  )
}

function filterSeoul1BranchTrains(
  trains: TrainListItem[],
  line: SeoulLineParam
): TrainListItem[] {
  // 1호선 분기 노선(인천/천안)일 때만 분기 필터를 적용합니다.
  if (line !== 'seoul1_incheon' && line !== 'seoul1_cheonan') {
    return trains
  }

  const branchStations =
    line === 'seoul1_incheon' ? S1_INCHEON_BRANCH_STATIONS : S1_CHEONAN_BRANCH_STATIONS

  return trains.filter((train) => {
    const directionKey = normalizeDirectionKey(train.direction)
    if (directionKey !== 'down') return false
    return branchStations.has(normalizeStationName(train.station_name))
  })
}

/** seoul1~9: 실시간 위치 + 역 도착 API 병렬 조회 */
async function fetchSeoulTrains(
  request: Request,
  seoulLine: SeoulLineParam,
  currentStation: string | null,
  operatingHours: boolean
): Promise<TrainListItem[]> {
  const lineName = resolveSeoulLineName(toBaseSeoulLine(seoulLine))
  if (!lineName) {
    return operatingHours
      ? buildSeoulFallbackTrains(seoulLine, currentStation)
      : []
  }

  const stationName = currentStation?.trim().replace(/역$/u, '') ?? ''
  const [positionRows, arrivalRows] = await Promise.all([
    fetchRealtimePositionRows(request, lineName),
    stationName
      ? fetchRealtimeArrivalRows(request, stationName)
      : Promise.resolve([] as SeoulArrivalRow[]),
  ])

  if (!operatingHours && positionRows.length === 0) {
    return []
  }

  let mapped: TrainListItem[]
  if (positionRows.length === 0) {
    mapped = buildSeoulFallbackTrains(seoulLine, currentStation)
  } else {
    mapped = filterSeoul1BranchTrains(
      positionRows
        .map((row) => {
          const fields = mapPositionRowToTrainFields(row, lineName)
          if (!fields) return null
          return mapSeoulTrain(
            {
              train_no: fields.train_no,
              station_name: fields.station_name,
              direction: fields.direction,
              direction_code: fields.direction_code,
              is_express: fields.is_express,
            },
            seoulLine,
            currentStation
          )
        })
        .filter((train): train is TrainListItem => train !== null),
      seoulLine
    )
  }

  return enrichSeoulTrainsWithArrival(
    seoulLine,
    mapped,
    currentStation,
    arrivalRows
  )
}

/**
 * GET /api/trains?line=seoul1~seoul9|incheon1|incheon2&current_station=송내&station=강남
 * — 호선별 열차 목록 (목적지 방향 필터 + 현재 역 기준 가까운 순)
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams
    const line = searchParams.get('line')?.trim()
    const currentStation = searchParams.get('current_station')?.trim() || null
    const destinationStation = searchParams.get('station')?.trim() || null

    if (!line) {
      return errorResponse('line 파라미터가 필요합니다.', 400)
    }

    if (!isSupportedLine(line)) {
      return errorResponse(
        `지원하지 않는 line 값입니다. (${SUPPORTED_LINES.join(', ')})`,
        400
      )
    }

    let trains: TrainListItem[]
    let stationOrder = STATION_ORDER_BY_LINE[line]
    const operatingHours = isSubwayOperatingHours(line)

    if (isSeoulLine(line)) {
      // 공공데이터 역순 조회는 느려 기본 목록으로 정렬하고, 캐시만 백그라운드 갱신합니다.
      stationOrder = STATION_ORDER_BY_LINE[line]
      void fetchStationOrderFromPublicData(line).catch(() => {
        // 역순 캐시 갱신 실패는 무시합니다.
      })
      trains = await fetchSeoulTrains(
        request,
        line,
        currentStation,
        operatingHours
      )
    } else if (line === 'incheon1') {
      trains = operatingHours
        ? INCHEON1_MOCK_TRAINS.map((train) =>
            enrichTrain(train, 'incheon1', currentStation)
          )
        : []
    } else {
      trains = operatingHours
        ? INCHEON2_MOCK_TRAINS.map((train) =>
            enrichTrain(train, 'incheon2', currentStation)
          )
        : []
    }

    trains = filterTrainsTowardDestination(
      trains,
      line,
      stationOrder,
      currentStation,
      destinationStation
    )
    if (isSeoulLine(line)) {
      trains = applyEstimatedArrivalToTrains(trains, line, currentStation)
    }

    trains = sortTrainsForBoarding(trains, stationOrder, currentStation)

    return NextResponse.json(
      {
        trains,
        station_order: stationOrder,
        is_operating_hours: operatingHours,
        operating_hours_message: operatingHours
          ? null
          : SUBWAY_OUTSIDE_OPERATING_HOURS_MESSAGE,
      },
      { headers: JSON_UTF8_HEADERS }
    )
  } catch (error) {
    if (error instanceof TrainsApiError) {
      return errorResponse(error.message, error.status)
    }

    return errorResponse('서버 오류가 발생했습니다.', 500)
  }
}
