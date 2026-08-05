-- Multiple beneficiary accounts per ledger.
--
-- A party ledger keeps its primary bank details on chart_of_accounts; this
-- table holds any number of ADDITIONAL beneficiary accounts (a supplier's
-- second bank, a doctor's family account, etc.), managed on the Tally
-- Ledger Creation / Alteration screen's Banking Details section.
--
-- Run in the Supabase dashboard SQL Editor. Safe to run twice.

BEGIN;

CREATE TABLE IF NOT EXISTS public.ledger_beneficiary_accounts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id      UUID NOT NULL REFERENCES public.chart_of_accounts(id) ON DELETE CASCADE,
  account_holder TEXT,
  bank_name      TEXT,
  account_number TEXT NOT NULL,
  ifsc           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ledger_beneficiary_accounts_ledger
  ON public.ledger_beneficiary_accounts (ledger_id);

ALTER TABLE public.ledger_beneficiary_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all operations on ledger_beneficiary_accounts" ON public.ledger_beneficiary_accounts;
CREATE POLICY "Allow all operations on ledger_beneficiary_accounts"
  ON public.ledger_beneficiary_accounts FOR ALL USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';

DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'ledger_beneficiary_accounts'
  ) THEN
    RAISE EXCEPTION 'ledger_beneficiary_accounts was not created';
  END IF;
  RAISE NOTICE 'OK — a ledger can now carry multiple beneficiary accounts';
END;
$verify$;

COMMIT;
