-- TPA / private-insurance claim tracker. One row per claim, tied to the visit
-- (and through it the patient and corporate). Tracks the lifecycle from
-- pre-auth to settlement with the amounts at each stage, so the money the
-- books say is receivable has a claim-status story behind it.

CREATE TABLE IF NOT EXISTS public.tpa_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id UUID REFERENCES public.visits(id),
  corporate_name TEXT,                  -- TPA / insurer, as on patients.corporate
  patient_name TEXT,                    -- denormalised for list speed
  visit_code TEXT,                      -- printed visit id, for the claim file
  claim_no TEXT,
  policy_no TEXT,
  status TEXT NOT NULL DEFAULT 'PREAUTH_PENDING'
    CHECK (status IN ('PREAUTH_PENDING','PREAUTH_APPROVED','CLAIM_SUBMITTED',
                      'QUERY_RAISED','APPROVED','SETTLED','DENIED')),
  preauth_amount NUMERIC(12,2),
  claimed_amount NUMERIC(12,2),
  approved_amount NUMERIC(12,2),
  received_amount NUMERIC(12,2),
  preauth_date DATE,
  submission_date DATE,
  settlement_date DATE,
  next_followup_date DATE,
  remarks TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tpa_claims_status_idx ON public.tpa_claims (status) WHERE is_active;
CREATE INDEX IF NOT EXISTS tpa_claims_followup_idx ON public.tpa_claims (next_followup_date) WHERE is_active;

ALTER TABLE public.tpa_claims ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tpa_claims') THEN
    CREATE POLICY tpa_claims_all ON public.tpa_claims FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
