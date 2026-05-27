'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

// 혼잡도 API 연동 전 기본값 (7 이상 시 기능 정지)
const CONGESTION_LEVEL = 8
const HALT_THRESHOLD = 7

/**
 * 혼잡도 기능 정지 안내 화면
 */
export default function SuspendedPage() {
  const router = useRouter()

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) {
      router.replace('/login')
    }
  }, [router])

  function handleGoHome() {
    router.push('/home')
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <main className="flex-1 max-w-md mx-auto w-full px-4 py-10 flex flex-col items-center justify-center">
        <div className="w-full rounded-2xl bg-white border border-amber-200 shadow-lg p-8 text-center">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-amber-100 flex items-center justify-center">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="w-9 h-9 text-amber-600"
              aria-hidden
            >
              <path
                fillRule="evenodd"
                d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25zM12.75 9a.75.75 0 00-1.5 0v2.25H9a.75.75 0 000 1.5h2.25V15a.75.75 0 001.5 0v-2.25H15a.75.75 0 000-1.5h-2.25V9z"
                clipRule="evenodd"
              />
            </svg>
          </div>

          <h1 className="text-2xl font-bold text-slate-900">기능 일시 정지</h1>
          <p className="mt-4 text-slate-600 leading-relaxed">
            현재 혼잡도가 높아 매칭·탑승 등
            <br />
            <span className="font-semibold text-amber-700">모든 기능이 일시 정지</span>
            되었습니다.
          </p>
          <p className="mt-3 text-sm text-slate-500">
            혼잡도 {HALT_THRESHOLD} 이상 시 서비스가 자동으로 중단됩니다.
          </p>

          <div className="mt-8 py-5 px-4 rounded-xl bg-amber-50 border border-amber-200">
            <p className="text-sm text-amber-700 font-medium">현재 혼잡도</p>
            <p className="mt-2 text-5xl font-bold text-amber-800">
              {CONGESTION_LEVEL}
              <span className="text-2xl font-semibold text-amber-600/80">/10</span>
            </p>
            <p className="mt-2 text-xs text-amber-600">
              정상화 후 다시 이용해주세요.
            </p>
          </div>
        </div>
      </main>

      <footer className="px-4 py-6 border-t border-slate-200 bg-white">
        <div className="max-w-md mx-auto">
          <button
            type="button"
            onClick={handleGoHome}
            className="w-full rounded-xl bg-blue-700 py-4 text-base font-semibold text-white hover:bg-blue-800 transition-colors"
          >
            메인으로 돌아가기
          </button>
        </div>
      </footer>
    </div>
  )
}
