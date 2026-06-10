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
        'id, status, request_type, remaining_stations, car_number, requested_at, destination_station_id, train_id'
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

    let destinationStationName: string | null = null
    if (currentRequest.destination_station_id) {
      const { data: stationRow } = await supabase
        .from('stations')
        .select('station_name')
        .eq('id', currentRequest.destination_station_id as string)
        .maybeSingle()
      destinationStationName =
        typeof stationRow?.station_name === 'string' ? stationRow.station_name : null
    }

    let trainNo: string | null = null
    let lineNumber: number | null = null
    if (currentRequest.train_id) {
      const { data: trainRow } = await supabase
        .from('trains')
        .select('train_no, line_number')
        .eq('id', currentRequest.train_id as string)
        .maybeSingle()
      trainNo = typeof trainRow?.train_no === 'string' ? trainRow.train_no : null
      lineNumber =
        typeof trainRow?.line_number === 'number' ? trainRow.line_number : null
    }

    return NextResponse.json({
      success: true,
      data: {
        id: currentRequest.id,
        status: currentRequest.status,
        request_type: currentRequest.request_type ?? null,
        train_no: trainNo,
        line_number: lineNumber,
        car_number: currentRequest.car_number ?? null,
        destination_station_name: destinationStationName,
        next_station_name: destinationStationName,
        remaining_stations: currentRequest.remaining_stations ?? null,
        waiting_count: waitingCountRaw ?? 0,
      },
    })
  } catch {
    return errorResponse('서버 오류가 발생했습니다.', 500)
  }
}
