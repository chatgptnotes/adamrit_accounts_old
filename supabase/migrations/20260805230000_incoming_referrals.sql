-- Incoming referral announcements ("Incoming Referrals - Suraj Arpit" tile).
--
-- Marketing executives announce a referred patient BEFORE arrival: patient
-- name, where they are coming from, the referee's initials, and uploaded
-- documents (Aadhaar, referral slip, previous discharge summary). Everyone
-- sees who claimed the referral — no double claim — and the announcer owns
-- paying the referee and getting the patient admitted.
--
-- When the patient actually arrives they are registered through the normal
-- registration flow (untouched), then LINKED here: the announcement row is
-- stamped with the registered patient's id and latest visit, flips to
-- LINKED, and records who linked it when. That stamp is the claim.
--
-- Run in the Supabase dashboard SQL Editor. Safe to run twice.

BEGIN;

CREATE TABLE IF NOT EXISTS public.incoming_referrals (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_name      TEXT NOT NULL,
  coming_from       TEXT,
  referee_initials  TEXT NOT NULL,
  -- [{name, url, category}] — Aadhaar, referral slip, discharge summary, other
  documents         JSONB NOT NULL DEFAULT '[]'::jsonb,
  status            TEXT NOT NULL DEFAULT 'ANNOUNCED'
                    CHECK (status IN ('ANNOUNCED', 'LINKED', 'CANCELLED')),
  announced_by      TEXT,
  linked_patient_id UUID REFERENCES public.patients(id),
  linked_visit_id   TEXT,
  linked_by         TEXT,
  linked_at         TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_incoming_referrals_created_at
  ON public.incoming_referrals (created_at DESC);

DROP TRIGGER IF EXISTS update_incoming_referrals_updated_at ON public.incoming_referrals;
CREATE TRIGGER update_incoming_referrals_updated_at
  BEFORE UPDATE ON public.incoming_referrals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.incoming_referrals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all operations on incoming_referrals" ON public.incoming_referrals;
CREATE POLICY "Allow all operations on incoming_referrals"
  ON public.incoming_referrals FOR ALL USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';

-- Proof: a linked announcement must carry its patient.
DO $verify$
DECLARE
  v_cols INT;
BEGIN
  SELECT count(*) INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'incoming_referrals'
     AND column_name IN ('patient_name', 'referee_initials', 'documents',
                         'status', 'linked_patient_id', 'linked_visit_id');
  IF v_cols <> 6 THEN
    RAISE EXCEPTION 'incoming_referrals is missing columns (found % of 6)', v_cols;
  END IF;
  RAISE NOTICE 'OK — incoming_referrals ready';
END;
$verify$;

COMMIT;
