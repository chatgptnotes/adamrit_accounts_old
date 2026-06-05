-- Add the `status` column the dispense + medication-round workflow depends on.
--
-- visit_medications.status was defined in earlier migrations but never applied
-- to production (the live schema drifted). Without it:
--   * Pharmacy Dispense fails — its update sets status='dispensed' → PGRST204
--     "Could not find the 'status' column".
--   * The Medication Round is always empty — it filters status='dispensed',
--     which therefore never matches.
--
-- Additive and safe: existing rows get the default 'prescribed' (i.e. active,
-- not yet dispensed), which is exactly how the dispense queue treats them.

ALTER TABLE public.visit_medications
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'prescribed';

-- PostgREST caches the schema; refresh so the new column is usable immediately.
NOTIFY pgrst, 'reload schema';
