-- match_requests에 칸 번호 컬럼 추가
ALTER TABLE public.match_requests
  ADD COLUMN IF NOT EXISTS car_number SMALLINT CHECK (car_number >= 1);

COMMENT ON COLUMN public.match_requests.car_number IS '탑승 칸 번호';
