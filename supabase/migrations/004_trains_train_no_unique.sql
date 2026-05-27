-- 동일 train_no 중복 행 방지 (매칭 시 train_id 불일치 원인)
CREATE UNIQUE INDEX IF NOT EXISTS idx_trains_train_no_unique ON public.trains (train_no);
