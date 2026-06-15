-- 매칭 후 착석 희망자 이동 상태 (이동 시작 / 도착)

CREATE TABLE IF NOT EXISTS public.match_movement_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES public.matches (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'idle'
    CHECK (status IN ('idle', 'moving', 'arrived')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT match_movement_status_match_user_unique UNIQUE (match_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_match_movement_status_match_id
  ON public.match_movement_status (match_id);

COMMENT ON TABLE public.match_movement_status IS '매칭 후 착석 희망자 이동 상태';
COMMENT ON COLUMN public.match_movement_status.status IS 'idle=대기, moving=이동중, arrived=도착';

ALTER PUBLICATION supabase_realtime ADD TABLE public.match_movement_status;
