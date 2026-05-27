-- users 테이블: Supabase Auth 없이 아이디/비밀번호 직접 인증
-- 기존 schema.sql 적용 후 실행

-- auth.users 연동 제거
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_id_fkey;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- 아이디·비밀번호 컬럼 추가
ALTER TABLE public.users
  ALTER COLUMN id SET DEFAULT gen_random_uuid();

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS username TEXT,
  ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- 기존 email 기반 데이터가 없다면 NOT NULL 적용
ALTER TABLE public.users
  ALTER COLUMN username SET NOT NULL,
  ALTER COLUMN password_hash SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON public.users (username);

COMMENT ON COLUMN public.users.username IS '로그인 아이디 (이메일 미사용)';
COMMENT ON COLUMN public.users.password_hash IS 'bcrypt 해시 비밀번호';
