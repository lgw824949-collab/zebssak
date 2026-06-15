'use client'

import type { MatchMovementPayload, MatchMovementStatus } from '@/lib/match-movement'
import type { MatchFlowStep } from '@/lib/match-flow-steps'
import { isHandoffMoveDue } from '@/lib/match-handoff-remaining'
import {
  resolvePartnerMovementLabel,
  resolveSelfMovementLabel,
} from '@/lib/match-movement'

interface MatchMovementPanelProps {
  viewerRole: 'seeker' | 'provider'
  movement: MatchMovementPayload
  flowStep?: MatchFlowStep
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
  flowStep,
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
  const handoffRemaining = routeGuide.handoff_remaining_stations
  const moveDue = isHandoffMoveDue(handoffRemaining)
  const isWaitingForHandoff = flowStep === 'wait'
  const isSeatReady = flowStep === 'seat'
  const isMoveNow = flowStep === 'move' && moveDue
  const seekerCanMove = viewerRole === 'seeker' && moveDue && flowStep === 'move'
  const showRouteContext =
    Boolean(routeGuide.train_current_station_name) ||
    Boolean(routeGuide.provider_direction_label)

  return (
    <div className="rounded-2xl border border-[#D5DDB8] bg-white px-4 py-5 text-left shadow-[0_2px_10px_rgba(26,26,26,0.04)]">
      <h2 className="text-[17px] font-bold text-[#747F00]">이동</h2>

      {showRouteContext ? (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {routeGuide.train_current_station_name ? (
            <div className="rounded-xl bg-[#F7F8F2] px-3 py-2.5">
              <p className="text-[11px] font-semibold text-[#9CA3AF]">위치</p>
              <p className="mt-1 text-[15px] font-bold text-[#1A1A1A]">
                {routeGuide.train_current_station_name}
              </p>
            </div>
          ) : null}
          {routeGuide.provider_direction_label ? (
            <div className="rounded-xl bg-[#F7F8F2] px-3 py-2.5">
              <p className="text-[11px] font-semibold text-[#9CA3AF]">방향</p>
              <p className="mt-1 text-[15px] font-bold text-[#747F00]">
                {routeGuide.provider_direction_label}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-[#9CA3AF]">양보 역</p>
          <p className="mt-1 truncate text-[22px] font-bold leading-tight text-[#1A1A1A]">
            {routeGuide.handoff_station_name}
          </p>
        </div>
        <p className="shrink-0 text-[32px] font-extrabold leading-none text-[#747F00] tabular-nums">
          {formatRemainingStations(handoffRemaining)}
        </p>
      </div>

      {isMoveNow && viewerRole === 'seeker' ? (
        <p
          className="match-move-blink mt-3 rounded-xl bg-[#FFF3CD] px-3 py-2.5 text-center text-[16px] font-extrabold text-[#8B6914]"
          role="alert"
        >
          지금 이동
        </p>
      ) : null}

      {isMoveNow && viewerRole === 'provider' ? (
        <p className="mt-3 rounded-xl bg-[#FFF3CD] px-3 py-2.5 text-center text-[14px] font-semibold text-[#8B6914]">
          착석 희망자 이동 중
        </p>
      ) : null}
      {isWaitingForHandoff ? (
        <p className="mt-3 rounded-xl bg-[#FFF8F0] px-3 py-2.5 text-center text-[14px] font-semibold text-[#8B6914]">
          {viewerRole === 'seeker' ? '문 옆 대기' : `${formatRemainingStations(handoffRemaining)} 후 양보`}
        </p>
      ) : null}

      {isSeatReady ? (
        <p className="mt-3 rounded-xl bg-[#F0F5E8] px-3 py-2.5 text-center text-[14px] font-semibold text-[#4A7C3F]">
          {viewerRole === 'seeker' ? '지금 앉기' : '지금 양보'}
        </p>
      ) : null}

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
              disabled={isUpdating || selfStatus === 'arrived' || !seekerCanMove}
              onClick={onStartMoving}
              className="rounded-xl border-2 border-[#D5DDB8] bg-white py-4 text-[16px] font-bold text-[#1A1A1A] transition active:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isUpdating && selfStatus !== 'arrived' ? '전송 중' : '이동 시작'}
            </button>
            <button
              type="button"
              disabled={isUpdating || selfStatus === 'arrived' || !seekerCanMove}
              onClick={onArrived}
              className="rounded-xl py-4 text-[16px] font-bold text-white transition active:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              style={{ backgroundColor: '#747F00' }}
            >
              {isUpdating && selfStatus === 'moving' ? '전송 중' : '도착했어요'}
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-center text-[15px] font-medium text-[#6B7280]">
          {isWaitingForHandoff
            ? '문 옆 대기 중'
            : isSeatReady
              ? '지금 양보'
              : '이동 대기'}
        </p>
      )}

      <style jsx>{`
        @keyframes match-move-blink {
          0%,
          100% {
            opacity: 1;
            box-shadow: 0 0 0 0 rgba(139, 105, 20, 0.35);
          }
          50% {
            opacity: 0.55;
            box-shadow: 0 0 0 6px rgba(139, 105, 20, 0);
          }
        }
        .match-move-blink {
          animation: match-move-blink 1s ease-in-out infinite;
        }
      `}</style>
    </div>
  )
}

export type { MatchMovementStatus }
