import { clearMatchClientSession } from '@/lib/match-session'

/**
 * API 401 응답 시 로그인 화면으로 이동합니다.
 */
export function clearAuthAndRedirectToLogin(): void {
  if (typeof window === 'undefined') {
    return
  }
  try {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    clearMatchClientSession()
  } catch {
    // storage 접근 실패 시에도 로그인으로 유도
  }
  window.location.href = '/login'
}

/**
 * fetch 응답이 401이면 세션을 비우고 로그인으로 보냅니다.
 */
export function handleUnauthorizedResponse(response: Response): boolean {
  if (response.status !== 401) {
    return false
  }
  clearAuthAndRedirectToLogin()
  return true
}
