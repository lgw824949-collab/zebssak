'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

interface BoardingDraft {
  role: string
  lineNumber: number
  trainNo: string
  carNumber: number
  destinationId: string
  destinationName: string
  remainingStations: number
}

/**
 * 하차 예정 등록 화면
 */
export default function ProviderPage() {
  const router = useRouter()
  const [draft, setDraft] = useState<BoardingDraft | null>(null)
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) {
      router.replace('/login')
      return
    }

    try {
      const rawDraft = sessionStorage.getItem('boardingDraft')
      if (!rawDraft) {
        router.replace('/home')
        return
      }

      const parsed = JSON.parse(rawDraft) as BoardingDraft
      if (parsed.role !== 'provider') {
        router.replace('/home')
        return
      }

      setDraft(parsed)
    } catch {
      router.replace('/home')
    }
  }, [router])

  function handleCancel() {
    sessionStorage.removeItem('boardingDraft')
    sessionStorage.removeItem('providerRegistered')
    router.push('/home')
  }

  async function handleRegister() {
    if (!draft) {
      return
    }

    setError('')
    setIsSubmitting(true)

    try {
      const token = localStorage.getItem('token')
      if (!token) {
        router.replace('/login')
        return
      }

      const response = await fetch('/api/match-requests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          role: 'provider',
          train_id: draft.trainNo,
          car_number: draft.carNumber,
          destination_id: draft.destinationId,
          remaining_stops: draft.remainingStations,
          line_number: draft.lineNumber,
          destination_name: draft.destinationName,
        }),
      })

      const result = (await response.json()) as {
        success: boolean
        error?: string
        data?: { match_request_id?: string }
      }

      if (!response.ok || !result.success) {
        setError(result.error ?? '하차 예정 등록에 실패했습니다.')
        return
      }

      sessionStorage.setItem(
        'providerRegistered',
        JSON.stringify({
          ...draft,
          matchRequestId: result.data?.match_request_id,
          registeredAt: new Date().toISOString(),
        })
      )
      sessionStorage.removeItem('boardingDraft')
      router.push('/home')
    } catch {
      setError('네트워크 오류가 발생했습니다. 다시 시도해주세요.')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!draft) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-500">
        로딩 중...
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="zeb-app-header">
        <div className="mx-auto flex w-full max-w-md items-center justify-between">
          <Link
            href="/home"
            className="text-sm text-slate-500 hover:text-slate-800"
          >
            ← 홈
          </Link>
          <h1 className="text-lg font-bold text-slate-900">하차 예정 등록</h1>
          <span className="text-xs font-medium text-slate-700 bg-slate-100 px-2 py-1 rounded">
            하차 예정
          </span>
        </div>
      </header>

      <main className="flex-1 max-w-md mx-auto w-full px-4 py-8 space-y-6">
        <p className="text-sm text-slate-500 text-center">
          아래 정보를 확인한 뒤 등록해주세요.
        </p>

        {/* 탑승 열차·칸 */}
        <section className="rounded-2xl bg-white border border-slate-200 p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">
            현재 탑승 열차·칸
          </h2>
          <dl className="space-y-3">
            <div className="flex justify-between items-center">
              <dt className="text-sm text-slate-500">호선</dt>
              <dd className="text-base font-semibold text-slate-900">
                인천 {draft.lineNumber}호선
              </dd>
            </div>
            <div className="flex justify-between items-center">
              <dt className="text-sm text-slate-500">열차</dt>
              <dd className="text-base font-semibold text-slate-900">
                {draft.trainNo}
              </dd>
            </div>
            <div className="flex justify-between items-center">
              <dt className="text-sm text-slate-500">칸 번호</dt>
              <dd className="text-base font-semibold text-slate-900">
                {draft.carNumber}호차
              </dd>
            </div>
          </dl>
        </section>

        {/* 목적지 역 */}
        <section className="rounded-2xl bg-white border border-slate-200 p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">
            목적지 역
          </h2>
          <p className="text-2xl font-bold text-slate-900 text-center">
            {draft.destinationName}
          </p>
          <p className="text-sm text-slate-500 text-center mt-3">
            목적지까지{' '}
            <span className="font-semibold text-blue-700">
              {draft.remainingStations}역
            </span>{' '}
            남음
          </p>
        </section>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
      </main>

      <footer className="px-4 py-6 border-t border-slate-200 bg-white space-y-3">
        <div className="max-w-md mx-auto space-y-3">
          <button
            type="button"
            onClick={handleRegister}
            disabled={isSubmitting}
            className="w-full rounded-xl bg-slate-800 py-4 text-base font-semibold text-white hover:bg-slate-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSubmitting ? '등록 중...' : '내릴게요 등록'}
          </button>
          <button
            type="button"
            onClick={handleCancel}
            disabled={isSubmitting}
            className="w-full rounded-xl border border-slate-300 bg-white py-4 text-base font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
          >
            취소
          </button>
        </div>
      </footer>
    </div>
  )
}
