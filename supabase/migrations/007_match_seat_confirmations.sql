-- 매칭 후 착석 희망자의 자리 확인 (상호 신뢰·품질 집계)

CREATE TABLE IF NOT EXISTS public.match_seat_confirmations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES public.matches (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  seated BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT match_seat_confirmations_match_user_unique UNIQUE (match_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_match_seat_confirmations_match_id
  ON public.match_seat_confirmations (match_id);

COMMENT ON TABLE public.match_seat_confirmations IS '매칭 후 착석 여부 확인 (착석 희망자)';
COMMENT ON COLUMN public.match_seat_confirmations.seated IS 'true=앉음, false=자리 없음';
