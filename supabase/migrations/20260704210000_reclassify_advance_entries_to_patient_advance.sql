-- Reclassify historical auto-receipt entries for ADVANCE payments:
-- move the credit side from the generic 4000 INCOME header account to
-- 2110 Patient Advance (liability), matching the fixed trigger behaviour.
--
-- Scope: credit entries on vouchers whose narration starts with 'Advance'
-- (covers all three historical trigger variants: 'Advance cash payment
-- received…', 'Advance payment received via…', 'Advance payment…').
-- Debit sides (cash/bank) and final-bill/OPD/pharmacy receipts are untouched.

WITH advance_entries AS (
  SELECT ve.id
  FROM public.voucher_entries ve
  JOIN public.vouchers v ON v.id = ve.voucher_id
  WHERE ve.account_id = (
          SELECT id FROM public.chart_of_accounts
          WHERE account_code = '4000' AND account_name = 'INCOME'
        )
    AND ve.credit_amount > 0
    AND v.narration ILIKE 'Advance%'
),
moved AS (
  UPDATE public.voucher_entries ve
  SET account_id = (
        SELECT id FROM public.chart_of_accounts
        WHERE account_code = '2110' AND account_name = 'Patient Advance'
      )
  WHERE ve.id IN (SELECT id FROM advance_entries)
  RETURNING ve.credit_amount
)
SELECT count(*) AS entries_moved, sum(credit_amount) AS amount_moved
FROM moved;
