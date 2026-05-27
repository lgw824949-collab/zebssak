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

// 임시 포인트 내역 데이터
const MOCK_POINT_HISTORY: PointHistoryItem[] = [
  {
    id: '1',
    recordedAt: '2026-05-25T14:32:00',
    reason: '하차 예정 매칭 완료',
    amount: 100,
  },
  {
    id: '2',
    recordedAt: '2026-05-23T09:15:00',
    reason: '하차 예정 매칭 완료',
    amount: 100,
  },
  {
    id: '3',
    recordedAt: '2026-05-20T18:40:00',
    reason: '매칭 완료 보너스',
    amount: 50,
  },
  {
    id: '4',
    recordedAt: '2026-05-18T11:05:00',
    reason: 'T-money 전환',
    amount: -200,
  },
]

/**
 * 일시 포맷 (한국어)
 */
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
 * 포인트 내역 화면
 */
export default function PointsPage() {
  const router = useRouter()
  const [balance, setBalance] = useState(0)
  const [tmoneyMessage, setTmoneyMessage] = useState('')

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
        setBalance(user.total_points ?? 250)
      } else {
        setBalance(250)
      }
    } catch {
      router.replace('/login')
    }
  }, [router])

  function handleTmoneyRequest() {
    setTmoneyMessage('T-money 전환 신청이 접수되었습니다. (임시 UI)')
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-slate-200 px-4 py-4">
        <div className="max-w-md mx-auto flex items-center justify-between">
          <Link
            href="/home"
            className="text-sm text-slate-500 hover:text-slate-800"
          >
            ← 홈
          </Link>
          <h1 className="text-lg font-bold text-slate-900">포인트 내역</h1>
          <span className="w-8" aria-hidden />
        </div>
      </header>

      <main className="flex-1 max-w-md mx-auto w-full px-4 py-6 pb-28">
        <section className="rounded-2xl bg-blue-700 text-white p-6 shadow-md text-center">
          <p className="text-sm text-blue-100 font-medium">누적 포인트 잔액</p>
          <p className="mt-2 text-4xl font-bold">{balance.toLocaleString()}P</p>
        </section>

        <section className="mt-8">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">적립·사용 이력</h2>
          <ul className="space-y-3">
            {MOCK_POINT_HISTORY.map((item) => (
              <li
                key={item.id}
                className="rounded-xl bg-white border border-slate-200 p-4 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900 truncate">
                    {item.reason}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    {formatDateTime(item.recordedAt)}
                  </p>
                </div>
                <p
                  className={`text-base font-bold shrink-0 ${
                    item.amount >= 0 ? 'text-blue-700' : 'text-red-600'
                  }`}
                >
                  {item.amount >= 0 ? '+' : ''}
                  {item.amount.toLocaleString()}P
                </p>
              </li>
            ))}
          </ul>
        </section>

        {tmoneyMessage && (
          <p className="mt-4 text-sm text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">
            {tmoneyMessage}
          </p>
        )}
      </main>

      <footer className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-4 py-4">
        <div className="max-w-md mx-auto">
          <button
            type="button"
            onClick={handleTmoneyRequest}
            className="w-full rounded-xl bg-slate-800 py-4 text-base font-semibold text-white hover:bg-slate-900 transition-colors"
          >
            T-money 전환 신청
          </button>
        </div>
      </footer>
    </div>
  )
}
