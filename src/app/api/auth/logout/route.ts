import { verifyAccessToken } from '@/lib/jwt'
import {
  errorResponse,
  extractBearerToken,
  parseJsonBody,
} from '../_utils'

interface LogoutBody {
  token?: unknown
}

/**
 * POST /api/auth/logout — 로그아웃 (JWT 무효화는 클라이언트에서 토큰 삭제)
 */
export async function POST(request: Request) {
  try {
    const body = await parseJsonBody<LogoutBody>(request)
    if (body instanceof Response) {
      return body
    }

    const token = extractBearerToken(request, body)
    if (!token) {
      return errorResponse('인증 토큰이 필요합니다.', 401)
    }

    try {
      verifyAccessToken(token)
    } catch {
      return errorResponse('유효하지 않은 토큰입니다.', 401)
    }

    return Response.json({ success: true, message: '로그아웃되었습니다.' })
  } catch (error) {
    if (error instanceof Error && error.message.includes('JWT_SECRET')) {
      return errorResponse(error.message, 500)
    }
    return errorResponse('서버 오류가 발생했습니다.', 500)
  }
}
