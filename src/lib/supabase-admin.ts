import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const MISSING_SERVER_KEY_MESSAGE =
  'Supabase 서버 키를 찾을 수 없습니다. Vercel에 SUPABASE_SECRET_KEY(sb_secret_…) 또는 service_role JWT를 설정한 뒤 Redeploy 해주세요.'

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
 * 클라이언트용(publishable/anon) 키인지 판별합니다.
 */
function isClientSideKey(key: string): boolean {
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()

  if (key.startsWith('sb_publishable_')) {
    return true
  }
  if (publishableKey && key === publishableKey) {
    return true
  }
  if (key.startsWith('eyJ') && decodeJwtRole(key) === 'anon') {
    return true
  }
  return false
}

/**
 * 서버(RLS 우회)용 Supabase 키인지 판별합니다.
 */
function isServerSideKey(key: string): boolean {
  if (isClientSideKey(key)) {
    return false
  }
  if (key.startsWith('sb_secret_')) {
    return true
  }
  if (key.startsWith('eyJ')) {
    const role = decodeJwtRole(key)
    return role === 'service_role' || role === null
  }
  return key.length > 20
}

/**
 * .env.local / Vercel에 넣은 여러 이름 중 서버용 키를 골라 씁니다.
 * SUPABASE_SECRET_KEY에 publishable이 잘못 들어가도 SERVICE_ROLE JWT를 이어서 시도합니다.
 */
function resolveServiceRoleKey(): string {
  const namedCandidates = [
    process.env.SUPABASE_SECRET_KEY,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.SUPABASE_SERVICE_ROLE,
  ]

  for (const raw of namedCandidates) {
    const key = raw?.trim()
    if (key && isServerSideKey(key)) {
      return key
    }
  }

  // Vercel에 다른 이름으로 넣은 sb_secret_* 도 허용
  for (const value of Object.values(process.env)) {
    const key = value?.trim()
    if (key?.startsWith('sb_secret_') && isServerSideKey(key)) {
      return key
    }
  }

  const hasSecretSlot = Boolean(process.env.SUPABASE_SECRET_KEY?.trim())
  const hasServiceSlot = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim())
  const secretLooksClient =
    hasSecretSlot && isClientSideKey(process.env.SUPABASE_SECRET_KEY!.trim())

  if (secretLooksClient && hasServiceSlot) {
    throw new Error(
      'SUPABASE_SECRET_KEY에 publishable(클라이언트) 키가 들어가 있습니다. 같은 값을 넣지 말고 Supabase Secret(sb_secret_…) 또는 service_role JWT를 넣어주세요.'
    )
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
