'use client'

import {
  MATCH_FLOW_STEP_LABELS,
  resolveMatchFlowStepIndex,
  type MatchFlowStep,
} from '@/lib/match-flow-steps'

interface MatchFlowStepBarProps {
  currentStep: MatchFlowStep
}

export default function MatchFlowStepBar({ currentStep }: MatchFlowStepBarProps) {
  const activeIndex = resolveMatchFlowStepIndex(currentStep)

  return (
    <div
      className="rounded-2xl border border-[#D5DDB8] bg-white px-3 py-3"
      role="list"
      aria-label="진행 단계"
    >
      <div className="grid grid-cols-5 gap-0.5">
        {MATCH_FLOW_STEP_LABELS.map((label, index) => {
          const isDone = index < activeIndex
          const isActive = index === activeIndex

          return (
            <div key={label} className="flex flex-col items-center gap-1" role="listitem">
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-extrabold ${
                  isActive ? 'match-step-active' : ''
                }`}
                style={{
                  backgroundColor: isDone || isActive ? '#747F00' : '#ECEEE4',
                  color: isDone || isActive ? '#FFFFFF' : '#9CA3AF',
                }}
                aria-current={isActive ? 'step' : undefined}
              >
                {isDone ? '✓' : index + 1}
              </span>
              <span
                className={`text-center text-[10px] font-bold leading-tight ${
                  isActive ? 'match-step-active text-[#747F00]' : isDone ? 'text-[#5F6B2E]' : 'text-[#9CA3AF]'
                }`}
              >
                {label}
              </span>
            </div>
          )
        })}
      </div>
      <style jsx>{`
        @keyframes match-step-active-pulse {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.55;
          }
        }
        :global(.match-step-active) {
          animation: match-step-active-pulse 1.2s ease-in-out infinite;
        }
      `}</style>
    </div>
  )
}
