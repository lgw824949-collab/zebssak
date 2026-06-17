import { NextResponse } from 'next/server'
import { getUserIdFromRequest } from '@/lib/api-auth'
import {
  extractLinePrefixFromStationCode,
  stationCodeFromJoin,
  validateOnboardBoardingContext,
} from '@/lib/match-boarding-validation'
import {
  calculateQueuePosition,
  extractApiTrainNoFromStored,
  tryCreateMatch,
} from '@/lib/match-create'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

function errorResponse(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status })
}

/**
 * PATCH /api/match-requests/[id]/onboard
 * 플랫폼 대기 → 탑승 중 전환 후 매칭 시도
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return errorResponse('로그인이 필요합니다.', 401)
    }

    const { id: requestId } = await context.params
    const trimmedId = requestId?.trim()
    if (!trimmedId) {
      return errorResponse('요청 ID가 필요합니다.', 400)
    }

    const supabase = createSupabaseAdminClient()

    const { data: matchRequest, error: fetchError } = await supabase
      .from('match_requests')
      .select(`
        id,
        user_id,
        status,
        request_type,
        presence_mode,
        direction,
        car_number,
        train_id,
        trains(train_no),
        origin_station:stations!origin_station_id(station_code),
        destination_station:stations!destination_station_id(station_code)
      `)
      .eq('id', trimmedId)
      .eq('user_id', userId)
      .maybeSingle()

    if (fetchError || !matchRequest) {
      return errorResponse('매칭 요청을 찾을 수 없습니다.', 404)
    }

    if (String(matchRequest.status) !== 'waiting') {
      return errorResponse('대기 중인 요청만 탑승 전환이 가능합니다.', 409)
    }

    if (String(matchRequest.presence_mode) === 'onboard') {
      return errorResponse('이미 탑승 중 상태입니다.', 409)
    }

    if (String(matchRequest.request_type) !== 'seat_seek') {
      return errorResponse('빈자리 찾기 요청만 플랫폼에서 탑승 전환이 가능합니다.', 409)
    }

    const originCode = stationCodeFromJoin(
      matchRequest.origin_station as
        | { station_code?: string }
        | { station_code?: string }[]
        | null
    )
    const destinationCode = stationCodeFromJoin(
      matchRequest.destination_station as
        | { station_code?: string }
        | { station_code?: string }[]
        | null
    )
    const linePrefix =
      extractLinePrefixFromStationCode(destinationCode) ??
      extractLinePrefixFromStationCode(originCode)

    if (!linePrefix) {
      return errorResponse('호선 정보를 확인할 수 없습니다.', 400)
    }

    const trainJoin = matchRequest.trains as { train_no?: string } | { train_no?: string }[] | null
    const storedTrainNo = Array.isArray(trainJoin)
      ? trainJoin[0]?.train_no?.trim() ?? ''
      : trainJoin?.train_no?.trim() ?? ''

    if (!storedTrainNo) {
      return errorResponse('열차 정보를 확인할 수 없습니다.', 400)
    }

    const apiTrainNo = extractApiTrainNoFromStored(storedTrainNo)
    const direction = String(matchRequest.direction ?? '')
    const carNumber =
      typeof matchRequest.car_number === 'number' ? matchRequest.car_number : 1
    const trainUuid = String(matchRequest.train_id ?? '')

    const onboardCheck = await validateOnboardBoardingContext(request, supabase, {
      linePrefix,
      trainNo: apiTrainNo,
      direction,
      originStationCode: originCode,
      destinationStationCode: destinationCode,
    })

    if (!onboardCheck.ok) {
      return errorResponse(onboardCheck.message, 409)
    }

    const { error: updateError } = await supabase
      .from('match_requests')
      .update({ presence_mode: 'onboard' })
      .eq('id', trimmedId)
      .eq('status', 'waiting')
      .eq('presence_mode', 'platform_waiting')

    if (updateError) {
      if (updateError.message?.includes('presence_mode')) {
        return errorResponse(
          'DB에 presence_mode 컬럼이 없습니다. migration 014를 실행해주세요.',
          500
        )
      }
      return errorResponse('탑승 전환에 실패했습니다.', 500)
    }

    const matchId = await tryCreateMatch(
      request,
      supabase,
      trimmedId,
      'seat_seek',
      trainUuid,
      apiTrainNo,
      carNumber,
      linePrefix,
      direction
    )

    const queuePosition = matchId
      ? 1
      : await calculateQueuePosition(supabase, 'seat_seek', trimmedId, 'onboard')

    return NextResponse.json({
      success: true,
      data: {
        match_request_id: trimmedId,
        presence_mode: 'onboard',
        queue_position: queuePosition,
        match_id: matchId,
        matched: Boolean(matchId),
      },
    })
  } catch {
    return errorResponse('서버 오류가 발생했습니다.', 500)
  }
}
