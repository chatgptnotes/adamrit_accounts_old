-- Ayushman card ID for PMJAY/MJPJAY patients, captured at registration
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS ayushman_id TEXT;
