-- match_requests: 플랫폼 대기 / 탑승 중 구분
ALTER TABLE public.match_requests
  ADD COLUMN IF NOT EXISTS presence_mode TEXT NOT NULL DEFAULT 'onboard'
    CHECK (presence_mode IN ('onboard', 'platform_waiting'));

COMMENT ON COLUMN public.match_requests.presence_mode IS 'platform_waiting=플랫폼 대기(매칭 전), onboard=탑승 중(매칭 가능)';

CREATE INDEX IF NOT EXISTS idx_match_requests_presence_waiting
  ON public.match_requests (status, request_type, presence_mode, train_id)
  WHERE status = 'waiting';
