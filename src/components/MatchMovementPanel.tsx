'use client'

import type { MatchMovementPayload, MatchMovementStatus } from '@/lib/match-movement'
import {
  resolvePartnerMovementLabel,
  resolveSelfMovementLabel,
} from '@/lib/match-movement'

interface MatchMovementPanelProps {
  viewerRole: 'seeker' | 'provider'
  movement: MatchMovementPayload
  isUpdating?: boolean
  onStartMoving?: () => void
  onArrived?: () => void
}

function formatRemainingStations(count: number | null): string {
  if (count == null || count < 0) {
    return '확인 중'
  }

  return `${count}역`
}

export default function MatchMovementPanel({
  viewerRole,
  movement,
  isUpdating = false,
  onStartMoving,
  onArrived,
}: MatchMovementPanelProps) {
  const { route_guide: routeGuide, self, partner } = movement
  const partnerRole: 'seeker' | 'provider' =
    viewerRole === 'seeker' ? 'provider' : 'seeker'
  const partnerLabel = resolvePartnerMovementLabel(partner.status, partnerRole)
  const selfLabel = resolveSelfMovementLabel(self.status)
  const selfStatus = self.status

  return (
    <div className="rounded-2xl border border-[#D5DDB8] bg-white px-4 py-4 text-left shadow-[0_2px_10px_rgba(26,26,26,0.04)]">
      <p className="text-sm font-bold text-[#747F00]">이동 안내</p>
      <p className="mt-2 text-[13px] leading-relaxed text-[#4B5563]">
        양보 예정 ·{' '}
        <span className="font-semibold text-[#1A1A1A]">
          {routeGuide.handoff_station_name}
        </span>
        까지{' '}
        <span className="font-bold text-[#747F00]">
          {formatRemainingStations(routeGuide.handoff_remaining_stations)}
        </span>{' '}
        남음
      </p>
      <p className="mt-1 text-[12px] text-[#6B7280]">
        내 목적지 · {routeGuide.self_destination_name} (
        {formatRemainingStations(routeGuide.self_remaining_stations)} 남음)
      </p>

      <div
        className="mt-4 rounded-xl px-3 py-3"
        style={{ backgroundColor: 'rgba(116, 127, 0, 0.08)' }}
        role="status"
      >
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF]">
          상대방 상태
        </p>
        <p className="mt-1 text-[15px] font-bold text-[#1A1A1A]">{partnerLabel}</p>
      </div>

      {viewerRole === 'seeker' ? (
        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[13px] font-semibold text-[#374151]">내 이동 상태</p>
            <span className="rounded-full bg-[#747F00] px-2.5 py-0.5 text-[12px] font-bold text-white">
              {selfLabel}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={isUpdating || selfStatus === 'arrived'}
              onClick={onStartMoving}
              className="rounded-xl border border-[#D5DDB8] bg-white py-3 text-sm font-bold text-[#1A1A1A] transition active:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isUpdating && selfStatus !== 'arrived' ? '전송 중...' : '이동 시작'}
            </button>
            <button
              type="button"
              disabled={isUpdating || selfStatus === 'arrived'}
              onClick={onArrived}
              className="rounded-xl py-3 text-sm font-bold text-white transition active:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              style={{ backgroundColor: '#747F00' }}
            >
              {isUpdating && selfStatus === 'moving' ? '전송 중...' : '도착했어요'}
            </button>
          </div>
          <p className="text-[12px] leading-relaxed text-[#6B7280]">
            수락 전에도 해당 호차로 이동을 시작해 주세요. 양보자에게 내 위치가
            전달됩니다.
          </p>
        </div>
      ) : (
        <p className="mt-4 text-[12px] leading-relaxed text-[#6B7280]">
          착석 희망자가 이동을 시작하면 여기에 표시됩니다.{' '}
          {routeGuide.handoff_station_name} 전까지 자리를 지켜 주세요.
        </p>
      )}
    </div>
  )
}

export type { MatchMovementStatus }
