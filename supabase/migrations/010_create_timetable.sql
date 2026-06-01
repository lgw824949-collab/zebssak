-- 열차 시각표 (역별 도착 시각)

CREATE TABLE IF NOT EXISTS public.timetable (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_code TEXT NOT NULL,
  train_number TEXT NOT NULL,
  day_type TEXT NOT NULL DEFAULT 'weekday',
  direction TEXT NOT NULL,
  station_name TEXT NOT NULL,
  arrival_time TIME,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_timetable_line_station
  ON public.timetable (line_code, station_name, direction, day_type);

COMMENT ON TABLE public.timetable IS '열차 시각표 (역별 도착 시각)';
COMMENT ON COLUMN public.timetable.line_code IS '노선 코드 (예: l1, s1, s2)';
COMMENT ON COLUMN public.timetable.day_type IS '운행 요일 구분 (예: weekday, weekend, holiday)';
COMMENT ON COLUMN public.timetable.direction IS '운행 방향 (예: up, down, inner, outer)';
