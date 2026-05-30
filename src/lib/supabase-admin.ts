import { loadEnvConfig } from '@next/env'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// 로컬 .env.local · Vercel 빌드 시 env 로드
loadEnvConfig(process.cwd())

const MISSING_SERVER_KEY_MESSAGE =
  'Supabase 서버 키를 찾을 수 없습니다. Vercel Environment Variables에 SUPABASE_SECRET_KEY(sb_secret_…)를 넣고 Redeploy 해주세요.'

/**
 * 환경변수 값 정리 (따옴표·공백 제거)
 */
function normalizeEnvValue(raw: string | undefined): string {
  if (!raw) {
    return ''
  }
  return raw.trim().replace(/^['"]|['"]$/g, '')
}

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
    normalizeEnvValue(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) ||
    normalizeEnvValue(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)

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
  if (!key || isClientSideKey(key)) {
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
 * 서버용 Supabase 키 후보 수집 (.env.local 과 동일한 이름 우선)
 */
export function collectSupabaseServerKeyCandidates(): string[] {
  const keys: string[] = []

  const named = [
    normalizeEnvValue(process.env.SUPABASE_SECRET_KEY),
    normalizeEnvValue(process.env.SUPABASE_SERVICE_ROLE_KEY),
    normalizeEnvValue(process.env.SUPABASE_SERVICE_ROLE),
  ]

  for (const value of named) {
    if (value && isServerSideKey(value)) {
      keys.push(value)
    }
  }

  for (const value of Object.values(process.env)) {
    const trimmed = normalizeEnvValue(value)
    if (trimmed.startsWith('sb_secret_') && isServerSideKey(trimmed)) {
      keys.push(trimmed)
    }
  }

  return keys
}

/**
 * .env.local / Vercel Environment Variables 에서 서버용 키 선택
 */
function resolveServiceRoleKey(): string {
  const candidates = collectSupabaseServerKeyCandidates()
  if (candidates[0]) {
    return candidates[0]
  }

  const secretRaw = normalizeEnvValue(process.env.SUPABASE_SECRET_KEY)
  const serviceRaw = normalizeEnvValue(process.env.SUPABASE_SERVICE_ROLE_KEY)

  if (secretRaw && isClientSideKey(secretRaw)) {
    throw new Error(
      'SUPABASE_SECRET_KEY에 publishable(클라이언트) 키가 들어가 있습니다. Supabase API의 Secret(sb_secret_…) 값으로 바꿔주세요.'
    )
  }

  if (serviceRaw && isClientSideKey(serviceRaw)) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY에 publishable(클라이언트) 키가 들어가 있습니다. service_role JWT 또는 sb_secret_ 키를 넣어주세요.'
    )
  }

  throw new Error(MISSING_SERVER_KEY_MESSAGE)
}

/**
 * Vercel/로컬 env 설정 상태 (값은 노출하지 않음)
 */
export function getSupabaseEnvDiagnostics(): {
  hasUrl: boolean
  hasPublishable: boolean
  hasSecretKey: boolean
  hasServiceRoleKey: boolean
  secretLooksValid: boolean
  serviceRoleLooksValid: boolean
  pickedServerKey: boolean
} {
  const secretRaw = normalizeEnvValue(process.env.SUPABASE_SECRET_KEY)
  const serviceRaw = normalizeEnvValue(process.env.SUPABASE_SERVICE_ROLE_KEY)
  const candidates = collectSupabaseServerKeyCandidates()

  return {
    hasUrl: Boolean(normalizeEnvValue(process.env.NEXT_PUBLIC_SUPABASE_URL)),
    hasPublishable: Boolean(
      normalizeEnvValue(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) ||
        normalizeEnvValue(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
    ),
    hasSecretKey: Boolean(secretRaw),
    hasServiceRoleKey: Boolean(serviceRaw),
    secretLooksValid: Boolean(secretRaw && isServerSideKey(secretRaw)),
    serviceRoleLooksValid: Boolean(serviceRaw && isServerSideKey(serviceRaw)),
    pickedServerKey: candidates.length > 0,
  }
}

/**
 * 서버 전용 Supabase 클라이언트 (service role / secret, RLS 우회)
 */
export function createSupabaseAdminClient(): SupabaseClient {
  const url = normalizeEnvValue(process.env.NEXT_PUBLIC_SUPABASE_URL)
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
