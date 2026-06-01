import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const lineCode = searchParams.get('line_code')?.trim()
  const stationName = searchParams.get('station_name')?.trim()
  const direction = searchParams.get('direction')?.trim()
  const dayType = searchParams.get('day_type')?.trim()

  if (!lineCode || !stationName || !direction || !dayType) {
    return NextResponse.json(
      { success: false, error: '필수 파라미터가 없습니다.', rows: [] },
      { status: 400 }
    )
  }

  try {
    const supabase = createSupabaseAdminClient()
    const { data, error } = await supabase
      .from('timetable')
      .select('train_number, arrival_time')
      .eq('line_code', lineCode)
      .eq('station_name', stationName)
      .eq('direction', direction)
      .eq('day_type', dayType)
      .order('arrival_time', { ascending: true })

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message, rows: [] },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, rows: data ?? [] })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'timetable 조회 실패'
    return NextResponse.json({ success: false, error: message, rows: [] }, { status: 500 })
  }
}
