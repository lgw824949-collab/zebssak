import { upgradePlainPasswordHash, verifyPassword } from '@/lib/password'
import { signAccessToken } from '@/lib/jwt'
import {
  checkSuspended,
  errorResponse,
  findUserByUsername,
  getAdminClient,
  normalizeUsername,
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

    const username = normalizeUsername(body.username as string)
    const password = body.password as string

    const supabaseOrResponse = getAdminClient()
    if (supabaseOrResponse instanceof Response) {
      return supabaseOrResponse
    }
    const supabase = supabaseOrResponse

    const { data, error } = await findUserByUsername(supabase, username)

    if (error) {
      return errorResponse(
        '로그인 서버 설정을 확인해주세요. (Supabase service_role 키)',
        500
      )
    }

    if (!data) {
      return errorResponse('아이디 또는 비밀번호가 올바르지 않습니다.', 401)
    }

    const passwordHash = String(data.password_hash ?? '')
    const isValid = await verifyPassword(password, passwordHash)

    if (!isValid) {
      return errorResponse('아이디 또는 비밀번호가 올바르지 않습니다.', 401)
    }

    const userId = String(data.id)
    try {
      await upgradePlainPasswordHash(supabase, userId, password, passwordHash)
    } catch {
      // 해시 갱신 실패해도 로그인은 허용
    }

    const user = toPublicUser(data)
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
    if (
      error instanceof Error &&
      (error.message.includes('SUPABASE_SECRET_KEY') ||
        error.message.includes('sb_secret_') ||
        error.message.includes('anon') ||
        error.message.includes('Legacy API keys are disabled'))
    ) {
      return errorResponse(error.message, 500)
    }
    return errorResponse('서버 오류가 발생했습니다.', 500)
  }
}
