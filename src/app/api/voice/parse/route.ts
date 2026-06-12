import { loadEnvConfig } from '@next/env'
import { NextResponse } from 'next/server'
import { getUserIdFromRequest } from '@/lib/api-auth'
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
} from '@/lib/mockData'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

loadEnvConfig(process.cwd())

type VoiceMode = 'seek' | 'leave'

type SupportedLine =
  | 'seoul1'
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

interface VoiceParseBody {
  transcript?: unknown
  line?: unknown
}

interface ParsedVoiceIntent {
  destination: string | null
  mode: VoiceMode | null
}

interface StationNameRow {
  station_name?: string | null
}

const JSON_UTF8_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
} as const

const STATION_NAMES_CACHE_TTL_MS = 1000 * 60 * 30

const LINE_STATION_NAMES: Record<SupportedLine, string[]> = {
  seoul1: MOCK_LINE_S1_STATIONS.map((station) => station.name.trim()),
  seoul2: MOCK_LINE_S2_STATIONS.map((station) => station.name.trim()),
  seoul3: MOCK_LINE_S3_STATIONS.map((station) => station.name.trim()),
  seoul4: MOCK_LINE_S4_STATIONS.map((station) => station.name.trim()),
  seoul5: MOCK_LINE_S5_STATIONS.map((station) => station.name.trim()),
  seoul6: MOCK_LINE_S6_STATIONS.map((station) => station.name.trim()),
  seoul7: MOCK_LINE_S7_STATIONS.map((station) => station.name.trim()),
  seoul8: MOCK_LINE_S8_STATIONS.map((station) => station.name.trim()),
  seoul9: MOCK_LINE_S9_STATIONS.map((station) => station.name.trim()),
  incheon1: MOCK_LINE_1_STATIONS.map((station) => station.name.trim()),
  incheon2: MOCK_LINE_2_STATIONS.map((station) => station.name.trim()),
}

let stationNamesCache: { names: string[]; expiresAt: number } | null = null
const lineStationNamesCache = new Map<
  SupportedLine,
  { names: string[]; expiresAt: number }
>()

function errorResponse(message: string, status: number) {
  return NextResponse.json(
    { success: false, error: message },
    { status, headers: JSON_UTF8_HEADERS }
  )
}

/** 매칭용 텍스트 정규화 — 공백·"역" 제거 */
function normalizeForMatch(text: string): string {
  return text.trim().replace(/\s+/g, '').replace(/역/gu, '')
}

/** 응답용 역명 — "역" 접미사 제거 */
function toDestinationName(stationName: string): string {
  const trimmed = stationName.trim().replace(/역$/u, '')
  return trimmed.length > 0 ? trimmed : stationName.trim()
}

/**
 * Supabase stations 테이블에서 전체 역명 로드 (메모리 캐시)
 */
async function loadAllStationNames(): Promise<string[]> {
  if (stationNamesCache && stationNamesCache.expiresAt > Date.now()) {
    return stationNamesCache.names
  }

  const supabase = createSupabaseAdminClient()
  const { data, error } = await supabase.from('stations').select('station_name')

  if (error) {
    throw new Error('역 목록을 불러오지 못했습니다.')
  }

  const fromDb = Array.from(
    new Set(
      ((data ?? []) as StationNameRow[])
        .map((row) => row.station_name?.trim())
        .filter((name): name is string => Boolean(name))
    )
  )

  const uniqueNames = (
    fromDb.length > 0
      ? fromDb
      : MOCK_ALL_STATIONS.map((station) => station.name.trim())
  ).sort((a, b) => b.length - a.length)

  stationNamesCache = {
    names: Array.from(new Set(uniqueNames)),
    expiresAt: Date.now() + STATION_NAMES_CACHE_TTL_MS,
  }

  return stationNamesCache.names
}

function parseSupportedLine(value: unknown): SupportedLine | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim() as SupportedLine
  return trimmed in LINE_STATION_NAMES ? trimmed : null
}

/**
 * 노선별 역명 로드 — 음성 목적지 오인식 방지
 */
function loadStationNamesForLine(line: SupportedLine): string[] {
  const cached = lineStationNamesCache.get(line)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.names
  }

  const names = Array.from(new Set(LINE_STATION_NAMES[line])).sort(
    (a, b) => b.length - a.length
  )

  lineStationNamesCache.set(line, {
    names,
    expiresAt: Date.now() + STATION_NAMES_CACHE_TTL_MS,
  })

  return names
}

/**
 * 음성 텍스트에 포함된 역명을 찾고, 여러 개면 문장에서 가장 뒤에 나온 역을 목적지로 반환
 */
function findDestinationFromTranscript(
  transcript: string,
  stationNames: string[]
): string | null {
  const normalizedText = normalizeForMatch(transcript)
  if (!normalizedText) {
    return null
  }

  const matches: Array<{ name: string; index: number }> = []

  for (const stationName of stationNames) {
    const normalizedStation = normalizeForMatch(stationName)
    if (normalizedStation.length < 2) {
      continue
    }

    const index = normalizedText.indexOf(normalizedStation)
    if (index >= 0) {
      matches.push({ name: toDestinationName(stationName), index })
    }
  }

  if (matches.length === 0) {
    return null
  }

  matches.sort((a, b) => a.index - b.index)
  return matches[matches.length - 1].name
}

function extractModeFromTranscript(transcript: string): VoiceMode | null {
  if (/내려요|내릴게요|내려|내릴/u.test(transcript)) {
    return 'leave'
  }
  // 음성 인식 오타(안고) 및 앉고 싶어 표현
  if (/앉고|안고|앉을|앉아|착석|자리/u.test(transcript)) {
    return 'seek'
  }
  return null
}

async function parseVoiceIntent(
  transcript: string,
  line: SupportedLine | null
): Promise<ParsedVoiceIntent> {
  const stationNames = line
    ? loadStationNamesForLine(line)
    : await loadAllStationNames()
  return {
    destination: findDestinationFromTranscript(transcript, stationNames),
    mode: extractModeFromTranscript(transcript),
  }
}

/**
 * POST /api/voice/parse — 음성 텍스트에서 목적지·모드(seek/leave) 추출
 * Body: { transcript, line?: seoul7 } — line 지정 시 해당 노선 역만 매칭
 */
export async function POST(request: Request) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return errorResponse('로그인이 필요합니다.', 401)
    }

    let body: VoiceParseBody
    try {
      body = (await request.json()) as VoiceParseBody
    } catch {
      return errorResponse('요청 본문이 올바르지 않습니다.', 400)
    }

    const transcript =
      typeof body.transcript === 'string' ? body.transcript.trim() : ''
    if (!transcript) {
      return errorResponse('transcript가 필요합니다.', 400)
    }
    if (transcript.length > 500) {
      return errorResponse('transcript가 너무 깁니다.', 400)
    }

    const line = parseSupportedLine(body.line)
    const data = await parseVoiceIntent(transcript, line)

    return NextResponse.json(
      { success: true, data },
      { headers: JSON_UTF8_HEADERS }
    )
  } catch (error) {
    if (error instanceof Error && error.message.includes('역 목록')) {
      return errorResponse(error.message, 503)
    }
    return errorResponse('서버 오류가 발생했습니다.', 500)
  }
}
