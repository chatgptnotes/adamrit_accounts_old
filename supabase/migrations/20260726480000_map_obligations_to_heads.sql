-- Map each recurring obligation to the expense head it belongs on.
--
-- The first attempt set nothing. It required exactly one ledger to match a
-- name, and 'salary' matches both 5210 Staff Salary and a Tally-imported Staff
-- Welfare, so it skipped rather than chose. Refusing to guess between two
-- candidates was right; requiring uniqueness to act was not, because your own
-- chart already has the obvious head in every case.
--
-- So the head is named rather than searched for. 5210, 5220, 5230 and 5290 are
-- Adamrit's own seeded expense accounts and are shared across companies, which
-- keeps both legs of a payment in the same company - the thing that put three
-- companies out of balance earlier today.
--
--   salary, rmo   ->  5210 Staff Salary
--   rent          ->  5220 Rent
--   electricity   ->  5230 Electricity
--   dialysis      ->  5240 Dialysis Charges     created here if missing
--   consultant    ->  5250 Consultancy Fees     created here if missing
--
-- WHAT IS DELIBERATELY LEFT UNMAPPED. 'other' and 'vendor', eleven obligations
-- worth about Rs 1,87,000 a day. 'other' is not one thing: it holds TDS
-- Payment, NMC Property tax, Repairs and Spot and Backing. TDS is a liability
-- being settled, not an expense at all, so charging the lot to Other Expenses
-- would put a tax payment in the P&L. Those need choosing one by one.
--
-- Dialysis is NephroPlus running your dialysis centre, and consultant covers
-- surgeon and doctor fees. Both had only a Tally-imported, company-owned ledger
-- to point at, so a shared head is created instead - a company-owned one on a
-- payment made by another company is what caused today's imbalance.
--
-- THIS STILL POSTS NOTHING. mark_obligation_paid creates a voucher but does not
-- read ledger_account_id. Wiring that is the next step and needs its body,
-- which was written outside the migrations.

INSERT INTO public.chart_of_accounts
  (account_code, account_name, account_type, account_group,
   opening_balance, opening_balance_type, is_active)
VALUES
  ('5240', 'Dialysis Charges',  'INDIRECT_EXPENSES', 'Indirect Expenses', 0, 'DR', true),
  ('5250', 'Consultancy Fees',  'INDIRECT_EXPENSES', 'Indirect Expenses', 0, 'DR', true)
ON CONFLICT (account_code) DO NOTHING;

UPDATE public.payment_obligations o
   SET ledger_account_id = a.id,
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
 WHERE o.ledger_account_id IS NULL
   AND lower(btrim(COALESCE(o.sub_category, ''))) = v.sub_category;
