'use client'

import {
  resolveHomeProgressBlinkHint,
  resolveHomeProgressStepIndex,
  resolveHomeProgressStepLabels,
  type HomeMatchProgress,
} from '@/lib/match-home-progress'

interface HomeMatchProgressBarProps {
  registrationKind: 'seek' | 'leave'
  progress: HomeMatchProgress
}

export default function HomeMatchProgressBar({
  registrationKind,
  progress,
}: HomeMatchProgressBarProps) {
  const labels = resolveHomeProgressStepLabels(registrationKind)
  const activeIndex = resolveHomeProgressStepIndex(progress.step)
  const blinkHint = resolveHomeProgressBlinkHint({
    registrationKind,
    step: progress.step,
    flowStep: progress.flowStep,
    handoffRemaining: progress.handoffRemaining,
    matchCompleted: progress.matchCompleted,
  })
  const shouldBlink = !progress.matchCompleted

  return (
    <div className="mt-3" role="group" aria-label="진행 단계">
      <div className="grid grid-cols-3 gap-1">
        {labels.map((label, index) => {
          const isDone = index < activeIndex || progress.matchCompleted
          const isActive = !progress.matchCompleted && index === activeIndex

          return (
            <div key={label} className="flex flex-col items-center gap-1.5">
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-full text-[12px] font-extrabold ${
                  isActive && shouldBlink ? 'home-progress-blink' : ''
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
                className={`text-center text-[11px] font-bold leading-tight ${
                  isActive && shouldBlink ? 'home-progress-blink' : ''
                }`}
                style={{ color: isActive ? '#747F00' : isDone ? '#5F6B2E' : '#9CA3AF' }}
              >
                {label}
              </span>
            </div>
          )
        })}
      </div>

      <p
        className={`mt-3 rounded-xl px-3 py-2.5 text-center text-[14px] font-bold leading-snug text-[#5F6B2E] ${
          shouldBlink ? 'home-progress-blink bg-[#FFF8F0]' : 'bg-[#F0F5E8]'
        }`}
        role="status"
      >
        {blinkHint}
      </p>

      <style jsx>{`
        @keyframes home-progress-blink {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.45;
          }
        }
        :global(.home-progress-blink) {
          animation: home-progress-blink 1s ease-in-out infinite;
        }
      `}</style>
    </div>
  )
}
