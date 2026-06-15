'use client'

import MatchMovementPanel from '@/components/MatchMovementPanel'
import MatchFlowStepBar from '@/components/MatchFlowStepBar'
import type { MatchMovementPayload } from '@/lib/match-movement'
import {
  resolveMatchFlowStep,
  resolveMatchedPhaseCopy,
} from '@/lib/match-flow-steps'
import { isHandoffMoveDue } from '@/lib/match-handoff-remaining'
import { clearMatchClientSession } from '@/lib/match-session'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

const COUNTDOWN_SECONDS = 180
const MATCH_MOVEMENT_POLL_MS = 3000
const HOME_MATCH_COMPLETED_HINT_KEY = 'homeMatchCompletedHint'
/** 서울 7호선 브랜드 */
const LINE7_PRIMARY = '#747F00'
const LINE7_DARK = '#4A5219'
const LINE7_MID = '#5F6B2E'
const LINE7_GLOW = 'rgba(116, 127, 0, 0.12)'

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
  movement?: MatchMovementPayload
  seat_confirmation?: { seated: boolean; created_at: string } | null
}

function MatchedLoading() {
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center gap-5 bg-[#f6f7f2] px-4">
      <div
        className="h-11 w-11 animate-spin rounded-full border-[3px] border-[#E4E9D0] border-t-[#747F00]"
        aria-hidden
      />
      <p className="text-sm font-medium text-[#6B7280]">매칭 정보를 불러오는 중</p>
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
  const doorLabel = `${carNumber}-${doorNumber}`
  const nextDoorLabel = `${carNumber}-${Math.min(doorNumber + 1, 4)}`

  const rowLetters = ['A', 'B', 'C', 'D', 'E', 'F']

  function isLeftColumn(letter: string): boolean {
    return letter === 'A' || letter === 'B' || letter === 'C'
  }

  function isMatchedSide(side: 'left' | 'right', letter: string): boolean {
    if (letter !== columnLetter) return false
    if (isLeftColumn(letter)) return side === 'left' && isLeftSide
    return side === 'right' && isRightSide
  }

  const seatW = 62
  const seatH = 28
  const gap = 6
  const aisleW = 36
  const padX = 16
  const padY = 20
  const doorH = 32
  const totalW = padX * 2 + seatW * 2 + aisleW
  const rowBlockH = seatH + gap
  const bodyH = doorH + gap + rowBlockH * 6 + gap + doorH * 0.6
  const totalH = padY * 2 + bodyH

  const leftX = padX
  const aisleX = padX + seatW
  const rightX = padX + seatW + aisleW
  const topDoorY = padY

  return (
    <svg
      viewBox={`0 0 ${totalW} ${totalH}`}
      className="mx-auto w-full max-w-[280px]"
      role="img"
      aria-label="좌석 배치도"
    >
      <defs>
        <linearGradient id="carBg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FAFBF7" />
          <stop offset="100%" stopColor="#F0F3E8" />
        </linearGradient>
        <filter id="seatGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor={LINE7_PRIMARY} floodOpacity="0.35" />
        </filter>
      </defs>

      <rect
        x="4"
        y="4"
        width={totalW - 8}
        height={totalH - 8}
        rx="20"
        fill="url(#carBg)"
        stroke="#E2E8D4"
        strokeWidth="1"
      />

      {/* 상단 출입문 */}
      <g transform={`translate(0, ${topDoorY})`}>
        <rect
          x={leftX}
          y={0}
          width={seatW}
          height={doorH}
          rx="10"
          fill="#fff"
          stroke="#D8DFC8"
          strokeWidth="1"
        />
        <rect
          x={rightX}
          y={0}
          width={seatW}
          height={doorH}
          rx="10"
          fill={LINE7_PRIMARY}
          stroke={LINE7_MID}
          strokeWidth="1"
        />
        <text x={leftX + seatW / 2} y={doorH / 2 + 4} textAnchor="middle" fontSize="10" fontWeight="600" fill="#9CA3AF">
          {doorLabel}
        </text>
        <text x={rightX + seatW / 2} y={doorH / 2 - 1} textAnchor="middle" fontSize="10" fontWeight="700" fill="#fff">
          {doorLabel}
        </text>
        <text x={rightX + seatW / 2} y={doorH / 2 + 10} textAnchor="middle" fontSize="8" fontWeight="600" fill="rgba(255,255,255,0.85)">
          여기서 탑승
        </text>
      </g>

      {rowLetters.map((letter, index) => {
        const rowY = padY + doorH + gap + index * rowBlockH
        const showAisleLabel = letter === 'C'

        const renderSeat = (side: 'left' | 'right', x: number) => {
          const matched = isMatchedSide(side, letter)
          const showLabel =
            (isLeftColumn(letter) && side === 'left') || (!isLeftColumn(letter) && side === 'right')

          return (
            <g key={`${letter}-${side}`}>
              <rect
                x={x}
                y={rowY}
                width={seatW}
                height={seatH}
                rx="9"
                fill={matched ? LINE7_PRIMARY : '#fff'}
                stroke={matched ? LINE7_MID : '#E5EAD8'}
                strokeWidth="1"
                filter={matched ? 'url(#seatGlow)' : undefined}
              />
              {showLabel ? (
                <text
                  x={x + seatW / 2}
                  y={rowY + seatH / 2 + 4}
                  textAnchor="middle"
                  fontSize="11"
                  fontWeight={matched ? '700' : '500'}
                  fill={matched ? '#fff' : '#9CA3AF'}
                >
                  {matched ? `${letter} · 내 자리` : letter}
                </text>
              ) : null}
            </g>
          )
        }

        return (
          <g key={letter}>
            {renderSeat('left', leftX)}
            {showAisleLabel ? (
              <text
                x={aisleX + aisleW / 2}
                y={rowY + seatH / 2 + 4}
                textAnchor="middle"
                fontSize="9"
                fontWeight="600"
                fill="#B8C28A"
              >
                통로
              </text>
            ) : null}
            {renderSeat('right', rightX)}
          </g>
        )
      })}

      {/* 하단 다음 문 (흐림) */}
      <g opacity="0.28" transform={`translate(0, ${padY + doorH + gap + rowBlockH * 6 + gap})`}>
        <rect x={leftX} y={0} width={seatW} height={doorH * 0.65} rx="8" fill="#fff" stroke="#E5EAD8" />
        <rect x={rightX} y={0} width={seatW} height={doorH * 0.65} rx="8" fill="#fff" stroke="#E5EAD8" />
        <text x={leftX + seatW / 2} y={doorH * 0.4} textAnchor="middle" fontSize="9" fill="#9CA3AF">
          {nextDoorLabel}
        </text>
        <text x={rightX + seatW / 2} y={doorH * 0.4} textAnchor="middle" fontSize="9" fill="#9CA3AF">
          {nextDoorLabel}
        </text>
      </g>
    </svg>
  )
}

function CountdownRing({ secondsLeft, total }: { secondsLeft: number; total: number }) {
  const radius = 42
  const circumference = 2 * Math.PI * radius
  const progress = Math.max(0, Math.min(1, secondsLeft / total))
  const offset = circumference * (1 - progress)
  const urgent = secondsLeft <= 60

  return (
    <div className="relative mx-auto flex h-[104px] w-[104px] items-center justify-center">
      <svg className="absolute inset-0 -rotate-90" viewBox="0 0 100 100" aria-hidden>
        <circle cx="50" cy="50" r={radius} fill="none" stroke="#E8EDD4" strokeWidth="6" />
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke={urgent ? '#DC2626' : LINE7_PRIMARY}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-1000 ease-linear"
        />
      </svg>
      <div className="text-center">
        <p
          className="font-mono text-[26px] font-bold leading-none tracking-tight"
          style={{ color: urgent ? '#DC2626' : LINE7_DARK }}
        >
          {formatCountdown(secondsLeft)}
        </p>
        <p className="mt-1 text-[10px] font-medium text-[#9CA3AF]">남음</p>
      </div>
    </div>
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
  const [isUpdatingMovement, setIsUpdatingMovement] = useState(false)
  const [movementError, setMovementError] = useState('')
  const completionHandledRef = useRef(false)

  const loadMatchDetail = useCallback(
    async (
      matchId: string,
      token: string,
      options?: { signal?: AbortSignal; silent?: boolean }
    ) => {
      try {
        const response = await fetch(`/api/matches/${encodeURIComponent(matchId)}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
          signal: options?.signal,
        })

        const result = (await response.json()) as {
          success?: boolean
          error?: string
          data?: MatchDetail
        }

        if (!response.ok || !result.success || !result.data) {
          if (!options?.silent) {
            setError(result.error ?? '매칭 결과를 불러올 수 없습니다.')
          }
          return
        }

        setError('')
        setDetail(result.data)
        if (result.data.seat_confirmation) {
          setSeatAnswer(result.data.seat_confirmation.seated)
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return
        if (!options?.silent) {
          setError('네트워크 오류가 발생했습니다.')
        }
      }
    },
    []
  )

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

    void loadMatchDetail(matchId, token, { signal: abortController.signal })

    const timerId = window.setInterval(() => {
      void loadMatchDetail(matchId, token, { silent: true })
    }, MATCH_MOVEMENT_POLL_MS)

    return () => {
      abortController.abort()
      window.clearInterval(timerId)
    }
  }, [loadMatchDetail, router])

  const submitMovementStatus = useCallback(
    async (status: 'moving' | 'arrived') => {
      const token = localStorage.getItem('token')
      const matchId = resolveMatchId()

      if (!token || !matchId || detail?.viewer_role !== 'seeker') {
        return
      }

      setIsUpdatingMovement(true)

      try {
        const response = await fetch(
          `/api/matches/${encodeURIComponent(matchId)}/movement-status`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ status }),
          }
        )

        const result = (await response.json()) as {
          success?: boolean
          data?: { status?: 'moving' | 'arrived' }
        }

        if (!response.ok || !result.success || !result.data?.status) {
          setMovementError('이동 상태 전송에 실패했습니다.')
          return
        }

        setDetail((prev) =>
          prev?.movement
            ? {
                ...prev,
                movement: {
                  ...prev.movement,
                  self: {
                    status: result.data!.status!,
                    updated_at: new Date().toISOString(),
                  },
                },
              }
            : prev
        )
        setMovementError('')
      } catch {
        setMovementError('이동 상태 전송 중 오류가 발생했습니다.')
      } finally {
        setIsUpdatingMovement(false)
      }
    },
    [detail?.viewer_role]
  )

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSecondsLeft((prev) => (prev > 0 ? prev - 1 : 0))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [])

  function saveHomeMatchCompletedHint() {
    if (!detail) {
      return
    }

    try {
      const kind = detail.viewer_role === 'provider' ? 'leave' : 'seek'
      const destinationName =
        detail.self.destination_station_name?.trim() || '목적지'

      sessionStorage.setItem(
        HOME_MATCH_COMPLETED_HINT_KEY,
        JSON.stringify({
          kind,
          destinationName,
          completedAt: Date.now(),
        })
      )
    } catch {
      // 힌트 저장 실패 시 홈 재등록 안내만 생략합니다.
    }
  }

  function clearMatchSession() {
    clearMatchClientSession()
  }

  function handleConfirm() {
    saveHomeMatchCompletedHint()
    clearMatchSession()
    router.push('/')
  }

  /** 착석 희망자 확인 후 양보자도 자동 종료합니다. */
  useEffect(() => {
    if (!detail || detail.status !== 'completed' || completionHandledRef.current) {
      return
    }

    completionHandledRef.current = true

    const timerId = window.setTimeout(() => {
      try {
        const kind = detail.viewer_role === 'provider' ? 'leave' : 'seek'
        const destinationName =
          detail.self.destination_station_name?.trim() || '목적지'
        sessionStorage.setItem(
          HOME_MATCH_COMPLETED_HINT_KEY,
          JSON.stringify({
            kind,
            destinationName,
            completedAt: Date.now(),
          })
        )
      } catch {
        // 힌트 저장 실패 시 홈 재등록 안내만 생략합니다.
      }
      clearMatchSession()
      router.replace('/')
    }, 2200)

    return () => window.clearTimeout(timerId)
  }, [detail, router])

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
      setDetail((prev) => (prev ? { ...prev, status: 'completed' } : prev))
      window.setTimeout(() => {
        handleConfirm()
      }, 1200)
      return
    }

    handleConfirm()
  }

  if (error) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center bg-[#f6f7f2] p-6">
        <p className="text-center text-sm font-medium text-red-600">{error}</p>
        <button
          type="button"
          className="mt-6 rounded-2xl bg-[#747F00] px-6 py-3 text-sm font-semibold text-white shadow-md shadow-[#747F00]/20"
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
  const seatConfirmed =
    seatAnswer === true || detail.seat_confirmation?.seated === true
  const handoffRemaining = detail.movement?.route_guide.handoff_remaining_stations ?? null
  const handoffStationName = detail.movement?.route_guide.handoff_station_name
  const flowStep = resolveMatchFlowStep({
    matchStatus: detail.status,
    viewerRole: detail.viewer_role,
    selfMovementStatus: detail.movement?.self.status,
    partnerMovementStatus: detail.movement?.partner.status,
    handoffRemainingStations: handoffRemaining,
    seatConfirmed,
  })
  const phaseCopy = resolveMatchedPhaseCopy({
    viewerRole: detail.viewer_role,
    step: flowStep,
    handoffStationName,
    handoffRemainingStations: handoffRemaining,
    selfMovementStatus: detail.movement?.self.status,
    partnerMovementStatus: detail.movement?.partner.status,
  })
  const moveDue = isHandoffMoveDue(handoffRemaining)
  const isFlowDone = flowStep === 'done'
  const guide = isSeeker ? detail.partner : detail.self
  const seatsPerSection = seatsPerSectionFromStationCode(guide.destination_station_code)
  const travelSideLabel = seatSideToTravelSideLabel(guide.seat_side)
  const columnLetter = resolveSeatColumnLetter(guide.seat_number, seatsPerSection)
  const { car: diagramCar, door: diagramDoor } = parseDoorParts(guide.car_number, guide.car_door_short)
  const carLabel = guide.car_number != null ? `${guide.car_number}호차` : '미확인'
  const doorLabel = guide.car_door_short ?? '-'
  const columnLabel = columnLetter !== '-' ? `${columnLetter}열` : '-'

  const infoItems = [
    { label: '호차', value: carLabel },
    { label: '방향', value: travelSideLabel || '-' },
    { label: '출입문', value: doorLabel },
    { label: '열', value: columnLabel },
  ]

  return (
    <div className="min-h-dvh bg-[#f6f7f2] pb-8">
      <p className="mx-4 mt-4 rounded-xl bg-[#f0f5e8] px-4 py-3 text-center text-[16px] font-semibold text-[#4a7c3f]">
        {phaseCopy.banner}
      </p>
      {/* 상단 히어로 */}
      <div
        className="relative overflow-hidden px-5 pb-8 pt-10"
        style={{
          background: `linear-gradient(155deg, ${LINE7_DARK} 0%, ${LINE7_PRIMARY} 48%, #8A9430 100%)`,
        }}
      >
        <div
          className="pointer-events-none absolute -right-8 -top-10 h-40 w-40 rounded-full opacity-20"
          style={{ background: 'radial-gradient(circle, #fff 0%, transparent 70%)' }}
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-16 -left-6 h-32 w-32 rounded-full opacity-10"
          style={{ background: '#fff' }}
          aria-hidden
        />

        <div className="relative mx-auto max-w-md">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/15 text-sm font-bold text-white ring-1 ring-white/25 backdrop-blur-sm">
              7
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-[13px] font-medium text-white/75">서울 7호선</p>
              <h1 className="mt-0.5 text-[22px] font-bold leading-tight tracking-tight text-white">
                {phaseCopy.headline}
              </h1>
            </div>
            <span
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-[#747F00] shadow-lg shadow-black/10"
              aria-hidden
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path
                  d="M5 12.5l4.5 4.5L19 7.5"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </div>

          <p className="mt-4 text-sm font-medium text-white/90">
            {phaseCopy.subline}
          </p>
        </div>
      </div>

      <main className="relative z-[1] mx-auto -mt-5 flex w-full max-w-md flex-col gap-3 px-4">
        <MatchFlowStepBar currentStep={flowStep} />

        {isFlowDone ? (
          <div className="rounded-2xl bg-white px-4 py-8 text-center shadow-[0_8px_30px_rgba(26,26,26,0.06)] ring-1 ring-black/[0.04]">
            <p className="text-[40px]" aria-hidden>
              ✓
            </p>
            <p className="mt-3 text-[20px] font-extrabold text-[#1A1A1A]">이용 완료</p>
            <p className="mt-2 text-[15px] font-medium text-[#6B7280]">
              {isSeeker ? '착석이 확인되었어요' : '착석 희망자가 착석했어요'}
            </p>
          </div>
        ) : (
          <>
        {detail.movement ? (
          <MatchMovementPanel
            viewerRole={detail.viewer_role}
            movement={detail.movement}
            flowStep={flowStep}
            isUpdating={isUpdatingMovement}
            onStartMoving={() => void submitMovementStatus('moving')}
            onArrived={() => void submitMovementStatus('arrived')}
          />
        ) : null}
        {movementError ? (
          <p className="rounded-xl bg-red-50 px-3 py-2 text-center text-sm text-red-700">
            {movementError}
          </p>
        ) : null}
        {/* 요약 칩 */}
        <div className="rounded-2xl bg-white p-4 shadow-[0_8px_30px_rgba(26,26,26,0.06)] ring-1 ring-black/[0.04]">
          <div className="grid grid-cols-4 gap-2">
            {infoItems.map((item) => (
              <div
                key={item.label}
                className="rounded-xl px-1 py-3 text-center"
                style={{ backgroundColor: LINE7_GLOW }}
              >
                <p className="text-[12px] font-bold text-[#6B7280]">{item.label}</p>
                <p className="mt-1.5 text-[18px] font-extrabold leading-tight text-[#1A1A1A]">
                  {item.value}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* 좌석 배치도 */}
        <div className="rounded-2xl bg-white p-5 shadow-[0_8px_30px_rgba(26,26,26,0.06)] ring-1 ring-black/[0.04]">
          <div className="mb-4 flex items-center justify-between gap-2">
            <div>
              <p className="text-[11px] font-semibold text-[#9CA3AF]">내 자리 안내</p>
              <p className="mt-0.5 text-[15px] font-bold text-[#1A1A1A]">
                {carLabel} · {doorLabel !== '-' ? doorLabel : `출${diagramCar}-${diagramDoor}`}
              </p>
            </div>
            <span
              className="shrink-0 rounded-full px-3 py-1 text-xs font-bold text-white"
              style={{ backgroundColor: LINE7_PRIMARY }}
            >
              {columnLabel}
            </span>
          </div>
          <MatchSeatDiagram
            carNumber={diagramCar}
            doorNumber={diagramDoor}
            travelSide={travelSideLabel}
            columnLetter={columnLetter}
          />
        </div>

        {/* 타이머 */}
        <div className="flex items-center gap-4 rounded-2xl bg-white p-4 shadow-[0_8px_30px_rgba(26,26,26,0.06)] ring-1 ring-black/[0.04]">
          <CountdownRing secondsLeft={secondsLeft} total={COUNTDOWN_SECONDS} />
          <div className="min-w-0 flex-1">
            <p className="text-[16px] font-bold text-[#1A1A1A]">
              {flowStep === 'seat' ? '착석 남은 시간' : '이동 남은 시간'}
            </p>
            <p className="mt-1 text-[14px] font-medium text-[#6B7280]">
              {phaseCopy.timerHint}
            </p>
          </div>
        </div>

        {/* CTA */}
        <button
          type="button"
          disabled={
            isSubmittingSeat ||
            !phaseCopy.ctaEnabled ||
            (isSeeker && flowStep === 'move' && !moveDue)
          }
          onClick={() => void handleSeatedComplete()}
          className="mt-1 w-full rounded-2xl py-4 text-[17px] font-bold text-white shadow-[0_10px_28px_rgba(116,127,0,0.35)] transition active:scale-[0.98] disabled:opacity-60"
          style={{
            background: `linear-gradient(180deg, #8A9430 0%, ${LINE7_PRIMARY} 45%, ${LINE7_DARK} 100%)`,
          }}
        >
          {isSubmittingSeat ? '처리 중...' : phaseCopy.ctaLabel}
        </button>

        {seatSubmitError ? (
          <p className="text-center text-sm font-medium text-red-600">{seatSubmitError}</p>
        ) : null}
          </>
        )}
      </main>
    </div>
  )
}
