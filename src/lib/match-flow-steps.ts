import type { MatchMovementStatus } from '@/lib/match-movement'
import { MATCH_STATION_GUIDE } from '@/lib/match-user-guide'
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
    return { text: '착석 희망자가 문 옆으로 옵니다', blink: false }
  }

  if (input.step === 'wait') {
    if (input.viewerRole === 'seeker') {
      return { text: '양보자가 내릴 때까지 문 옆에서 서서 기다려 주세요', blink: false }
    }
    return { text: '착석 희망자가 문 옆에서 기다리고 있어요', blink: false }
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
      title: '빈자리 매칭됨',
      guide: '착석 희망자와 연결되었어요',
      action: '수락 버튼을 눌러 주세요',
      footnote: MATCH_STATION_GUIDE.providerNote,
    }
  }

  return {
    title: '빈자리 연결됨',
    guide: '하차 예정자와 연결되었어요',
    action: '수락 후 바로 이동 안내가 옵니다',
    footnote: MATCH_STATION_GUIDE.seekerNote,
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
      banner: '5단계 · 완료',
      headline: '이용 완료',
      subline: '잠시 후 홈으로 이동합니다',
      ctaLabel: '홈으로',
      timerHint: '',
      ctaEnabled: true,
    }
  }

  if (input.step === 'wait') {
    if (input.viewerRole === 'seeker') {
      return {
        banner: '3단계 · 대기',
        headline: '문 옆에서 서서 대기',
        subline: `${handoffStation} · ${waitText} 양보자가 내리면 앉아 주세요`,
        ctaLabel: '착석 완료',
        timerHint: '아직 앉지 마세요 · 양보자 하차를 기다려 주세요',
        ctaEnabled: false,
      }
    }

    return {
      banner: '3단계 · 대기',
      headline: '착석 희망자 대기 중',
      subline: `${waitText} ${handoffStation}에서 양보 예정`,
      ctaLabel: '양보 완료',
      timerHint: '목적지 전까지 자리를 지켜 주세요',
      ctaEnabled: false,
    }
  }

  if (input.step === 'seat') {
    if (input.viewerRole === 'seeker') {
      return {
        banner: '4단계 · 착석',
        headline: '지금 앉아 주세요',
        subline: `${handoffStation} · 양보자가 곧 비워 주는 자리예요`,
        ctaLabel: '착석 완료',
        timerHint: '앉은 뒤 아래 버튼을 눌러 주세요',
        ctaEnabled: true,
      }
    }

    return {
      banner: '4단계 · 착석',
      headline: '지금 양보해 주세요',
      subline: '착석 희망자가 문 옆에서 기다리고 있어요',
      ctaLabel: '양보 완료',
      timerHint: '일어서서 자리를 비워 주세요',
      ctaEnabled: true,
    }
  }

  if (input.viewerRole === 'seeker') {
    if (selfStatus === 'moving') {
      return {
        banner: '2단계 · 지금 이동',
        headline: '지금 이동 중이에요',
        subline: '표시된 호차·출입문으로 가 주세요',
        ctaLabel: '착석 완료',
        timerHint: '도착하면 도착했어요를 눌러 주세요',
        ctaEnabled: false,
      }
    }

    return {
      banner: '2단계 · 지금 이동',
      headline: '지금 이동하세요',
      subline: `${handoffStation} · 표시된 호차·출입문으로 이동해 주세요`,
      ctaLabel: '착석 완료',
      timerHint: '이동 시작 → 도착했어요 순서로 눌러 주세요',
      ctaEnabled: false,
    }
  }

  if (partnerStatus === 'moving') {
    return {
      banner: '2단계 · 이동 중',
      headline: '착석 희망자가 오고 있어요',
      subline: '자리를 지켜 주세요',
      ctaLabel: '양보 완료',
      timerHint: '착석 희망자가 도착할 때까지 기다려 주세요',
      ctaEnabled: false,
    }
  }

  return {
    banner: '2단계 · 이동 안내',
    headline: '착석 희망자가 곧 옵니다',
    subline: `${waitText} ${handoffStation}에서 양보 예정 · 지금은 편히 앉아 주세요`,
    ctaLabel: '양보 완료',
    timerHint: '착석 희망자가 문 옆으로 옵니다',
    ctaEnabled: false,
  }
}
