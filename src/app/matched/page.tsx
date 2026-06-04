'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

const COUNTDOWN_SECONDS = 180
const MATCH_GREEN = '#4a7c3f'
const SIDE_SEAT_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']

interface RequestSummary {
  car_number: number | null
  car_door_short: string | null
  seat_side: 'A' | 'B' | null
  seat_number: number | null
  seat_position_label: string | null
  train_no: string | null
  line_label: string | null
  destination_station_name: string
  destination_station_code?: string | null
  remaining_stations: number | null
}

interface MatchDetail {
  match_id: string
  status: string
  viewer_role: 'seeker' | 'provider'
  partner: RequestSummary
  self: RequestSummary
  seat_confirmation?: { seated: boolean; created_at: string } | null
}

function MatchedLoading() {
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center gap-4 bg-[#f7f8fa] px-4">
      <div className="w-full max-w-[12rem] space-y-2" aria-hidden>
        <div className="h-2 rounded-full bg-[#e8f0d8]" />
        <div className="h-2 rounded-full bg-[#d8e4c8]" />
      </div>
      <p className="text-sm text-gray-500">로딩 중...</p>
    </div>
  )
}

/** seat_side(A/B) → 진행 방향 기준 좌측·우측 */
function seatSideToTravelSideLabel(seatSide: 'A' | 'B' | null | undefined): string {
  if (seatSide === 'A') return '좌측'
  if (seatSide === 'B') return '우측'
  return '-'
}

function seatsPerSectionFromStationCode(code: string | null | undefined): number {
  const trimmed = (code ?? '').trim().toLowerCase()
  if (trimmed.startsWith('s1')) return 8
  return 7
}

function resolveSeatColumnLetter(
  seatNumber: number | null | undefined,
  seatsPerSection: number
): string {
  if (!Number.isInteger(seatNumber) || seatNumber! < 1) return '-'
  const seatInSection = (seatNumber! - 1) % seatsPerSection
  return SIDE_SEAT_LETTERS[seatInSection] ?? '-'
}

function parseDoorParts(
  carNumber: number | null,
  carDoorShort: string | null | undefined
): { car: number; door: number } {
  const match = (carDoorShort ?? '').match(/^출(\d+)-(\d+)$/)
  if (match) {
    return {
      car: Number.parseInt(match[1], 10),
      door: Number.parseInt(match[2], 10),
    }
  }
  return {
    car: carNumber ?? 1,
    door: 1,
  }
}

function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function resolveMatchId(): string | null {
  const fromStorage = sessionStorage.getItem('activeMatchId')?.trim()
  if (fromStorage) return fromStorage
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('matchId')?.trim()
    return fromUrl || null
  } catch {
    return null
  }
}

function MatchSeatDiagram({
  carNumber,
  doorNumber,
  travelSide,
  columnLetter,
}: {
  carNumber: number
  doorNumber: number
  travelSide: string
  columnLetter: string
}) {
  const isRightSide = travelSide === '우측'
  const isLeftSide = travelSide === '좌측'
  const doorLabel = `출${carNumber}-${doorNumber}`
  const sectionKey = `${carNumber}-${doorNumber}`
  const nextDoorLabel = `출${carNumber}-${Math.min(doorNumber + 1, 4)}`

  const SEAT_FILL = '#ddeedd'
  const CAP_FILL = '#c8dba8'
  const BG_FILL = '#e8f0d8'
  const STROKE = '#b8cca8'

  const leftX = 8
  const aisleX = 78
  const rightX = 122
  const seatW = 70
  const aisleW = 44
  const topCapH = 10
  const doorH = 22
  const rowH = 33
  const bottomCapH = 28

  const topDoorY = topCapH
  const rowStartY = topDoorY + doorH
  const bottomDoorY = rowStartY + rowH * 6
  const bottomCapY = bottomDoorY + doorH

  const rowLetters = ['A', 'B', 'C', 'D', 'E', 'F']

  function isLeftColumn(letter: string): boolean {
    return letter === 'A' || letter === 'B' || letter === 'C'
  }

  function isMatchedSide(side: 'left' | 'right', letter: string): boolean {
    if (letter !== columnLetter) return false
    if (isLeftColumn(letter)) return side === 'left' && isLeftSide
    return side === 'right' && isRightSide
  }

  function seatSideFill(side: 'left' | 'right', letter: string): string {
    return isMatchedSide(side, letter) ? MATCH_GREEN : SEAT_FILL
  }

  function seatSideLabel(side: 'left' | 'right', letter: string): string {
    if (isLeftColumn(letter)) {
      if (side === 'left') {
        return isMatchedSide('left', letter) ? `${letter} ★` : letter
      }
      return ''
    }
    if (side === 'right') {
      return isMatchedSide('right', letter) ? `${letter} ★` : letter
    }
    return ''
  }

  function seatTextColor(side: 'left' | 'right', letter: string): string {
    return isMatchedSide(side, letter) ? '#ffffff' : '#374151'
  }

  return (
    <svg viewBox="0 0 200 280" className="w-full" role="img" aria-label="좌석 배치도">
      {/* 1. 객차 배경 */}
      <rect x="0" y="0" width="200" height="280" fill={BG_FILL} stroke={STROKE} strokeWidth="1.5" />

      {/* 2. 상단 캡 */}
      <rect x="0" y="0" width="200" height={topCapH} fill={CAP_FILL} />

      {/* 3. 출입문 (상단) */}
      <rect x={leftX} y={topDoorY} width={seatW} height={doorH} fill="#ffffff" stroke={STROKE} strokeWidth="1" />
      <text x={leftX + seatW / 2} y={topDoorY + 15} textAnchor="middle" fontSize="9" fontWeight="800" fill={MATCH_GREEN}>
        {doorLabel}
      </text>
      <rect x={rightX} y={topDoorY} width={seatW} height={doorH} fill={MATCH_GREEN} stroke={STROKE} strokeWidth="1" />
      <text x={rightX + seatW / 2} y={topDoorY + 13} textAnchor="middle" fontSize="9" fontWeight="800" fill="#ffffff">
        {doorLabel}
      </text>
      <text x={rightX + seatW / 2} y={topDoorY + 20} textAnchor="middle" fontSize="7" fontWeight="700" fill="#ffffff">
        ▼ 여기
      </text>

      {/* 4~9. A~F열 (좌우 양쪽, 붙임) */}
      {rowLetters.map((letter, index) => {
        const y = rowStartY + index * rowH
        const showSectionBox = letter === 'C'
        return (
          <g key={`row-${letter}`}>
            <rect
              x={leftX}
              y={y}
              width={seatW}
              height={rowH}
              fill={seatSideFill('left', letter)}
              stroke={STROKE}
              strokeWidth="1"
            />
            <text
              x={leftX + seatW / 2}
              y={y + rowH / 2 + 5}
              textAnchor="middle"
              fontSize="12"
              fontWeight="900"
              fill={seatTextColor('left', letter)}
            >
              {seatSideLabel('left', letter)}
            </text>
            {showSectionBox ? (
              <>
                <rect
                  x={aisleX}
                  y={y}
                  width={aisleW}
                  height={rowH}
                  fill="#ffffff"
                  stroke={STROKE}
                  strokeWidth="1"
                />
                <text
                  x={aisleX + aisleW / 2}
                  y={y + rowH / 2 + 5}
                  textAnchor="middle"
                  fontSize="11"
                  fontWeight="900"
                  fill={MATCH_GREEN}
                >
                  {sectionKey}
                </text>
              </>
            ) : (
              <rect x={aisleX} y={y} width={aisleW} height={rowH} fill={BG_FILL} />
            )}
            <rect
              x={rightX}
              y={y}
              width={seatW}
              height={rowH}
              fill={seatSideFill('right', letter)}
              stroke={STROKE}
              strokeWidth="1"
            />
            <text
              x={rightX + seatW / 2}
              y={y + rowH / 2 + 5}
              textAnchor="middle"
              fontSize="12"
              fontWeight="900"
              fill={seatTextColor('right', letter)}
            >
              {seatSideLabel('right', letter)}
            </text>
          </g>
        )
      })}

      {/* 10. 출입문 (하단, 흐리게) */}
      <g opacity="0.35">
        <rect x={leftX} y={bottomDoorY} width={seatW} height={doorH} fill="#ffffff" stroke={STROKE} strokeWidth="1" />
        <text x={leftX + seatW / 2} y={bottomDoorY + 15} textAnchor="middle" fontSize="9" fontWeight="800" fill={MATCH_GREEN}>
          {nextDoorLabel}
        </text>
        <rect x={rightX} y={bottomDoorY} width={seatW} height={doorH} fill="#ffffff" stroke={STROKE} strokeWidth="1" />
        <text x={rightX + seatW / 2} y={bottomDoorY + 15} textAnchor="middle" fontSize="9" fontWeight="800" fill={MATCH_GREEN}>
          {nextDoorLabel}
        </text>
      </g>

      {/* 11. 하단 캡 */}
      <rect x="0" y={bottomCapY} width="200" height={bottomCapH} fill={CAP_FILL} />
    </svg>
  )
}

/**
 * 매칭 완료 화면
 */
export default function MatchedPage() {
  const router = useRouter()
  const [detail, setDetail] = useState<MatchDetail | null>(null)
  const [error, setError] = useState('')
  const [seatAnswer, setSeatAnswer] = useState<boolean | null>(null)
  const [isSubmittingSeat, setIsSubmittingSeat] = useState(false)
  const [seatSubmitError, setSeatSubmitError] = useState('')
  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_SECONDS)

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) {
      router.replace('/login')
      return
    }

    const resolvedMatchId = resolveMatchId()
    if (!resolvedMatchId) {
      setError('매칭 정보를 찾을 수 없습니다.')
      return
    }
    const matchId = resolvedMatchId

    const abortController = new AbortController()

    async function loadMatchDetail() {
      try {
        const response = await fetch(`/api/matches/${encodeURIComponent(matchId)}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: abortController.signal,
        })

        const result = (await response.json()) as {
          success?: boolean
          error?: string
          data?: MatchDetail
        }

        if (!response.ok || !result.success || !result.data) {
          setError(result.error ?? '매칭 결과를 불러올 수 없습니다.')
          return
        }

        setDetail(result.data)
        if (result.data.seat_confirmation) {
          setSeatAnswer(result.data.seat_confirmation.seated)
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return
        setError('네트워크 오류가 발생했습니다.')
      }
    }

    void loadMatchDetail()

    return () => abortController.abort()
  }, [router])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSecondsLeft((prev) => (prev > 0 ? prev - 1 : 0))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [])

  function clearMatchSession() {
    sessionStorage.removeItem('boardingDraft')
    sessionStorage.removeItem('waitingDraft')
    sessionStorage.removeItem('providerRegistered')
    sessionStorage.removeItem('activeMatchId')
    sessionStorage.removeItem('activeMatchRequestId')
    sessionStorage.removeItem('seekerMatchRequestRegistered')
  }

  function handleConfirm() {
    clearMatchSession()
    router.push('/')
  }

  async function submitSeatConfirmation(seated: boolean): Promise<boolean> {
    const token = localStorage.getItem('token')
    const matchId = resolveMatchId()
    if (!token || !matchId) {
      setSeatSubmitError('매칭 정보를 찾을 수 없습니다.')
      return false
    }

    setIsSubmittingSeat(true)
    setSeatSubmitError('')

    try {
      const response = await fetch(
        `/api/matches/${encodeURIComponent(matchId)}/confirm-seat`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ seated }),
        }
      )

      const result = (await response.json()) as {
        success?: boolean
        error?: string
      }

      if (!response.ok || !result.success) {
        setSeatSubmitError(result.error ?? '확인 저장에 실패했습니다.')
        return false
      }

      setSeatAnswer(seated)
      return true
    } catch {
      setSeatSubmitError('네트워크 오류가 발생했습니다.')
      return false
    } finally {
      setIsSubmittingSeat(false)
    }
  }

  async function handleSeatedComplete() {
    if (detail?.viewer_role === 'seeker' && seatAnswer === null) {
      const ok = await submitSeatConfirmation(true)
      if (!ok) return
    }
    handleConfirm()
  }

  if (error) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center bg-[#f7f8fa] p-6">
        <p className="text-center text-sm font-semibold text-red-600">{error}</p>
        <button
          type="button"
          className="mt-6 rounded-2xl bg-[#4a7c3f] px-6 py-3 text-sm font-bold text-white"
          onClick={() => router.push('/home')}
        >
          홈으로
        </button>
      </div>
    )
  }

  if (!detail) {
    return <MatchedLoading />
  }

  const isSeeker = detail.viewer_role === 'seeker'
  const guide = isSeeker ? detail.partner : detail.self
  const seatsPerSection = seatsPerSectionFromStationCode(guide.destination_station_code)
  const travelSideLabel = seatSideToTravelSideLabel(guide.seat_side)
  const columnLetter = resolveSeatColumnLetter(guide.seat_number, seatsPerSection)
  const { car: diagramCar, door: diagramDoor } = parseDoorParts(guide.car_number, guide.car_door_short)
  const carLabel = guide.car_number != null ? `${guide.car_number}호차` : '미확인'
  const doorLabel = guide.car_door_short ?? '-'
  const columnLabel = columnLetter !== '-' ? `${columnLetter}열` : '-'
  const diagramTitle = `${carLabel} · ${doorLabel !== '-' ? doorLabel : `출${diagramCar}-${diagramDoor}`} 구간`

  const infoItems = [
    { label: '호차', value: carLabel },
    { label: '방향', value: travelSideLabel || '-' },
    { label: '출입문', value: doorLabel },
    { label: '열', value: columnLabel },
  ]

  return (
    <div className="min-h-dvh flex flex-col bg-[#f7f8fa] px-4 py-6">
      <main className="mx-auto flex w-full max-w-md flex-col gap-4">
        {/* 1. 상단 배너 */}
        <div className="rounded-2xl bg-[#4a7c3f] p-4 text-center">
          <p className="text-xs text-white opacity-75">빈자리를 찾았어요!</p>
          <h1 className="mt-1 text-2xl font-black text-white">매칭 완료 ✓</h1>
        </div>

        {/* 2. 좌석 정보 카드 */}
        <div className="rounded-2xl bg-white p-4">
          <div className="grid grid-cols-4 gap-3">
            {infoItems.map((item) => (
              <div key={item.label} className="text-center">
                <p className="text-xs text-gray-400">{item.label}</p>
                <p className="mt-1 text-base font-black text-[#4a7c3f]">{item.value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* 3. 좌석 배치도 카드 */}
        <div className="rounded-2xl bg-white p-4">
          <p className="text-sm font-bold text-gray-900">{diagramTitle}</p>
          <div className="mt-3">
            <MatchSeatDiagram
              carNumber={diagramCar}
              doorNumber={diagramDoor}
              travelSide={travelSideLabel}
              columnLetter={columnLetter}
            />
          </div>
        </div>

        {/* 4. 타이머 */}
        <div className="rounded-2xl bg-[#fff8e6] p-4 text-center">
          <p className="text-xs text-[#8a6020]">착석까지 남은 시간</p>
          <p className="mt-2 text-2xl font-black text-[#b45309]">{formatCountdown(secondsLeft)}</p>
        </div>

        {/* 5. 착석 완료 버튼 */}
        <button
          type="button"
          disabled={isSubmittingSeat}
          onClick={() => void handleSeatedComplete()}
          className="w-full rounded-2xl bg-[#4a7c3f] py-4 text-lg font-black text-white disabled:opacity-60"
        >
          {isSubmittingSeat ? '처리 중...' : '착석 완료'}
        </button>

        {seatSubmitError ? (
          <p className="text-center text-sm font-semibold text-red-600">{seatSubmitError}</p>
        ) : null}
      </main>
    </div>
  )
}
