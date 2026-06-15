import type { MatchFlowStep } from '@/lib/match-flow-steps'

/** 홈 화면 단순 진행 — 매칭완료 → 이동중 → 착석완료 */
export type HomeProgressStep = 'matched' | 'moving' | 'seated'

export interface HomeMatchProgress {
  step: HomeProgressStep
  flowStep: MatchFlowStep
  handoffRemaining: number | null
  seatConfirmed: boolean
  matchCompleted: boolean
  trainCurrentStationName: string | null
  providerDirectionLabel: string | null
  positionIsLive: boolean
}

export function resolveHomeProgressStepIndex(step: HomeProgressStep): number {
  if (step === 'matched') return 0
  if (step === 'moving') return 1
  return 2
}

/** 매칭 상세 흐름 → 홈 3단계 */
export function resolveHomeProgressStep(input: {
  flowStep: MatchFlowStep
  handoffRemaining: number | null
  seatConfirmed: boolean
  matchCompleted: boolean
}): HomeProgressStep {
  if (input.matchCompleted || input.seatConfirmed || input.flowStep === 'done') {
    return 'seated'
  }

  if (input.flowStep === 'seat') {
    return 'seated'
  }

  if (input.flowStep === 'wait' || input.flowStep === 'move') {
    return 'moving'
  }

  return 'matched'
}

/** 역할별 3단계 라벨 */
export function resolveHomeProgressStepLabels(
  registrationKind: 'seek' | 'leave'
): readonly [string, string, string] {
  if (registrationKind === 'leave') {
    return ['매칭', '대기', '완료']
  }

  return ['매칭', '이동', '완료']
}

/** 역할·단계별 깜빡 안내 문구 */
export function resolveHomeProgressBlinkHint(input: {
  registrationKind: 'seek' | 'leave'
  step: HomeProgressStep
  flowStep: MatchFlowStep
  handoffRemaining: number | null
  matchCompleted: boolean
  trainCurrentStationName?: string | null
}): string {
  const currentStation = input.trainCurrentStationName?.trim()

  if (input.matchCompleted) {
    return input.registrationKind === 'leave' ? '양보 완료' : '착석 완료'
  }

  if (input.registrationKind === 'leave') {
    if (input.step === 'matched') {
      return currentStation ? `${currentStation} · 편히 앉기` : '편히 앉아 주세요'
    }
    if (input.step === 'moving') {
      if (input.flowStep === 'wait') {
        return '문 옆 대기 중'
      }
      return '착석 희망자 이동 중'
    }
    return '지금 양보'
  }

  if (input.step === 'matched') {
    return '수락 후 바로 이동'
  }

  if (input.step === 'moving') {
    if (input.flowStep === 'wait') {
      return '문 옆 대기'
    }
    return '지금 이동'
  }

  return '지금 앉기'
}

/** 홈 상단 배너 문구 */
export function resolveHomeProgressBannerLabel(input: {
  registrationKind: 'seek' | 'leave'
  step: HomeProgressStep
  matchCompleted: boolean
}): string {
  if (input.matchCompleted) {
    return input.registrationKind === 'leave' ? '양보 완료' : '착석 완료'
  }

  const labels = resolveHomeProgressStepLabels(input.registrationKind)
  return labels[resolveHomeProgressStepIndex(input.step)]
}

/** 등록 목적 한 줄 */
export function resolveHomeRegistrationPurposeLine(
  registrationKind: 'seek' | 'leave',
  destinationName: string
): string {
  const destination = destinationName || '목적지 미확인'
  if (registrationKind === 'leave') {
    return `양보 · ${destination}`
  }
  return `착석 · ${destination}`
}
