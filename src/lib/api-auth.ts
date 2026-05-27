import { verifyAccessToken } from '@/lib/jwt'

/**
 * Authorization 헤더에서 Bearer 토큰을 추출합니다.
 */
export function getBearerToken(request: Request): string | null {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return null
  }
  return authHeader.slice(7).trim()
}

/**
 * 요청 JWT에서 사용자 ID를 반환합니다.
 */
export function getUserIdFromRequest(request: Request): string | null {
  const token = getBearerToken(request)
  if (!token) {
    return null
  }

  try {
    const payload = verifyAccessToken(token)
    return payload.sub
  } catch {
    return null
  }
}
