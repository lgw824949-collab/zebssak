'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'

const PENDING_POINTS_PROVIDER = 100

/** 테스트·API 영문 역명 → 한글 (매칭 완료 화면 전용) */
const STATION_NAME_EN_TO_KO: Record<string, string> = {
  gangnam: '강남',
  seoul: '서울',
  gangbyeon: '강변',
  jamsil: '잠실',
  sadang: '사당',
  hongdae: '홍대입구',
  sinchon: '신촌',
  edae: '이대',
  cityhall: '시청',
  euljiro: '을지로',
  dongdaemun: '동대문',
  wangsimni: '왕십리',
  yeongdeungpo: '영등포',
  sindorim: '신도림',
  guro: '구로',
  bupyeong: '부평',
  incheon: '인천',
}

interface RequestSummary {
  car_number: number | null
  car_door_short: string | null
  seat_side: 'A' | 'B' | null
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
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="flex items-start justify-between gap-3 py-2"
      style={{ borderBottom: '1px solid var(--border)' }}
    >
      <span className="zeb-caption shrink-0" style={{ fontWeight: 600 }}>
        {label}
      </span>
      <span
        className="text-right font-semibold"
        style={{ fontSize: 'var(--font-size-base)', color: 'var(--foreground)' }}
      >
        {value}
      </span>
    </div>
  )
}

function SectionCard({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <div
      className="mt-4 rounded-[var(--radius-button)] border-2 px-4 py-4 text-left"
      style={{
        background: 'var(--surface)',
        borderColor: 'var(--line-1)',
      }}
    >
      <p
        className="font-semibold zeb-text-line1 mb-3"
        style={{ fontSize: 'var(--font-size-base)' }}
      >
        {title}
      </p>
      {children}
    </div>
  )
}

function MatchedLoading() {
  return (
    <div className="zeb-page flex flex-col items-center justify-center gap-4">
      <div className="w-full max-w-[12rem] space-y-2" aria-hidden>
        <div className="zeb-track zeb-track--line1" />
        <div className="zeb-track zeb-track--lines2" />
      </div>
      <p className="zeb-caption" style={{ fontSize: 'var(--font-size-lg)' }}>
        로딩 중...
      </p>
    </div>
  )
}

/** 역명 한글 표기 (역 접미사 포함) */
function formatStationKorean(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim()
  if (!trimmed) return '미확인'

  if (/[가-힣]/.test(trimmed)) {
    return trimmed.endsWith('역') ? trimmed : `${trimmed}역`
  }

  const normalizedKey = trimmed.toLowerCase().replace(/[^a-z]/g, '')
  const mapped = STATION_NAME_EN_TO_KO[normalizedKey]
  if (mapped) {
    return `${mapped}역`
  }

  return `${trimmed}역`
}

/** sessionStorage draft에서 한글 하차역명 보조 조회 */
function readKoreanDestinationFromSession(): string | null {
  const keys = ['waitingDraft', 'boardingDraft'] as const
  for (const key of keys) {
    try {
      const raw = sessionStorage.getItem(key)
      if (!raw) continue
      const parsed = JSON.parse(raw) as { destinationName?: string }
      if (typeof parsed.destinationName === 'string' && /[가-힣]/.test(parsed.destinationName)) {
        return parsed.destinationName.trim()
      }
    } catch {
      continue
    }
  }
  return null
}

/** seat_side(A/B) → 진행 방향 기준 좌측·우측 (좌석 맵과 동일) */
function seatSideToTravelSideLabel(seatSide: 'A' | 'B' | null | undefined): string {
  if (seatSide === 'A') return '좌측'
  if (seatSide === 'B') return '우측'
  return ''
}

/** 문·좌석 위치 한글 안내 */
function formatSeatPositionKorean(guide: RequestSummary): string {
  const sideLabel = seatSideToTravelSideLabel(guide.seat_side)
  const carNumber = guide.car_number
  const doorPart = guide.car_door_short?.includes('-')
    ? guide.car_door_short.split('-')[1]
    : null

  if (carNumber != null && doorPart && sideLabel) {
    return `${carNumber}-${doorPart}번 문 옆 (${sideLabel})`
  }

  const fallback = (guide.seat_position_label ?? '').trim()
  if (!fallback) return '좌석 정보 없음'

  return fallback.replace(/A측/g, '좌측').replace(/B측/g, '우측')
}

/** 하차역 표시 (영문 API값 보정) */
function resolveDestinationKorean(guide: RequestSummary): string {
  const fromSession = readKoreanDestinationFromSession()
  if (fromSession) {
    return formatStationKorean(fromSession)
  }
  return formatStationKorean(guide.destination_station_name)
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

/**
 * 매칭 완료 화면 — API 기준 상대방(하차 예정) 위치·노선 표시
 */
export default function MatchedPage() {
  const router = useRouter()
  const [detail, setDetail] = useState<MatchDetail | null>(null)
  const [error, setError] = useState('')

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
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return
        setError('네트워크 오류가 발생했습니다.')
      }
    }

    void loadMatchDetail()

    return () => abortController.abort()
  }, [router])

  function handleConfirm() {
    sessionStorage.removeItem('boardingDraft')
    sessionStorage.removeItem('waitingDraft')
    sessionStorage.removeItem('providerRegistered')
    sessionStorage.removeItem('activeMatchId')
    sessionStorage.removeItem('activeMatchRequestId')
    sessionStorage.removeItem('seekerMatchRequestRegistered')
    router.push('/home')
  }

  if (error) {
    return (
      <div className="zeb-page matched-theme flex flex-col items-center justify-center p-6">
        <p className="zeb-caption text-center" style={{ color: 'var(--color-danger)' }}>
          {error}
        </p>
        <button
          type="button"
          className="zeb-btn zeb-btn--line1 mt-6"
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
  const lineLabel = guide.line_label ?? '노선 미확인'
  const trainNo =
    guide.train_no != null && String(guide.train_no).trim()
      ? `${String(guide.train_no).trim()}번`
      : '미확인'
  const carLabel =
    guide.car_number != null ? `${guide.car_number}호차` : '미확인'
  const positionLabel = formatSeatPositionKorean(guide)
  const carDoorShort = guide.car_door_short
  const destinationLabel = resolveDestinationKorean(guide)
  const travelSideLabel = seatSideToTravelSideLabel(guide.seat_side)

  return (
    <div className="zeb-page matched-theme flex flex-col">
      <header className="zeb-page-header" aria-hidden>
        <div className="space-y-2">
          <div className="zeb-track zeb-track--line1" />
          <div className="zeb-track zeb-track--lines2" />
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center py-4">
        <div className="zeb-card w-full text-center zeb-bg-lines2-light">
          <div
            className="mx-auto mb-6 flex items-center justify-center rounded-full"
            style={{
              width: '5rem',
              height: '5rem',
              background: 'var(--line-1-light)',
            }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              width={40}
              height={40}
              aria-hidden
              style={{ color: 'var(--line-1)' }}
            >
              <path d="M4.5 6.375a4.125 4.125 0 118.25 0 4.125 4.125 0 01-8.25 0zM14.25 8.625a3.375 3.375 0 116.75 0 3.375 3.375 0 01-6.75 0zM1.5 19.125a7.125 7.125 0 0114.25 0v.003a.75.75 0 01-.363.63 13.067 13.067 0 01-6.761 1.873c-2.472 0-4.786-.343-6.76-1.873a.75.75 0 01-.364-.63v-.003zM17.25 19.128l-.001.144a2.25 2.25 0 01-.233.96 10.088 10.088 0 005.06-1.01.75.75 0 00.42-.643 4.875 4.875 0 00-6.957-4.611 8.586 8.586 0 011.039 3.174.75.75 0 00.47.695 9.067 9.067 0 004.52 1.01h-.001z" />
            </svg>
          </div>

          <div className="zeb-alert zeb-alert--success mb-6" style={{ textAlign: 'center' }}>
            <h1
              className="font-bold"
              style={{ fontSize: 'var(--font-size-2xl)', color: 'inherit' }}
            >
              매칭 완료!
            </h1>
          </div>

          <p className="zeb-page-desc">
            {isSeeker
              ? '하차 예정 승객 옆으로 이동해 주세요.'
              : '착석 희망 승객이 이동 중입니다.'}
          </p>

          <SectionCard title={isSeeker ? '하차 예정 승객' : '내 하차 등록'}>
            <InfoRow label="노선" value={lineLabel} />
            <InfoRow label="열차 번호" value={trainNo} />
            <InfoRow
              label={isSeeker ? '상대방 하차 역' : '내 하차 역'}
              value={destinationLabel}
            />
            {guide.remaining_stations != null ? (
              <InfoRow
                label="남은 역 수"
                value={`${guide.remaining_stations}역`}
              />
            ) : null}
          </SectionCard>

          <SectionCard title={isSeeker ? '이동 안내 (착석 위치)' : '내 좌석 위치'}>
            <InfoRow label="칸" value={carLabel} />
            <InfoRow label="문·좌석 위치" value={positionLabel} />
          </SectionCard>

          {isSeeker ? (
            <div
              className="mt-4 rounded-[var(--radius-card)] border-2 px-4 py-5"
              style={{
                background: '#0B1F4B',
                borderColor: '#C6FF00',
                color: '#ffffff',
              }}
            >
              <p style={{ fontSize: 'var(--font-size-sm)', fontWeight: 700, opacity: 0.9 }}>
                한 줄 안내
              </p>
              <p
                style={{
                  marginTop: '0.5rem',
                  fontSize: 'var(--font-size-xl)',
                  fontWeight: 900,
                  lineHeight: 1.35,
                  color: '#C6FF00',
                }}
              >
                {carDoorShort
                  ? `${carLabel} · ${carDoorShort}번 문 옆${travelSideLabel ? `(${travelSideLabel})` : ''}으로 이동하세요`
                  : `${carLabel} · ${positionLabel}`}
              </p>
            </div>
          ) : null}

          {!isSeeker ? (
            <div className="zeb-alert zeb-alert--warning mt-6 text-center">
              <p style={{ fontSize: 'var(--font-size-base)', fontWeight: 700 }}>
                적립 예정 포인트
              </p>
              <p
                className="mt-2"
                style={{
                  fontSize: 'var(--font-size-2xl)',
                  fontWeight: 800,
                  color: '#8a5a00',
                }}
              >
                +{PENDING_POINTS_PROVIDER.toLocaleString()}포인트
              </p>
              <p className="zeb-caption mt-2">하차 완료 후 자동 적립됩니다.</p>
            </div>
          ) : null}
        </div>
      </main>

      <footer
        className="mt-auto pt-6"
        style={{ borderTop: '2px solid var(--border)' }}
      >
        <button
          type="button"
          onClick={handleConfirm}
          className="zeb-btn zeb-btn--block zeb-btn--line1"
        >
          확인
        </button>
      </footer>
      <style jsx global>{`
        .matched-theme {
          background: #f7f8fa !important;
          color: #1a1a1a !important;
        }
        .matched-theme .zeb-card,
        .matched-theme .zeb-alert {
          border-radius: 16px !important;
        }
        .matched-theme .zeb-card {
          background: #ffffff !important;
          border: 0.5px solid #ebebeb !important;
          box-shadow: 0 2px 10px rgba(26, 26, 26, 0.05) !important;
        }
        .matched-theme .zeb-text-line1 {
          color: #0052a4 !important;
        }
        .matched-theme .zeb-alert--warning {
          border-color: #ff6b00 !important;
          background: #fff4ea !important;
          color: #ff6b00 !important;
        }
        .matched-theme .zeb-btn--line1 {
          background: #0052a4 !important;
          color: #ffffff !important;
        }
      `}</style>
    </div>
  )
}
