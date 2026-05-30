import { NextResponse } from 'next/server'
import { getSupabaseEnvDiagnostics } from '@/lib/supabase-admin'

export const runtime = 'nodejs'

/**
 * GET /api/health/supabase-env — Vercel env 주입 여부 확인 (값 미노출)
 */
export async function GET() {
  const diagnostics = getSupabaseEnvDiagnostics()

  return NextResponse.json({
    success: true,
    environment: process.env.VERCEL_ENV ?? 'local',
    diagnostics,
    hint: diagnostics.pickedServerKey
      ? '서버 키 인식됨. 로그인을 다시 시도하세요.'
      : 'Vercel → Settings → Environment Variables 에 SUPABASE_SECRET_KEY(sb_secret_…) 추가 후 Redeploy 필요.',
  })
}
