import type { MatchMovementStatus } from '@/lib/match-movement'
import type { MatchFlowStep } from '@/lib/match-flow-steps'
import { resolveSeekerMovementLocationLine } from '@/lib/match-movement-guide'

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

/** 매칭 후 화면 — 지금 할 일 하나만 */
export function resolveMatchedUserAction(input: {
  viewerRole: 'seeker' | 'provider'
  step: MatchFlowStep
  handoffStationName?: string
  handoffRemainingStations?: number | null
  selfMovementStatus?: MatchMovementStatus
  partnerMovementStatus?: MatchMovementStatus
  selfCarNumber?: number | null
  targetCarNumber?: number | null
  targetDoorLabel?: string | null
  locationLine?: string | null
}): MatchedUserAction {
  const handoffStation = input.handoffStationName?.trim() || '양보 역'
  const remainingText = formatHandoffRemaining(input.handoffRemainingStations)
  const selfStatus = input.selfMovementStatus ?? 'idle'
  const partnerStatus = input.partnerMovementStatus ?? 'idle'
  const locationHint =
    resolveSeekerMovementLocationLine({
      selfCarNumber: input.selfCarNumber,
      targetCarNumber: input.targetCarNumber,
      targetDoorLabel: input.targetDoorLabel,
    }) ??
    input.locationLine?.trim() ??
    null

  const routeDetail = (station: string) =>
    locationHint ? `${locationHint} · ${station}` : station

  if (input.step === 'done') {
    const isSeeker = input.viewerRole === 'seeker'
    return {
      kind: 'go_home',
      stepLabel: '완료',
      headline: isSeeker ? '착석 완료' : '양보 완료',
      detail: '',
      instruction: '',
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
        stepLabel: '착석',
        headline: '지금 앉기',
        detail: routeDetail(handoffStation),
        instruction: '',
        buttonLabel: '착석 완료',
        blink: true,
        afterClickMessage: null,
        locationHint,
      }
    }

    return {
      kind: 'yield_confirm',
      stepLabel: '착석',
      headline: '지금 양보',
      detail: locationHint ? `${locationHint} 문 옆` : handoffStation,
      instruction: '',
      buttonLabel: '양보 완료',
      blink: true,
      afterClickMessage: null,
      locationHint,
    }
  }

  if (input.step === 'wait') {
    if (input.viewerRole === 'seeker') {
      return {
        kind: 'wait',
        stepLabel: '대기',
        headline: '문 옆 대기',
        detail: routeDetail(
          remainingText ? `${handoffStation} · ${remainingText}` : handoffStation
        ),
        instruction: '아직 앉지 마세요',
        buttonLabel: null,
        blink: false,
        afterClickMessage: null,
        locationHint,
      }
    }

    return {
      kind: 'wait',
      stepLabel: '대기',
      headline: '문 옆 대기 중',
      detail: locationHint ?? (remainingText ? `${handoffStation} · ${remainingText}` : handoffStation),
      instruction: '',
      buttonLabel: null,
      blink: false,
      afterClickMessage: null,
      locationHint,
    }
  }

  if (input.viewerRole === 'seeker') {
    if (selfStatus === 'moving') {
      return {
        kind: 'move_arrive',
        stepLabel: '이동',
        headline: '이동 중',
        detail: routeDetail(handoffStation),
        instruction: '',
        buttonLabel: '도착했어요',
        blink: true,
        afterClickMessage: null,
        locationHint,
      }
    }

    return {
      kind: 'move_start',
      stepLabel: '이동',
      headline: '지금 이동',
      detail: routeDetail(handoffStation),
      instruction: '',
      buttonLabel: '이동 시작',
      blink: true,
      afterClickMessage: null,
      locationHint,
    }
  }

  return {
    kind: 'wait',
    stepLabel: '이동',
    headline: partnerStatus === 'moving' ? '이동 중' : '착석 희망자 대기',
    detail: routeDetail(
      remainingText ? `${handoffStation} · ${remainingText}` : handoffStation
    ),
    instruction: '',
    buttonLabel: null,
    blink: false,
    afterClickMessage: null,
    locationHint,
  }
}
