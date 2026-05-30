'use client'

import { CONGESTION_HALT_THRESHOLD } from '@/lib/congestion'

interface CongestionHaltModalProps {
  open: boolean
  onClose: () => void
  congestionLevel?: number
}

export default function CongestionHaltModal({
  open,
  onClose,
  congestionLevel,
}: CongestionHaltModalProps) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="congestion-halt-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-[#0B1F4B]/55"
        aria-label="닫기"
        onClick={onClose}
      />
      <div className="relative z-[101] w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#FEF2F2] text-2xl">
          🚫
        </div>
        <h2
          id="congestion-halt-title"
          className="mb-2 text-xl font-extrabold leading-snug text-[#1A1A1A]"
        >
          혼잡도 시간에는 이용할 수 없습니다
        </h2>
        <p className="mb-1 text-sm leading-relaxed text-[#6F7682]">
          현재 혼잡도가 높아 매칭·탑승 서비스 이용이 일시 중단되었습니다.
        </p>
        {typeof congestionLevel === 'number' && congestionLevel > 0 ? (
          <p className="mb-5 text-sm font-semibold text-[#DC2626]">
            현재 혼잡도 {congestionLevel} (기준 {CONGESTION_HALT_THRESHOLD} 이상)
          </p>
        ) : (
          <p className="mb-5 text-sm font-semibold text-[#DC2626]">
            혼잡도 {CONGESTION_HALT_THRESHOLD} 이상 구간
          </p>
        )}
        <p className="mb-6 text-xs leading-relaxed text-[#94A3B8]">
          혼잡도가 낮아지면 자동으로 이용 가능합니다. 잠시 후 다시 시도해 주세요.
        </p>
        <button
          type="button"
          className="zeb-touch-target flex min-h-11 w-full items-center justify-center rounded-xl bg-[#0B1F4B] text-base font-bold text-white"
          onClick={onClose}
        >
          확인
        </button>
      </div>
    </div>
  )
}
