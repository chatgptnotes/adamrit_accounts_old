-- Patient-level government portal Registration ID.
-- This is intentionally separate from visits.thumb_registration_no.
ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS registration_id TEXT;

COMMENT ON COLUMN public.patients.registration_id IS
  'Patient-level government portal Registration ID, separate from visit thumb registration number.';

CREATE INDEX IF NOT EXISTS idx_patients_registration_id
  ON public.patients (registration_id);
