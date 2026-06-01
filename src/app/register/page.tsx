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

function BoltIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M13 2L4.5 13.5H11L10 22L19.5 10.5H13L13 2Z"
        fill="#FFFFFF"
        stroke="#FFFFFF"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="5" y="11" width="14" height="10" rx="2" stroke="#0052A4" strokeWidth="2" />
      <path
        d="M8 11V8a4 4 0 0 1 8 0v3"
        stroke="#0052A4"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
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
        <header className="rounded-b-[28px] bg-[#0052A4] px-6 pb-8 pt-6">
          <Link
            href="/"
            className="mb-6 inline-block text-sm font-semibold text-white/80"
          >
            ← 홈으로
          </Link>
          <div className="flex items-center gap-2">
            <BoltIcon />
            <h1 className="text-[28px] font-black tracking-tight text-white">잽싸게</h1>
          </div>
          <p className="mt-3 text-[14px] font-medium text-white/85">
            개인정보 없이 30초면 끝나요
          </p>
        </header>

        <main className="px-6 pb-10 pt-6">
          <div className="mb-6 flex items-center gap-2 rounded-full bg-[#E8F0FE] px-4 py-3">
            <LockIcon />
            <p className="text-[13px] font-semibold text-[#0052A4]">
              이름 · 전화번호 · 이메일은 받지 않습니다
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label
                htmlFor="username"
                className="mb-2 block text-sm font-semibold text-[#1A1A1A]"
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
                className="h-14 w-full rounded-[14px] border-[1.5px] border-[#E8E8E8] bg-white px-4 text-[15px] font-medium text-[#1A1A1A] placeholder:text-[#A0A0A0] focus:border-[#0052A4] focus:outline-none focus:ring-2 focus:ring-[#0052A4]/15"
                placeholder="4~20자 (영문, 숫자, _)"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-2 block text-sm font-semibold text-[#1A1A1A]"
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
                className="h-14 w-full rounded-[14px] border-[1.5px] border-[#E8E8E8] bg-white px-4 text-[15px] font-medium text-[#1A1A1A] placeholder:text-[#A0A0A0] focus:border-[#0052A4] focus:outline-none focus:ring-2 focus:ring-[#0052A4]/15"
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
              className="mt-2 h-14 w-full rounded-2xl bg-[#0052A4] text-[17px] font-bold text-white transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoading ? '가입 중...' : '가입하고 시작하기'}
            </button>
          </form>

          <p className="mt-6 text-center text-sm font-medium text-[#7A7A7A]">
            이미 계정이 있으신가요?{' '}
            <Link href={loginHref} className="font-bold text-[#0052A4] underline">
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
