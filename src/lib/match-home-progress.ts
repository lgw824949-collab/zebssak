import type { MatchFlowStep } from '@/lib/match-flow-steps'
import { isHandoffMoveDue } from '@/lib/match-handoff-remaining'

/** 홈 화면 단순 진행 — 매칭완료 → 이동중 → 착석완료 */
export type HomeProgressStep = 'matched' | 'moving' | 'seated'

export interface HomeMatchProgress {
  step: HomeProgressStep
  flowStep: MatchFlowStep
  handoffRemaining: number | null
  seatConfirmed: boolean
  matchCompleted: boolean
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

  if (input.flowStep === 'wait') {
    return 'moving'
  }

  if (input.flowStep === 'move') {
    return isHandoffMoveDue(input.handoffRemaining) ? 'moving' : 'matched'
  }

  return 'matched'
}

/** 역할별 3단계 라벨 */
export function resolveHomeProgressStepLabels(
  registrationKind: 'seek' | 'leave'
): readonly [string, string, string] {
  if (registrationKind === 'leave') {
    return ['매칭 완료', '양보 대기', '양보 완료']
  }

  return ['매칭 완료', '이동 중', '착석 완료']
}

/** 역할·단계별 깜빡 안내 문구 */
export function resolveHomeProgressBlinkHint(input: {
  registrationKind: 'seek' | 'leave'
  step: HomeProgressStep
  flowStep: MatchFlowStep
  handoffRemaining: number | null
  matchCompleted: boolean
}): string {
  if (input.matchCompleted) {
    return input.registrationKind === 'leave'
      ? '양보가 완료되었어요'
      : '착석이 완료되었어요'
  }

  if (input.registrationKind === 'leave') {
    if (input.step === 'matched') {
      return '목적지 전까지 편히 앉아 주세요'
    }
    if (input.step === 'moving') {
      if (input.flowStep === 'wait') {
        return '착석 희망자가 문 옆에서 기다리고 있어요'
      }
      return '착석 희망자가 이동 중이에요'
    }
    return '지금 양보해 주세요'
  }

  if (input.step === 'matched') {
    return '곧 이동 안내가 올 거예요 · 아직 이동하지 마세요'
  }

  if (input.step === 'moving') {
    if (input.flowStep === 'wait') {
      return '양보자가 내릴 때까지 문 옆에서 서서 기다려 주세요'
    }
    if (isHandoffMoveDue(input.handoffRemaining)) {
      return '지금 이동하세요'
    }
    return '표시된 호차·출입문으로 이동해 주세요'
  }

  return '지금 앉아 주세요'
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
    return `자리 넘기기 · ${destination}까지`
  }
  return `빈자리 찾기 · ${destination}까지`
}
