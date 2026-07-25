-- Correct refunds that were posted in the wrong direction.
--
-- Until 20260726160000, a refund posted the same way as a receipt:
--
--     Dr Bank/Cash  X      Cr 2110 Patient Advance  X     <- wrong
--
-- when it should have been the reverse. Each account is therefore out by
-- TWICE the refund: once for the entry that should not be there, once for the
-- one that is missing. The correcting entry is:
--
--     Dr 2110 Patient Advance  2X      Cr Bank/Cash  2X
--
-- Grouped by month and by the account the money actually left, so bank
-- reconciliation stays intact rather than everything landing on cash.
--
-- One journal per month per account, tagged reference_number
-- 'REFUND-CORR-YYYY-MM-<code>' so the batch can be found and cancelled.
-- Re-running skips combinations already posted.
--
-- The original bad vouchers are deliberately left in place rather than
-- cancelled. The advance_payment trigger records no reference back to its
-- voucher, so matching a refund row to its voucher would rely on patient +
-- date + amount, which is ambiguous when a patient has a receipt and a refund
-- of the same amount on the same day. A correcting journal needs no such
-- guesswork.
--
-- NOTHING IS POSTED until v_confirm is set to true.

DO $$
DECLARE
  -- ==================== SETTINGS ====================
  -- Enabled 25 Jul 2026. Apr-Jul 2026 refunds total Rs 5,67,100, so this
  -- posts Rs 11,34,200 across 9 vouchers.
  --
  -- Note: this closes Rs 11.34 lakh of the Rs 20.87 lakh gap between the 2110
  -- ledger and the advance_payment table. The remaining Rs 9.53 lakh has a
  -- different cause - most likely duplicate vouchers - and is not addressed
  -- here. If some refunds were also duplicated, this under-corrects rather
  -- than overshoots.
  v_confirm      BOOLEAN := true;

  -- Months to correct, inclusive. Defaults to the current financial year, to
  -- match the decision taken on the advance liability - FY 2025-26 was left
  -- alone rather than reopening a year that may be filed.
  v_from_period  DATE := '2026-04-01';
  v_upto_period  DATE := '2026-07-01';

  -- Account assumed when a refund row carries no bank_account_id.
  v_default_cash TEXT := '1110';
  -- =================================================

  r                RECORD;
  v_advance_id     UUID;
  v_type_id        UUID;
  v_type_code      TEXT;
  v_voucher_id     UUID;
  v_voucher_number TEXT;
  v_reference      TEXT;
  v_voucher_date   DATE;
  v_posted         INTEGER := 0;
  v_total          NUMERIC(15,2) := 0;
BEGIN
  IF NOT v_confirm THEN
    RAISE NOTICE 'Nothing posted. Set v_confirm := true once the preview is agreed.';
    RETURN;
  END IF;

  SELECT id INTO v_advance_id
    FROM chart_of_accounts WHERE account_code = '2110';
  IF v_advance_id IS NULL THEN
    RAISE EXCEPTION 'Ledger 2110 Patient Advance not found';
  END IF;

  SELECT id, voucher_type_code INTO v_type_id, v_type_code
    FROM voucher_types
   WHERE voucher_category = 'JOURNAL' AND is_active = true
   ORDER BY CASE voucher_type_code WHEN 'JV' THEN 1 WHEN 'JOU' THEN 2 ELSE 3 END
   LIMIT 1;
  IF v_type_id IS NULL THEN
    RAISE EXCEPTION 'No active JOURNAL voucher type';
  END IF;

  FOR r IN
    SELECT date_trunc('month', ap.payment_date::date)::date       AS period,
           COALESCE(a.id, dflt.id)                                AS account_id,
           COALESCE(a.account_code, dflt.account_code)             AS account_code,
           round(2 * sum(COALESCE(ap.advance_amount,0)), 2)        AS correction
      FROM advance_payment ap
      LEFT JOIN chart_of_accounts a    ON a.id = ap.bank_account_id
      LEFT JOIN chart_of_accounts dflt ON dflt.account_code = v_default_cash
     WHERE COALESCE(ap.status,'ACTIVE') <> 'CANCELLED'
       AND COALESCE(ap.is_refund, false)
       AND date_trunc('month', ap.payment_date::date)::date
             BETWEEN v_from_period AND v_upto_period
     GROUP BY 1, 2, 3
     ORDER BY 1, 3
  LOOP
    CONTINUE WHEN r.correction IS NULL OR r.correction <= 0;
    CONTINUE WHEN r.account_id IS NULL;

    v_reference := 'REFUND-CORR-' || to_char(r.period, 'YYYY-MM') || '-' || r.account_code;
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM vouchers
       WHERE reference_number = v_reference AND status <> 'CANCELLED'
    );

    v_voucher_date := (r.period + INTERVAL '1 month' - INTERVAL '1 day')::date;
    v_voucher_id := gen_random_uuid();
    v_voucher_number := generate_voucher_number(v_type_code);

    INSERT INTO vouchers (
      id, voucher_number, voucher_type_id, voucher_date, reference_number,
      narration, total_amount, status, created_by, created_at, updated_at
    ) VALUES (
      v_voucher_id, v_voucher_number, v_type_id, v_voucher_date, v_reference,
      'Correction: refunds in ' || to_char(r.period, 'Mon YYYY')
        || ' were posted as receipts',
      r.correction, 'AUTHORISED', 'refund-direction-correction', NOW(), NOW()
    );

    INSERT INTO voucher_entries (
      id, voucher_id, account_id, narration, debit_amount, credit_amount,
      entry_order, created_at
    ) VALUES
      (gen_random_uuid(), v_voucher_id, v_advance_id,
       'Reverse refunds posted as receipts - ' || to_char(r.period,'Mon YYYY'),
       r.correction, 0, 1, NOW()),
      (gen_random_uuid(), v_voucher_id, r.account_id,
       'Reverse refunds posted as receipts - ' || to_char(r.period,'Mon YYYY'),
       0, r.correction, 2, NOW());

    v_posted := v_posted + 1;
    v_total  := v_total + r.correction;
    RAISE NOTICE '% % : % corrected as %',
      to_char(r.period,'Mon YYYY'), r.account_code, r.correction, v_voucher_number;
  END LOOP;

  RAISE NOTICE 'Done. % vouchers, Rs % corrected.', v_posted, v_total;
END;
$$;

-- To undo the whole batch:
--   UPDATE vouchers SET status = 'CANCELLED'
--    WHERE reference_number LIKE 'REFUND-CORR-%' AND status <> 'CANCELLED';
