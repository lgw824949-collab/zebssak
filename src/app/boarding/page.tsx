'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useMemo, useState } from 'react'
import {
  MOCK_ALL_STATIONS,
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
  type LineNumber,
  type MockStation,
} from '@/lib/mockData'

type BoardingRole = 'seeker' | 'provider'
type BoardingLine =
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
  | 'incheon1'
  | 'incheon2'
type SeatSide = 'A' | 'B'
type SeatType = 'elderly' | 'normal'
type SelectedSeat = { face: SeatSide; number: number; type: SeatType } | null
type SpeechRecognitionInstance = {
  lang: string
  continuous?: boolean
  interimResults: boolean
  maxAlternatives: number
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: { error?: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}
type SpeechRecognitionCtor = new () => SpeechRecognitionInstance
type SpeechRecognitionResultLike = { transcript?: string }
type SpeechRecognitionEventLike = {
  results?: ArrayLike<ArrayLike<SpeechRecognitionResultLike>>
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
}

const CAR_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8] as const
const ALL_STATION_NAMES = Array.from(
  new Set(MOCK_ALL_STATIONS.map((station) => station.name.trim()).filter(Boolean))
).sort((a, b) => b.length - a.length)

const COMPLETION_NOTICE_KEY = 'boardingCompletionNotice'

type BoardingType = 'seek' | 'leave'

const BOARDING_MODE_META: Record<
  BoardingType,
  { title: string; badge: string; submitLabel: string; role: BoardingRole }
> = {
  seek: {
    title: '?? ???',
    badge: '?? ??',
    submitLabel: '?? ??? ??',
    role: 'seeker',
  },
  leave: {
    title: '????',
    badge: '?? ??',
    submitLabel: '???? ??',
    role: 'provider',
  },
}

function resolveBoardingType(
  typeParam: string | null,
  roleParam: string | null
): BoardingType | null {
  if (typeParam === 'seek' || typeParam === 'leave') {
    return typeParam
  }
  if (roleParam === 'seeker') {
    return 'seek'
  }
  if (roleParam === 'provider') {
    return 'leave'
  }
  return null
}

/** ???draft? ??? (lineKey ?? ?? ??) */
const LINE_LABEL_BY_KEY: Record<BoardingLine, string> = {
  seoul1_incheon: '??1 ??',
  seoul1_cheonan: '??1 ??',
  seoul2: '?? 2??',
  seoul3: '?? 3??',
  seoul4: '?? 4??',
  seoul5: '?? 5??',
  seoul6: '?? 6??',
  seoul7: '?? 7??',
  seoul8: '?? 8??',
  seoul9: '?? 9??',
  incheon1: '?? 1??',
  incheon2: '?? 2??',
}

/** /api/trains line ???? (1?? ??? ?? ??? 1?? ??? ??) */
const TRAINS_API_LINE: Record<BoardingLine, string> = {
  seoul1_incheon: 'seoul1_incheon',
  seoul1_cheonan: 'seoul1_cheonan',
  seoul2: 'seoul2',
  seoul3: 'seoul3',
  seoul4: 'seoul4',
  seoul5: 'seoul5',
  seoul6: 'seoul6',
  seoul7: 'seoul7',
  seoul8: 'seoul8',
  seoul9: 'seoul9',
  incheon1: 'incheon1',
  incheon2: 'incheon2',
}

const STATIONS_API_LINE: Record<BoardingLine, string> = {
  seoul1_incheon: 'seoul1',
  seoul1_cheonan: 'seoul1',
  seoul2: 'seoul2',
  seoul3: 'seoul3',
  seoul4: 'seoul4',
  seoul5: 'seoul5',
  seoul6: 'seoul6',
  seoul7: 'seoul7',
  seoul8: 'seoul8',
  seoul9: 'seoul9',
  incheon1: 'incheon1',
  incheon2: 'incheon2',
}

const LINE_OPTIONS: Array<{
  key: BoardingLine
  label: string
  color: string
}> = [
  { key: 'incheon1', label: LINE_LABEL_BY_KEY.incheon1, color: '#7CA8D5' },
  { key: 'incheon2', label: LINE_LABEL_BY_KEY.incheon2, color: '#F5A200' },
  { key: 'seoul1_incheon', label: LINE_LABEL_BY_KEY.seoul1_incheon, color: '#0052A4' },
  { key: 'seoul1_cheonan', label: LINE_LABEL_BY_KEY.seoul1_cheonan, color: '#0052A4' },
  { key: 'seoul2', label: LINE_LABEL_BY_KEY.seoul2, color: '#00A84D' },
  { key: 'seoul3', label: LINE_LABEL_BY_KEY.seoul3, color: '#EF7C1C' },
  { key: 'seoul4', label: LINE_LABEL_BY_KEY.seoul4, color: '#00A5DE' },
  { key: 'seoul5', label: LINE_LABEL_BY_KEY.seoul5, color: '#996CAC' },
  { key: 'seoul6', label: LINE_LABEL_BY_KEY.seoul6, color: '#CD7C2F' },
  { key: 'seoul7', label: LINE_LABEL_BY_KEY.seoul7, color: '#747F00' },
  { key: 'seoul8', label: LINE_LABEL_BY_KEY.seoul8, color: '#E6186C' },
  { key: 'seoul9', label: LINE_LABEL_BY_KEY.seoul9, color: '#BDB092' },
]

/** ?? 1?? ????: ??? ~ ?? */
const S1_INCHEON_STATIONS: MockStation[] = (() => {
  const incheonIndex = MOCK_LINE_S1_STATIONS.findIndex((station) => station.name === '??')
  if (incheonIndex < 0) {
    return MOCK_LINE_S1_STATIONS
  }
  return MOCK_LINE_S1_STATIONS.slice(0, incheonIndex + 1)
})()

/** ?? 1?? ??/????: ?? ?? ?? ??? ?? */
const S1_CHEONAN_STATIONS: MockStation[] = (() => {
  const guroIndex = MOCK_LINE_S1_STATIONS.findIndex((station) => station.name === '???????')
  const branchStartIndex = MOCK_LINE_S1_STATIONS.findIndex(
    (station) => station.name === '???????'
  )
  if (guroIndex < 0 || branchStartIndex < 0) return MOCK_LINE_S1_STATIONS
  return [
    ...MOCK_LINE_S1_STATIONS.slice(0, guroIndex + 1),
    ...MOCK_LINE_S1_STATIONS.slice(branchStartIndex),
  ]
})()

/** ??? ??????? ?? */
const STATIONS_BY_LINE: Record<BoardingLine, MockStation[]> = {
  seoul1_incheon: S1_INCHEON_STATIONS,
  seoul1_cheonan: S1_CHEONAN_STATIONS,
  seoul2: MOCK_LINE_S2_STATIONS,
  seoul3: MOCK_LINE_S3_STATIONS,
  seoul4: MOCK_LINE_S4_STATIONS,
  seoul5: MOCK_LINE_S5_STATIONS,
  seoul6: MOCK_LINE_S6_STATIONS,
  seoul7: MOCK_LINE_S7_STATIONS,
  seoul8: MOCK_LINE_S8_STATIONS,
  seoul9: MOCK_LINE_S9_STATIONS,
  incheon1: MOCK_LINE_1_STATIONS,
  incheon2: MOCK_LINE_2_STATIONS,
}

interface TrainListItem {
  train_no: string
  station_name: string
  direction: string
  direction_display: string
  is_express: boolean
}

function buildTrainsApiUrl(apiLine: string, currentStation: string | null): string {
  const params = new URLSearchParams({ line: apiLine })
  const station = currentStation?.trim()
  if (station) {
    params.set('current_station', station)
  }
  return `/api/trains?${params.toString()}`
}

function buildStationsApiUrl(apiLine: string): string {
  const params = new URLSearchParams({ line: apiLine })
  return `/api/stations?${params.toString()}`
}

interface TrainsApiResponse {
  success?: boolean
  error?: string
  trains?: TrainListItem[]
  station_order?: string[]
}

interface StationsApiResponse {
  success?: boolean
  error?: string
  stations?: Array<{ name?: string; order?: number; lat?: number | null; lng?: number | null }>
}

const SEAT_STRUCTURE = [
  { type: 'door' },
  { type: 'elderly' },
  { type: 'elderly' },
  { type: 'door' },
  { type: 'normal' },
  { type: 'normal' },
  { type: 'normal' },
  { type: 'normal' },
  { type: 'normal' },
  { type: 'normal' },
  { type: 'door' },
  { type: 'normal' },
  { type: 'normal' },
  { type: 'normal' },
  { type: 'normal' },
  { type: 'normal' },
  { type: 'normal' },
  { type: 'door' },
  { type: 'normal' },
  { type: 'normal' },
  { type: 'normal' },
  { type: 'normal' },
  { type: 'normal' },
  { type: 'normal' },
  { type: 'door' },
  { type: 'elderly' },
  { type: 'elderly' },
  { type: 'door' },
] as const

interface BoardingDraft {
  role: BoardingRole
  lineKey: BoardingLine
  lineLabel: string
  /** ?? API? (?? 1?1, ? ? 2; ?? ??? lineKey? ??) */
  lineNumber: LineNumber
  trainNo: string
  carNumber: number
  boardingStationId: string
  boardingStationName: string
  destinationId: string
  destinationName: string
  remainingStations: number
  seatSide?: SeatSide
  seatNumber?: number
}

function mapLineNumberForMatchApi(line: BoardingLine): LineNumber {
  return line === 'incheon1' ? 1 : 2
}

function resolveLineLabel(line: BoardingLine): string {
  return LINE_LABEL_BY_KEY[line] ?? ''
}

/** API ??? ?? ? ??? ?? */
function resolveStationByName(
  stations: MockStation[],
  stationName: string
): MockStation | undefined {
  const trimmed = stationName.trim()
  const withoutSuffix = trimmed.replace(/?$/, '')

  return (
    stations.find((station) => station.name === trimmed) ??
    stations.find((station) => station.name === withoutSuffix) ??
    stations.find(
      (station) => trimmed.includes(station.name) || station.name.includes(withoutSuffix)
    )
  )
}

function normalizeDirectionKey(direction: string | null | undefined): 'up' | 'down' | null {
  const value = direction?.trim()
  if (!value) return null
  if (value === '??' || value === '??' || value === '1') return 'up'
  if (value === '??' || value === '??' || value === '2') return 'down'
  return null
}

const MIN_DESTINATION_STOPS = 1
/** ?? ?? ?? 20? ??? ?? ??? ? ?? */
const LOOP_MAX_DESTINATION_STOPS = 20

function resolveSeoul2DirectionStep(
  loopStations: MockStation[],
  currentStationName: string,
  directionDisplay: string,
  fallbackDirectionKey: 'up' | 'down'
): 1 | -1 {
  const current = resolveStationByName(loopStations, currentStationName)
  if (!current) return fallbackDirectionKey === 'up' ? -1 : 1

  const currentIdx = current.order - 1
  const count = loopStations.length
  const nextStation = loopStations[(currentIdx + 1) % count]
  const prevStation = loopStations[(currentIdx - 1 + count) % count]
  const target = normalizeStationName(directionDisplay.replace(/\s*?$/, ''))

  if (normalizeStationName(nextStation.name) === target) return 1
  if (normalizeStationName(prevStation.name) === target) return -1
  return fallbackDirectionKey === 'up' ? -1 : 1
}

function resolveLinearDirectionStep(
  stations: MockStation[],
  currentStationName: string,
  directionDisplay: string,
  fallbackDirectionKey: 'up' | 'down'
): 1 | -1 {
  const current = resolveStationByName(stations, currentStationName)
  if (!current) return fallbackDirectionKey === 'up' ? -1 : 1

  const targetName = directionDisplay.replace(/\s*?$/, '').trim()
  const target = resolveStationByName(stations, targetName)
  if (!target) return fallbackDirectionKey === 'up' ? -1 : 1

  if (target.order === current.order) return fallbackDirectionKey === 'up' ? -1 : 1
  return target.order > current.order ? 1 : -1
}

function normalizeStationName(name: string): string {
  return name.trim().replace(/\s+/g, '').replace(/?$/, '')
}

function reorderStationsByNameOrder(
  stations: MockStation[],
  stationNameOrder: readonly string[]
): MockStation[] {
  if (stationNameOrder.length === 0) return stations

  const byNormalizedName = new Map<string, MockStation>()
  for (const station of stations) {
    byNormalizedName.set(normalizeStationName(station.name), station)
  }

  const ordered: MockStation[] = []
  const usedIds = new Set<string>()

  for (const stationName of stationNameOrder) {
    const matched = byNormalizedName.get(normalizeStationName(stationName))
    if (!matched || usedIds.has(matched.id)) continue
    usedIds.add(matched.id)
    ordered.push(matched)
  }

  for (const station of stations) {
    if (!usedIds.has(station.id)) {
      ordered.push(station)
    }
  }

  return ordered.map((station, index) => ({ ...station, order: index + 1 }))
}

function distanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRad = (v: number) => (v * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function findStationNameInPhrase(phrase: string): string | null {
  const normalizedPhrase = phrase.replace(/\s+/g, '').replace(/?/g, '')
  if (!normalizedPhrase) return null

  const aliasMap: Record<string, string> = {
    ?????????: '?????????',
  }
  const aliased = aliasMap[normalizedPhrase] ?? normalizedPhrase

  for (const stationName of ALL_STATION_NAMES) {
    const normalizedStation = stationName.replace(/\s+/g, '').replace(/?/g, '')
    if (
      normalizedStation &&
      (aliased.includes(normalizedStation) ||
        (aliased.length >= 2 && normalizedStation.includes(aliased)))
    ) {
      return stationName
    }
  }
  return null
}

function findStationMentionsInText(text: string): Array<{ name: string; index: number }> {
  const compact = text.replace(/\s+/g, '').replace(/?/g, '')
  const mentions = new Map<string, number>()

  for (const stationName of ALL_STATION_NAMES) {
    const normalizedStation = stationName.replace(/\s+/g, '').replace(/?/g, '')
    if (!normalizedStation) continue
    const idx = compact.indexOf(normalizedStation)
    if (idx >= 0) {
      const prev = mentions.get(stationName)
      if (prev === undefined || idx < prev) mentions.set(stationName, idx)
    }
  }

  const tokens = compact.match(/[?-?0-9]+/g) ?? []
  const stopWords = new Set(['??', '??', '???', '???'])
  for (const token of tokens) {
    if (token.length < 2 || stopWords.has(token)) continue
    const matched = findStationNameInPhrase(token)
    if (!matched) continue
    const idx = compact.indexOf(token)
    if (idx < 0) continue
    const prev = mentions.get(matched)
    if (prev === undefined || idx < prev) mentions.set(matched, idx)
  }

  return [...mentions.entries()]
    .map(([name, index]) => ({ name, index }))
    .sort((a, b) => a.index - b.index)
}

function parseVoiceRoute(rawText: string): { origin: string; destination: string } | null {
  const text = rawText.trim()
  if (!text) return null

  const compact = text.replace(/\s+/g, '')
  const fromMatch = compact.match(/^(.+?)??(.+)$/)
  if (fromMatch) {
    const origin = findStationNameInPhrase(fromMatch[1] ?? '')
    const destinationPhrase = (fromMatch[2] ?? '').replace(
      /(??|??|?|??|???|???|???|???)\s*$/g,
      ''
    )
    const destination = findStationNameInPhrase(destinationPhrase)
    if (origin && destination) {
      return { origin, destination }
    }
  }

  const mentions = findStationMentionsInText(compact)
  if (mentions.length < 2) return null

  const origin = mentions[0].name
  let destination = mentions[1].name

  const destinationCue = compact.search(/(??|???|???)/)
  if (destinationCue >= 0) {
    const beforeCue = mentions.filter((m) => m.index < destinationCue)
    if (beforeCue.length > 0) {
      destination = beforeCue[beforeCue.length - 1].name
    }
  }

  if (!origin || !destination) return null
  return { origin, destination }
}

function parseKoreanNumber(token: string): number | null {
  const value = token.trim()
  const map: Record<string, number> = {
    ?: 1,
    ?: 2,
    ?: 3,
    ?: 4,
    ?: 5,
    ?: 6,
    ?: 7,
    ?: 8,
    ?: 1,
    ?: 2,
    ?: 3,
    ?: 4,
    1: 1,
    2: 2,
    3: 3,
    4: 4,
    5: 5,
    6: 6,
    7: 7,
    8: 8,
  }
  return map[value] ?? null
}

function parseCarAndDoor(
  rawText: string
): { carNumber: number; doorPosition: number | null } | null {
  const compact = rawText.replace(/\s+/g, '').toLowerCase()
  const dashMatch = compact.match(/([1-8])-([1-4])/)
  if (dashMatch) {
    const carNumber = Number.parseInt(dashMatch[1] ?? '', 10)
    const doorPosition = Number.parseInt(dashMatch[2] ?? '', 10)
    if (Number.isFinite(carNumber) && Number.isFinite(doorPosition)) {
      return { carNumber, doorPosition }
    }
  }

  const fullMatch = compact.match(
    /([????????????1-8])??([????????????1-4])/
  )
  if (fullMatch) {
    const carNumber = parseKoreanNumber(fullMatch[1] ?? '')
    const doorPosition = parseKoreanNumber(fullMatch[2] ?? '')
    if (!carNumber || !doorPosition) return null
    if (carNumber < 1 || carNumber > 8 || doorPosition < 1 || doorPosition > 4) return null
    return { carNumber, doorPosition }
  }

  const carOnlyMatch = compact.match(/([????????????1-8])??/)
  if (!carOnlyMatch) return null
  const carNumber = parseKoreanNumber(carOnlyMatch[1] ?? '')
  if (!carNumber || carNumber < 1 || carNumber > 8) return null
  return { carNumber, doorPosition: null }
}

function pickNearestTrainNo(
  trains: TrainListItem[],
  stations: MockStation[],
  originStation: MockStation
): string | null {
  if (trains.length === 0) return null
  const ordered = [...trains].sort((a, b) => {
    const aStation = resolveStationByName(stations, a.station_name)
    const bStation = resolveStationByName(stations, b.station_name)
    const aDist = aStation ? Math.abs(aStation.order - originStation.order) : Number.POSITIVE_INFINITY
    const bDist = bStation ? Math.abs(bStation.order - originStation.order) : Number.POSITIVE_INFINITY
    if (aDist !== bDist) return aDist - bDist
    return (b.is_express ? 1 : 0) - (a.is_express ? 1 : 0)
  })
  return ordered[0]?.train_no ?? null
}

function buildBoardingDraft(params: {
  role: BoardingRole
  lineKey: BoardingLine
  trainNo: string
  carNumber: number
  boardingStationId: string
  boardingStationName: string
  destinationId: string
  destinationName: string
  remainingStations: number
  seatSide?: SeatSide
  seatNumber?: number
}): BoardingDraft {
  return {
    role: params.role,
    lineKey: params.lineKey,
    lineLabel: resolveLineLabel(params.lineKey),
    lineNumber: mapLineNumberForMatchApi(params.lineKey),
    trainNo: params.trainNo,
    carNumber: params.carNumber,
    boardingStationId: params.boardingStationId,
    boardingStationName: params.boardingStationName,
    destinationId: params.destinationId,
    destinationName: params.destinationName,
    remainingStations: params.remainingStations,
    seatSide: params.seatSide,
    seatNumber: params.seatNumber,
  }
}

function BoardingForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const boardingType = resolveBoardingType(
    searchParams.get('type'),
    searchParams.get('role')
  )
  const isSeekMode = boardingType === 'seek'
  const isLeaveMode = boardingType === 'leave'
  const modeMeta = boardingType ? BOARDING_MODE_META[boardingType] : null
  const role = modeMeta?.role ?? null

  const [lineKey, setLineKey] = useState<BoardingLine | null>(null)
  const [trainNo, setTrainNo] = useState<string | null>(null)
  const [carNumber, setCarNumber] = useState<number | null>(null)
  const [selectedSeat, setSelectedSeat] = useState<SelectedSeat>(null)
  const [destinationId, setDestinationId] = useState<string | null>(null)
  const [destinationSearch, setDestinationSearch] = useState('')
  const [error, setError] = useState('')
  const [trainList, setTrainList] = useState<TrainListItem[]>([])
  const [trainsLoading, setTrainsLoading] = useState(false)
  const [trainsLoadError, setTrainsLoadError] = useState(false)
  const [boardingStationId, setBoardingStationId] = useState<string | null>(null)
  const [currentLocationName, setCurrentLocationName] = useState<string | null>(null)
  const [stationOrderNames, setStationOrderNames] = useState<string[]>([])
  const [stationCoordinates, setStationCoordinates] = useState<
    Record<string, { lat: number; lng: number }>
  >({})
  const [isListeningVoice, setIsListeningVoice] = useState(false)
  const [voiceRawText, setVoiceRawText] = useState('')
  const [voiceRecognizedText, setVoiceRecognizedText] = useState('')
  const [doorPosition, setDoorPosition] = useState<number | null>(null)
  const [voiceParsedOrigin, setVoiceParsedOrigin] = useState<string | null>(null)
  const [voiceParsedDestination, setVoiceParsedDestination] = useState<string | null>(null)
  const [voiceParsedCarDoor, setVoiceParsedCarDoor] = useState<string | null>(null)

  const lineOption = LINE_OPTIONS.find((line) => line.key === lineKey) ?? null

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) {
      router.replace('/login')
      return
    }
    if (!boardingType) {
      router.replace('/')
    }
  }, [boardingType, router])

  useEffect(() => {
    if (!lineKey) {
      setStationOrderNames([])
      setStationCoordinates({})
      return
    }

    const controller = new AbortController()
    const activeLineKey: BoardingLine = lineKey

    async function loadStations() {
      try {
        const apiLine = STATIONS_API_LINE[activeLineKey]
        const response = await fetch(buildStationsApiUrl(apiLine), {
          method: 'GET',
          cache: 'no-store',
          signal: controller.signal,
        })

        let payload: StationsApiResponse
        try {
          payload = (await response.json()) as StationsApiResponse
        } catch {
          return
        }

        if (!response.ok || payload.success === false || !Array.isArray(payload.stations)) {
          return
        }

        const stationOrder = payload.stations
          .map((row) => row.name?.trim())
          .filter((name): name is string => Boolean(name))
        const coordinates: Record<string, { lat: number; lng: number }> = {}
        for (const row of payload.stations) {
          const name = row.name?.trim()
          if (!name || typeof row.lat !== 'number' || typeof row.lng !== 'number') continue
          if (!Number.isFinite(row.lat) || !Number.isFinite(row.lng)) continue
          coordinates[normalizeStationName(name)] = { lat: row.lat, lng: row.lng }
        }
        setStationOrderNames(stationOrder)
        setStationCoordinates(coordinates)
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          return
        }
      }
    }

    void loadStations()
    return () => controller.abort()
  }, [lineKey])

  useEffect(() => {
    if (!lineKey) {
      setTrainList([])
      setTrainsLoading(false)
      setTrainsLoadError(false)
      return
    }

    const controller = new AbortController()
    const activeLineKey: BoardingLine = lineKey

    async function loadTrains() {
      setTrainsLoading(true)
      setTrainsLoadError(false)
      setTrainList([])

      try {
        const apiLine = TRAINS_API_LINE[activeLineKey]
        const response = await fetch(buildTrainsApiUrl(apiLine, currentLocationName), {
          method: 'GET',
          cache: 'no-store',
          signal: controller.signal,
        })

        let payload: TrainsApiResponse
        try {
          payload = (await response.json()) as TrainsApiResponse
        } catch {
          setTrainsLoadError(true)
          return
        }

        if (!response.ok || payload.success === false) {
          setTrainsLoadError(true)
          return
        }

        const rawTrains = payload.trains
        if (!Array.isArray(rawTrains)) {
          setTrainsLoadError(true)
          return
        }
        const trains: TrainListItem[] = []
        const seen = new Set<string>()

        for (const row of rawTrains) {
          const trainNo = row.train_no?.trim()
          const stationName = row.station_name?.trim()
          const direction = row.direction?.trim()
          const directionDisplay = row.direction_display?.trim()
          if (!trainNo || !stationName || !direction || !directionDisplay || seen.has(trainNo)) {
            continue
          }
          seen.add(trainNo)
          trains.push({
            train_no: trainNo,
            station_name: stationName,
            direction,
            direction_display: directionDisplay,
            is_express: row.is_express === true,
          })
        }

        // ???(/api/trains) ??(??? ???? ??) ??? ??? ?????.
        setTrainList(trains)
      } catch (fetchError) {
        if (fetchError instanceof Error && fetchError.name === 'AbortError') {
          return
        }
        setTrainsLoadError(true)
      } finally {
        if (!controller.signal.aborted) {
          setTrainsLoading(false)
        }
      }
    }

    void loadTrains()

    return () => {
      controller.abort()
    }
  }, [lineKey, currentLocationName])

  useEffect(() => {
    if (!lineKey) return
    const activeLineKey: BoardingLine = lineKey
    if (currentLocationName) return
    if (typeof window === 'undefined' || !navigator.geolocation) return
    if (Object.keys(stationCoordinates).length === 0) return
    const orderedStations = reorderStationsByNameOrder(
      STATIONS_BY_LINE[activeLineKey],
      stationOrderNames
    )
    if (orderedStations.length === 0) return

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude
        const lng = position.coords.longitude
        let nearest: { station: MockStation; dist: number } | null = null

        for (const station of orderedStations) {
          const coord = stationCoordinates[normalizeStationName(station.name)]
          if (!coord) continue
          const dist = distanceKm(lat, lng, coord.lat, coord.lng)
          if (!nearest || dist < nearest.dist) {
            nearest = { station, dist }
          }
        }

        if (nearest) {
          setCurrentLocationName(nearest.station.name)
          setBoardingStationId(nearest.station.id)
        }
      },
      () => {
        // ?? ??/?? ? ?? ???? ??
      },
      {
        enableHighAccuracy: true,
        timeout: 7000,
        maximumAge: 30000,
      }
    )
  }, [lineKey, stationOrderNames, stationCoordinates, currentLocationName])

  const stationsOnLine = useMemo(() => {
    if (!lineKey) return []
    const baseStations = STATIONS_BY_LINE[lineKey]
    return reorderStationsByNameOrder(baseStations, stationOrderNames)
  }, [lineKey, stationOrderNames])

  const destinationStation =
    stationsOnLine.find((station) => station.id === destinationId) ?? null

  const boardingStation =
    stationsOnLine.find((station) => station.id === boardingStationId) ?? null

  const selectedTrain = useMemo(
    () => (trainNo ? trainList.find((train) => train.train_no === trainNo) ?? null : null),
    [trainList, trainNo]
  )

  const destinationCandidates = useMemo(() => {
    if (!currentLocationName || !selectedTrain) {
      return stationsOnLine
    }

    const currentStation = resolveStationByName(stationsOnLine, currentLocationName)
    if (!currentStation) {
      return stationsOnLine
    }

    const directionKey = normalizeDirectionKey(selectedTrain.direction)
    if (!directionKey) {
      return stationsOnLine
    }

    const isLoopLine = lineKey === 'seoul2'
    if (isLoopLine) {
      const currentIdx = stationsOnLine.findIndex((station) => station.id === currentStation.id)
      if (currentIdx < 0) return []

      const step = resolveSeoul2DirectionStep(
        stationsOnLine,
        currentStation.name,
        selectedTrain.direction_display,
        directionKey
      )
      const result: MockStation[] = []
      for (let i = MIN_DESTINATION_STOPS; i <= LOOP_MAX_DESTINATION_STOPS; i += 1) {
        const idx = (currentIdx + step * i + stationsOnLine.length * 10) % stationsOnLine.length
        const candidate = stationsOnLine[idx]
        if (candidate) result.push(candidate)
      }
      return result
    }

    const linearStep = resolveLinearDirectionStep(
      stationsOnLine,
      currentStation.name,
      selectedTrain.direction_display,
      directionKey
    )

    const candidates = stationsOnLine.filter((station) => {
      if (station.id === currentStation.id) return false

      const delta = station.order - currentStation.order
      const remainingStops = Math.abs(delta)
      if (remainingStops < MIN_DESTINATION_STOPS) return false
      if (remainingStops > LOOP_MAX_DESTINATION_STOPS) return false
      return linearStep === 1 ? delta > 0 : delta < 0
    })

    // ?? ?? ?? ??? ??? (??? ? ?? ?? ???)
    return candidates.sort((a, b) => {
      const distA = Math.abs(a.order - currentStation.order)
      const distB = Math.abs(b.order - currentStation.order)
      return distA - distB
    })
  }, [currentLocationName, selectedTrain, stationsOnLine, lineKey])

  const filteredDestinations = useMemo(() => {
    const query = destinationSearch.trim()
    if (!query) return destinationCandidates
    return destinationCandidates.filter((station) => station.name.includes(query))
  }, [destinationCandidates, destinationSearch])

  const trainOptions = useMemo(
    () => trainList.map((train) => train.train_no),
    [trainList]
  )

  const isSeatStepComplete = selectedSeat !== null

  const isSubmitReady = isSeekMode
    ? lineKey !== null &&
      trainNo !== null &&
      boardingStationId !== null &&
      carNumber !== null &&
      destinationId !== null
    : lineKey !== null &&
      trainNo !== null &&
      boardingStationId !== null &&
      carNumber !== null &&
      isSeatStepComplete &&
      destinationId !== null

  const summaryLine = lineOption?.label ?? '?? ???'
  const summaryTrain = trainNo ?? '?? ???'
  const summaryBoarding =
    boardingStation?.name ?? currentLocationName ?? '??? ???'
  const summaryCar = carNumber ? `${carNumber}??` : '?? ???'
  const summaryDestination = destinationStation?.name
    ? `${destinationStation.name} ??`
    : '??? ???'
  const summarySeat = selectedSeat ? `${selectedSeat.face} ${selectedSeat.number}?` : ''

  function applyTrainLocation(trainNoValue: string, stations: MockStation[]) {
    const train = trainList.find((item) => item.train_no === trainNoValue)
    if (!train) {
      setCurrentLocationName(null)
      setBoardingStationId(null)
      return
    }

    setCurrentLocationName(train.station_name)
    const matchedStation = resolveStationByName(stations, train.station_name)
    setBoardingStationId(matchedStation?.id ?? null)
  }

  function persistBoardingDraftToStorage(nextSeat: SelectedSeat) {
    if (!isLeaveMode || !nextSeat) return
    if (!role || !lineKey || !trainNo || carNumber === null) {
      return
    }

    try {
      const destination = stationsOnLine.find((station) => station.id === destinationId)
      const startStation = stationsOnLine.find(
        (station) => station.id === boardingStationId
      )
      const remainingStations =
        startStation && destination
          ? Math.max(0, destination.order - startStation.order)
          : 0

      const draft = buildBoardingDraft({
        role,
        lineKey,
        trainNo,
        carNumber,
        boardingStationId: startStation?.id ?? '',
        boardingStationName: startStation?.name ?? currentLocationName ?? '',
        destinationId: destination?.id ?? '',
        destinationName: destination?.name ?? '',
        remainingStations,
        seatSide: nextSeat.face,
        seatNumber: nextSeat.number,
      })

      sessionStorage.setItem('boardingDraft', JSON.stringify(draft))
      sessionStorage.setItem('waitingDraft', JSON.stringify(draft))
    } catch {
      setError('?? ?? ??? ??????.')
    }
  }

  function handleLineSelect(line: BoardingLine) {
    setLineKey(line)
    setTrainNo(null)
    setTrainList([])
    setBoardingStationId(null)
    setCurrentLocationName(null)
    setCarNumber(null)
    setSelectedSeat(null)
    setDestinationId(null)
    setDestinationSearch('')
    setDoorPosition(null)
    setVoiceParsedOrigin(null)
    setVoiceParsedDestination(null)
    setVoiceParsedCarDoor(null)
    setError('')
  }

  function handleTrainSelect(value: string) {
    setTrainNo(value)
    applyTrainLocation(value, stationsOnLine)
    setCarNumber(null)
    setDoorPosition(null)
    setSelectedSeat(null)
    setDestinationId(null)
    setError('')
  }

  function handleBoardingStationSelect(stationId: string) {
    setBoardingStationId(stationId)
    setDestinationId(null)
    setError('')
  }

  function handleVoiceInput() {
    if (!lineKey) {
      setError('??? ?? ??????.')
      return
    }

    const SpeechRecognition =
      typeof window !== 'undefined'
        ? window.SpeechRecognition ?? window.webkitSpeechRecognition
        : undefined

    if (!SpeechRecognition) {
      setError('? ????? ?? ??? ???? ????.')
      return
    }

    const recognition = new SpeechRecognition()
    recognition.lang = 'ko-KR'
    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    setIsListeningVoice(true)
    setError('')
    setVoiceRawText('')
    setVoiceRecognizedText('')
    setVoiceParsedOrigin(null)
    setVoiceParsedDestination(null)
    setVoiceParsedCarDoor(null)

    let lastTranscript = ''
    let silenceTimer: ReturnType<typeof setTimeout> | null = null

    const stopAfterSilence = () => {
      if (silenceTimer) {
        clearTimeout(silenceTimer)
      }
      silenceTimer = setTimeout(() => {
        recognition.stop()
      }, 5000)
    }

    const applyTranscript = (transcript: string) => {
      const parsed = parseVoiceRoute(transcript)
      if (!parsed) return

      const parsedCarDoor = parseCarAndDoor(transcript)
      const originStation = resolveStationByName(stationsOnLine, parsed.origin)
      const destinationStation = resolveStationByName(stationsOnLine, parsed.destination)

      if (!originStation || !destinationStation) return

      const nearestTrainNo = pickNearestTrainNo(trainList, stationsOnLine, originStation)

      setCurrentLocationName(originStation.name)
      setBoardingStationId(originStation.id)
      setDestinationId(destinationStation.id)
      setDestinationSearch(destinationStation.name)
      setVoiceParsedOrigin(originStation.name)
      setVoiceParsedDestination(destinationStation.name)
      if (nearestTrainNo) {
        setTrainNo(nearestTrainNo)
      }
      if (parsedCarDoor) {
        setCarNumber(parsedCarDoor.carNumber)
        setDoorPosition(parsedCarDoor.doorPosition ?? null)
        setVoiceParsedCarDoor(
          parsedCarDoor.doorPosition
            ? `${parsedCarDoor.carNumber}?? ${parsedCarDoor.doorPosition}??`
            : `${parsedCarDoor.carNumber}??`
        )
      }
    }

    recognition.onresult = (event) => {
      let transcript = ''
      const resultList = event.results
      if (resultList) {
        for (let i = 0; i < resultList.length; i += 1) {
          transcript += `${resultList[i]?.[0]?.transcript ?? ''} `
        }
      }
      const normalized = transcript.trim().replace(/\s+/g, ' ')
      if (!normalized) return
      lastTranscript = normalized
      setVoiceRawText(normalized)
      setVoiceRecognizedText(normalized)
      stopAfterSilence()
      applyTranscript(normalized)
    }

    recognition.onerror = () => {
      setError('?? ??? ??????. ?? ??????.')
      if (silenceTimer) {
        clearTimeout(silenceTimer)
      }
    }

    recognition.onend = () => {
      if (silenceTimer) {
        clearTimeout(silenceTimer)
      }
      if (!parseVoiceRoute(lastTranscript)) {
        setError('?: "??????? ?? ????" ??? ??????.')
      }
      setIsListeningVoice(false)
    }

    recognition.start()
    stopAfterSilence()
  }

  function handleCarSelect(car: number) {
    setCarNumber(car)
    setDoorPosition(null)
    setSelectedSeat(null)
    setDestinationId(null)
    setError('')
  }

  function handleConfirm() {
    if (
      !role ||
      !boardingType ||
      !isSubmitReady ||
      !lineKey ||
      !trainNo ||
      carNumber === null
    ) {
      setError('?? ??? ??????.')
      return
    }

    if (!boardingStationId) {
      setError('???? ??????. ??? ?? ????? ???? ??????.')
      return
    }

    const startStation = stationsOnLine.find(
      (station) => station.id === boardingStationId
    )
    if (!startStation) {
      setError('???? ??????.')
      return
    }

    if (isLeaveMode) {
      if (!selectedSeat) {
        setError('??? ??????.')
        return
      }

      const destination = stationsOnLine.find((station) => station.id === destinationId)
      if (!destination) {
        setError('??? ?? ??????.')
        return
      }

      const remainingStations = Math.max(0, destination.order - startStation.order)

      const draft = buildBoardingDraft({
        role,
        lineKey,
        trainNo,
        carNumber,
        boardingStationId: startStation.id,
        boardingStationName: startStation.name,
        destinationId: destination.id,
        destinationName: destination.name,
        remainingStations,
        seatSide: selectedSeat.face,
        seatNumber: selectedSeat.number,
      })

      sessionStorage.setItem('boardingDraft', JSON.stringify(draft))
      sessionStorage.setItem('waitingDraft', JSON.stringify(draft))
      sessionStorage.setItem(
        COMPLETION_NOTICE_KEY,
        `???? ????: ${destination.name}?`
      )
      router.push('/provider')
      return
    }

    const destination = stationsOnLine.find((station) => station.id === destinationId)
    if (!destination) {
      setError('??? ?? ??????.')
      return
    }

    const remainingStations = Math.max(0, destination.order - startStation.order)

    const draft = buildBoardingDraft({
      role,
      lineKey,
      trainNo,
      carNumber,
      boardingStationId: startStation.id,
      boardingStationName: startStation.name,
      destinationId: destination.id,
      destinationName: destination.name,
      remainingStations,
    })

    sessionStorage.setItem('boardingDraft', JSON.stringify(draft))
    sessionStorage.setItem('waitingDraft', JSON.stringify(draft))
    sessionStorage.removeItem('seekerMatchRequestRegistered')
    sessionStorage.removeItem('activeMatchRequestId')
    router.push('/waiting')
  }

  if (!boardingType || !modeMeta || !role) {
    return null
  }

  return (
    <div className="brd-app">
      <header className="brd-header">
        <Link href="/" className="brd-back" aria-label="???">
          ?
        </Link>
        <h1 className="brd-title">{modeMeta.title}</h1>
        <span className="brd-role">{modeMeta.badge}</span>
      </header>

      <main className="brd-main">
        <button
          type="button"
          className={`brd-voice-top-btn ${isListeningVoice ? 'is-listening' : ''}`}
          onClick={handleVoiceInput}
          aria-label="???? ????"
        >
          {isListeningVoice ? '?? ??' : '?? ???? ????'}
        </button>
        {voiceRecognizedText ? (
          <p className="brd-voice-top-text">??: {voiceRecognizedText}</p>
        ) : null}
        {voiceRawText ? <p className="brd-voice-raw-text">??: {voiceRawText}</p> : null}
        {isListeningVoice ? (
          <p className="brd-voice-listening" role="status">
            ?? ???...
          </p>
        ) : null}
        {(voiceParsedOrigin || voiceParsedDestination || voiceParsedCarDoor) && (
          <div className="brd-voice-parse-result" role="status" aria-live="polite">
            <p>
              ????: <strong>{voiceParsedOrigin ?? '???'}</strong>
            </p>
            <p>
              ???: <strong>{voiceParsedDestination ?? '???'}</strong>
            </p>
            <p>
              ??: <strong>{voiceParsedCarDoor ?? '???'}</strong>
            </p>
            <p className="brd-voice-parse-hint">??? ?? ???? ???? ??? ? ???.</p>
          </div>
        )}

        {/* 1?? ? ?? */}
        <section className="brd-card">
          <h2 className="brd-step-title">1. ?? ??</h2>
          <div className="brd-line-chips" role="listbox" aria-label="??">
            {LINE_OPTIONS.map((line) => {
              const selected = lineKey === line.key
              return (
                <button
                  key={line.key}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`brd-line-chip ${selected ? 'is-selected' : ''}`}
                  style={
                    selected
                      ? {
                          background: line.color,
                          borderColor: line.color,
                          color: '#ffffff',
                        }
                      : undefined
                  }
                  onClick={() => handleLineSelect(line.key)}
                >
                  <span className="brd-line-chip-dot" style={{ background: line.color }} />
                  <span className="brd-line-chip-label">{line.label}</span>
                </button>
              )
            })}
          </div>
        </section>

        {/* 2?? ? ?? */}
        {lineKey && (
          <section className="brd-card">
            <h2 className="brd-step-title">2. ?? ??</h2>
            {trainsLoading ? (
              <div className="brd-trains-loading" role="status" aria-live="polite">
                <span className="brd-spinner" aria-hidden="true" />
                <span className="brd-trains-loading-text">?? ?? ???? ??</span>
              </div>
            ) : trainsLoadError ? (
              <p className="brd-trains-error">?? ??? ??? ? ????</p>
            ) : (
              <div className="brd-scroll-row" role="listbox" aria-label="?? ??">
                {trainOptions.map((train) => {
                  const selected = trainNo === train
                  const trainInfo = trainList.find((item) => item.train_no === train)
                  return (
                    <button
                      key={train}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={`brd-chip ${selected ? 'is-selected' : ''}`}
                      style={
                        selected && lineOption
                          ? { borderColor: lineOption.color, color: lineOption.color }
                          : undefined
                      }
                      onClick={() => handleTrainSelect(train)}
                    >
                      <span className="brd-chip-label">
                        {train}
                        {trainInfo?.direction_display
                          ? ` ? ${trainInfo.direction_display}`
                          : ''}
                      </span>
                      {trainInfo?.is_express ? (
                        <span className="brd-chip-express">?</span>
                      ) : null}
                    </button>
                  )
                })}
              </div>
            )}
            {trainNo && currentLocationName && (
              <p className="brd-current-location brd-current-location--inline" role="status">
                ?? ??: <strong>{currentLocationName}</strong>
              </p>
            )}
            {isLeaveMode && trainNo && (
              <>
                {currentLocationName && !boardingStationId && (
                  <p className="brd-boarding-hint">?? ???? ???? ??????.</p>
                )}
                <ul
                  className="brd-station-list brd-boarding-list"
                  role="listbox"
                  aria-label="???"
                >
                  {stationsOnLine.map((station) => {
                    const selected = boardingStationId === station.id
                    const isCurrentLocation = currentLocationName
                      ? station.name === currentLocationName ||
                        currentLocationName.includes(station.name) ||
                        station.name.includes(currentLocationName.replace(/?$/, ''))
                      : false
                    return (
                      <li key={station.id}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={selected}
                          className={`brd-station-btn ${selected ? 'is-selected' : ''} ${
                            isCurrentLocation ? 'is-current-location' : ''
                          }`}
                          onClick={() => handleBoardingStationSelect(station.id)}
                        >
                          {station.name}
                          {isCurrentLocation ? (
                            <span className="brd-station-tag">?? ??</span>
                          ) : null}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
            {isSeekMode && trainNo && currentLocationName && !boardingStationId && (
              <p className="brd-boarding-hint">
                ?? ?? ?? ???? ?? ?????. ?? ??? ??????.
              </p>
            )}
          </section>
        )}

        {/* 3?? ? ?? */}
        {trainNo && boardingStationId && (
          <section className="brd-card">
            <h2 className="brd-step-title">3. ?? ??</h2>
            <div className="brd-car-row" role="listbox" aria-label="??">
              {CAR_NUMBERS.map((car) => {
                const selected = carNumber === car
                return (
                  <button
                    key={car}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={`brd-car-btn ${selected ? 'is-selected' : ''}`}
                    onClick={() => handleCarSelect(car)}
                  >
                    {car}
                  </button>
                )
              })}
            </div>
            {doorPosition !== null ? (
              <p className="brd-door-position">{doorPosition}? ? ?? ???</p>
            ) : null}
          </section>
        )}

        {/* 4?? ? ?? (????) */}
        {isLeaveMode && carNumber !== null && (
          <section className="brd-card brd-seat-card">
            <h2 className="brd-step-title">4. ?? ??</h2>
            <p className="brd-seat-hint">??? ??? ?? ??? ? ? ????</p>
            <div className="brd-cabin">
              {(['A', 'B'] as const).map((face) => {
                let seatNum = face === 'A' ? 1 : 23
                return (
                  <div key={face}>
                    <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>{face}?</div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 3,
                        overflowX: 'auto',
                        paddingBottom: 4,
                      }}
                    >
                      {SEAT_STRUCTURE.map((item, i) => {
                        if (item.type === 'door') {
                          return (
                            <div
                              key={i}
                              style={{
                                width: 2,
                                height: 32,
                                background: '#D0D0D0',
                                borderRadius: 1,
                                flexShrink: 0,
                              }}
                            />
                          )
                        }
                        const num = seatNum++
                        const isSelected =
                          selectedSeat?.face === face && selectedSeat?.number === num
                        const isElderly = item.type === 'elderly'
                        return (
                          <div
                            key={i}
                            onClick={() => {
                              const nextSeat: SelectedSeat = {
                                face,
                                number: num,
                                type: item.type,
                              }
                              setSelectedSeat(nextSeat)
                              setDestinationId(null)
                              setError('')
                              persistBoardingDraftToStorage(nextSeat)
                            }}
                            style={{
                              width: 22,
                              height: 30,
                              borderRadius: 4,
                              flexShrink: 0,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: 9,
                              fontWeight: 700,
                              background: isSelected
                                ? '#0B1F4B'
                                : isElderly
                                  ? '#FFAA00'
                                  : '#E0E0E0',
                              color: isSelected ? '#fff' : isElderly ? '#fff' : '#999',
                              border: isSelected
                                ? '2px solid #0B1F4B'
                                : '1px solid transparent',
                            }}
                          >
                            {num}
                          </div>
                        )
                      })}
                    </div>
                    {face === 'A' && (
                      <div
                        style={{
                          textAlign: 'center',
                          fontSize: 10,
                          color: '#aaa',
                          padding: '6px 0',
                        }}
                      >
                        ? ? ? ?
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="brd-legend">
              <span className="brd-legend-item">
                <i className="brd-legend-swatch is-priority" /> ????
              </span>
              <span className="brd-legend-item">
                <i className="brd-legend-swatch is-general" /> ???
              </span>
              <span className="brd-legend-item">
                <i className="brd-legend-swatch is-selected" /> ? ??
              </span>
            </div>
          </section>
        )}

        {/* 4??(?????) / 5??(????) ? ??? */}
        {((isSeekMode && carNumber !== null) || (isLeaveMode && isSeatStepComplete)) && (
          <section className="brd-card">
            <h2 className="brd-step-title">
              {isSeekMode ? '4. ??? ? ??' : '5. ??? ?'}
            </h2>
            <div className="brd-search-wrap">
              <input
                type="search"
                value={destinationSearch}
                onChange={(event) => setDestinationSearch(event.target.value)}
                placeholder="? ?? ??"
                className="brd-search"
                aria-label="??? ??"
              />
            </div>
            <ul className="brd-station-list" role="listbox" aria-label="??? ?">
              {filteredDestinations.length === 0 ? (
                <li className="brd-station-empty">?? ??? ????</li>
              ) : (
                filteredDestinations.map((station) => {
                  const selected = destinationId === station.id
                  return (
                    <li key={station.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={selected}
                        className={`brd-station-btn ${selected ? 'is-selected' : ''}`}
                        onClick={() => {
                          setDestinationId(station.id)
                          setError('')
                        }}
                      >
                        {station.name}
                      </button>
                    </li>
                  )
                })
              )}
            </ul>
          </section>
        )}

        {error && <p className="brd-error">{error}</p>}
      </main>

      <footer className="brd-footer">
        <p className="brd-summary">
          {isSeekMode
            ? `${summaryLine} ? ${summaryTrain} ? ${summaryCar} ? ${summaryDestination}`
            : `${summaryLine} ? ${summaryTrain} ? ${summaryBoarding} ? ${summaryCar}${
                summarySeat ? ` ? ${summarySeat}` : ''
              }${destinationStation ? ` ? ${destinationStation.name}` : ''}`}
        </p>
        <button
          type="button"
          className="brd-submit"
          disabled={!isSubmitReady}
          onClick={handleConfirm}
        >
          {modeMeta.submitLabel}
        </button>
      </footer>

      <style jsx>{`
        .brd-app {
          min-height: 100dvh;
          max-width: 480px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          background: #f7f8fa;
          color: #1a1a1a;
          font-family: 'Pretendard', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif;
          padding-bottom: calc(120px + env(safe-area-inset-bottom));
        }

        .brd-header {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 16px 20px;
          background: #ffffff;
          border-bottom: 1px solid #e8eaed;
        }

        .brd-back {
          font-size: 1.25rem;
          font-weight: 700;
          color: #0052a4;
          text-decoration: none;
        }

        .brd-title {
          flex: 1;
          margin: 0;
          font-size: 1.125rem;
          font-weight: 800;
          color: #1a1a1a;
        }

        .brd-role {
          padding: 6px 10px;
          border-radius: 999px;
          background: #ff6b00;
          color: #ffffff;
          font-size: 0.75rem;
          font-weight: 800;
          white-space: nowrap;
        }

        .brd-main {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 12px;
          padding: 16px 20px;
        }

        .brd-card {
          padding: 16px;
          border-radius: 16px;
          background: #ffffff;
          border: 0.5px solid #ebebeb;
          box-shadow: 0 2px 12px rgba(26, 26, 26, 0.06);
        }

        .brd-step-title {
          margin: 0 0 14px;
          font-size: 1rem;
          font-weight: 800;
          color: #0052a4;
        }

        .brd-line-chips {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
        }

        .brd-line-chip {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          width: 100%;
          height: 36px;
          padding: 0 12px;
          border: 1px solid #d0d0d0;
          border-radius: 20px;
          background: #ffffff;
          cursor: pointer;
          transition:
            background 0.2s ease,
            border-color 0.2s ease,
            color 0.2s ease;
        }

        .brd-line-chip-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
        }

        .brd-line-chip-label {
          font-size: 13px;
          font-weight: 700;
          line-height: 1;
          color: #1a1a1a;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .brd-line-chip.is-selected .brd-line-chip-label {
          color: #ffffff;
        }

        @media (min-width: 420px) {
          .brd-line-chips {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
        }

        .brd-trains-loading {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          min-height: 48px;
          padding: 8px 0;
        }

        .brd-voice-top-btn {
          width: 100%;
          min-height: 50px;
          padding: 0 16px;
          border: 1px solid #ebebeb;
          border-radius: 14px;
          background: #ffffff;
          color: #0052a4;
          font-size: 1rem;
          font-weight: 800;
          cursor: pointer;
        }

        .brd-voice-top-btn.is-listening {
          border-color: #ff6b00;
          color: #ff6b00;
        }

        .brd-voice-top-text {
          margin: -4px 2px 0;
          font-size: 0.8125rem;
          color: #666666;
          font-weight: 600;
        }

        .brd-voice-raw-text {
          margin: -2px 2px 0;
          font-size: 0.8125rem;
          color: #444444;
          font-weight: 600;
        }

        .brd-voice-listening {
          margin: -2px 2px 0;
          font-size: 0.8125rem;
          font-weight: 800;
          color: #ff6b00;
        }

        .brd-voice-parse-result {
          margin-top: 8px;
          padding: 10px 12px;
          border: 1px solid #ebebeb;
          border-radius: 12px;
          background: #ffffff;
          font-size: 0.8125rem;
          color: #1a1a1a;
          display: grid;
          gap: 4px;
        }

        .brd-voice-parse-result p {
          margin: 0;
        }

        .brd-voice-parse-hint {
          margin-top: 2px !important;
          color: #666666;
          font-weight: 600;
        }

        .brd-door-position {
          margin: 10px 0 0;
          font-size: 0.8125rem;
          font-weight: 700;
          color: #0052a4;
        }

        .brd-trains-loading-text {
          font-size: 0.875rem;
          font-weight: 600;
          color: #888888;
        }

        .brd-spinner {
          width: 22px;
          height: 22px;
          border: 2px solid #e8eaed;
          border-top-color: #0b1f4b;
          border-radius: 50%;
          animation: brd-spin 0.7s linear infinite;
        }

        @keyframes brd-spin {
          to {
            transform: rotate(360deg);
          }
        }

        .brd-trains-error {
          margin: 0;
          min-height: 48px;
          display: flex;
          align-items: center;
          font-size: 0.875rem;
          font-weight: 700;
          color: #c62828;
        }

        .brd-scroll-row {
          display: flex;
          gap: 8px;
          overflow-x: auto;
          padding-bottom: 4px;
          -webkit-overflow-scrolling: touch;
        }

        .brd-chip {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          flex: 0 0 auto;
          min-height: 48px;
          max-width: 220px;
          padding: 8px 14px;
          border: 0.5px solid #ebebeb;
          border-radius: 16px;
          background: #f7f8fa;
          font-size: 1rem;
          font-weight: 700;
          color: #1a1a1a;
          cursor: pointer;
          white-space: nowrap;
        }

        .brd-chip.is-selected {
          background: #ffffff;
          font-weight: 800;
        }

        .brd-chip-label {
          text-align: center;
          line-height: 1.25;
          white-space: nowrap;
        }

        .brd-chip-express {
          flex-shrink: 0;
          margin-left: 0;
          padding: 2px 5px;
          border-radius: 4px;
          background: #c62828;
          color: #ffffff;
          font-size: 0.625rem;
          font-weight: 800;
          vertical-align: middle;
        }

        .brd-current-location {
          margin: 0 0 12px;
          padding: 12px 14px;
          border-radius: 12px;
          background: rgba(198, 255, 0, 0.35);
          border: 2px solid #c6ff00;
          font-size: 0.9375rem;
          font-weight: 700;
          color: #0b1f4b;
        }

        .brd-current-location--inline {
          margin-top: 14px;
          margin-bottom: 0;
        }

        .brd-current-location strong {
          font-weight: 900;
          color: #0b1f4b;
        }

        .brd-boarding-hint {
          margin: -4px 0 10px;
          font-size: 0.8125rem;
          font-weight: 600;
          color: #c62828;
        }

        .brd-boarding-list {
          max-height: 200px;
        }

        .brd-station-btn.is-current-location:not(.is-selected) {
          background: rgba(198, 255, 0, 0.12);
        }

        .brd-station-tag {
          margin-left: 8px;
          padding: 2px 6px;
          border-radius: 6px;
          background: #0b1f4b;
          color: #c6ff00;
          font-size: 0.6875rem;
          font-weight: 800;
        }

        .brd-car-row {
          display: flex;
          gap: 8px;
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
        }

        .brd-car-btn {
          flex: 0 0 auto;
          min-width: 52px;
          min-height: 52px;
          border: 0.5px solid #ebebeb;
          border-radius: 16px;
          background: #f7f8fa;
          font-size: 1.125rem;
          font-weight: 800;
          color: #1a1a1a;
          cursor: pointer;
        }

        .brd-car-btn.is-selected {
          border-color: #0052a4;
          background: #0052a4;
          color: #ffffff;
        }

        .brd-seat-hint {
          margin: -6px 0 12px;
          font-size: 0.8125rem;
          font-weight: 600;
          color: #888888;
        }

        .brd-cabin {
          padding: 12px 10px;
          border-radius: 12px;
          background: #f7f8fa;
        }

        .brd-face-label {
          margin: 0 0 6px;
          font-size: 0.75rem;
          font-weight: 700;
          color: #888888;
        }

        .brd-face-row {
          display: flex;
          align-items: center;
          gap: 3px;
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          padding: 0 2px 6px;
          min-width: max-content;
        }

        .brd-door {
          flex-shrink: 0;
          width: 2px;
          height: 24px;
          border-radius: 1px;
          background: rgba(26, 26, 26, 0.2);
        }

        .brd-seat {
          flex-shrink: 0;
          width: 20px;
          height: 28px;
          padding: 0;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: 1px solid transparent;
          border-radius: 4px;
          cursor: pointer;
          font-size: 0.5rem;
          font-weight: 700;
          line-height: 1;
          color: #1a1a1a;
        }

        .brd-seat.is-priority {
          background: #ffaa00;
          border-color: #e69500;
        }

        .brd-seat.is-general {
          background: #e0e0e0;
          border-color: #cccccc;
        }

        .brd-seat.is-current {
          background: #c6ff00;
          border-color: #9dd400;
        }

        .brd-seat.is-selected {
          background: #0b1f4b;
          border-color: #ffffff;
          box-shadow: 0 0 0 1px #0b1f4b;
          color: #ffffff;
        }

        .brd-aisle {
          margin: 10px 0;
          text-align: center;
          font-size: 0.75rem;
          font-weight: 700;
          color: #888888;
          letter-spacing: 0.08em;
        }

        .brd-legend {
          display: flex;
          flex-wrap: wrap;
          gap: 10px 14px;
          margin-top: 12px;
        }

        .brd-legend-item {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 0.75rem;
          font-weight: 600;
          color: #888888;
        }

        .brd-legend-swatch {
          display: inline-block;
          width: 14px;
          height: 14px;
          border-radius: 3px;
        }

        .brd-legend-swatch.is-priority {
          background: #ffaa00;
        }

        .brd-legend-swatch.is-general {
          background: #c8ccd4;
        }

        .brd-legend-swatch.is-selected {
          background: #0b1f4b;
          box-shadow: 0 0 0 1px #c6ff00;
        }

        .brd-search-wrap {
          margin-bottom: 12px;
        }

        .brd-search {
          width: 100%;
          height: 48px;
          padding: 0 14px;
          border: 0.5px solid #ebebeb;
          border-radius: 16px;
          background: #f7f8fa;
          font-size: 1rem;
          font-weight: 600;
          color: #1a1a1a;
          outline: none;
        }

        .brd-search:focus {
          border-color: #0052a4;
        }

        .brd-station-list {
          list-style: none;
          margin: 0;
          padding: 0;
          max-height: 240px;
          overflow-y: auto;
        }

        .brd-station-btn {
          width: 100%;
          min-height: 48px;
          padding: 12px 14px;
          border: none;
          border-bottom: 1px solid #e8eaed;
          background: transparent;
          text-align: left;
          font-size: 1rem;
          font-weight: 600;
          color: #1a1a1a;
          cursor: pointer;
        }

        .brd-station-btn.is-selected {
          background: rgba(255, 107, 0, 0.14);
          color: #1a1a1a;
          font-weight: 800;
        }

        .brd-station-empty {
          padding: 16px;
          text-align: center;
          color: #888888;
          font-size: 0.9375rem;
        }

        .brd-error {
          margin: 0;
          padding: 12px 14px;
          border-radius: 12px;
          background: #fff0f0;
          color: #d92d20;
          font-size: 0.9375rem;
          font-weight: 600;
        }

        .brd-footer {
          position: fixed;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 30;
          max-width: 480px;
          margin: 0 auto;
          padding: 12px 20px calc(12px + env(safe-area-inset-bottom));
          background: #ffffff;
          border-top: 1px solid #e8eaed;
          box-shadow: 0 -4px 20px rgba(26, 26, 26, 0.08);
        }

        .brd-summary {
          margin: 0 0 10px;
          font-size: 0.8125rem;
          font-weight: 700;
          color: #888888;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .brd-submit {
          width: 100%;
          min-height: 52px;
          border: none;
          border-radius: 16px;
          background: #0052a4;
          color: #ffffff;
          font-size: 1.0625rem;
          font-weight: 800;
          cursor: pointer;
        }

        .brd-submit:disabled {
          background: #c8ccd4;
          color: #888888;
          cursor: not-allowed;
        }

        .brd-submit:not(:disabled):active {
          transform: scale(0.98);
        }

        @media (orientation: landscape) {
          .brd-seat-hint {
            display: none;
          }

          .brd-face-row {
            overflow-x: auto;
          }
        }
      `}</style>
    </div>
  )
}

export default function BoardingPage() {
  return (
    <Suspense
      fallback={
        <div
          style={{
            minHeight: '100dvh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#f7f8fa',
            fontFamily: 'Pretendard, sans-serif',
          }}
        >
          ?? ?...
        </div>
      }
    >
      <BoardingForm />
    </Suspense>
  )
}
