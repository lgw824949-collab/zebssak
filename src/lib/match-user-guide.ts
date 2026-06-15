import {
  HANDOFF_READY_STATION_THRESHOLD,
} from '@/lib/match-handoff-remaining'

/** 서비스 참여 최소 남은 역 수 (API와 동일) */
export const MIN_PARTICIPATION_STATIONS = 3

/** 여유 있는 이용을 권장하는 남은 역 수 */
export const RECOMMENDED_PARTICIPATION_STATIONS = 5

export const MATCH_STATION_GUIDE = {
  participationTitle: '왜 역 수가 중요한가요?',
  participationSummary:
    '잽싸게는 「지금 앉는 자리」가 아니라 「곧 비워질 자리」를 연결합니다. 양보자가 목적지까지 탈 시간이 있어야 매칭이 자연스럽게 이어집니다.',
  participationRules: [
    {
      label: '참여 기준',
      text: `목적지까지 최소 ${MIN_PARTICIPATION_STATIONS}역 이상 남아야 등록할 수 있어요`,
    },
    {
      label: '권장',
      text: `${RECOMMENDED_PARTICIPATION_STATIONS}역 이상이면 양보·착석 타이밍이 더 여유 있어요`,
    },
    {
      label: '매칭 조건',
      text: '같은 열차 · 같은 호차 또는 바로 옆 호차 · 같은 방향에서 상대를 찾아요',
    },
  ],
  afterMatchTitle: '매칭 후 이렇게 진행돼요',
  afterMatchSteps: [
    '수락 — 연결되면 30초 안에 수락해 주세요',
    '지금 이동 — 수락 후 바로 표시된 호차·출입문으로 이동해요 (옆 호차면 약 1분)',
    '서서 대기 — 문 옆에서 양보자가 내릴 때까지 기다려요 (아직 앉지 않아요)',
    `착석 — 양보자 하차 ${HANDOFF_READY_STATION_THRESHOLD}역 전부터 앉을 수 있어요`,
    '완료 — 착석·양보 확인 후 이용이 끝나요',
  ],
  seekerNote:
    '같은 칸·옆 칸이면 1분 안에 이동할 수 있어요. 수락 후 바로 이동 안내를 따라 주세요.',
  providerNote:
    '수락 후 착석 희망자가 문 옆으로 옵니다. 목적지 전까지는 편히 앉아 주세요.',
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
      text: `목적지까지 ${remainingStations}역 남았어요. 등록은 가능하지만, ${RECOMMENDED_PARTICIPATION_STATIONS}역 이상이면 양보·착석이 더 여유 있어요.`,
    }
  }

  return {
    tone: 'positive',
    text: `목적지까지 ${remainingStations}역 — 좋아요. 매칭되면 바로 호차·출입문 안내가 올 거예요.`,
  }
}
