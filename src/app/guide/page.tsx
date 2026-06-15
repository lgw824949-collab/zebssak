'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { MATCH_STATION_GUIDE } from '@/lib/match-user-guide'

const GUIDE_STEPS = [
  {
    title: '빈자리 찾기',
    lines: [
      { label: '등록', text: '목적지·열차·좌석 입력' },
      { label: '알림', text: '빈 자리 생기면 푸시' },
      { label: '수락', text: '30초 안에 수락' },
    ],
  },
  {
    title: '자리 넘기기',
    lines: [
      { label: '등록', text: '내릴 역·좌석 입력' },
      { label: '알림', text: '착석 희망자와 매칭 시 푸시' },
      { label: '양보', text: '하차 때 자리 넘기기' },
    ],
  },
  {
    title: '매칭 후',
    lines: [
      { label: '수락', text: '30초 안에' },
      { label: '이동', text: '수락 후 바로' },
      { label: '착석', text: '문 옆 대기 → 착석' },
    ],
  },
] as const

/**
 * 이용 방법 안내
 */
export default function GuidePage() {
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
        <h1 className="flex-1 text-center text-[17px] font-bold text-[#1A1A1A]">이용 방법</h1>
        <span className="zeb-touch-target w-12 shrink-0" aria-hidden />
      </header>

      <main className="zeb-no-scrollbar mx-auto w-full max-w-md flex-1 overflow-y-auto px-4 py-6">
        <p className="text-[14px] font-medium text-[#6B7280]">
          빈자리 찾기·자리 넘기기로 이용하세요.
        </p>

        <ol className="mt-4 flex flex-col gap-3">
          {GUIDE_STEPS.map((step, index) => (
            <li
              key={step.title}
              className="rounded-2xl border border-[#EBEBEB] bg-white px-4 py-4"
            >
              <div className="flex items-start gap-3">
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white"
                  style={{ backgroundColor: '#747F00' }}
                  aria-hidden
                >
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-bold text-[#1A1A1A]">{step.title}</p>
                  <ul className="mt-2.5 flex flex-col gap-2">
                    {step.lines.map((line) => (
                      <li key={line.label} className="flex gap-3 text-[14px] leading-snug">
                        <span className="w-10 shrink-0 font-bold text-[#747F00]">{line.label}</span>
                        <span className="text-[#4B5563]">{line.text}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </li>
          ))}
        </ol>

        <section className="mt-4 rounded-2xl border border-[#D5DDB8] bg-[#F7F8F2] px-4 py-4">
          <h2 className="text-[15px] font-bold text-[#1A1A1A]">
            {MATCH_STATION_GUIDE.participationTitle}
          </h2>
          <p className="mt-2 text-[14px] leading-relaxed text-[#4B5563]">
            {MATCH_STATION_GUIDE.participationSummary}
          </p>
          <ul className="mt-3 flex flex-col gap-2.5">
            {MATCH_STATION_GUIDE.participationRules.map((rule) => (
              <li key={rule.label} className="flex gap-3 text-[14px] leading-snug">
                <span className="w-14 shrink-0 font-bold text-[#747F00]">{rule.label}</span>
                <span className="text-[#4B5563]">{rule.text}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-4 rounded-2xl border border-[#EBEBEB] bg-white px-4 py-4">
          <h2 className="text-[15px] font-bold text-[#1A1A1A]">
            {MATCH_STATION_GUIDE.afterMatchTitle}
          </h2>
          <ol className="mt-3 flex flex-col gap-2">
            {MATCH_STATION_GUIDE.afterMatchSteps.map((step, index) => (
              <li key={step} className="flex gap-3 text-[14px] leading-snug text-[#4B5563]">
                <span className="w-5 shrink-0 font-bold text-[#747F00]">{index + 1}.</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <p className="mt-4 rounded-xl bg-[#FFF8F0] px-3 py-2.5 text-[13px] font-medium leading-relaxed text-[#7D6B52]">
            {MATCH_STATION_GUIDE.seekerNote}
          </p>
        </section>
      </main>
    </div>
  )
}
