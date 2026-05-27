import { NextResponse } from 'next/server'
import { getUserIdFromRequest } from '@/lib/api-auth'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

function errorResponse(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status })
}

/**
 * GET /api/match-requests/current
 * 현재 로그인 유저의 활성(waiting/matched) 요청 1건
 */
export async function GET(request: Request) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return errorResponse('로그인이 필요합니다.', 401)
    }

    const supabase = createSupabaseAdminClient()

    const { data: currentRequest, error: currentError } = await supabase
      .from('match_requests')
      .select(
        `
        id,
        status,
        request_type,
        remaining_stations,
        car_number,
        requested_at,
        train:trains!train_id(train_no, line_number),
        destination_station:stations!destination_station_id(station_name)
      `
      )
      .eq('user_id', userId)
      .in('status', ['waiting', 'matched'])
      .order('requested_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (currentError) {
      return errorResponse('현재 매칭 요청을 불러올 수 없습니다.', 500)
    }

    const { count: waitingCountRaw, error: waitingCountError } = await supabase
      .from('match_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'waiting')
      .eq('request_type', 'seat_seek')

    if (waitingCountError) {
      return errorResponse('대기 인원 정보를 불러올 수 없습니다.', 500)
    }

    if (!currentRequest) {
      return NextResponse.json({
        success: true,
        data: {
          waiting_count: waitingCountRaw ?? 0,
        },
      })
    }

    const trainObj = (Array.isArray(currentRequest.train)
      ? currentRequest.train[0]
      : currentRequest.train) as
      | { train_no?: string; line_number?: number }
      | null

    const destinationObj = (Array.isArray(currentRequest.destination_station)
      ? currentRequest.destination_station[0]
      : currentRequest.destination_station) as
      | { station_name?: string }
      | null

    return NextResponse.json({
      success: true,
      data: {
        id: currentRequest.id,
        status: currentRequest.status,
        train_no: trainObj?.train_no ?? null,
        line_number: trainObj?.line_number ?? null,
        car_number: currentRequest.car_number ?? null,
        destination_station_name: destinationObj?.station_name ?? null,
        next_station_name: destinationObj?.station_name ?? null,
        remaining_stations: currentRequest.remaining_stations ?? null,
        waiting_count: waitingCountRaw ?? 0,
      },
    })
  } catch {
    return errorResponse('서버 오류가 발생했습니다.', 500)
  }
}
