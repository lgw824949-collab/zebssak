import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

interface AlightingSeatRow {
  car_number: number | null
  seat_side: string | null
  seat_number: number | null
}

interface CarCountRow {
  car_number: number
  count: number
}

function errorResponse(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status })
}

/**
 * GET /api/match-requests/alighting
 * 열차별 대기 중 하차 예정(leaving) 좌석·칸 집계 (좌석 맵 표시용)
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const trainNo = searchParams.get('train_no')?.trim() ?? ''
    const lineNumberRaw = searchParams.get('line_number')?.trim() ?? ''
    const direction = searchParams.get('direction')?.trim() ?? ''
    const carNumberRaw = searchParams.get('car_number')?.trim() ?? ''

    const lineNumber = Number(lineNumberRaw)
    if (!trainNo) {
      return errorResponse('train_no는 필수입니다.', 400)
    }
    if (!Number.isInteger(lineNumber) || (lineNumber !== 1 && lineNumber !== 2)) {
      return errorResponse('line_number는 1 또는 2여야 합니다.', 400)
    }

    const carNumber =
      carNumberRaw !== '' ? Number(carNumberRaw) : null
    if (carNumberRaw !== '' && (!Number.isInteger(carNumber) || (carNumber as number) < 1)) {
      return errorResponse('car_number가 올바르지 않습니다.', 400)
    }

    const supabase = createSupabaseAdminClient()

    const { data: trainRows, error: trainError } = await supabase
      .from('trains')
      .select('id')
      .eq('train_no', trainNo)
      .eq('line_number', lineNumber)
      .order('created_at', { ascending: true })
      .limit(1)

    if (trainError) {
      return errorResponse('열차 정보를 조회할 수 없습니다.', 500)
    }

    const trainId = trainRows?.[0]?.id as string | undefined
    if (!trainId) {
      return NextResponse.json({
        success: true,
        data: { seats: [], car_counts: [] },
      })
    }

    let query = supabase
      .from('match_requests')
      .select('car_number, seat_side, seat_number')
      .eq('train_id', trainId)
      .eq('request_type', 'leaving')
      .eq('status', 'waiting')

    if (direction) {
      query = query.eq('direction', direction)
    }

    const { data: rows, error: requestError } = await query

    if (requestError) {
      return errorResponse('하차 예정 목록을 조회할 수 없습니다.', 500)
    }

    const allRows = (rows ?? []) as AlightingSeatRow[]
    const filtered =
      carNumber != null
        ? allRows.filter((row) => row.car_number === carNumber)
        : allRows

    const seats = filtered
      .filter(
        (row) =>
          row.seat_side === 'A' || row.seat_side === 'B'
      )
      .filter(
        (row) =>
          typeof row.seat_number === 'number' &&
          Number.isInteger(row.seat_number) &&
          (row.seat_number as number) >= 1
      )
      .map((row) => ({
        car_number: row.car_number,
        seat_side: row.seat_side as 'A' | 'B',
        seat_number: row.seat_number as number,
      }))

    const carCountMap = new Map<number, number>()
    for (const row of filtered) {
      const car = row.car_number
      if (typeof car !== 'number' || !Number.isInteger(car) || car < 1) continue
      carCountMap.set(car, (carCountMap.get(car) ?? 0) + 1)
    }

    const car_counts: CarCountRow[] = Array.from(carCountMap.entries())
      .map(([car_number, count]) => ({ car_number, count }))
      .sort((a, b) => a.car_number - b.car_number)

    return NextResponse.json({
      success: true,
      data: { seats, car_counts },
    })
  } catch {
    return errorResponse('서버 오류가 발생했습니다.', 500)
  }
}
