'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

interface StoredUser {
  username?: string
  nickname?: string | null
  is_vulnerable?: boolean
}

interface VulnerableOptions {
  elderly: boolean
  pregnant: boolean
  disabled: boolean
}

/**
 * 프로필 설정 화면
 */
export default function ProfilePage() {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [vulnerable, setVulnerable] = useState<VulnerableOptions>({
    elderly: false,
    pregnant: false,
    disabled: false,
  })
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

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
      setUsername(user.username ?? '')

      if (user.is_vulnerable) {
        setVulnerable({ elderly: true, pregnant: false, disabled: false })
      }
    } catch {
      router.replace('/login')
    }
  }, [router])

  function handleVulnerableChange(key: keyof VulnerableOptions, checked: boolean) {
    setVulnerable((prev) => ({ ...prev, [key]: checked }))
    setMessage('')
    setError('')
  }

  function handlePasswordChange() {
    setMessage('비밀번호 변경 기능은 준비 중입니다.')
    setError('')
  }

  function handleSave() {
    setError('')
    setMessage('')

    try {
      const raw = localStorage.getItem('user')
      const user = raw ? (JSON.parse(raw) as StoredUser) : {}
      const isVulnerable =
        vulnerable.elderly || vulnerable.pregnant || vulnerable.disabled

      const updated = {
        ...user,
        is_vulnerable: isVulnerable,
      }

      localStorage.setItem('user', JSON.stringify(updated))
      setMessage('프로필이 저장되었습니다.')
    } catch {
      setError('저장에 실패했습니다.')
    }
  }

  async function handleLogout() {
    const token = localStorage.getItem('token')

    try {
      if (token) {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        })
      }
    } catch {
      // 로컬 로그아웃은 토큰 삭제로 처리
    } finally {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      sessionStorage.removeItem('boardingDraft')
      sessionStorage.removeItem('providerRegistered')
      router.replace('/login')
    }
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
          <h1 className="text-lg font-bold text-slate-900">프로필 설정</h1>
          <span className="w-8" aria-hidden />
        </div>
      </header>

      <main className="flex-1 max-w-md mx-auto w-full px-4 py-6 space-y-6 pb-8">
        <section className="rounded-xl bg-white border border-slate-200 p-5">
          <label className="block text-sm font-medium text-slate-500 mb-1">
            아이디
          </label>
          <p className="text-lg font-semibold text-slate-900">{username || '—'}</p>
        </section>

        <section className="rounded-xl bg-white border border-slate-200 p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">계정</h2>
          <button
            type="button"
            onClick={handlePasswordChange}
            className="w-full rounded-lg border border-slate-300 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            비밀번호 변경
          </button>
        </section>

        <section className="rounded-xl bg-white border border-slate-200 p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-1">
            교통약자 등록
          </h2>
          <p className="text-xs text-slate-500 mb-4">
            해당 항목을 선택하면 매칭 우선순위가 적용됩니다.
          </p>
          <div className="space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={vulnerable.elderly}
                onChange={(e) => handleVulnerableChange('elderly', e.target.checked)}
                className="w-5 h-5 rounded border-slate-300 text-blue-700 focus:ring-blue-600"
              />
              <span className="text-sm text-slate-800">고령자</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={vulnerable.pregnant}
                onChange={(e) =>
                  handleVulnerableChange('pregnant', e.target.checked)
                }
                className="w-5 h-5 rounded border-slate-300 text-blue-700 focus:ring-blue-600"
              />
              <span className="text-sm text-slate-800">임산부</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={vulnerable.disabled}
                onChange={(e) =>
                  handleVulnerableChange('disabled', e.target.checked)
                }
                className="w-5 h-5 rounded border-slate-300 text-blue-700 focus:ring-blue-600"
              />
              <span className="text-sm text-slate-800">장애인</span>
            </label>
          </div>
        </section>

        {message && (
          <p className="text-sm text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">
            {message}
          </p>
        )}
        {error && (
          <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={handleSave}
          className="w-full rounded-xl bg-blue-700 py-4 text-base font-semibold text-white hover:bg-blue-800 transition-colors"
        >
          저장
        </button>

        <button
          type="button"
          onClick={handleLogout}
          className="w-full rounded-xl border border-red-200 bg-white py-4 text-base font-semibold text-red-600 hover:bg-red-50 transition-colors"
        >
          로그아웃
        </button>
      </main>
    </div>
  )
}
