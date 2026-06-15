'use client'

import type { MatchedUserAction } from '@/lib/match-matched-action'
import type { MatchFlowStep } from '@/lib/match-flow-steps'

interface MatchFlowScreenProps {
  flowStep: MatchFlowStep
  action: MatchedUserAction
  handoffRemaining: number | null
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
  transitionMessage,
  isSubmitting = false,
  onPrimaryAction,
  children,
}: MatchFlowScreenProps) {
  const remainingLabel = formatRemaining(handoffRemaining)
  const showButton = action.buttonLabel != null && action.kind !== 'wait'

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-2xl bg-white px-5 py-6 shadow-[0_8px_30px_rgba(26,26,26,0.06)] ring-1 ring-black/[0.04]">
        <p className="text-center text-[13px] font-bold text-[#747F00]">{action.stepLabel}</p>
        <h1 className="mt-2 text-center text-[24px] font-extrabold leading-tight text-[#1A1A1A]">
          {action.headline}
        </h1>
        <p className="mt-2 text-center text-[15px] font-medium leading-snug text-[#6B7280]">
          {action.detail}
        </p>

        {remainingLabel && flowStep !== 'done' ? (
          <p className="mt-4 text-center text-[32px] font-extrabold tabular-nums text-[#747F00]">
            {remainingLabel}
          </p>
        ) : null}

        <p
          className={`mt-4 rounded-xl px-4 py-3.5 text-center text-[15px] font-bold leading-snug ${
            action.blink && !transitionMessage
              ? 'match-flow-blink bg-[#FFF3CD] text-[#8B6914]'
              : 'bg-[#F7F8F2] text-[#4A5219]'
          }`}
          role="status"
        >
          {transitionMessage ?? action.instruction}
        </p>

        {action.locationHint && !transitionMessage ? (
          <p className="mt-3 text-center text-[16px] font-extrabold text-[#374151]">
            {action.locationHint}
          </p>
        ) : null}
      </div>

      {showButton ? (
        <button
          type="button"
          disabled={isSubmitting}
          onClick={onPrimaryAction}
          className={`w-full rounded-2xl py-4 text-[18px] font-extrabold text-white shadow-[0_10px_28px_rgba(116,127,0,0.35)] transition active:scale-[0.98] disabled:opacity-60 ${
            action.blink ? 'match-flow-blink' : ''
          }`}
          style={{
            background: 'linear-gradient(180deg, #8A9430 0%, #747F00 45%, #4A5219 100%)',
          }}
        >
          {isSubmitting ? '처리 중...' : action.buttonLabel}
        </button>
      ) : (
        <div
          className="rounded-2xl border border-dashed border-[#D5DDB8] bg-[#FAFBF7] px-4 py-3.5 text-center text-[14px] font-semibold text-[#6B7280]"
          role="status"
        >
          지금은 기다리는 단계예요 · 안내가 바뀌면 버튼이 나타납니다
        </div>
      )}

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
