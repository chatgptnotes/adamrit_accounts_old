-- Referral Register report fields captured per visit:
-- whether the patient was shifted from Ayushman OPD, and the doctor who
-- referred the patient to the marketing executive.

ALTER TABLE public.visits
  ADD COLUMN IF NOT EXISTS shifted_from_ayushman_opd boolean;

ALTER TABLE public.visits
  ADD COLUMN IF NOT EXISTS executive_referral_doctor text;

NOTIFY pgrst, 'reload schema';
