import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const MISSING_SERVER_KEY_MESSAGE =
  'Supabase 서버 키가 없습니다. Vercel에 SUPABASE_SECRET_KEY(sb_secret_…)를 추가한 뒤 Redeploy 해주세요.'

const ANON_KEY_MESSAGE =
  'Supabase 서버 키가 클라이언트용(anon)으로 설정되어 있습니다. Vercel → Settings → Environment Variables에서 SUPABASE_SECRET_KEY에 Supabase 대시보드 API의 Secret key(sb_secret_…)만 넣고, SUPABASE_SERVICE_ROLE_KEY의 publishable/anon 값은 삭제한 뒤 Redeploy 해주세요.'

/**
 * JWT payload에서 role 클레임을 읽습니다.
 */
function decodeJwtRole(jwt: string): string | null {
  try {
    const segment = jwt.split('.')[1]
    if (!segment) {
      return null
    }
    const payload = JSON.parse(
      Buffer.from(segment.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
        'utf8'
      )
    ) as { role?: string }
    return payload.role ?? null
  } catch {
    return null
  }
}

/**
 * publishable/anon 키가 서버 변수에 들어갔는지 검사합니다.
 */
function assertNotClientKey(key: string, envName: string): void {
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()

  if (
    key.startsWith('sb_publishable_') ||
    (publishableKey && key === publishableKey)
  ) {
    throw new Error(ANON_KEY_MESSAGE)
  }

  if (key.startsWith('eyJ') && decodeJwtRole(key) === 'anon') {
    throw new Error(ANON_KEY_MESSAGE)
  }

  if (key.startsWith('eyJ')) {
    const role = decodeJwtRole(key)
    if (role && role !== 'service_role') {
      throw new Error(
        `Supabase 키 role이 "${role}"입니다. ${envName}에는 Secret key(sb_secret_…)만 사용해주세요.`
      )
    }
  }
}

/**
 * 서버 API용 Supabase 키를 선택합니다 (RLS 우회용).
 */
function resolveServiceRoleKey(): string {
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim()
  const serviceRoleJwt = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()

  if (secretKey) {
    assertNotClientKey(secretKey, 'SUPABASE_SECRET_KEY')
    if (secretKey.startsWith('sb_secret_')) {
      return secretKey
    }
    return secretKey
  }

  if (serviceRoleJwt) {
    assertNotClientKey(serviceRoleJwt, 'SUPABASE_SERVICE_ROLE_KEY')
    if (serviceRoleJwt.startsWith('eyJ')) {
      return serviceRoleJwt
    }
    return serviceRoleJwt
  }

  throw new Error(MISSING_SERVER_KEY_MESSAGE)
}

/**
 * 서버 전용 Supabase 클라이언트 (service role / secret, RLS 우회)
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
