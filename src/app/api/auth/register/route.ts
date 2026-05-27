import { hashPassword } from '@/lib/password'
import { signAccessToken } from '@/lib/jwt'
import {
  checkSuspended,
  errorResponse,
  getAdminClient,
  parseJsonBody,
  successResponse,
  toPublicUser,
  validateCredentials,
} from '../_utils'

interface RegisterBody {
  username?: unknown
  password?: unknown
  nickname?: unknown
  phone?: unknown
  is_vulnerable?: unknown
}

/**
 * Supabase DB 오류를 사용자용 메시지로 변환합니다.
 */
function mapDatabaseError(message: string, code?: string) {
  if (code === '42703' || message.includes('password_hash') || message.includes('username')) {
    return errorResponse(
      'DB 설정이 필요합니다. Supabase SQL Editor에서 custom auth migration을 실행해주세요.',
      500
    )
  }
  if (code === '23505') {
    return errorResponse('이미 사용 중인 아이디입니다.', 409)
  }
  if (process.env.NODE_ENV === 'development') {
    return errorResponse(`회원가입 실패: ${message}`, 500)
  }
  return errorResponse('회원가입에 실패했습니다.', 500)
}

/**
 * POST /api/auth/register — 회원가입 (아이디/비밀번호)
 */
export async function POST(request: Request) {
  try {
    const body = await parseJsonBody<RegisterBody>(request)
    if (body instanceof Response) {
      return body
    }

    const validationError = validateCredentials(body.username, body.password)
    if (validationError) {
      return errorResponse(validationError, 400)
    }

    const username = (body.username as string).trim()
    const password = body.password as string

    const supabaseOrResponse = getAdminClient()
    if (supabaseOrResponse instanceof Response) {
      return supabaseOrResponse
    }
    const supabase = supabaseOrResponse

    const { data: existing, error: lookupError } = await supabase
      .from('users')
      .select('id')
      .eq('username', username)
      .maybeSingle()

    if (lookupError) {
      return mapDatabaseError(lookupError.message, lookupError.code)
    }

    if (existing) {
      return errorResponse('이미 사용 중인 아이디입니다.', 409)
    }

    const passwordHash = await hashPassword(password)

    const insertPayload: Record<string, string | boolean> = {
      username,
      password_hash: passwordHash,
    }

    if (typeof body.nickname === 'string' && body.nickname.trim()) {
      insertPayload.nickname = body.nickname.trim()
    }
    if (typeof body.phone === 'string' && body.phone.trim()) {
      insertPayload.phone = body.phone.trim()
    }
    if (typeof body.is_vulnerable === 'boolean') {
      insertPayload.is_vulnerable = body.is_vulnerable
    }

    const { data, error } = await supabase
      .from('users')
      .insert(insertPayload)
      .select(
        'id, username, nickname, phone, is_vulnerable, no_show_count, suspended_until, total_points, created_at'
      )
      .single()

    if (error) {
      return mapDatabaseError(error.message, error.code)
    }

    if (!data) {
      return errorResponse('회원가입에 실패했습니다.', 500)
    }

    const user = toPublicUser(data as Record<string, unknown>)
    const suspendedMessage = checkSuspended(user)
    if (suspendedMessage) {
      return errorResponse(suspendedMessage, 403)
    }

    const token = signAccessToken({ sub: user.id, username: user.username })

    return successResponse({ user, token }, 201)
  } catch (error) {
    if (error instanceof Error && error.message.includes('JWT_SECRET')) {
      return errorResponse(error.message, 500)
    }
    return errorResponse('서버 오류가 발생했습니다.', 500)
  }
}
