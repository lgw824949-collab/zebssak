'use client'

import type { MatchedUserAction } from '@/lib/match-matched-action'
import type { MatchFlowStep } from '@/lib/match-flow-steps'

interface MatchFlowScreenProps {
  flowStep: MatchFlowStep
  action: MatchedUserAction
  handoffRemaining: number | null
  trainCurrentStationName?: string | null
  providerDirectionLabel?: string | null
  positionIsLive?: boolean
  transitionMessage: string | null
  isSubmitting?: boolean
  onPrimaryAction?: () => void
  children?: React.ReactNode
}

function formatRemaining(count: number | null): string | null {
  if (count == null || count < 0 || count === 0) return null
  return `${count}역`
}

export default function MatchFlowScreen({
  flowStep,
  action,
  handoffRemaining,
  trainCurrentStationName,
  providerDirectionLabel,
  positionIsLive = false,
  transitionMessage,
  isSubmitting = false,
  onPrimaryAction,
  children,
}: MatchFlowScreenProps) {
  const remainingLabel = formatRemaining(handoffRemaining)
  const showButton = action.buttonLabel != null && action.kind !== 'wait'
  const currentStation = trainCurrentStationName?.trim() || null
  const directionLabel = providerDirectionLabel?.trim() || null
  const showLiveTrain =
    flowStep !== 'done' && (Boolean(currentStation) || Boolean(directionLabel))
  const statusText = transitionMessage ?? action.instruction
  const showStatus = Boolean(statusText) && (showButton || action.kind === 'wait')

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-2xl bg-white px-5 py-6 shadow-[0_8px_30px_rgba(26,26,26,0.06)] ring-1 ring-black/[0.04]">
        <p className="text-center text-zeb-sm font-semibold text-[#747F00]">{action.stepLabel}</p>
        <h1 className="mt-2 text-center text-zeb-2xl font-bold leading-tight text-[#1A1A1A]">
          {action.headline}
        </h1>

        {action.detail ? (
          <p className="mt-2 text-center text-zeb-md font-medium leading-snug text-[#6B7280]">
            {action.detail}
          </p>
        ) : null}

        {showLiveTrain ? (
          <div
            className={`mt-4 grid gap-2 ${currentStation && directionLabel ? 'grid-cols-2' : 'grid-cols-1'}`}
          >
            {currentStation ? (
              <div className="rounded-xl bg-[#F7F8F2] px-3 py-2.5 text-center">
                <p className="text-zeb-xs font-medium text-[#9CA3AF]">현재 위치</p>
                <p className="mt-1 text-zeb-lg font-bold text-[#1A1A1A]">{currentStation}</p>
              </div>
            ) : null}
            {directionLabel ? (
              <div className="rounded-xl bg-[#F7F8F2] px-3 py-2.5 text-center">
                <p className="text-zeb-xs font-medium text-[#9CA3AF]">방향</p>
                <p className="mt-1 text-zeb-md font-bold text-[#747F00]">{directionLabel}</p>
              </div>
            ) : null}
          </div>
        ) : null}

        {remainingLabel && flowStep !== 'done' ? (
          <div className="mt-4 text-center">
            <p className="text-zeb-3xl font-bold tabular-nums text-[#747F00] zeb-mono">
              {remainingLabel}
            </p>
            <p className="mt-1 text-zeb-xs font-medium text-[#9CA3AF]">
              {positionIsLive ? '실시간' : '등록 기준'}
            </p>
          </div>
        ) : null}

        {showStatus ? (
          <p
            className={`mt-4 rounded-xl px-4 py-3.5 text-center text-zeb-md font-semibold leading-snug ${
              action.blink && !transitionMessage && showButton
                ? 'match-flow-blink bg-[#FFF3CD] text-[#8B6914]'
                : 'bg-[#F7F8F2] text-[#4A5219]'
            }`}
            role="status"
          >
            {statusText}
          </p>
        ) : null}
      </div>

      {showButton ? (
        <button
          type="button"
          disabled={isSubmitting}
          onClick={onPrimaryAction}
          className={`w-full rounded-2xl py-4 text-zeb-xl font-bold text-white shadow-[0_10px_28px_rgba(116,127,0,0.35)] transition active:scale-[0.98] disabled:opacity-60 ${
            action.blink ? 'match-flow-blink' : ''
          }`}
          style={{
            background: 'linear-gradient(180deg, #8A9430 0%, #747F00 45%, #4A5219 100%)',
          }}
        >
          {isSubmitting ? '처리 중...' : action.buttonLabel}
        </button>
      ) : null}

      {children}

      <style jsx>{`
        @keyframes match-flow-blink {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.55;
          }
        }
        .match-flow-blink {
          animation: match-flow-blink 1s ease-in-out infinite;
        }
      `}</style>
    </div>
  )
}
