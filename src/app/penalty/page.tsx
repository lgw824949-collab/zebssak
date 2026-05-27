'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

interface StoredUser {
  no_show_count?: number
  suspended_until?: string | null
}

/**
 * 정지 해제일 포맷 (한국어)
 */
function formatReleaseDate(isoDate: string): string {
  try {
    return new Date(isoDate).toLocaleString('ko-KR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return isoDate
  }
}

/**
 * 노쇼 패널티 안내 화면
 */
export default function PenaltyPage() {
  const router = useRouter()
  const [noShowCount, setNoShowCount] = useState(0)
  const [suspendedUntil, setSuspendedUntil] = useState<string | null>(null)

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) {
      router.replace('/login')
      return
    }

    try {
      const raw = localStorage.getItem('user')
      if (!raw) return

      const user = JSON.parse(raw) as StoredUser
      setNoShowCount(user.no_show_count ?? 3)
      setSuspendedUntil(user.suspended_until ?? null)
    } catch {
      router.replace('/login')
    }
  }, [router])

  function handleConfirm() {
    router.push('/home')
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <main className="flex-1 max-w-md mx-auto w-full px-4 py-10 flex flex-col items-center justify-center">
        <div className="w-full rounded-2xl bg-white border border-red-200 shadow-lg p-8 text-center">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-red-100 flex items-center justify-center">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="w-9 h-9 text-red-600"
              aria-hidden
            >
              <path
                fillRule="evenodd"
                d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.661 13.28c1.155 2-.29 4.5-2.599 4.5H4.34c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003zM12 8.25a.75.75 0 00-.75.75v3.75a.75.75 0 001.5 0V9a.75.75 0 00-.75-.75zm0 8.25a.75.75 0 100-1.5.75.75 0 000 1.5z"
                clipRule="evenodd"
              />
            </svg>
          </div>

          <h1 className="text-2xl font-bold text-slate-900">이용 정지 안내</h1>
          <p className="mt-4 text-slate-600 leading-relaxed">
            노쇼가 <span className="font-semibold text-red-600">{noShowCount}회</span>{' '}
            누적되어 서비스 이용이 일시 정지되었습니다.
          </p>
          <p className="mt-3 text-sm text-slate-500">
            노쇼 3회 누적 시 7일간 이용이 제한됩니다.
          </p>

          <div className="mt-8 py-4 px-4 rounded-xl bg-red-50 border border-red-100">
            <p className="text-sm text-red-700 font-medium">정지 해제 예정</p>
            <p className="mt-2 text-lg font-bold text-red-800">
              {suspendedUntil
                ? formatReleaseDate(suspendedUntil)
                : '관리자에게 문의해주세요'}
            </p>
          </div>
        </div>
      </main>

      <footer className="px-4 py-6 border-t border-slate-200 bg-white">
        <div className="max-w-md mx-auto">
          <button
            type="button"
            onClick={handleConfirm}
            className="w-full rounded-xl bg-slate-800 py-4 text-base font-semibold text-white hover:bg-slate-900 transition-colors"
          >
            확인
          </button>
        </div>
      </footer>
    </div>
  )
}
