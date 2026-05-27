import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * .env.local의 Supabase 공개 키를 읽고 유효성을 검사합니다.
 */
function getSupabaseConfig(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()

  if (!url || !anonKey) {
    throw new Error(
      'Supabase 환경변수(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY)가 없습니다. .env.local을 확인하세요.'
    )
  }

  return { url, anonKey }
}

/**
 * Supabase 클라이언트를 생성합니다.
 * 브라우저·서버(API Route)에서 공용으로 사용합니다.
 */
export function createSupabaseClient(): SupabaseClient {
  const { url, anonKey } = getSupabaseConfig()
  return createClient(url, anonKey)
}

let supabaseInstance: SupabaseClient | null = null

/**
 * 싱글톤 Supabase 클라이언트를 반환합니다.
 */
export function getSupabase(): SupabaseClient {
  if (!supabaseInstance) {
    supabaseInstance = createSupabaseClient()
  }
  return supabaseInstance
}
