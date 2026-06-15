import {
  HANDOFF_READY_STATION_THRESHOLD,
} from '@/lib/match-handoff-remaining'

/** 서비스 참여 최소 남은 역 수 (API와 동일) */
export const MIN_PARTICIPATION_STATIONS = 3

/** 여유 있는 이용을 권장하는 남은 역 수 */
export const RECOMMENDED_PARTICIPATION_STATIONS = 5

export const MATCH_STATION_GUIDE = {
  participationTitle: '역 수 안내',
  participationSummary: '곧 비워질 자리를 연결합니다. 양보자가 목적지까지 탈 시간이 필요해요.',
  participationRules: [
    {
      label: '참여',
      text: `최소 ${MIN_PARTICIPATION_STATIONS}역 이상`,
    },
    {
      label: '권장',
      text: `${RECOMMENDED_PARTICIPATION_STATIONS}역 이상`,
    },
    {
      label: '매칭',
      text: '같은 열차 · 같은·옆 호차 · 같은 방향',
    },
  ],
  afterMatchTitle: '매칭 후',
  afterMatchSteps: [
    '수락 — 30초 안에',
    '이동 — 수락 후 바로 (옆 호차 약 1분)',
    '대기 — 문 옆에서',
    `착석 — 하차 ${HANDOFF_READY_STATION_THRESHOLD}역 전`,
    '완료',
  ],
  seekerNote: '수락 후 바로 이동',
  providerNote: '목적지 전까지 편히 앉기',
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
      text: `${remainingStations}역 남음 · ${RECOMMENDED_PARTICIPATION_STATIONS}역 이상 권장`,
    }
  }

  return {
    tone: 'positive',
    text: `${remainingStations}역 — 매칭되면 바로 이동 안내`,
  }
}
