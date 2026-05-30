'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FormEvent, useState } from 'react'
import InstallShortcut, { useInstallShortcutVisible } from '@/components/InstallShortcut'

interface AuthApiResponse {
  success: boolean
  error?: string
  data?: {
    token: string
    user: Record<string, unknown>
  }
}

/**
 * 로그인 페이지 — 아이디/비밀번호만 입력
 */
export default function LoginPage() {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const { visible: showInstallShortcut, hide: hideInstallShortcut } = useInstallShortcutVisible()

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
      router.replace('/')
    } catch {
      setError('네트워크 오류가 발생했습니다. 잠시 후 다시 시도해주세요.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-[100vh] bg-[#F7F8FA]">
      <div className="mx-auto flex min-h-[100vh] w-full max-w-[480px] flex-col bg-[#F7F8FA]">
        <header className="min-h-[280px] rounded-b-[36px] bg-[#0B1F4B] px-8 pb-12 pt-[80px]">
          <h1 className="text-[48px] font-black tracking-tight text-[#C6FF00]">
            ⚡ 잽싸게
          </h1>
          <div className="mt-4 h-1 w-10 rounded-full bg-[#C6FF00]" />
          <p className="mt-5 text-[15px] font-semibold text-white/85">
            지하철 빈자리 실시간 매칭
          </p>
          <p className="mt-2 text-[14px] font-medium text-white/65">
            눈치 보지 말고 잽싸게 앉으세요
          </p>
        </header>

        <main className="px-6 pb-0 pt-[32px]">
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

            {error && (
              <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-600">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="mt-2 h-14 w-full rounded-2xl bg-[#0B1F4B] text-[18px] font-bold text-white transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoading ? '로그인 중...' : '로그인'}
            </button>
          </form>

          {showInstallShortcut ? (
            <div className="mt-6">
              <InstallShortcut compact onDismiss={hideInstallShortcut} />
            </div>
          ) : null}

          <p className="mt-7 text-center text-sm font-medium text-[#7A7A7A]">
            계정이 없으신가요?{' '}
            <Link href="/register" className="font-bold text-[#0B1F4B] underline">
              회원가입
            </Link>
          </p>
        </main>
      </div>
    </div>
  )
}
