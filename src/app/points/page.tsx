'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

interface PointHistoryItem {
  id: string
  recordedAt: string
  reason: string
  amount: number
}

interface StoredUser {
  total_points?: number
}

/** 미리보기용 포인트 내역 (서비스 오픈 전) */
const PREVIEW_POINT_HISTORY: PointHistoryItem[] = [
  {
    id: '1',
    recordedAt: '2026-05-25T14:32:00',
    reason: '자리 넘기기 매칭 완료',
    amount: 100,
  },
  {
    id: '2',
    recordedAt: '2026-05-23T09:15:00',
    reason: '자리 넘기기 매칭 완료',
    amount: 100,
  },
  {
    id: '3',
    recordedAt: '2026-05-20T18:40:00',
    reason: '매칭 완료 보너스',
    amount: 50,
  },
]

/** 일시 포맷 (한국어) */
function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ko-KR', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

/**
 * 포인트 내역 화면 (서비스 예정)
 */
export default function PointsPage() {
  const router = useRouter()
  const [balance, setBalance] = useState(0)

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) {
      router.replace('/login')
      return
    }

    try {
      const raw = localStorage.getItem('user')
      if (raw) {
        const user = JSON.parse(raw) as StoredUser
        setBalance(user.total_points ?? 0)
      }
    } catch {
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
        <h1 className="flex-1 text-center text-[17px] font-bold text-[#1A1A1A]">포인트 내역</h1>
        <span className="zeb-touch-target w-12 shrink-0" aria-hidden />
      </header>

      <main className="zeb-no-scrollbar mx-auto w-full max-w-md flex-1 overflow-y-auto px-4 py-6 pb-8">
        <p
          className="rounded-xl border border-[#D5DDB8] bg-[#F7F8F2] px-3 py-2.5 text-center text-[13px] font-bold text-[#5F6B2E]"
          role="status"
        >
          서비스 예정 · 아래 내역은 화면 미리보기입니다
        </p>

        <section className="mt-4 rounded-2xl bg-[#747F00] p-5 text-center text-white shadow-sm">
          <p className="text-[13px] font-medium text-white/85">누적 매너포인트</p>
          <p className="mt-2 text-[36px] font-extrabold leading-none">
            {balance.toLocaleString()}
            <span className="ml-1 text-[18px] font-bold">P</span>
          </p>
          <p className="mt-2 text-[12px] font-medium text-white/75">정식 오픈 후 실제 잔액이 표시됩니다</p>
        </section>

        <section className="mt-6">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-[15px] font-bold text-[#1A1A1A]">적립·사용 이력</h2>
            <span className="shrink-0 rounded-full bg-[#EBEBEB] px-2.5 py-0.5 text-[11px] font-bold text-[#6B7280]">
              서비스 예정
            </span>
          </div>
          <ul className="flex flex-col gap-2">
            {PREVIEW_POINT_HISTORY.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-[#EBEBEB] bg-white px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold text-[#1A1A1A]">{item.reason}</p>
                  <p className="mt-0.5 text-[12px] font-medium text-[#9CA3AF]">
                    {formatDateTime(item.recordedAt)}
                  </p>
                </div>
                <p
                  className={`shrink-0 text-[15px] font-bold ${
                    item.amount >= 0 ? 'text-[#747F00]' : 'text-[#DC2626]'
                  }`}
                >
                  {item.amount >= 0 ? '+' : ''}
                  {item.amount.toLocaleString()}P
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-6 rounded-2xl border border-dashed border-[#D5DDB8] bg-white px-4 py-4 text-center">
          <p className="text-[14px] font-bold text-[#1A1A1A]">T-money 전환</p>
          <p className="mt-1 text-[13px] font-medium text-[#6B7280]">서비스 예정</p>
          <button
            type="button"
            disabled
            className="mt-3 w-full rounded-xl bg-[#E5E7EB] py-3 text-[15px] font-bold text-[#9CA3AF]"
          >
            준비 중
          </button>
        </section>
      </main>
    </div>
  )
}
