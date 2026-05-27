'use client'

import { useCallback, useEffect, useState } from 'react'

const ADMIN_KEY_STORAGE = 'adminApiKey'
const ADMIN_KEY_COOKIE = 'zebssak_admin_key'
const REFRESH_INTERVAL_MS = 4000

interface AdminUser {
  id: string
  username: string
  nickname: string | null
  is_vulnerable: boolean
  no_show_count: number
  suspended_until: string | null
  total_points: number
  created_at: string
}

interface MatchRequestUser {
  id: string
  username: string
  nickname: string | null
}

interface MatchRequestEmbed {
  id: string
  status: string
  request_type: string
  car_number: number | null
  user: MatchRequestUser | MatchRequestUser[] | null
}

interface AdminMatch {
  id: string
  status: string
  notify_expires_at: string
  accepted_at: string | null
  completed_at: string | null
  created_at: string
  seat_seek_request: MatchRequestEmbed | MatchRequestEmbed[] | null
  leaving_request: MatchRequestEmbed | MatchRequestEmbed[] | null
}

interface CongestionLog {
  id: string
  line_number: number
  congestion_level: number
  recorded_at: string
}

interface CongestionData {
  latest_by_line: Record<string, CongestionLog | null>
  recent: CongestionLog[]
}

interface ApiResult<T> {
  success: boolean
  error?: string
  data?: T
}

/**
 * embed 관계에서 단일 행 추출
 */
function unwrapEmbed<T>(value: T | T[] | null | undefined): T | null {
  if (!value) {
    return null
  }
  return Array.isArray(value) ? (value[0] ?? null) : value
}

/**
 * 날짜·시간 포맷
 */
function formatDateTime(value: string | null): string {
  if (!value) {
    return '—'
  }
  try {
    return new Date(value).toLocaleString('ko-KR')
  } catch {
    return value
  }
}

/**
 * 저장된 어드민 키 조회 (sessionStorage → cookie)
 */
function getStoredAdminKey(): string {
  if (typeof window === 'undefined') {
    return ''
  }

  const fromSession = sessionStorage.getItem(ADMIN_KEY_STORAGE)?.trim()
  if (fromSession) {
    return fromSession
  }

  const cookieMatch = document.cookie.match(
    new RegExp(`(?:^|;\\s*)${ADMIN_KEY_COOKIE}=([^;]*)`)
  )
  if (!cookieMatch?.[1]) {
    return ''
  }

  try {
    return decodeURIComponent(cookieMatch[1]).trim()
  } catch {
    return ''
  }
}

/**
 * 어드민 키 저장 (sessionStorage + cookie)
 */
function persistAdminKey(key: string): void {
  const trimmed = key.trim()
  sessionStorage.setItem(ADMIN_KEY_STORAGE, trimmed)
  document.cookie = `${ADMIN_KEY_COOKIE}=${encodeURIComponent(trimmed)}; path=/; max-age=${60 * 60 * 24 * 7}; SameSite=Lax`
}

/**
 * 어드민 키 삭제
 */
function clearAdminKey(): void {
  sessionStorage.removeItem(ADMIN_KEY_STORAGE)
  document.cookie = `${ADMIN_KEY_COOKIE}=; path=/; max-age=0; SameSite=Lax`
}

/**
 * 어드민 API 호출 헤더
 */
function adminHeaders(apiKey: string): HeadersInit {
  const trimmed = apiKey.trim()
  return {
    'Content-Type': 'application/json',
    'x-admin-key': trimmed,
  }
}

/**
 * 어드민 키 유효성 검사 (서버 ADMIN_SECRET과 일치 여부)
 */
async function verifyAdminKey(key: string): Promise<boolean> {
  const trimmed = key.trim()
  if (!trimmed) {
    return false
  }

  try {
    const response = await fetch('/api/admin/users', {
      headers: adminHeaders(trimmed),
      cache: 'no-store',
    })
    const result = (await response.json()) as ApiResult<unknown>
    return response.ok && result.success === true
  } catch {
    return false
  }
}

/**
 * 어드민 대시보드
 */
export default function AdminPage() {
  const [, setApiKey] = useState('')
  const [inputKey, setInputKey] = useState('')
  const [isAuthed, setIsAuthed] = useState(false)
  const [isHydrated, setIsHydrated] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const [matches, setMatches] = useState<AdminMatch[]>([])
  const [users, setUsers] = useState<AdminUser[]>([])
  const [congestion, setCongestion] = useState<CongestionData | null>(null)

  const [lineNumber, setLineNumber] = useState<1 | 2>(1)
  const [congestionLevel, setCongestionLevel] = useState(3)
  const [unsuspendLoadingId, setUnsuspendLoadingId] = useState<string | null>(
    null
  )

  useEffect(() => {
    let cancelled = false

    async function restoreSession() {
      const saved = getStoredAdminKey()
      if (!saved) {
        if (!cancelled) {
          setIsHydrated(true)
        }
        return
      }

      const valid = await verifyAdminKey(saved)
      if (cancelled) {
        return
      }

      if (valid) {
        persistAdminKey(saved)
        setApiKey(saved)
        setIsAuthed(true)
      } else {
        clearAdminKey()
        setApiKey('')
        setIsAuthed(false)
        setError('저장된 어드민 키가 유효하지 않습니다. 다시 로그인해주세요.')
      }
      setIsHydrated(true)
    }

    void restoreSession()

    return () => {
      cancelled = true
    }
  }, [])

  const fetchDashboard = useCallback(async () => {
    const currentKey = getStoredAdminKey()
    if (!currentKey) {
      setIsAuthed(false)
      setApiKey('')
      return
    }

    setApiKey(currentKey)
    setLoading(true)
    setError('')

    try {
      const headers = adminHeaders(currentKey)

      const [matchesRes, usersRes, congestionRes] = await Promise.all([
        fetch('/api/admin/matches', { headers, cache: 'no-store' }),
        fetch('/api/admin/users', { headers, cache: 'no-store' }),
        fetch('/api/admin/congestion', { headers, cache: 'no-store' }),
      ])

      const matchesJson = (await matchesRes.json()) as ApiResult<AdminMatch[]>
      const usersJson = (await usersRes.json()) as ApiResult<AdminUser[]>
      const congestionJson = (await congestionRes.json()) as ApiResult<CongestionData>

      if (
        matchesRes.status === 401 ||
        usersRes.status === 401 ||
        congestionRes.status === 401
      ) {
        clearAdminKey()
        setApiKey('')
        setIsAuthed(false)
        setError('어드민 인증이 필요합니다. 키를 다시 입력해주세요.')
        return
      }

      if (!matchesRes.ok || !matchesJson.success) {
        throw new Error(matchesJson.error ?? '매칭 목록 조회 실패')
      }
      if (!usersRes.ok || !usersJson.success) {
        throw new Error(usersJson.error ?? '유저 목록 조회 실패')
      }
      if (!congestionRes.ok || !congestionJson.success) {
        throw new Error(congestionJson.error ?? '혼잡도 조회 실패')
      }

      setMatches(matchesJson.data ?? [])
      setUsers(usersJson.data ?? [])
      setCongestion(congestionJson.data ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '데이터를 불러올 수 없습니다.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isHydrated || !isAuthed) {
      return
    }

    void fetchDashboard()
    const timerId = window.setInterval(() => {
      void fetchDashboard()
    }, REFRESH_INTERVAL_MS)

    return () => window.clearInterval(timerId)
  }, [isHydrated, isAuthed, fetchDashboard])

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = inputKey.trim()
    if (!trimmed) {
      setError('어드민 키를 입력해주세요.')
      return
    }

    setError('')
    setLoading(true)

    const valid = await verifyAdminKey(trimmed)
    if (!valid) {
      clearAdminKey()
      setApiKey('')
      setIsAuthed(false)
      setError(
        '어드민 키가 올바르지 않습니다. .env.local의 ADMIN_SECRET과 동일한지 확인해주세요.'
      )
      setLoading(false)
      return
    }

    persistAdminKey(trimmed)
    setApiKey(trimmed)
    setIsAuthed(true)
    setLoading(false)
    await fetchDashboard()
  }

  function handleLogout() {
    clearAdminKey()
    setApiKey('')
    setIsAuthed(false)
    setInputKey('')
    setError('')
  }

  async function handleUnsuspend(userId: string) {
    const currentKey = getStoredAdminKey()
    if (!currentKey) {
      setIsAuthed(false)
      return
    }

    setUnsuspendLoadingId(userId)
    setError('')

    try {
      const response = await fetch(`/api/admin/users/${userId}/unsuspend`, {
        method: 'POST',
        headers: adminHeaders(currentKey),
        cache: 'no-store',
      })
      const result = (await response.json()) as ApiResult<AdminUser>

      if (!response.ok || !result.success) {
        throw new Error(result.error ?? '정지 해제에 실패했습니다.')
      }

      await fetchDashboard()
    } catch (err) {
      setError(err instanceof Error ? err.message : '정지 해제에 실패했습니다.')
    } finally {
      setUnsuspendLoadingId(null)
    }
  }

  async function handleCongestionSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const currentKey = getStoredAdminKey()
    if (!currentKey) {
      setIsAuthed(false)
      return
    }

    setError('')

    try {
      const response = await fetch('/api/admin/congestion', {
        method: 'POST',
        headers: adminHeaders(currentKey),
        cache: 'no-store',
        body: JSON.stringify({
          line_number: lineNumber,
          congestion_level: congestionLevel,
        }),
      })
      const result = (await response.json()) as ApiResult<CongestionLog>

      if (!response.ok || !result.success) {
        throw new Error(result.error ?? '혼잡도 입력에 실패했습니다.')
      }

      await fetchDashboard()
    } catch (err) {
      setError(err instanceof Error ? err.message : '혼잡도 입력에 실패했습니다.')
    }
  }

  if (!isHydrated) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center text-slate-400">
        로딩 중…
      </div>
    )
  }

  if (!isAuthed) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center px-4">
        <form
          onSubmit={handleLogin}
          className="w-full max-w-md rounded-2xl bg-slate-800 border border-slate-700 p-8 shadow-xl"
        >
          <h1 className="text-2xl font-bold text-white">잽싸게 어드민</h1>
          <p className="mt-2 text-sm text-slate-400">
            .env.local의 ADMIN_SECRET 값을 입력하세요.
          </p>
          <label className="block mt-6 text-sm font-medium text-slate-300">
            어드민 키
          </label>
          <input
            type="password"
            value={inputKey}
            onChange={(e) => setInputKey(e.target.value)}
            className="mt-2 w-full rounded-lg border border-slate-600 bg-slate-900 px-4 py-3 text-white focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            placeholder="ADMIN_SECRET"
          />
          {error && (
            <p className="mt-3 text-sm text-red-400" role="alert">
              {error}
            </p>
          )}
          <button
            type="submit"
            className="mt-6 w-full rounded-lg bg-blue-600 py-3 font-semibold text-white hover:bg-blue-500 transition-colors"
          >
            접속
          </button>
        </form>
      </div>
    )
  }

  const latestLine1 = congestion?.latest_by_line?.['1'] ?? congestion?.latest_by_line?.[1]
  const latestLine2 = congestion?.latest_by_line?.['2'] ?? congestion?.latest_by_line?.[2]

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="bg-slate-900 text-white sticky top-0 z-10 shadow-md">
        <div className="max-w-7xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">잽싸게 어드민</h1>
            <p className="text-xs text-slate-400 mt-0.5">
              {loading ? '갱신 중…' : `${REFRESH_INTERVAL_MS / 1000}초마다 자동 갱신`}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void fetchDashboard()}
              className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-medium hover:bg-slate-600"
            >
              새로고침
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-medium hover:bg-slate-800"
            >
              로그아웃
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 space-y-8">
        {error && (
          <div
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            role="alert"
          >
            {error}
          </div>
        )}

        {/* 혼잡도 */}
        <section className="rounded-2xl bg-white border border-slate-200 shadow-sm p-6">
          <h2 className="text-lg font-bold text-slate-900">혼잡도 모니터링</h2>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-xl border border-slate-200 p-4">
              <p className="text-sm text-slate-500">인천 1호선 (최신)</p>
              <p className="mt-2 text-3xl font-bold text-slate-900">
                {latestLine1?.congestion_level ?? '—'}
                <span className="text-lg font-normal text-slate-400">/10</span>
              </p>
              <p className="mt-1 text-xs text-slate-400">
                {formatDateTime(latestLine1?.recorded_at ?? null)}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 p-4">
              <p className="text-sm text-slate-500">인천 2호선 (최신)</p>
              <p className="mt-2 text-3xl font-bold text-slate-900">
                {latestLine2?.congestion_level ?? '—'}
                <span className="text-lg font-normal text-slate-400">/10</span>
              </p>
              <p className="mt-1 text-xs text-slate-400">
                {formatDateTime(latestLine2?.recorded_at ?? null)}
              </p>
            </div>
          </div>

          <form
            onSubmit={handleCongestionSubmit}
            className="mt-6 flex flex-wrap items-end gap-4 border-t border-slate-100 pt-6"
          >
            <div>
              <label className="block text-sm font-medium text-slate-700">호선</label>
              <select
                value={lineNumber}
                onChange={(e) => setLineNumber(Number(e.target.value) as 1 | 2)}
                className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value={1}>1호선</option>
                <option value={2}>2호선</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">
                혼잡도 (1~10)
              </label>
              <input
                type="number"
                min={1}
                max={10}
                value={congestionLevel}
                onChange={(e) => setCongestionLevel(Number(e.target.value))}
                className="mt-1 w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <button
              type="submit"
              className="rounded-lg bg-blue-700 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-800"
            >
              수동 입력
            </button>
          </form>

          {congestion?.recent && congestion.recent.length > 0 && (
            <div className="mt-6 overflow-x-auto">
              <p className="text-sm font-medium text-slate-700 mb-2">최근 이력</p>
              <table className="w-full text-sm text-left">
                <thead className="text-slate-500 border-b">
                  <tr>
                    <th className="py-2 pr-4">호선</th>
                    <th className="py-2 pr-4">지수</th>
                    <th className="py-2">기록 시각</th>
                  </tr>
                </thead>
                <tbody>
                  {congestion.recent.map((row) => (
                    <tr key={row.id} className="border-b border-slate-50">
                      <td className="py-2 pr-4">{row.line_number}호선</td>
                      <td className="py-2 pr-4 font-medium">{row.congestion_level}</td>
                      <td className="py-2 text-slate-500">
                        {formatDateTime(row.recorded_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* 매칭 현황 */}
        <section className="rounded-2xl bg-white border border-slate-200 shadow-sm p-6">
          <h2 className="text-lg font-bold text-slate-900">
            매칭 현황
            <span className="ml-2 text-sm font-normal text-slate-400">
              ({matches.length}건)
            </span>
          </h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm text-left min-w-[720px]">
              <thead className="text-slate-500 border-b">
                <tr>
                  <th className="py-2 pr-3">상태</th>
                  <th className="py-2 pr-3">착석 희망</th>
                  <th className="py-2 pr-3">하차 예정</th>
                  <th className="py-2 pr-3">마감</th>
                  <th className="py-2">생성</th>
                </tr>
              </thead>
              <tbody>
                {matches.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-400">
                      매칭 내역이 없습니다.
                    </td>
                  </tr>
                ) : (
                  matches.map((match) => {
                    const seeker = unwrapEmbed(match.seat_seek_request)
                    const provider = unwrapEmbed(match.leaving_request)
                    const seekerUser = unwrapEmbed(seeker?.user ?? null)
                    const providerUser = unwrapEmbed(provider?.user ?? null)

                    return (
                      <tr key={match.id} className="border-b border-slate-50">
                        <td className="py-3 pr-3">
                          <span className="inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium">
                            {match.status}
                          </span>
                        </td>
                        <td className="py-3 pr-3">
                          {seekerUser?.username ?? '—'}
                          {seeker?.car_number != null && (
                            <span className="text-slate-400"> · {seeker.car_number}호차</span>
                          )}
                        </td>
                        <td className="py-3 pr-3">
                          {providerUser?.username ?? '—'}
                          {provider?.car_number != null && (
                            <span className="text-slate-400">
                              {' '}
                              · {provider.car_number}호차
                            </span>
                          )}
                        </td>
                        <td className="py-3 pr-3 text-slate-500 text-xs">
                          {formatDateTime(match.notify_expires_at)}
                        </td>
                        <td className="py-3 text-slate-500 text-xs">
                          {formatDateTime(match.created_at)}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* 유저 · 노쇼 */}
        <section className="rounded-2xl bg-white border border-slate-200 shadow-sm p-6">
          <h2 className="text-lg font-bold text-slate-900">
            유저 · 노쇼 패널티
            <span className="ml-2 text-sm font-normal text-slate-400">
              ({users.length}명)
            </span>
          </h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm text-left min-w-[640px]">
              <thead className="text-slate-500 border-b">
                <tr>
                  <th className="py-2 pr-3">아이디</th>
                  <th className="py-2 pr-3">노쇼</th>
                  <th className="py-2 pr-3">정지 해제일</th>
                  <th className="py-2 pr-3">포인트</th>
                  <th className="py-2">관리</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const isSuspended =
                    user.suspended_until != null &&
                    new Date(user.suspended_until) > new Date()

                  return (
                    <tr key={user.id} className="border-b border-slate-50">
                      <td className="py-3 pr-3 font-medium">{user.username}</td>
                      <td className="py-3 pr-3">
                        <span
                          className={
                            user.no_show_count >= 3
                              ? 'text-red-600 font-semibold'
                              : ''
                          }
                        >
                          {user.no_show_count}회
                        </span>
                      </td>
                      <td className="py-3 pr-3 text-slate-600">
                        {isSuspended ? (
                          <span className="text-red-600">
                            {formatDateTime(user.suspended_until)}
                          </span>
                        ) : (
                          '정상'
                        )}
                      </td>
                      <td className="py-3 pr-3">{user.total_points}</td>
                      <td className="py-3">
                        {isSuspended ? (
                          <button
                            type="button"
                            disabled={unsuspendLoadingId === user.id}
                            onClick={() => void handleUnsuspend(user.id)}
                            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                          >
                            {unsuspendLoadingId === user.id
                              ? '처리 중…'
                              : '정지 해제'}
                          </button>
                        ) : (
                          <span className="text-slate-300 text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  )
}
