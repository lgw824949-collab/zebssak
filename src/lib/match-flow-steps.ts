import type { MatchMovementStatus } from '@/lib/match-movement'

export type MatchFlowStep = 'accept' | 'move' | 'seat' | 'done'

export const MATCH_FLOW_STEP_LABELS = ['수락', '이동', '착석', '완료'] as const

export function resolveMatchFlowStepIndex(step: MatchFlowStep): number {
  if (step === 'accept') return 0
  if (step === 'move') return 1
  if (step === 'seat') return 2
  return 3
}

/** 매칭·이동·착석 상태로 현재 단계를 판별합니다. */
export function resolveMatchFlowStep(input: {
  matchStatus: string
  viewerRole: 'seeker' | 'provider'
  selfMovementStatus?: MatchMovementStatus
  partnerMovementStatus?: MatchMovementStatus
  seatConfirmed?: boolean
}): MatchFlowStep {
  if (input.matchStatus === 'completed' || input.seatConfirmed) {
    return 'done'
  }

  if (input.matchStatus === 'pending') {
    return 'accept'
  }

  const selfStatus = input.selfMovementStatus ?? 'idle'
  const partnerStatus = input.partnerMovementStatus ?? 'idle'

  if (input.viewerRole === 'seeker') {
    if (selfStatus === 'arrived') {
      return 'seat'
    }
    return 'move'
  }

  if (partnerStatus === 'arrived') {
    return 'seat'
  }

  return 'move'
}

/** 수락 대기 화면 — 역할별 안내 문구 */
export function resolveAcceptPhaseCopy(viewerRole: 'seeker' | 'provider'): {
  title: string
  guide: string
  action: string
} {
  if (viewerRole === 'provider') {
    return {
      title: '빈자리 매칭됨',
      guide: '착석 희망자와 연결되었어요',
      action: '수락 버튼을 눌러 주세요',
    }
  }

  return {
    title: '빈자리 연결됨',
    guide: '하차 예정자와 연결되었어요',
    action: '이동 후 수락 버튼을 눌러 주세요',
  }
}

/** 수락 후 화면 — 역할·단계별 안내 문구 */
export function resolveMatchedPhaseCopy(input: {
  viewerRole: 'seeker' | 'provider'
  step: MatchFlowStep
  selfMovementStatus?: MatchMovementStatus
  partnerMovementStatus?: MatchMovementStatus
}): {
  banner: string
  headline: string
  subline: string
  ctaLabel: string
  timerHint: string
} {
  const selfStatus = input.selfMovementStatus ?? 'idle'
  const partnerStatus = input.partnerMovementStatus ?? 'idle'

  if (input.step === 'done') {
    return {
      banner: '이용이 완료되었어요',
      headline: '착석 완료',
      subline: '잠시 후 홈으로 이동합니다',
      ctaLabel: '홈으로',
      timerHint: '',
    }
  }

  if (input.step === 'seat') {
    if (input.viewerRole === 'seeker') {
      return {
        banner: '3단계 · 착석',
        headline: '자리에 앉아 주세요',
        subline: '착석 후 아래 버튼을 눌러 주세요',
        ctaLabel: '착석 완료',
        timerHint: '서둘러 착석해 주세요',
      }
    }

    return {
      banner: '3단계 · 착석',
      headline: '착석 희망자 도착',
      subline: '자리를 양보해 주세요',
      ctaLabel: '양보 완료',
      timerHint: '착석 희망자가 확인 중이에요',
    }
  }

  if (input.viewerRole === 'seeker') {
    if (selfStatus === 'moving') {
      return {
        banner: '2단계 · 이동 중',
        headline: '지금 이동 중이에요',
        subline: '표시된 호차·출입문으로 가 주세요',
        ctaLabel: '착석 완료',
        timerHint: '도착하면 착석 완료를 눌러 주세요',
      }
    }

    return {
      banner: '2단계 · 이동',
      headline: '이동을 시작해 주세요',
      subline: '이동 시작 → 도착했어요 순서로 눌러 주세요',
      ctaLabel: '착석 완료',
      timerHint: '이동 후 착석 완료를 눌러 주세요',
    }
  }

  if (partnerStatus === 'moving') {
    return {
      banner: '2단계 · 이동 중',
      headline: '착석 희망자가 오고 있어요',
      subline: '자리를 지켜 주세요',
      ctaLabel: '양보 완료',
      timerHint: '착석 희망자가 도착할 때까지 기다려 주세요',
    }
  }

  return {
    banner: '2단계 · 이동',
    headline: '착석 희망자 출발 대기',
    subline: '착석 희망자가 이동을 시작하면 알려드려요',
    ctaLabel: '양보 완료',
    timerHint: '착석 희망자 이동을 기다려 주세요',
  }
}
