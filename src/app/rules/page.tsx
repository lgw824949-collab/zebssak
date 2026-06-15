'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import {
  MATCH_STATION_GUIDE,
  MIN_PARTICIPATION_STATIONS,
} from '@/lib/match-user-guide'

const MATCHING_RULES = [
  { label: '참여', text: `목적지 필수 · 최소 ${MIN_PARTICIPATION_STATIONS}역 이상 남아야 함` },
  { label: '권장', text: MATCH_STATION_GUIDE.participationRules[1].text },
  { label: '매칭', text: MATCH_STATION_GUIDE.participationRules[2].text },
  { label: '이동', text: '수락 후 바로 이동' },
  { label: '착석', text: '문 옆 대기 후 착석' },
  { label: '우선순위', text: '교통약자 → 매너포인트 → 호차 거리 → 남은 역 → 요청 시각' },
  { label: '수락', text: '알림 후 30초 안에 수락' },
] as const

const SERVICE_RULES = [
  { label: '혼잡도', text: '7 이상이면 매칭 일시 정지' },
  { label: '노쇼', text: '3회 누적 시 7일 이용 정지' },
  { label: '패널티', text: '허위 등록·반복 취소 주의' },
] as const

/**
 * 매칭·이용 규칙 안내
 */
export default function RulesPage() {
  const router = useRouter()

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) {
      router.replace('/login')
    }
  }, [router])

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#F7F8FA]">
      <header className="zeb-app-header justify-between">
        <Link
          href="/"
          className="zeb-touch-target flex shrink-0 items-center text-sm font-medium text-[#6B7280]"
        >
          ← 홈
        </Link>
        <h1 className="flex-1 text-center text-[17px] font-bold text-[#1A1A1A]">매칭·이용 규칙</h1>
        <span className="zeb-touch-target w-12 shrink-0" aria-hidden />
      </header>

      <main className="zeb-no-scrollbar mx-auto w-full max-w-md flex-1 overflow-y-auto px-4 py-6">
        <section className="rounded-2xl border border-[#EBEBEB] bg-white px-4 py-4">
          <h2 className="text-[15px] font-bold text-[#1A1A1A]">매칭 규칙</h2>
          <ul className="mt-3 flex flex-col gap-3">
            {MATCHING_RULES.map((rule) => (
              <li key={rule.label} className="flex gap-3 text-[14px] leading-snug">
                <span className="w-14 shrink-0 font-bold text-[#747F00]">{rule.label}</span>
                <span className="text-[#4B5563]">{rule.text}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-4 rounded-2xl border border-[#D5DDB8] bg-[#F7F8F2] px-4 py-4">
          <h2 className="text-[15px] font-bold text-[#1A1A1A]">양보자 안내</h2>
          <p className="mt-2 text-[14px] leading-relaxed text-[#4B5563]">
            {MATCH_STATION_GUIDE.providerNote}
          </p>
        </section>

        <section className="mt-4 rounded-2xl border border-[#EBEBEB] bg-white px-4 py-4">
          <h2 className="text-[15px] font-bold text-[#1A1A1A]">이용 제한</h2>
          <ul className="mt-3 flex flex-col gap-3">
            {SERVICE_RULES.map((rule) => (
              <li key={rule.label} className="flex gap-3 text-[14px] leading-snug">
                <span className="w-14 shrink-0 font-bold text-[#747F00]">{rule.label}</span>
                <span className="text-[#4B5563]">{rule.text}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  )
}
