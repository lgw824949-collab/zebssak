'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

interface BoardingInfo {
  role: string | null
  carNumber: number | null
  seatSide?: 'A' | 'B'
  seatNumber?: number
  lineNumber?: number
  trainNo?: string
  destinationName?: string
}

// 하차 예정자(provider) 매칭 완료 시 적립 예정 포인트 (API 연동 전)
const PENDING_POINTS_PROVIDER = 100

/**
 * sessionStorage에서 탑승 정보를 읽습니다.
 */
function readBoardingInfo(): BoardingInfo {
  const keys = ['providerRegistered', 'boardingDraft']

  for (const key of keys) {
    try {
      const raw = sessionStorage.getItem(key)
      if (!raw) continue

      const parsed = JSON.parse(raw) as Record<string, unknown>
      return {
        role: typeof parsed.role === 'string' ? parsed.role : null,
        carNumber:
          typeof parsed.carNumber === 'number' ? parsed.carNumber : null,
        seatSide:
          parsed.seatSide === 'A' || parsed.seatSide === 'B'
            ? parsed.seatSide
            : parsed.seat_side === 'A' || parsed.seat_side === 'B'
              ? parsed.seat_side
              : undefined,
        seatNumber:
          typeof parsed.seatNumber === 'number'
            ? parsed.seatNumber
            : typeof parsed.seat_number === 'number'
              ? parsed.seat_number
              : undefined,
        lineNumber:
          typeof parsed.lineNumber === 'number' ? parsed.lineNumber : undefined,
        trainNo:
          typeof parsed.trainNo === 'string' ? parsed.trainNo : undefined,
        destinationName:
          typeof parsed.destinationName === 'string'
            ? parsed.destinationName
            : undefined,
      }
    } catch {
      continue
    }
  }

  return { role: null, carNumber: null }
}

/** 호선 번호에 맞는 노선 트랙 클래스 */
function getTrackClass(lineNumber: number): string {
  return lineNumber === 1
    ? 'zeb-track zeb-track--line1'
    : 'zeb-track zeb-track--line2'
}

/** 호선 번호에 맞는 배지 클래스 */
function getLineBadgeClass(lineNumber: number): string {
  return lineNumber === 1
    ? 'zeb-line-badge zeb-line-badge--1'
    : 'zeb-line-badge zeb-line-badge--2'
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

/**
 * 매칭 완료 화면
 */
export default function MatchedPage() {
  const router = useRouter()
  const [boardingInfo, setBoardingInfo] = useState<BoardingInfo | null>(null)

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) {
      router.replace('/login')
      return
    }

    setBoardingInfo(readBoardingInfo())
  }, [router])

  function handleConfirm() {
    sessionStorage.removeItem('boardingDraft')
    sessionStorage.removeItem('providerRegistered')
    router.push('/home')
  }

  if (!boardingInfo) {
    return <MatchedLoading />
  }

  const isProvider = boardingInfo.role === 'provider'
  const lineNumber = boardingInfo.lineNumber ?? 1
  const hasSeatGuide =
    boardingInfo.carNumber != null &&
    (boardingInfo.seatSide === 'A' || boardingInfo.seatSide === 'B') &&
    typeof boardingInfo.seatNumber === 'number'

  return (
    <div className="zeb-page matched-theme flex flex-col">
      <header className="zeb-page-header" aria-hidden>
        <div className="space-y-2">
          <div className={getTrackClass(lineNumber)} />
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
            매칭이 성공적으로 완료되었습니다.
            <br />
            안내에 따라 이동해주세요.
          </p>

          {boardingInfo.destinationName && (
            <p className="zeb-caption mt-3">
              목적지 · {boardingInfo.destinationName}
            </p>
          )}

          <div
            className="mt-8 rounded-[var(--radius-button)] border-2 px-4 py-5"
            style={{
              background: 'var(--surface)',
              borderColor: 'var(--line-1)',
            }}
          >
            <p
              className="font-semibold zeb-text-line1"
              style={{ fontSize: 'var(--font-size-base)' }}
            >
              탑승 안내
            </p>
            <p
              className="zeb-text-line1 mt-2"
              style={{ fontSize: 'var(--font-size-3xl)', fontWeight: 800, lineHeight: 1.2 }}
            >
              {boardingInfo.carNumber != null
                ? `${boardingInfo.carNumber}호차`
                : '—호차'}
            </p>
            {boardingInfo.lineNumber != null && boardingInfo.trainNo && (
              <div className="mt-3 flex items-center justify-center gap-2 flex-wrap">
                <span className={getLineBadgeClass(boardingInfo.lineNumber)}>
                  {boardingInfo.lineNumber}
                </span>
                <p className="zeb-caption">
                  인천 {boardingInfo.lineNumber}호선 · {boardingInfo.trainNo}
                </p>
              </div>
            )}
          </div>

          <div
            className="mt-4 rounded-[var(--radius-card)] border-2 px-4 py-5"
            style={{
              background: '#0B1F4B',
              borderColor: '#C6FF00',
              color: '#ffffff',
            }}
          >
            <p style={{ fontSize: 'var(--font-size-sm)', fontWeight: 700, opacity: 0.9 }}>
              좌석 위치 안내
            </p>
            <p
              style={{
                marginTop: '0.5rem',
                fontSize: 'var(--font-size-xl)',
                fontWeight: 900,
                lineHeight: 1.3,
                color: '#C6FF00',
              }}
            >
              {hasSeatGuide
                ? `${boardingInfo.carNumber}호차 ${boardingInfo.seatSide}면 ${boardingInfo.seatNumber}번으로 이동하세요`
                : '좌석 위치 정보를 불러오는 중입니다.'}
            </p>
          </div>

          <div className="mt-6 flex justify-center gap-2" aria-hidden>
            <span className="zeb-station-dot zeb-station-dot--line1" />
            <span className="zeb-station-dot zeb-station-dot--line2" />
            <span className="zeb-station-dot zeb-station-dot--lines2" />
          </div>

          {isProvider && (
            <div className="zeb-alert zeb-alert--warning mt-6 text-center">
              <p
                style={{
                  fontSize: 'var(--font-size-base)',
                  fontWeight: 700,
                }}
              >
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
                +{PENDING_POINTS_PROVIDER.toLocaleString()}P
              </p>
              <p className="zeb-caption mt-2">하차 완료 후 자동 적립됩니다.</p>
            </div>
          )}
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
        .matched-theme .zeb-page-title,
        .matched-theme .zeb-label,
        .matched-theme .zeb-text-line1 {
          color: #0052a4 !important;
        }
        .matched-theme .zeb-alert--warning {
          border-color: #ff6b00 !important;
          background: #fff4ea !important;
          color: #ff6b00 !important;
        }
        .matched-theme .zeb-btn {
          border-radius: 16px !important;
        }
        .matched-theme .zeb-btn--line1 {
          background: #0052a4 !important;
          color: #ffffff !important;
        }
      `}</style>
    </div>
  )
}
