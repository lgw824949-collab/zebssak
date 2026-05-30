import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * 서버 API용 Supabase service_role 키를 선택합니다.
 * sb_secret가 잘못 설정된 Vercel 환경에서 publishable/anon 키가 쓰이면
 * RLS 때문에 users 조회가 비어 로그인이 항상 실패합니다.
 */
function resolveServiceRoleKey(): string {
  const serviceRoleJwt = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim()
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()

  // 신규 secret 키 우선 (레거시 JWT 비활성화 프로젝트 호환)
  if (secretKey?.startsWith('sb_secret_')) {
    return secretKey
  }

  if (secretKey) {
    return secretKey
  }

  if (serviceRoleJwt?.startsWith('eyJ')) {
    assertJwtServiceRole(serviceRoleJwt)
    return serviceRoleJwt
  }

  if (serviceRoleJwt) {
    if (
      serviceRoleJwt.startsWith('sb_publishable_') ||
      (publishableKey && serviceRoleJwt === publishableKey)
    ) {
      throw new Error(
        'SUPABASE_SERVICE_ROLE_KEY에 클라이언트용(publishable/anon) 키가 들어가 있습니다. Supabase 대시보드의 service_role JWT를 넣어주세요.'
      )
    }
    return serviceRoleJwt
  }

  throw new Error(
    'Supabase 서버 환경변수(SUPABASE_SERVICE_ROLE_KEY 또는 SUPABASE_SECRET_KEY)가 없습니다.'
  )
}

/**
 * JWT payload의 role이 service_role인지 검사합니다.
 */
function assertJwtServiceRole(jwt: string): void {
  try {
    const segment = jwt.split('.')[1]
    if (!segment) return
    const payload = JSON.parse(
      Buffer.from(segment.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
        'utf8'
      )
    ) as { role?: string }
    if (payload.role && payload.role !== 'service_role') {
      throw new Error(
        `Supabase 키 role이 "${payload.role}"입니다. service_role JWT를 SUPABASE_SERVICE_ROLE_KEY에 설정해주세요.`
      )
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('service_role')) {
      throw error
    }
    // payload 파싱 실패 시 키 문자열 형식만으로 진행
  }
}

/**
 * 서버 전용 Supabase 클라이언트 (service role, RLS 우회)
 */
export function createSupabaseAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const serviceRoleKey = resolveServiceRoleKey()

  if (!url) {
    throw new Error(
      'Supabase 서버 환경변수(NEXT_PUBLIC_SUPABASE_URL)가 없습니다. .env.local을 확인하세요.'
    )
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
