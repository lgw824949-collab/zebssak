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
      <div className="grid grid-cols-4 gap-1">
        {MATCH_FLOW_STEP_LABELS.map((label, index) => {
          const isDone = index < activeIndex
          const isActive = index === activeIndex

          return (
            <div key={label} className="flex flex-col items-center gap-1.5" role="listitem">
              <span
                className="flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-extrabold"
                style={{
                  backgroundColor: isDone || isActive ? '#747F00' : '#ECEEE4',
                  color: isDone || isActive ? '#FFFFFF' : '#9CA3AF',
                }}
                aria-current={isActive ? 'step' : undefined}
              >
                {isDone ? '✓' : index + 1}
              </span>
              <span
                className="text-[11px] font-bold"
                style={{ color: isActive ? '#747F00' : isDone ? '#5F6B2E' : '#9CA3AF' }}
              >
                {label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
