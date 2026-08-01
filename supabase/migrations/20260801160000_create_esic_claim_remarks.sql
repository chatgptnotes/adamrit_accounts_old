-- Storage for the ESIC scrutiny worklist behind the Remark tab.
--
-- The ESIC portal hands back an Excel sheet of claims that a scrutinizer has
-- looked at. Some of those rows carry an "L2 Remark" — a query from ESIC asking
-- for a missing referral letter, a doctor's stamp, a justification for a long
-- stay. Somebody here has to answer each one, and today that answer lives in a
-- WhatsApp message or a person's head. This table gives the reply a home next
-- to the query it answers.
--
-- WHY THE JUSTIFICATION IS A COLUMN AND NOT A SEPARATE TABLE
-- One remark gets one reply. Threading would be honest only if ESIC replied
-- back into the same sheet, and it doesn't — a fresh export just restates the
-- remark. So the reply is a field on the claim, and the import is careful never
-- to write it.
--
-- RE-IMPORTING IS SAFE
-- The sheet is exported repeatedly and re-imported over the top. The unique key
-- below is what makes that an update instead of a pile of duplicates, and the
-- import deliberately omits justification from its payload so that a reply
-- typed last week survives this week's file.
--
-- Safe to run twice.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.esic_claim_remarks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Tenant scope. Every query filters on this; without it the Hope and Ayushman
  -- worklists would be one shared pile.
  hospital_name    TEXT NOT NULL,

  -- The portal's claim number. Stable across exports, which is why it — and not
  -- the patient's name — is what a re-import matches on.
  claim_id         TEXT NOT NULL,

  -- Straight off the sheet. Only patient_name and l2_remark are shown in the
  -- tab; the rest are kept so a claim can be traced back to the portal without
  -- reopening the spreadsheet.
  hospital         TEXT,
  card_id          TEXT,
  uhid             TEXT,
  beneficiary_name TEXT,
  patient_name     TEXT,
  admission_type   TEXT,
  process_stage    TEXT,
  approved_amount  NUMERIC,
  l2_remark        TEXT,

  -- The reply. Typed here, never written by the import.
  justification    TEXT,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The conflict target for the import's upsert. Claim IDs are unique per
-- hospital rather than globally, so the same claim arriving under two tenants
-- stays two rows.
CREATE UNIQUE INDEX IF NOT EXISTS esic_claim_remarks_hospital_claim_key
  ON public.esic_claim_remarks (hospital_name, claim_id);

-- The tab lists open queries newest-first within a hospital.
CREATE INDEX IF NOT EXISTS esic_claim_remarks_hospital_idx
  ON public.esic_claim_remarks (hospital_name, created_at DESC);

COMMENT ON COLUMN public.esic_claim_remarks.l2_remark IS
'The ESIC scrutinizer query, verbatim from the portal export. Overwritten on re-import.';
COMMENT ON COLUMN public.esic_claim_remarks.justification IS
'Our reply to the remark. Written only by a user in the Remark tab, never by the Excel import.';

ALTER TABLE public.esic_claim_remarks ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY esic_claim_remarks_all ON public.esic_claim_remarks
    FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

NOTIFY pgrst, 'reload schema';
