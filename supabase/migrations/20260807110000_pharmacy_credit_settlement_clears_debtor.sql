-- Pharmacy credit settlements clear the debtor instead of crediting income again.
--
-- 20260807100000 made the invoice JV the place income is recognised. A credit
-- settlement (pharmacy_credit_payments) still ran through the older trigger
-- create_voucher_for_pharmacy_credit_payment(), which posts Dr Cash/Bank and
-- Cr income — so income was counted a second time when the patient paid, and
-- Pharmacy Debtors never came down.
--
-- Retire that trigger (the new one from the previous migration already posts
-- Dr Cash/Bank, Cr Pharmacy Debtors) and restate the 4 vouchers it produced.
-- The function itself is left in place, unused, so nothing else that may
-- reference it breaks.
--
-- Applied through apply_migration(): one transaction, rolls back on any
-- failure. Idempotent, and it verifies itself before committing.

-- ---------------------------------------------------------------------------
-- STEP 1 — one rail only
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trigger_pharmacy_credit_payment_voucher ON public.pharmacy_credit_payments;

-- ---------------------------------------------------------------------------
-- STEP 2 — restate what the old trigger already posted
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_row RECORD;
  v_cancelled INTEGER := 0;
  v_reposted INTEGER := 0;
  v_value NUMERIC := 0;
  v_result JSONB;
BEGIN
  FOR v_row IN
    SELECT v.id AS voucher_id, v.voucher_number, v.total_amount, v.voucher_date, p.id AS payment_id
      FROM public.vouchers v
      JOIN public.pharmacy_credit_payments p
        ON p.amount = v.total_amount
       AND COALESCE(p.payment_date::DATE, CURRENT_DATE) = v.voucher_date
       AND upper(COALESCE(p.payment_method, 'CASH')) = upper(
             split_part(split_part(v.narration, ' via ', 2), ' - ', 1))
     WHERE v.status <> 'CANCELLED'
       AND v.narration ILIKE 'Pharmacy credit payment%'
  LOOP
    -- Only restate if the replacement can actually be posted, so a failed
    -- match never leaves the settlement with no voucher at all.
    v_result := public.post_pharmacy_credit_payment_receipt(v_row.payment_id);
    IF COALESCE((v_result ->> 'posted')::BOOLEAN, false) THEN
      UPDATE public.vouchers
         SET status = 'CANCELLED',
             last_modified_by = 'pharmacy-credit-settlement-restatement',
             narration = narration || ' [cancelled: income was already recognised by the invoice JV — reposted against Pharmacy Debtors]',
             updated_at = NOW()
       WHERE id = v_row.voucher_id;
      v_cancelled := v_cancelled + 1;
      v_reposted := v_reposted + 1;
      v_value := v_value + COALESCE(v_row.total_amount, 0);
    ELSE
      RAISE NOTICE 'Left % alone — replacement not posted (%)', v_row.voucher_number, v_result;
    END IF;
  END LOOP;

  RAISE NOTICE 'Restated % credit settlements worth Rs %', v_cancelled, ROUND(v_value, 2);
END $$;

-- ---------------------------------------------------------------------------
-- STEP 3 — verify before committing
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_unbalanced INTEGER;
  v_old_rail INTEGER;
  v_dr NUMERIC;
  v_cr NUMERIC;
BEGIN
  SELECT COUNT(*) INTO v_unbalanced
    FROM (
      SELECT e.voucher_id
        FROM public.voucher_entries e
        JOIN public.vouchers v ON v.id = e.voucher_id
       WHERE v.status = 'AUTHORISED'
       GROUP BY e.voucher_id
      HAVING ABS(COALESCE(SUM(e.debit_amount), 0) - COALESCE(SUM(e.credit_amount), 0)) > 0.01
    ) x;
  IF v_unbalanced > 0 THEN
    RAISE EXCEPTION 'ABORT: % authorised vouchers have debits <> credits', v_unbalanced;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trigger_pharmacy_credit_payment_voucher' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'ABORT: the old credit-payment trigger is still attached';
  END IF;

  SELECT COUNT(*) INTO v_old_rail
    FROM public.vouchers
   WHERE status <> 'CANCELLED' AND narration ILIKE 'Pharmacy credit payment%';
  RAISE NOTICE 'Old-rail credit-payment vouchers still live: %', v_old_rail;

  SELECT COALESCE(SUM(e.debit_amount), 0), COALESCE(SUM(e.credit_amount), 0) INTO v_dr, v_cr
    FROM public.voucher_entries e
    JOIN public.vouchers v ON v.id = e.voucher_id AND v.status = 'AUTHORISED'
    JOIN public.chart_of_accounts a ON a.id = e.account_id
    JOIN public.companies c ON c.id = a.company_id AND c.company_key = 'hope_pharmacy'
   WHERE a.account_name = 'Pharmacy Debtors';
  RAISE NOTICE 'Pharmacy Debtors: Dr % / Cr % — outstanding Rs %',
    ROUND(v_dr, 2), ROUND(v_cr, 2), ROUND(v_dr - v_cr, 2);
END $$;
