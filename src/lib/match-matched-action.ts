import type { MatchMovementStatus } from '@/lib/match-movement'
import type { MatchFlowStep } from '@/lib/match-flow-steps'
import { isHandoffMoveDue } from '@/lib/match-handoff-remaining'

export type MatchedUserActionKind =
  | 'wait'
  | 'move_start'
  | 'move_arrive'
  | 'seat_confirm'
  | 'yield_confirm'
  | 'go_home'

export interface MatchedUserAction {
  kind: MatchedUserActionKind
  stepLabel: string
  headline: string
  detail: string
  instruction: string
  buttonLabel: string | null
  blink: boolean
  afterClickMessage: string | null
  locationHint: string | null
}

function formatHandoffRemaining(count: number | null | undefined): string {
  if (count == null || count < 0) return ''
  if (count === 0) return '이번 역'
  return `${count}역 후`
}

/** 매칭 후 화면 — 지금 할 일 하나만 (버튼 없으면 대기 안내) */
export function resolveMatchedUserAction(input: {
  viewerRole: 'seeker' | 'provider'
  step: MatchFlowStep
  handoffStationName?: string
  handoffRemainingStations?: number | null
  selfMovementStatus?: MatchMovementStatus
  locationLine?: string | null
}): MatchedUserAction {
  const handoffStation = input.handoffStationName?.trim() || '양보 역'
  const remainingText = formatHandoffRemaining(input.handoffRemainingStations)
  const selfStatus = input.selfMovementStatus ?? 'idle'
  const moveDue = isHandoffMoveDue(input.handoffRemainingStations)
  const locationHint = input.locationLine?.trim() || null

  if (input.step === 'done') {
    const isSeeker = input.viewerRole === 'seeker'
    return {
      kind: 'go_home',
      stepLabel: '5단계 · 완료',
      headline: isSeeker ? '착석 완료' : '양보 완료',
      detail: '이용이 끝났어요',
      instruction: '잠시 후 홈으로 이동합니다',
      buttonLabel: '홈으로',
      blink: false,
      afterClickMessage: null,
      locationHint: null,
    }
  }

  if (input.step === 'seat') {
    if (input.viewerRole === 'seeker') {
      return {
        kind: 'seat_confirm',
        stepLabel: '4단계 · 착석',
        headline: '지금 앉아 주세요',
        detail: `${handoffStation} · 양보자가 비워 주는 자리예요`,
        instruction: '앉은 뒤 아래 버튼을 눌러 주세요',
        buttonLabel: '착석 완료',
        blink: true,
        afterClickMessage: '착석 완료! 홈으로 이동합니다',
        locationHint,
      }
    }

    return {
      kind: 'yield_confirm',
      stepLabel: '4단계 · 착석',
      headline: '지금 양보해 주세요',
      detail: '착석 희망자가 문 옆에서 기다리고 있어요',
      instruction: '일어서서 자리를 비운 뒤 버튼을 눌러 주세요',
      buttonLabel: '양보 완료',
      blink: true,
      afterClickMessage: '양보 완료! 홈으로 이동합니다',
      locationHint,
    }
  }

  if (input.step === 'wait') {
    if (input.viewerRole === 'seeker') {
      return {
        kind: 'wait',
        stepLabel: '3단계 · 대기',
        headline: '문 옆에서 서서 기다리세요',
        detail: `${handoffStation} · ${remainingText || '곧'} 양보자가 내려요`,
        instruction: '아직 앉지 마세요 · 양보자가 내리면 착석 안내가 옵니다',
        buttonLabel: null,
        blink: false,
        afterClickMessage: null,
        locationHint,
      }
    }

    return {
      kind: 'wait',
      stepLabel: '3단계 · 대기',
      headline: '착석 희망자가 문 옆에 있어요',
      detail: `${remainingText || '곧'} ${handoffStation}에서 내리면 돼요`,
      instruction: '지금은 편히 앉아 주세요 · 하차 직전에 양보 안내가 옵니다',
      buttonLabel: null,
      blink: false,
      afterClickMessage: null,
      locationHint,
    }
  }

  if (input.viewerRole === 'seeker') {
    if (!moveDue) {
      return {
        kind: 'wait',
        stepLabel: '2단계 · 이동 대기',
        headline: '아직 이동하지 마세요',
        detail: `${handoffStation} · ${remainingText || '조금 후'} 이동 안내가 옵니다`,
        instruction: '3역 전에 「이동 시작」 버튼이 나타나요',
        buttonLabel: null,
        blink: false,
        afterClickMessage: null,
        locationHint,
      }
    }

    if (selfStatus === 'moving') {
      return {
        kind: 'move_arrive',
        stepLabel: '2단계 · 이동 중',
        headline: '호차로 가고 있나요?',
        detail: locationHint ? `${locationHint} 문 옆으로 이동해 주세요` : '표시된 출입문으로 이동해 주세요',
        instruction: '도착했으면 아래 버튼을 눌러 주세요',
        buttonLabel: '도착했어요',
        blink: true,
        afterClickMessage: '다음 단계 · 양보자가 내릴 때까지 문 옆에서 서서 기다려 주세요',
        locationHint,
      }
    }

    return {
      kind: 'move_start',
      stepLabel: '2단계 · 지금 이동',
      headline: '지금 이동하세요',
      detail: locationHint
        ? `${locationHint} · ${remainingText || ''}`.trim()
        : `${handoffStation} · ${remainingText || '지금'} 출발해 주세요`,
      instruction: '이동을 시작하면 상대방에게도 알려드려요',
      buttonLabel: '이동 시작',
      blink: true,
      afterClickMessage: '다음 · 도착하면 「도착했어요」를 눌러 주세요',
      locationHint,
    }
  }

  if (!moveDue) {
    return {
      kind: 'wait',
      stepLabel: '2단계 · 이동 대기',
      headline: '편히 앉아 주세요',
      detail: `${remainingText || '조금 후'} 착석 희망자에게 이동 안내가 갑니다`,
      instruction: '목적지 전까지 자리를 지켜 주세요',
      buttonLabel: null,
      blink: false,
      afterClickMessage: null,
      locationHint,
    }
  }

  return {
    kind: 'wait',
    stepLabel: '2단계 · 이동 중',
    headline: '착석 희망자가 오고 있어요',
    detail: `${handoffStation} · ${remainingText || '곧'} 전에 문 옆으로 옵니다`,
    instruction: '자리를 지켜 주세요 · 도착하면 알려드려요',
    buttonLabel: null,
    blink: false,
    afterClickMessage: null,
    locationHint,
  }
}
