import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import type { PostgrestError } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'

const LOGIN_USER_COLUMNS =
  'id, username, password_hash, nickname, phone, is_vulnerable, no_show_count, suspended_until, total_points, created_at'

export interface PublicUser {
  id: string
  username: string
  nickname: string | null
  phone: string | null
  is_vulnerable: boolean
  no_show_count: number
  suspended_until: string | null
  total_points: number
  created_at: string
}

export interface AuthSuccessPayload {
  user: PublicUser
  token: string
}

/**
 * JSON 요청 본문을 파싱합니다.
 */
export async function parseJsonBody<T extends object>(
  request: Request
): Promise<T | NextResponse> {
  try {
    const body = (await request.json()) as T
    return body
  } catch {
    return errorResponse('요청 본문이 올바른 JSON이 아닙니다.', 400)
  }
}

/**
 * API 에러 응답을 반환합니다.
 */
export function errorResponse(message: string, status: number): NextResponse {
  return NextResponse.json({ success: false, error: message }, { status })
}

/**
 * API 성공 응답을 반환합니다.
 */
export function successResponse(
  data: AuthSuccessPayload,
  status = 200
): NextResponse {
  return NextResponse.json({ success: true, data }, { status })
}

/**
 * 아이디·비밀번호 필수값을 검증합니다.
 */
/**
 * 로그인·회원가입용 아이디를 정규화합니다 (모바일 대소문자 오입력 방지).
 */
export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase()
}

/**
 * 아이디로 사용자 행을 조회합니다 (소문자 우선, 레거시 대소문자 혼용 호환).
 */
export async function findUserByUsername(
  supabase: SupabaseClient,
  usernameInput: string
): Promise<{
  data: Record<string, unknown> | null
  error: PostgrestError | null
}> {
  const trimmed = usernameInput.trim()
  const lowered = normalizeUsername(trimmed)

  const lookup = async (name: string) =>
    supabase
      .from('users')
      .select(LOGIN_USER_COLUMNS)
      .eq('username', name)
      .maybeSingle()

  let result = await lookup(lowered)
  if (result.error) {
    return { data: null, error: result.error }
  }
  if (result.data) {
    return { data: result.data as Record<string, unknown>, error: null }
  }

  if (trimmed !== lowered) {
    result = await lookup(trimmed)
    if (result.error) {
      return { data: null, error: result.error }
    }
    if (result.data) {
      return { data: result.data as Record<string, unknown>, error: null }
    }
  }

  return { data: null, error: null }
}

export function validateCredentials(
  username: unknown,
  password: unknown
): string | null {
  if (typeof username !== 'string' || !username.trim()) {
    return '아이디를 입력해주세요.'
  }
  const trimmedUsername = normalizeUsername(username)
  if (trimmedUsername.length < 4 || trimmedUsername.length > 20) {
    return '아이디는 4~20자여야 합니다.'
  }
  if (!/^[a-z0-9_]+$/.test(trimmedUsername)) {
    return '아이디는 영문, 숫자, 밑줄(_)만 사용할 수 있습니다.'
  }
  if (typeof password !== 'string' || password.length < 6) {
    return '비밀번호는 6자 이상이어야 합니다.'
  }
  return null
}

/**
 * Supabase Admin 클라이언트를 생성합니다.
 */
export function getAdminClient(): SupabaseClient | NextResponse {
  try {
    return createSupabaseAdminClient()
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '서버 설정 오류가 발생했습니다.'
    return errorResponse(message, 500)
  }
}

/**
 * DB 행을 공개용 사용자 객체로 변환합니다.
 */
export function toPublicUser(row: Record<string, unknown>): PublicUser {
  return {
    id: String(row.id),
    username: String(row.username),
    nickname: row.nickname != null ? String(row.nickname) : null,
    phone: row.phone != null ? String(row.phone) : null,
    is_vulnerable: Boolean(row.is_vulnerable),
    no_show_count: Number(row.no_show_count ?? 0),
    suspended_until:
      row.suspended_until != null ? String(row.suspended_until) : null,
    total_points: Number(row.total_points ?? 0),
    created_at: String(row.created_at),
  }
}

/**
 * 이용 정지 여부를 확인합니다.
 */
export function checkSuspended(user: PublicUser): string | null {
  if (user.suspended_until && new Date(user.suspended_until) > new Date()) {
    return '노쇼 누적으로 이용이 정지된 계정입니다.'
  }
  return null
}

/**
 * Authorization 헤더 또는 본문에서 JWT를 추출합니다.
 */
export function extractBearerToken(
  request: Request,
  body: { token?: unknown }
): string | null {
  const authHeader = request.headers.get('Authorization')
  const headerToken = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : null

  const bodyToken = typeof body.token === 'string' ? body.token.trim() : null

  return headerToken ?? bodyToken
}
