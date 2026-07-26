-- Set the expense head on each obligation, on the column that is actually read.
--
-- Two migrations ago I mapped the heads onto payment_obligations.ledger_account_id,
-- a column I had added. One migration ago I found mark_obligation_paid reads
-- chart_of_accounts_id instead, copied across, and dropped mine. But the first
-- of those was never run, so the copy moved nothing and the drop removed an
-- empty column. Net effect: all 26 obligations are still unmapped.
--
-- This does the mapping once, directly onto chart_of_accounts_id. It supersedes
-- 20260726470000 and 20260726480000 entirely; neither needs to be run.
--
--   salary, rmo   ->  5210 Staff Salary
--   rent          ->  5220 Rent
--   electricity   ->  5230 Electricity
--   dialysis      ->  5240 Dialysis Charges     created here if missing
--   consultant    ->  5250 Consultancy Fees     created here if missing
--
-- WHAT UNMAPPED COSTS TODAY. mark_obligation_paid falls back to the first
-- ledger whose name contains 'expense', which resolves to 5000 EXPENSES. So
-- every payment - rent, salary, dialysis, TDS - has been landing in one generic
-- account rather than failing. Deterministic, but useless for a P&L.
--
-- other and vendor stay unmapped deliberately. 'other' holds TDS Payment,
-- NMC Property tax, Repairs and Spot and Backing, which are four different
-- things; TDS is a liability being settled and does not belong in the P&L at
-- all. Those need choosing one at a time, and until then they keep landing in
-- 5000 EXPENSES, which is at least visible in one place.

INSERT INTO public.chart_of_accounts
  (account_code, account_name, account_type, account_group,
   opening_balance, opening_balance_type, is_active)
VALUES
  ('5240', 'Dialysis Charges', 'INDIRECT_EXPENSES', 'Indirect Expenses', 0, 'DR', true),
  ('5250', 'Consultancy Fees', 'INDIRECT_EXPENSES', 'Indirect Expenses', 0, 'DR', true)
ON CONFLICT (account_code) DO NOTHING;

UPDATE public.payment_obligations o
   SET chart_of_accounts_id = a.id,
       updated_at = now()
  FROM (VALUES
         ('salary',      '5210'),
         ('rmo',         '5210'),
         ('rent',        '5220'),
         ('electricity', '5230'),
         ('dialysis',    '5240'),
         ('consultant',  '5250')
       ) AS v(sub_category, code)
  JOIN public.chart_of_accounts a ON a.account_code = v.code AND a.is_active
 WHERE o.chart_of_accounts_id IS NULL
   AND lower(btrim(COALESCE(o.sub_category, ''))) = v.sub_category;
