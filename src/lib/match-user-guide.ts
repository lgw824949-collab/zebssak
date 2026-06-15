import {
  HANDOFF_MOVE_START_THRESHOLD,
  HANDOFF_READY_STATION_THRESHOLD,
} from '@/lib/match-handoff-remaining'

/** 서비스 참여 최소 남은 역 수 (API와 동일) */
export const MIN_PARTICIPATION_STATIONS = 3

/** 여유 있는 이용을 권장하는 남은 역 수 */
export const RECOMMENDED_PARTICIPATION_STATIONS = 5

export const MATCH_STATION_GUIDE = {
  participationTitle: '왜 역 수가 중요한가요?',
  participationSummary:
    '잽싸게는 「지금 앉는 자리」가 아니라 「곧 비워질 자리」를 연결합니다. 남은 역이 충분해야 이동·대기·착석 안내가 자연스럽게 이어집니다.',
  participationRules: [
    {
      label: '참여 기준',
      text: `목적지까지 최소 ${MIN_PARTICIPATION_STATIONS}역 이상 남아야 등록할 수 있어요`,
    },
    {
      label: '권장',
      text: `${RECOMMENDED_PARTICIPATION_STATIONS}역 이상이면 매칭 후 대기·이동 안내가 더 여유 있어요`,
    },
    {
      label: '매칭 조건',
      text: '같은 열차 · 같은 호차 · 같은 방향에서 상대를 찾아요',
    },
  ],
  afterMatchTitle: '매칭 후 이렇게 진행돼요',
  afterMatchSteps: [
    '수락 — 연결되면 30초 안에 수락해 주세요',
    `이동 대기 — 양보자 하차 ${HANDOFF_MOVE_START_THRESHOLD}역 전까지는 아직 이동하지 않아요`,
    `지금 이동 — ${HANDOFF_MOVE_START_THRESHOLD}역 전에 「지금 이동하세요」 안내가 와요`,
    '서서 대기 — 문 옆에서 양보자가 내릴 때까지 기다려요 (아직 앉지 않아요)',
    `착석 — 양보자 하차 ${HANDOFF_READY_STATION_THRESHOLD}역 전부터 앉을 수 있어요`,
    '완료 — 착석·양보 확인 후 이용이 끝나요',
  ],
  seekerNote:
    '같은 칸에 있어도 양보자가 아직 목적지에 도달하지 않았다면, 서서 기다리는 것이 정상이에요.',
  providerNote:
    '착석 희망자는 양보 역 3역 전에만 이동합니다. 목적지 전까지는 편히 앉아 주세요.',
} as const

export type ParticipationStationHintTone = 'caution' | 'positive'

/** 목적지 선택 직후 — 남은 역 수에 따른 등록 안내 */
export function resolveParticipationStationHint(
  remainingStations: number
): { tone: ParticipationStationHintTone; text: string } | null {
  if (!Number.isFinite(remainingStations) || remainingStations < MIN_PARTICIPATION_STATIONS) {
    return null
  }

  if (remainingStations < RECOMMENDED_PARTICIPATION_STATIONS) {
    return {
      tone: 'caution',
      text: `목적지까지 ${remainingStations}역 남았어요. 등록은 가능하지만, ${RECOMMENDED_PARTICIPATION_STATIONS}역 이상이면 매칭 후 이동·대기가 더 자연스러워요.`,
    }
  }

  return {
    tone: 'positive',
    text: `목적지까지 ${remainingStations}역 — 좋아요. 양보자 하차 ${HANDOFF_MOVE_START_THRESHOLD}역 전에 이동 안내가 올 거예요.`,
  }
}
