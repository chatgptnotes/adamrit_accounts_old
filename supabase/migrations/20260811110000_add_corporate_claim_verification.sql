-- Phase 2 verification facts.  This migration is additive and touches only the
-- isolated corporate claim tracking table; existing HMIS tables remain read-only.
ALTER TABLE public.corporate_claims
  ADD COLUMN IF NOT EXISTS verification_state TEXT NOT NULL DEFAULT 'not_checked'
    CHECK (verification_state IN ('not_checked','matched','unmatched','ambiguous','conflict','invalid')),
  ADD COLUMN IF NOT EXISTS admission_status TEXT NOT NULL DEFAULT 'not_checked'
    CHECK (admission_status IN ('not_checked','active_ipd','discharged','not_ipd','no_visit','not_matched','ambiguous','conflict')),
  ADD COLUMN IF NOT EXISTS verification_evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_corporate_claims_verification
  ON public.corporate_claims(hospital_name, scheme_code, verification_state, admission_status);
