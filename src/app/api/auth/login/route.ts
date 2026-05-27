import { verifyPassword } from '@/lib/password'
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

interface LoginBody {
  username?: unknown
  password?: unknown
}

/**
 * POST /api/auth/login — 로그인 (아이디/비밀번호)
 */
export async function POST(request: Request) {
  try {
    const body = await parseJsonBody<LoginBody>(request)
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

    const { data, error } = await supabase
      .from('users')
      .select(
        'id, username, password_hash, nickname, phone, is_vulnerable, no_show_count, suspended_until, total_points, created_at'
      )
      .eq('username', username)
      .maybeSingle()

    if (error || !data) {
      return errorResponse('아이디 또는 비밀번호가 올바르지 않습니다.', 401)
    }

    const passwordHash = String(data.password_hash ?? '')
    const isValid = await verifyPassword(password, passwordHash)

    if (!isValid) {
      return errorResponse('아이디 또는 비밀번호가 올바르지 않습니다.', 401)
    }

    const user = toPublicUser(data as Record<string, unknown>)
    const suspendedMessage = checkSuspended(user)
    if (suspendedMessage) {
      return errorResponse(suspendedMessage, 403)
    }

    const token = signAccessToken({ sub: user.id, username: user.username })

    return successResponse({ user, token })
  } catch (error) {
    if (error instanceof Error && error.message.includes('JWT_SECRET')) {
      return errorResponse(error.message, 500)
    }
    return errorResponse('서버 오류가 발생했습니다.', 500)
  }
}
