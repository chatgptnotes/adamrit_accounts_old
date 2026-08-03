-- Monthly Obligation tab: monthly amount + expense ledger on obligations,
-- and a tracking table so each party gets at most one accrual JV per month.
-- Safe to re-run (idempotent) — paste into the Supabase SQL editor.

ALTER TABLE payment_obligations
  ADD COLUMN IF NOT EXISTS monthly_amount numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expense_account_id uuid REFERENCES chart_of_accounts(id);

COMMENT ON COLUMN payment_obligations.monthly_amount IS 'Monthly obligation figure for the Monthly Obligation tab; independent of default_daily_amount.';
COMMENT ON COLUMN payment_obligations.expense_account_id IS 'Expense ledger debited by the monthly accrual JV (Dr expense / Cr party chart_of_accounts_id).';

CREATE TABLE IF NOT EXISTS monthly_obligation_jvs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obligation_id uuid NOT NULL REFERENCES payment_obligations(id) ON DELETE CASCADE,
  month date NOT NULL,               -- always the first day of the month
  hospital_name text NOT NULL,
  voucher_id uuid REFERENCES vouchers(id),
  amount numeric NOT NULL,
  created_by text,
  created_at timestamptz DEFAULT now(),
  UNIQUE (obligation_id, month)
);

CREATE INDEX IF NOT EXISTS idx_monthly_obligation_jvs_month
  ON monthly_obligation_jvs (hospital_name, month);

ALTER TABLE monthly_obligation_jvs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anonymous access to monthly_obligation_jvs" ON monthly_obligation_jvs;
CREATE POLICY "Allow anonymous access to monthly_obligation_jvs"
  ON monthly_obligation_jvs FOR ALL TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Allow authenticated access to monthly_obligation_jvs" ON monthly_obligation_jvs;
CREATE POLICY "Allow authenticated access to monthly_obligation_jvs"
  ON monthly_obligation_jvs FOR ALL TO authenticated USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
