import { NextResponse } from 'next/server'
import { getUserIdFromRequest } from '@/lib/api-auth'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

interface SubscribeBody {
  subscription?: {
    endpoint?: string
    keys?: {
      p256dh?: string
      auth?: string
    }
  }
}

function errorResponse(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status })
}

/**
 * POST /api/push/subscribe — Web Push 구독 정보 저장
 */
export async function POST(request: Request) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return errorResponse('로그인이 필요합니다.', 401)
    }

    let body: SubscribeBody
    try {
      body = (await request.json()) as SubscribeBody
    } catch {
      return errorResponse('요청 본문이 올바른 JSON이 아닙니다.', 400)
    }

    const endpoint = body.subscription?.endpoint?.trim()
    const p256dh = body.subscription?.keys?.p256dh?.trim()
    const authKey = body.subscription?.keys?.auth?.trim()

    if (!endpoint || !p256dh || !authKey) {
      return errorResponse('유효한 push subscription이 필요합니다.', 400)
    }

    const supabase = createSupabaseAdminClient()
    const now = new Date().toISOString()

    const { error } = await supabase.from('push_subscriptions').upsert(
      {
        user_id: userId,
        endpoint,
        p256dh,
        auth_key: authKey,
        updated_at: now,
      },
      { onConflict: 'user_id,endpoint' }
    )

    if (error) {
      if (error.message.includes('push_subscriptions')) {
        return errorResponse(
          'push_subscriptions 테이블이 없습니다. migration 011을 실행해주세요.',
          500
        )
      }
      return errorResponse('구독 정보 저장에 실패했습니다.', 500)
    }

    return NextResponse.json({ success: true })
  } catch {
    return errorResponse('서버 오류가 발생했습니다.', 500)
  }
}
