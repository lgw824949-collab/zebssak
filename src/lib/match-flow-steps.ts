import type { MatchMovementStatus } from '@/lib/match-movement'
import { isHandoffMoveDue, isHandoffReady } from '@/lib/match-handoff-remaining'

export type MatchFlowStep = 'accept' | 'move' | 'wait' | 'seat' | 'done'

export const MATCH_FLOW_STEP_LABELS = ['수락', '이동', '대기', '착석', '완료'] as const

export { HANDOFF_READY_STATION_THRESHOLD } from '@/lib/match-handoff-remaining'
export { isHandoffMoveDue, isHandoffReady } from '@/lib/match-handoff-remaining'

export function resolveMatchFlowStepIndex(step: MatchFlowStep): number {
  if (step === 'accept') return 0
  if (step === 'move') return 1
  if (step === 'wait') return 2
  if (step === 'seat') return 3
  return 4
}

/** 상세 화면 — 현재 단계 한 줄 안내 (나열 대신 이것만 강조) */
export function resolveMatchStepFocusInstruction(input: {
  viewerRole: 'seeker' | 'provider'
  step: MatchFlowStep
  handoffRemainingStations?: number | null
}): { text: string; blink: boolean } {
  if (input.step === 'move') {
    if (input.viewerRole === 'seeker') {
      return { text: '지금 이동하세요', blink: true }
    }
    return { text: '착석 희망자 이동 중', blink: false }
  }

  if (input.step === 'wait') {
    if (input.viewerRole === 'seeker') {
      return { text: '문 옆에서 대기', blink: false }
    }
    return { text: '문 옆 대기 중', blink: false }
  }

  if (input.step === 'seat') {
    if (input.viewerRole === 'seeker') {
      return { text: '지금 앉아 주세요', blink: true }
    }
    return { text: '지금 양보해 주세요', blink: true }
  }

  if (input.step === 'done') {
    return {
      text: input.viewerRole === 'seeker' ? '착석 완료' : '양보 완료',
      blink: false,
    }
  }

  return { text: '연결되었어요', blink: false }
}

/** 매칭·이동·대기·착석 상태로 현재 단계를 판별합니다. */
export function resolveMatchFlowStep(input: {
  matchStatus: string
  viewerRole: 'seeker' | 'provider'
  selfMovementStatus?: MatchMovementStatus
  partnerMovementStatus?: MatchMovementStatus
  handoffRemainingStations?: number | null
  seatConfirmed?: boolean
  /** 실시간 위치 미연결 시 등록 기준 역 수로 대기 단계가 멈추지 않게 합니다 */
  positionIsLive?: boolean
}): MatchFlowStep {
  if (input.matchStatus === 'completed' || input.seatConfirmed) {
    return 'done'
  }

  if (input.matchStatus === 'pending') {
    return 'accept'
  }

  const selfStatus = input.selfMovementStatus ?? 'idle'
  const partnerStatus = input.partnerMovementStatus ?? 'idle'
  const handoffReady = isHandoffReady(input.handoffRemainingStations)
  const moveDue = isHandoffMoveDue(input.handoffRemainingStations)

  const seekerAtDoor =
    input.viewerRole === 'seeker'
      ? selfStatus === 'arrived'
      : partnerStatus === 'arrived'

  if (seekerAtDoor) {
    // 실시간 위치 없을 때: 문 옆 도착 후 착석/양보 단계로 진행
    if (!input.positionIsLive && moveDue) {
      return 'seat'
    }

    return handoffReady ? 'seat' : 'wait'
  }

  return 'move'
}

/** 수락 대기 화면 — 역할별 안내 문구 */
export function resolveAcceptPhaseCopy(viewerRole: 'seeker' | 'provider'): {
  title: string
  guide: string
  action: string
  footnote: string | null
} {
  if (viewerRole === 'provider') {
    return {
      title: '매칭됨',
      guide: '착석 희망자와 연결',
      action: '수락해 주세요',
      footnote: null,
    }
  }

  return {
    title: '연결됨',
    guide: '하차 예정자와 연결',
    action: '수락 후 바로 이동',
    footnote: null,
  }
}

function formatHandoffWaitText(handoffRemainingStations: number | null | undefined): string {
  if (handoffRemainingStations == null || handoffRemainingStations < 0) {
    return '양보자가 내릴 때까지'
  }

  if (handoffRemainingStations === 0) {
    return '이번 역에서'
  }

  return `${handoffRemainingStations}역 후`
}

/** 수락 후 화면 — 역할·단계별 안내 문구 */
export function resolveMatchedPhaseCopy(input: {
  viewerRole: 'seeker' | 'provider'
  step: MatchFlowStep
  handoffStationName?: string
  handoffRemainingStations?: number | null
  selfMovementStatus?: MatchMovementStatus
  partnerMovementStatus?: MatchMovementStatus
}): {
  banner: string
  headline: string
  subline: string
  ctaLabel: string
  timerHint: string
  ctaEnabled: boolean
} {
  const selfStatus = input.selfMovementStatus ?? 'idle'
  const partnerStatus = input.partnerMovementStatus ?? 'idle'
  const handoffStation = input.handoffStationName?.trim() || '양보 역'
  const waitText = formatHandoffWaitText(input.handoffRemainingStations)

  if (input.step === 'done') {
    return {
      banner: '완료',
      headline: '이용 완료',
      subline: '',
      ctaLabel: '홈으로',
      timerHint: '',
      ctaEnabled: true,
    }
  }

  if (input.step === 'wait') {
    if (input.viewerRole === 'seeker') {
      return {
        banner: '대기',
        headline: '문 옆 대기',
        subline: `${handoffStation} · ${waitText}`,
        ctaLabel: '착석 완료',
        timerHint: '아직 앉지 마세요',
        ctaEnabled: false,
      }
    }

    return {
      banner: '대기',
      headline: '문 옆 대기 중',
      subline: `${waitText} ${handoffStation}`,
      ctaLabel: '양보 완료',
      timerHint: '',
      ctaEnabled: false,
    }
  }

  if (input.step === 'seat') {
    if (input.viewerRole === 'seeker') {
      return {
        banner: '착석',
        headline: '지금 앉기',
        subline: handoffStation,
        ctaLabel: '착석 완료',
        timerHint: '',
        ctaEnabled: true,
      }
    }

    return {
      banner: '착석',
      headline: '지금 양보',
      subline: '문 옆 대기 중',
      ctaLabel: '양보 완료',
      timerHint: '',
      ctaEnabled: true,
    }
  }

  if (input.viewerRole === 'seeker') {
    if (selfStatus === 'moving') {
      return {
        banner: '이동',
        headline: '이동 중',
        subline: handoffStation,
        ctaLabel: '착석 완료',
        timerHint: '도착했어요를 눌러 주세요',
        ctaEnabled: false,
      }
    }

    return {
      banner: '이동',
      headline: '지금 이동',
      subline: handoffStation,
      ctaLabel: '착석 완료',
      timerHint: '이동 시작 → 도착했어요',
      ctaEnabled: false,
    }
  }

  if (partnerStatus === 'moving') {
    return {
      banner: '이동',
      headline: '이동 중',
      subline: '자리를 지켜 주세요',
      ctaLabel: '양보 완료',
      timerHint: '',
      ctaEnabled: false,
    }
  }

  return {
    banner: '이동',
    headline: '착석 희망자 대기',
    subline: `${waitText} ${handoffStation}`,
    ctaLabel: '양보 완료',
    timerHint: '편히 앉아 주세요',
    ctaEnabled: false,
  }
}
