-- Spot payment approvals (tablet tile "Azhar Arpit Suraj Spot").
--
-- Spot is the on-the-spot counter commission paid to certain regular referees
-- the moment their patient is admitted. Azhar / Arpit / Suraj approve each
-- one on the tablet: the referee's ledger, the patient, what deposit the
-- patient has already paid (pulled from the paid receipts) or an instruction
-- to collect one, and the "maximum spot" — 5,000 by default, raisable to
-- 8,000 and never beyond (enforced here, not just in the UI).
--
-- Run in the Supabase dashboard SQL Editor. Safe to run twice.

BEGIN;

CREATE TABLE IF NOT EXISTS public.spot_payment_approvals (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referee_ledger_id  UUID NOT NULL REFERENCES public.chart_of_accounts(id),
  referee_ledger_name TEXT NOT NULL,
  patient_id         UUID REFERENCES public.patients(id),
  patient_name       TEXT NOT NULL,
  visit_id           TEXT,
  -- What the patient has paid so far (snapshot of receipts at approval time).
  deposit_paid       NUMERIC(15, 2) NOT NULL DEFAULT 0,
  -- Instruction to the counter: collect this much deposit from the patient.
  deposit_to_collect NUMERIC(15, 2) CHECK (deposit_to_collect IS NULL OR deposit_to_collect >= 0),
  max_spot           NUMERIC(15, 2) NOT NULL DEFAULT 5000
                     CHECK (max_spot >= 0 AND max_spot <= 8000),
  approved_by        TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_spot_payment_approvals_created_at
  ON public.spot_payment_approvals (created_at DESC);

ALTER TABLE public.spot_payment_approvals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all operations on spot_payment_approvals" ON public.spot_payment_approvals;
CREATE POLICY "Allow all operations on spot_payment_approvals"
  ON public.spot_payment_approvals FOR ALL USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';

-- Proof: the 8,000 ceiling holds at the database, whatever the UI does.
DO $verify$
BEGIN
  BEGIN
    INSERT INTO public.spot_payment_approvals
      (referee_ledger_id, referee_ledger_name, patient_name, max_spot)
    SELECT id, account_name, '__verify__', 9000
      FROM public.chart_of_accounts LIMIT 1;
    RAISE EXCEPTION 'a 9,000 max_spot was accepted — the ceiling is not enforced';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'OK — max_spot is capped at 8,000 by the database';
  END;
END;
$verify$;

COMMIT;
