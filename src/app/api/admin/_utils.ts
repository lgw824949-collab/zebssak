import { NextResponse } from 'next/server'

/**
 * 어드민 API 공통 에러 응답
 */
export function adminErrorResponse(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status })
}

/**
 * x-admin-key 헤더로 어드민 요청 검증 (.env.local ADMIN_SECRET)
 */
export function verifyAdminRequest(request: Request): boolean {
  const secret = process.env.ADMIN_SECRET?.trim()
  if (!secret) {
    return true
  }

  const key = request.headers.get('x-admin-key')?.trim()
  return key === secret
}

/**
 * 어드민 권한 없으면 401 반환, 있으면 null
 */
export function requireAdmin(request: Request) {
  if (!verifyAdminRequest(request)) {
    return adminErrorResponse('어드민 인증이 필요합니다.', 401)
  }
  return null
}
