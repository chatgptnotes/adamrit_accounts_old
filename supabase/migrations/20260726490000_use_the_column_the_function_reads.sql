-- Put the expense heads on the column mark_obligation_paid already reads, and
-- drop the one I added by mistake.
--
-- WHAT THE FUNCTION ACTUALLY DOES. Reading its source rather than guessing:
--
--     SELECT chart_of_accounts_id INTO v_expense_account_id
--       FROM payment_obligations WHERE id = v_schedule.obligation_id;
--     IF v_expense_account_id IS NULL THEN
--       SELECT id INTO v_expense_account_id FROM chart_of_accounts
--        WHERE account_name ILIKE '%expense%' OR account_type = 'expense'
--        LIMIT 1;
--     END IF;
--
-- then Dr that account and Cr Cash in Hand for the amount paid, and writes the
-- voucher id back onto daily_payment_schedule.
--
-- So the wiring was never missing. payment_obligations.chart_of_accounts_id is
-- the column it reads, and it has been there all along. I added
-- ledger_account_id an hour ago and mapped the heads onto that, which the
-- function never looks at. Two columns meaning the same thing is worse than
-- none, so the mapping moves across and mine goes.
--
-- THE FALLBACK IS WORTH KNOWING ABOUT. When no head is set, the function takes
-- the FIRST ledger whose name merely contains 'expense', with no ordering. An
-- unmapped obligation therefore does not fail - it posts silently to whatever
-- that happens to be. The eleven still unmapped, about Rs 1,87,000 a day of
-- 'other' and 'vendor', are landing somewhere arbitrary rather than visibly
-- nowhere. That is the argument for choosing their heads sooner rather than
-- later, and TDS Payment is the one to look at first: it is a liability being
-- settled, not an expense at all.

UPDATE public.payment_obligations
   SET chart_of_accounts_id = ledger_account_id,
       updated_at = now()
 WHERE chart_of_accounts_id IS NULL
   AND ledger_account_id IS NOT NULL;

DROP INDEX IF EXISTS public.idx_payment_obligations_ledger;

ALTER TABLE public.payment_obligations
  DROP COLUMN IF EXISTS ledger_account_id;

COMMENT ON COLUMN public.payment_obligations.chart_of_accounts_id IS
  'Expense head this obligation is charged to. Read by mark_obligation_paid, '
  'which debits it and credits Cash in Hand. When NULL that function falls back '
  'to the first ledger whose name contains "expense", so an unmapped obligation '
  'posts somewhere arbitrary rather than failing.';
