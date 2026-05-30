import { hashPassword } from '@/lib/password'
import { signAccessToken } from '@/lib/jwt'
import {
  checkSuspended,
  errorResponse,
  getAdminClient,
  normalizeUsername,
  parseJsonBody,
  successResponse,
  toPublicUser,
  validateCredentials,
} from '../_utils'
import type { SupabaseClient } from '@supabase/supabase-js'

interface RegisterBody {
  username?: unknown
  password?: unknown
  nickname?: unknown
  phone?: unknown
  is_vulnerable?: unknown
}

const REGISTER_USER_COLUMNS =
  'id, username, nickname, phone, is_vulnerable, no_show_count, suspended_until, total_points, created_at'

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
  if (code === '23503' || message.includes('auth.users')) {
    return errorResponse(
      '계정 DB 연동 오류입니다. Supabase에서 custom auth migration(002)을 실행해주세요.',
      500
    )
  }
  if (
    message.includes('Legacy API keys are disabled') ||
    message.includes('SUPABASE_SECRET_KEY') ||
    message.includes('sb_secret_') ||
    message.includes('anon')
  ) {
    return errorResponse(message, 500)
  }
  if (process.env.NODE_ENV === 'development') {
    return errorResponse(`회원가입 실패: ${message}`, 500)
  }
  return errorResponse('회원가입에 실패했습니다.', 500)
}

/**
 * auth.users FK가 남아 있는 DB에서 회원가입을 처리합니다.
 */
async function registerWithAuthUser(
  supabase: SupabaseClient,
  username: string,
  password: string,
  passwordHash: string,
  insertPayload: Record<string, string | boolean>
) {
  const email = `${username}@users.zebssak.app`

  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username },
  })

  if (authError || !authData.user) {
    return mapDatabaseError(authError?.message ?? 'auth 사용자 생성 실패', authError?.code)
  }

  const userId = authData.user.id

  const { data: updated, error: updateError } = await supabase
    .from('users')
    .update({
      username,
      password_hash: passwordHash,
      email,
      ...insertPayload,
    })
    .eq('id', userId)
    .select(REGISTER_USER_COLUMNS)
    .maybeSingle()

  if (!updateError && updated) {
    return updated
  }

  const { data: inserted, error: insertError } = await supabase
    .from('users')
    .insert({
      id: userId,
      email,
      username,
      password_hash: passwordHash,
      ...insertPayload,
    })
    .select(REGISTER_USER_COLUMNS)
    .single()

  if (insertError) {
    return mapDatabaseError(insertError.message, insertError.code)
  }

  return inserted
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

    const username = normalizeUsername(body.username as string)
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
      .select(REGISTER_USER_COLUMNS)
      .single()

    let userRow: Record<string, unknown> | null = data as Record<string, unknown> | null

    if (error) {
      if (error.code === '23503' || error.message.includes('auth.users')) {
        const fallback = await registerWithAuthUser(
          supabase,
          username,
          password,
          passwordHash,
          insertPayload
        )
        if (fallback instanceof Response) {
          return fallback
        }
        userRow = fallback as Record<string, unknown>
      } else {
        return mapDatabaseError(error.message, error.code)
      }
    }

    if (!userRow) {
      return errorResponse('회원가입에 실패했습니다.', 500)
    }

    const user = toPublicUser(userRow as Record<string, unknown>)
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
    if (error instanceof Error && error.message.includes('service_role')) {
      return errorResponse(error.message, 500)
    }
    return errorResponse('서버 오류가 발생했습니다.', 500)
  }
}
