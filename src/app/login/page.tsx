'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { FormEvent, Suspense, useState } from 'react'
import { subscribePush } from '@/lib/push'

interface AuthApiResponse {
  success: boolean
  error?: string
  data?: {
    token: string
    user: Record<string, unknown>
  }
}

function buildBoardingReturnUrl(searchParams: URLSearchParams): string | null {
  const lineLabel = searchParams.get('lineLabel')?.trim()
  const type = searchParams.get('type')?.trim()
  if (!lineLabel || (type !== 'seek' && type !== 'leave')) return null
  const params = new URLSearchParams({ type, lineLabel })
  return `/boarding?${params.toString()}`
}

function AuthJoinNotice({
  lineLabel,
  mode,
}: {
  lineLabel: string | null
  mode: 'seek' | 'leave' | null
}) {
  if (!lineLabel || !mode) return null

  const modeLabel = mode === 'leave' ? '하차' : '착석'

  return (
    <div className="mb-6 rounded-2xl border border-[#D8E4FF] bg-[#F0F5FF] px-4 py-4">
      <p className="text-sm font-bold text-[#0B1F4B]">왜 로그인이 필요한가요?</p>
      <p className="mt-2 text-sm leading-relaxed text-[#475569]">
        <strong>{lineLabel}</strong> {modeLabel} 매칭을 이어가려면 계정이 필요해요.
      </p>
      <p className="mt-2 text-sm leading-relaxed text-[#475569]">
        이름·전화번호·이메일은 받지 않아요. 아이디와 비밀번호만 사용합니다.
      </p>
    </div>
  )
}

function LoginPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const lineLabel = searchParams.get('lineLabel')?.trim() || null
  const flowType = searchParams.get('type')?.trim()
  const mode = flowType === 'leave' ? 'leave' : flowType === 'seek' ? 'seek' : null

  const registerHref =
    lineLabel && mode
      ? `/register?${new URLSearchParams({ type: mode, lineLabel }).toString()}`
      : '/register'

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          password,
        }),
      })

      const result = (await response.json()) as AuthApiResponse

      if (!response.ok || !result.success || !result.data?.token) {
        setError(result.error ?? '로그인에 실패했습니다.')
        return
      }

      localStorage.setItem('token', result.data.token)
      localStorage.setItem('user', JSON.stringify(result.data.user))

      if ('serviceWorker' in navigator) {
        try {
          await navigator.serviceWorker.register('/sw.js')
        } catch {
          // SW 등록 실패 시에도 로그인은 유지합니다.
        }
      }

      void subscribePush(result.data.token)

      const returnUrl = buildBoardingReturnUrl(searchParams)
      router.replace(returnUrl ?? '/')
    } catch {
      setError('네트워크 오류가 발생했습니다. 잠시 후 다시 시도해주세요.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-[100vh] bg-[#F7F8FA]">
      <div className="mx-auto flex min-h-[100vh] w-full max-w-[480px] flex-col bg-[#F7F8FA]">
        <header className="min-h-[240px] rounded-b-[36px] bg-[#0B1F4B] px-8 pb-12 pt-[72px]">
          <Link
            href="/"
            className="mb-4 inline-block text-sm font-semibold text-white/70"
          >
            ← 홈으로
          </Link>
          <h1 className="text-[48px] font-black tracking-tight text-[#C6FF00]">
            ⚡ 잽싸게
          </h1>
          <div className="mt-4 h-1 w-10 rounded-full bg-[#C6FF00]" />
          <p className="mt-5 text-[15px] font-semibold text-white/85">
            {lineLabel ? '가입한 계정으로 이어가기' : '지하철 빈자리 실시간 매칭'}
          </p>
        </header>

        <main className="px-6 pb-0 pt-[32px]">
          <AuthJoinNotice lineLabel={lineLabel} mode={mode} />

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label
                htmlFor="username"
                className="mb-2 block text-sm font-semibold text-[#0B1F4B]"
              >
                아이디
              </label>
              <input
                id="username"
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                inputMode="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="h-14 w-full rounded-[14px] border-[1.5px] border-[#E8E8E8] bg-white px-4 text-[15px] font-medium text-[#0B1F4B] placeholder:text-[#A0A0A0] focus:border-[#0B1F4B] focus:outline-none focus:ring-2 focus:ring-[#0B1F4B]/10"
                placeholder="아이디를 입력하세요"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-2 block text-sm font-semibold text-[#0B1F4B]"
              >
                비밀번호
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                autoCapitalize="none"
                autoCorrect="off"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-14 w-full rounded-[14px] border-[1.5px] border-[#E8E8E8] bg-white px-4 text-[15px] font-medium text-[#0B1F4B] placeholder:text-[#A0A0A0] focus:border-[#0B1F4B] focus:outline-none focus:ring-2 focus:ring-[#0B1F4B]/10"
                placeholder="비밀번호를 입력하세요"
              />
            </div>

            {error ? (
              <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-600">
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={isLoading}
              className="mt-2 h-14 w-full rounded-2xl bg-[#0B1F4B] text-[18px] font-bold text-white transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoading ? '로그인 중...' : lineLabel ? '로그인하고 이어가기' : '로그인'}
            </button>
          </form>

          <p className="mt-7 text-center text-sm font-medium text-[#7A7A7A]">
            계정이 없으신가요?{' '}
            <Link href={registerHref} className="font-bold text-[#0B1F4B] underline">
              회원가입
            </Link>
          </p>
        </main>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center bg-[#F7F8FA] text-sm font-semibold text-[#888888]">
          로딩 중...
        </div>
      }
    >
      <LoginPageContent />
    </Suspense>
  )
}
