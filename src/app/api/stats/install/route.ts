import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

const CLIENT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isValidSource(value: unknown): value is 'visit' | 'pwa_install' {
  return value === 'visit' || value === 'pwa_install'
}

/**
 * POST /api/stats/install — 최초 방문·PWA 설치 1회 집계
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      client_id?: string
      source?: unknown
    }

    const clientId = typeof body.client_id === 'string' ? body.client_id.trim() : ''
    const source = isValidSource(body.source) ? body.source : 'visit'

    if (!CLIENT_ID_PATTERN.test(clientId)) {
      return NextResponse.json({ success: false, message: 'invalid client_id' }, { status: 400 })
    }

    const supabase = createSupabaseAdminClient()
    const userAgent = request.headers.get('user-agent')

    const { data: existing, error: selectError } = await supabase
      .from('app_installs')
      .select('id, install_source')
      .eq('client_id', clientId)
      .maybeSingle()

    if (selectError) {
      return NextResponse.json({ success: true, recorded: false })
    }

    if (!existing) {
      const { error: insertError } = await supabase.from('app_installs').insert({
        client_id: clientId,
        install_source: source,
        user_agent: userAgent,
      })

      if (insertError) {
        return NextResponse.json({ success: true, recorded: false })
      }

      return NextResponse.json({ success: true, recorded: true })
    }

    if (source === 'pwa_install' && existing.install_source === 'visit') {
      const { error: updateError } = await supabase
        .from('app_installs')
        .update({
          install_source: 'pwa_install',
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)

      if (updateError) {
        return NextResponse.json({ success: true, recorded: false })
      }
    }

    return NextResponse.json({ success: true, recorded: false })
  } catch {
    return NextResponse.json({ success: true, recorded: false })
  }
}
