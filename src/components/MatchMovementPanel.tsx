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
    return '—'
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
    <div className="rounded-2xl border border-[#D5DDB8] bg-white px-4 py-5 text-left shadow-[0_2px_10px_rgba(26,26,26,0.04)]">
      <h2 className="text-[17px] font-bold text-[#747F00]">이동 안내</h2>

      <div className="mt-4 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-[#9CA3AF]">만나는 역</p>
          <p className="mt-1 truncate text-[22px] font-bold leading-tight text-[#1A1A1A]">
            {routeGuide.handoff_station_name}
          </p>
        </div>
        <p className="shrink-0 text-[32px] font-extrabold leading-none text-[#747F00] tabular-nums">
          {formatRemainingStations(routeGuide.handoff_remaining_stations)}
        </p>
      </div>

      <p className="mt-3 text-[15px] font-medium text-[#6B7280]">
        내 하차 · {routeGuide.self_destination_name}{' '}
        <span className="font-bold text-[#374151]">
          {formatRemainingStations(routeGuide.self_remaining_stations)}
        </span>
      </p>

      <div
        className="mt-4 rounded-xl px-4 py-3.5 text-center"
        style={{ backgroundColor: 'rgba(116, 127, 0, 0.1)' }}
        role="status"
        aria-label={`상대방 상태: ${partnerLabel}`}
      >
        <p className="text-[18px] font-bold leading-snug text-[#1A1A1A]">{partnerLabel}</p>
      </div>

      {viewerRole === 'seeker' ? (
        <div className="mt-4 space-y-3">
          <div className="flex justify-center">
            <span className="rounded-full bg-[#747F00] px-3 py-1 text-[14px] font-bold text-white">
              {selfLabel}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={isUpdating || selfStatus === 'arrived'}
              onClick={onStartMoving}
              className="rounded-xl border-2 border-[#D5DDB8] bg-white py-4 text-[16px] font-bold text-[#1A1A1A] transition active:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isUpdating && selfStatus !== 'arrived' ? '전송 중' : '이동 시작'}
            </button>
            <button
              type="button"
              disabled={isUpdating || selfStatus === 'arrived'}
              onClick={onArrived}
              className="rounded-xl py-4 text-[16px] font-bold text-white transition active:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              style={{ backgroundColor: '#747F00' }}
            >
              {isUpdating && selfStatus === 'moving' ? '전송 중' : '도착했어요'}
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-center text-[15px] font-medium leading-relaxed text-[#6B7280]">
          착석 희망자가 오면 알려드려요
        </p>
      )}
    </div>
  )
}

export type { MatchMovementStatus }
