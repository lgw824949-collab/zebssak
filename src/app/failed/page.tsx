'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

/**
 * 매칭 실패 화면
 */
export default function FailedPage() {
  const router = useRouter()

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) {
      router.replace('/login')
    }
  }, [router])

  function handleRetry() {
    router.push('/waiting')
  }

  function handleGoHome() {
    router.push('/home')
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <main className="flex-1 max-w-md mx-auto w-full px-4 py-10 flex flex-col items-center justify-center">
        <div className="w-full rounded-2xl bg-white border border-slate-200 shadow-lg p-8 text-center">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-slate-100 flex items-center justify-center">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="w-9 h-9 text-slate-500"
              aria-hidden
            >
              <path
                fillRule="evenodd"
                d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25zm-1.72 6.97a.75.75 0 10-1.06 1.06L10.94 12l-1.72 1.72a.75.75 0 101.06 1.06L12 13.06l1.72 1.72a.75.75 0 101.06-1.06L13.06 12l1.72-1.72a.75.75 0 10-1.06-1.06L12 10.94l-1.72-1.72z"
                clipRule="evenodd"
              />
            </svg>
          </div>

          <h1 className="text-2xl font-bold text-slate-900">매칭 실패</h1>
          <p className="mt-4 text-slate-600 leading-relaxed">
            아쉽게도 이번에는 매칭되지 않았습니다.
            <br />
            잠시 후 다시 시도해주세요.
          </p>
          <p className="mt-3 text-sm text-slate-500">
            대기열에서 다른 승객과 연결되지 않았습니다.
          </p>
        </div>
      </main>

      <footer className="px-4 py-6 border-t border-slate-200 bg-white">
        <div className="max-w-md mx-auto space-y-3">
          <button
            type="button"
            onClick={handleRetry}
            className="w-full rounded-xl bg-blue-700 py-4 text-base font-semibold text-white hover:bg-blue-800 transition-colors"
          >
            다시 시도하기
          </button>
          <button
            type="button"
            onClick={handleGoHome}
            className="w-full rounded-xl border border-slate-300 bg-white py-4 text-base font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
          >
            메인으로 돌아가기
          </button>
        </div>
      </footer>
    </div>
  )
}
