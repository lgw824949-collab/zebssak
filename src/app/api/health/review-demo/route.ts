import { NextResponse } from 'next/server'
import { getReviewDemoStatus } from '@/lib/review-demo'

/**
 * GET /api/health/review-demo — 심사용 매칭 데모 모드 상태
 */
export async function GET() {
  try {
    const status = getReviewDemoStatus()
    return NextResponse.json({
      success: true,
      data: {
        ...status,
        hint: status.enabled
          ? '심사 기간: PC에서도 등록·매칭·수락 테스트가 가능합니다.'
          : null,
      },
    })
  } catch {
    return NextResponse.json(
      { success: false, error: '상태를 확인할 수 없습니다.' },
      { status: 500 }
    )
  }
}
