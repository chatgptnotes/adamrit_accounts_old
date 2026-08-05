-- Keep the package fee master compatible with existing rows while recording
-- the exact surgery name used by Yojana records.
ALTER TABLE public.surgery_fee_master
  ADD COLUMN IF NOT EXISTS yojana_surgery_name TEXT;

NOTIFY pgrst, 'reload schema';
