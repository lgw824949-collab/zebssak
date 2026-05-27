-- =============================================================================
-- 잽싸게 (Zeb-ssak) — Supabase 초기 스키마
-- README.md DB 테이블: users, stations, trains, match_requests, matches,
--   points, notifications, congestion_logs, penalties, cancellations
-- UUID: gen_random_uuid() (Supabase 기본)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- users — 앱 사용자 프로필 (auth.users 연동)
-- ---------------------------------------------------------------------------
CREATE TABLE public.users (
  id UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  email TEXT,
  nickname TEXT,
  phone TEXT,
  is_vulnerable BOOLEAN NOT NULL DEFAULT FALSE, -- 교통약자 (매칭 우선순위 1순위)
  no_show_count INTEGER NOT NULL DEFAULT 0 CHECK (no_show_count >= 0),
  suspended_until TIMESTAMPTZ, -- 노쇼 3회 시 7일 정지 종료 시각
  total_points INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.users IS '앱 사용자 프로필';
COMMENT ON COLUMN public.users.is_vulnerable IS '교통약자 여부 (매칭 우선순위 최상위)';
COMMENT ON COLUMN public.users.suspended_until IS '이용 정지 해제 시각 (노쇼 3회 누적 시 7일)';

-- ---------------------------------------------------------------------------
-- stations — 역 정보 (인천 1·2호선)
-- ---------------------------------------------------------------------------
CREATE TABLE public.stations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_code TEXT NOT NULL UNIQUE,
  station_name TEXT NOT NULL,
  line_number SMALLINT NOT NULL CHECK (line_number IN (1, 2)),
  station_order INTEGER NOT NULL, -- 호선 내 순서 (남은 역 수 계산용)
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.stations IS '지하철 역 정보';

-- ---------------------------------------------------------------------------
-- trains — 열차 정보
-- ---------------------------------------------------------------------------
CREATE TABLE public.trains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  train_no TEXT NOT NULL,
  line_number SMALLINT NOT NULL CHECK (line_number IN (1, 2)),
  direction TEXT,
  current_station_id UUID REFERENCES public.stations (id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.trains IS '열차 실시간 정보';

-- ---------------------------------------------------------------------------
-- match_requests — 착석 희망 / 하차 예정 요청
-- ---------------------------------------------------------------------------
CREATE TABLE public.match_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  train_id UUID REFERENCES public.trains (id) ON DELETE SET NULL,
  request_type TEXT NOT NULL CHECK (request_type IN ('seat_seek', 'leaving')),
  origin_station_id UUID NOT NULL REFERENCES public.stations (id),
  destination_station_id UUID NOT NULL REFERENCES public.stations (id), -- 목적지 필수
  remaining_stations INTEGER NOT NULL CHECK (remaining_stations >= 3), -- 최소 3역 이상
  status TEXT NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'matching', 'matched', 'cancelled', 'expired')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), -- 매칭 우선순위 3순위 (요청 시각)
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.match_requests IS '착석 희망·하차 예정 매칭 요청';
COMMENT ON COLUMN public.match_requests.destination_station_id IS '목적지 역 (미입력 불가)';
COMMENT ON COLUMN public.match_requests.remaining_stations IS '목적지까지 남은 역 수 (3역 미만 참여 불가)';
COMMENT ON COLUMN public.match_requests.requested_at IS '매칭 우선순위: 요청 시각 (오래된 순)';

-- ---------------------------------------------------------------------------
-- matches — 매칭 결과
-- ---------------------------------------------------------------------------
CREATE TABLE public.matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seat_seek_request_id UUID NOT NULL REFERENCES public.match_requests (id),
  leaving_request_id UUID NOT NULL REFERENCES public.match_requests (id),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'completed', 'expired', 'cancelled')),
  notify_expires_at TIMESTAMPTZ NOT NULL, -- 수락 마감 (요청 후 30초)
  accepted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT matches_different_requests CHECK (seat_seek_request_id <> leaving_request_id)
);

COMMENT ON TABLE public.matches IS '착석 희망 ↔ 하차 예정 매칭';
COMMENT ON COLUMN public.matches.notify_expires_at IS '매칭 알림 수락 마감 시각 (30초)';

-- ---------------------------------------------------------------------------
-- points — 포인트 적립·차감 내역
-- ---------------------------------------------------------------------------
CREATE TABLE public.points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  reason TEXT NOT NULL,
  match_id UUID REFERENCES public.matches (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.points IS '포인트 거래 내역';

-- ---------------------------------------------------------------------------
-- notifications — 알림 (매칭 알림 등)
-- ---------------------------------------------------------------------------
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  match_id UUID REFERENCES public.matches (id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL
    CHECK (notification_type IN ('match_offer', 'match_accepted', 'match_expired', 'penalty', 'system')),
  title TEXT NOT NULL,
  body TEXT,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.notifications IS '사용자 알림';

-- ---------------------------------------------------------------------------
-- congestion_logs — 혼잡도 기록 (7 이상 시 기능 정지)
-- ---------------------------------------------------------------------------
CREATE TABLE public.congestion_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_number SMALLINT NOT NULL CHECK (line_number IN (1, 2)),
  train_id UUID REFERENCES public.trains (id) ON DELETE SET NULL,
  station_id UUID REFERENCES public.stations (id) ON DELETE SET NULL,
  congestion_level SMALLINT NOT NULL CHECK (congestion_level BETWEEN 1 AND 10),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.congestion_logs IS '혼잡도 로그';
COMMENT ON COLUMN public.congestion_logs.congestion_level IS '혼잡도 7 이상 시 서비스 기능 전면 정지';

-- ---------------------------------------------------------------------------
-- penalties — 패널티 (노쇼 등)
-- ---------------------------------------------------------------------------
CREATE TABLE public.penalties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  penalty_type TEXT NOT NULL DEFAULT 'no_show'
    CHECK (penalty_type IN ('no_show', 'suspension', 'other')),
  no_show_count INTEGER NOT NULL CHECK (no_show_count >= 0),
  suspended_until TIMESTAMPTZ, -- 3회 누적 시 NOW() + 7일
  reason TEXT,
  match_id UUID REFERENCES public.matches (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.penalties IS '노쇼·이용 정지 패널티';
COMMENT ON COLUMN public.penalties.suspended_until IS '노쇼 3회 누적 시 7일 이용 정지 종료 시각';

-- ---------------------------------------------------------------------------
-- cancellations — 매칭·요청 취소 기록
-- ---------------------------------------------------------------------------
CREATE TABLE public.cancellations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  match_request_id UUID REFERENCES public.match_requests (id) ON DELETE SET NULL,
  match_id UUID REFERENCES public.matches (id) ON DELETE SET NULL,
  cancel_reason TEXT,
  cancelled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cancellations_has_target CHECK (
    match_request_id IS NOT NULL OR match_id IS NOT NULL
  )
);

COMMENT ON TABLE public.cancellations IS '매칭·요청 취소 이력';

-- =============================================================================
-- 인덱스 (매칭·조회 성능)
-- =============================================================================
CREATE INDEX idx_users_suspended_until ON public.users (suspended_until)
  WHERE suspended_until IS NOT NULL;

CREATE INDEX idx_users_is_vulnerable ON public.users (is_vulnerable)
  WHERE is_vulnerable = TRUE;

CREATE INDEX idx_stations_line_order ON public.stations (line_number, station_order);

CREATE INDEX idx_match_requests_waiting ON public.match_requests (status, request_type, remaining_stations, requested_at)
  WHERE status = 'waiting';

CREATE INDEX idx_match_requests_user ON public.match_requests (user_id, created_at DESC);

CREATE INDEX idx_matches_status ON public.matches (status, notify_expires_at);

CREATE INDEX idx_notifications_user_unread ON public.notifications (user_id, created_at DESC)
  WHERE is_read = FALSE;

CREATE INDEX idx_congestion_logs_line_recorded ON public.congestion_logs (line_number, recorded_at DESC);

CREATE INDEX idx_congestion_logs_halt ON public.congestion_logs (line_number, congestion_level, recorded_at DESC)
  WHERE congestion_level >= 7;

CREATE INDEX idx_penalties_user ON public.penalties (user_id, created_at DESC);

CREATE INDEX idx_points_user ON public.points (user_id, created_at DESC);

-- =============================================================================
-- 트리거·함수
-- =============================================================================

-- users.updated_at 자동 갱신
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- auth 가입 시 public.users 프로필 자동 생성
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email)
  VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- 혼잡도 7 이상 여부 (기능 정지 판단용)
CREATE OR REPLACE FUNCTION public.is_congestion_halted(p_line_number SMALLINT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.congestion_logs
    WHERE line_number = p_line_number
      AND congestion_level >= 7
      AND recorded_at > NOW() - INTERVAL '10 minutes'
  );
$$;

COMMENT ON FUNCTION public.is_congestion_halted IS '혼잡도 7 이상 시 true — 기능 전면 정지 판단';

-- 이용 정지 중 여부
CREATE OR REPLACE FUNCTION public.is_user_suspended(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = p_user_id
      AND suspended_until IS NOT NULL
      AND suspended_until > NOW()
  );
$$;

-- =============================================================================
-- Row Level Security (RLS)
-- =============================================================================
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.points ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.congestion_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.penalties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cancellations ENABLE ROW LEVEL SECURITY;

-- users: 본인 프로필만 읽기·수정
CREATE POLICY users_select_own ON public.users
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY users_update_own ON public.users
  FOR UPDATE USING (auth.uid() = id);

-- stations, trains: 인증 사용자 읽기 전용
CREATE POLICY stations_select_authenticated ON public.stations
  FOR SELECT TO authenticated USING (TRUE);

CREATE POLICY trains_select_authenticated ON public.trains
  FOR SELECT TO authenticated USING (TRUE);

-- match_requests: 본인 요청만 CRUD
CREATE POLICY match_requests_select_own ON public.match_requests
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY match_requests_insert_own ON public.match_requests
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY match_requests_update_own ON public.match_requests
  FOR UPDATE USING (auth.uid() = user_id);

-- matches: 관련 요청 당사자만 조회
CREATE POLICY matches_select_participant ON public.matches
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.match_requests mr
      WHERE mr.id IN (seat_seek_request_id, leaving_request_id)
        AND mr.user_id = auth.uid()
    )
  );

-- points, notifications, penalties, cancellations: 본인만
CREATE POLICY points_select_own ON public.points
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY notifications_select_own ON public.notifications
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY notifications_update_own ON public.notifications
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY penalties_select_own ON public.penalties
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY cancellations_select_own ON public.cancellations
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY cancellations_insert_own ON public.cancellations
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- congestion_logs: 인증 사용자 읽기
CREATE POLICY congestion_logs_select_authenticated ON public.congestion_logs
  FOR SELECT TO authenticated USING (TRUE);

-- Realtime 구독 대상 (매칭·알림)
ALTER PUBLICATION supabase_realtime ADD TABLE public.match_requests;
ALTER PUBLICATION supabase_realtime ADD TABLE public.matches;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
