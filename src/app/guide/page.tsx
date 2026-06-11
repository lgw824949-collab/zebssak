'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

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
      { label: '확인', text: '「내 상태」 탭에서 진행 상황 확인' },
      { label: '완료', text: '안내에 따라 착석·하차' },
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
      </main>
    </div>
  )
}
