-- PWA·웹 앱 방문/설치 집계 (홈 누적 이용자 수 표시용)

CREATE TABLE IF NOT EXISTS public.app_installs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL UNIQUE,
  install_source TEXT NOT NULL DEFAULT 'visit'
    CHECK (install_source IN ('visit', 'pwa_install')),
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_installs_created_at
  ON public.app_installs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_installs_source
  ON public.app_installs (install_source);

COMMENT ON TABLE public.app_installs IS '앱 최초 방문·PWA 설치 집계 (client_id 기준 1회)';
COMMENT ON COLUMN public.app_installs.client_id IS '브라우저 localStorage UUID';
COMMENT ON COLUMN public.app_installs.install_source IS 'visit=최초 방문, pwa_install=바탕화면 추가';
