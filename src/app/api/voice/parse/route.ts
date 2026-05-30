import { loadEnvConfig } from '@next/env'
import { NextResponse } from 'next/server'
import { getUserIdFromRequest } from '@/lib/api-auth'
import { MOCK_ALL_STATIONS } from '@/lib/mockData'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

loadEnvConfig(process.cwd())

type VoiceMode = 'seek' | 'leave'

interface VoiceParseBody {
  transcript?: unknown
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

let stationNamesCache: { names: string[]; expiresAt: number } | null = null

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
  if (transcript.includes('내릴')) {
    return 'leave'
  }
  // 음성 인식 오타(안고) 및 앉고 싶어 표현
  if (/앉고|안고|앉을|앉아|착석|자리/u.test(transcript)) {
    return 'seek'
  }
  return null
}

async function parseVoiceIntent(transcript: string): Promise<ParsedVoiceIntent> {
  const stationNames = await loadAllStationNames()
  return {
    destination: findDestinationFromTranscript(transcript, stationNames),
    mode: extractModeFromTranscript(transcript),
  }
}

/**
 * POST /api/voice/parse — 음성 텍스트에서 목적지·모드(seek/leave) 추출
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

    const data = await parseVoiceIntent(transcript)

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
