'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { FormEvent, Suspense, useState } from 'react'

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
      <p className="text-sm font-bold text-[#0B1F4B]">왜 가입이 필요한가요?</p>
      <p className="mt-2 text-sm leading-relaxed text-[#475569]">
        <strong>{lineLabel}</strong> {modeLabel} 매칭을 이어가려면 최소한의 계정이 필요해요.
      </p>
      <ul className="mt-3 space-y-1.5 text-sm leading-relaxed text-[#475569]">
        <li>· 이름, 전화번호, 이메일은 받지 않아요</li>
        <li>· 아이디와 비밀번호만 사용해요</li>
        <li>· 상대방과 매칭할 때만 쓰여요</li>
      </ul>
    </div>
  )
}

function RegisterPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const lineLabel = searchParams.get('lineLabel')?.trim() || null
  const flowType = searchParams.get('type')?.trim()
  const mode = flowType === 'leave' ? 'leave' : flowType === 'seek' ? 'seek' : null

  const loginHref =
    lineLabel && mode
      ? `/login?${new URLSearchParams({ type: mode, lineLabel }).toString()}`
      : '/login'

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          password,
        }),
      })

      const result = (await response.json()) as AuthApiResponse

      if (!response.ok || !result.success || !result.data?.token) {
        setError(result.error ?? '회원가입에 실패했습니다.')
        return
      }

      localStorage.setItem('token', result.data.token)
      localStorage.setItem('user', JSON.stringify(result.data.user))

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
        <header className="rounded-b-[36px] bg-[#0B1F4B] px-8 pb-10 pt-[72px]">
          <Link
            href="/"
            className="mb-4 inline-block text-sm font-semibold text-white/70"
          >
            ← 홈으로
          </Link>
          <h1 className="text-[36px] font-black tracking-tight text-[#C6FF00]">
            ⚡ 잽싸게
          </h1>
          <p className="mt-4 text-[15px] font-semibold text-white/85">간단 가입</p>
          <p className="mt-1 text-[14px] font-medium text-white/65">
            개인정보 없이 아이디만 만들면 바로 이어져요
          </p>
        </header>

        <main className="px-6 pb-10 pt-8">
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
                minLength={4}
                maxLength={20}
                pattern="[a-zA-Z0-9_]+"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="h-14 w-full rounded-[14px] border-[1.5px] border-[#E8E8E8] bg-white px-4 text-[15px] font-medium text-[#0B1F4B] placeholder:text-[#A0A0A0] focus:border-[#0B1F4B] focus:outline-none focus:ring-2 focus:ring-[#0B1F4B]/10"
                placeholder="4~20자 (영문, 숫자, _)"
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
                autoComplete="new-password"
                autoCapitalize="none"
                autoCorrect="off"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-14 w-full rounded-[14px] border-[1.5px] border-[#E8E8E8] bg-white px-4 text-[15px] font-medium text-[#0B1F4B] placeholder:text-[#A0A0A0] focus:border-[#0B1F4B] focus:outline-none focus:ring-2 focus:ring-[#0B1F4B]/10"
                placeholder="6자 이상"
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
              {isLoading ? '가입 중...' : lineLabel ? '가입하고 이어가기' : '회원가입'}
            </button>
          </form>

          <p className="mt-7 text-center text-sm font-medium text-[#7A7A7A]">
            이미 계정이 있으신가요?{' '}
            <Link href={loginHref} className="font-bold text-[#0B1F4B] underline">
              로그인
            </Link>
          </p>
        </main>
      </div>
    </div>
  )
}

export default function RegisterPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center bg-[#F7F8FA] text-sm font-semibold text-[#888888]">
          로딩 중...
        </div>
      }
    >
      <RegisterPageContent />
    </Suspense>
  )
}
