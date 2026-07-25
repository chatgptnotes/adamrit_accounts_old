-- Correct the Patient Advance liability.
--
-- Every advance ever taken posted Dr Bank / Cr 2110 Patient Advance, and
-- nothing ever converted it to income, because the only thing that would is a
-- bill accrual and there wasn't one until 20260726130000. As at 25 Jul 2026:
--
--   Rs 5,48,50,492  sitting in 2110 as "we owe patients this"
--   Rs 5,44,38,392  of that is revenue already earned
--   Rs    3,10,500  is a genuine deposit (12 patients currently admitted)
--   Rs    1,01,600  is orphaned - advances with no matching visit, left alone
--
-- Earned = OPD (any state; OPD visits never receive a discharge flag)
--        + IPD that has been discharged.
--
-- Posts one journal per calendar month so revenue lands in roughly the period
-- it was earned, rather than dumping nine months into a single day. Each is
-- tagged reference_number = 'ADV-CORR-YYYY-MM' so the batch can be found and
-- cancelled if the figures are challenged. Re-running skips months already
-- posted.
--
-- NOTHING IS POSTED until v_confirm is set to true. This needs your
-- accountant's decision on the two income accounts first - Rs 2.17 crore of
-- this falls in FY 2025-26, which may already be filed.

DO $$
DECLARE
  -- ==================== SETTINGS ====================
  -- Enabled 25 Jul 2026 to post the current financial year only.
  v_confirm           BOOLEAN := true;

  -- Months to post, inclusive. Starts at the current financial year:
  -- FY 2025-26 (Rs 2.17 crore, Sep 2025 - Mar 2026) is deliberately left
  -- alone and will be handled separately if that year is reopened.
  v_from_period       DATE := '2026-04-01';
  v_upto_period       DATE := '2026-07-01';

  -- Start of the current financial year. Months before this use
  -- v_income_prior_fy; months on or after use v_income_current_fy.
  v_fy_split          DATE := '2026-04-01';

  -- Where the recognised revenue goes. 4160 matches where receipts already
  -- post. v_income_prior_fy is unused while v_from_period sits on or after
  -- v_fy_split - it only applies if the prior year is brought in later, in
  -- which case 3200 Retained Earnings is the usual treatment.
  v_income_current_fy TEXT := '4160';
  v_income_prior_fy   TEXT := '3200';
  -- =================================================

  r                RECORD;
  v_account_code   TEXT;
  v_account_id     UUID;
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
    RAISE NOTICE 'Nothing posted. Set v_confirm := true once the income accounts are agreed.';
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
    WITH adv AS (
      SELECT ap.visit_id,
             date_trunc('month', ap.payment_date::date)::date AS period,
             CASE WHEN COALESCE(ap.is_refund,false)
                  THEN -COALESCE(ap.advance_amount,0)
                  ELSE  COALESCE(ap.advance_amount,0) END      AS amt
        FROM advance_payment ap
       WHERE COALESCE(ap.status,'ACTIVE') <> 'CANCELLED'
    ),
    earned AS (
      SELECT a.period, a.amt
        FROM adv a
        JOIN visits v ON v.visit_id = a.visit_id
       WHERE upper(COALESCE(v.patient_type,'')) = 'OPD'
          OR COALESCE(v.is_discharged,false)
          OR v.discharge_date IS NOT NULL
    )
    SELECT period, round(sum(amt), 2) AS amount
      FROM earned
     WHERE period BETWEEN v_from_period AND v_upto_period
     GROUP BY period
     ORDER BY period
  LOOP
    CONTINUE WHEN r.amount IS NULL OR r.amount = 0;

    v_reference := 'ADV-CORR-' || to_char(r.period, 'YYYY-MM');
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM vouchers
       WHERE reference_number = v_reference AND status <> 'CANCELLED'
    );

    v_account_code := CASE WHEN r.period < v_fy_split
                           THEN v_income_prior_fy ELSE v_income_current_fy END;

    SELECT id INTO v_account_id
      FROM chart_of_accounts WHERE account_code = v_account_code;
    IF v_account_id IS NULL THEN
      RAISE EXCEPTION 'Income ledger % not found', v_account_code;
    END IF;

    -- Dated at month end so the entry falls inside the period it belongs to.
    v_voucher_date := (r.period + INTERVAL '1 month' - INTERVAL '1 day')::date;
    v_voucher_id := gen_random_uuid();
    v_voucher_number := generate_voucher_number(v_type_code);

    INSERT INTO vouchers (
      id, voucher_number, voucher_type_id, voucher_date, reference_number,
      narration, total_amount, status, created_by, created_at, updated_at
    ) VALUES (
      v_voucher_id, v_voucher_number, v_type_id, v_voucher_date, v_reference,
      'Patient advances earned in ' || to_char(r.period, 'Mon YYYY')
        || ' recognised as income',
      abs(r.amount), 'AUTHORISED', 'advance-liability-correction', NOW(), NOW()
    );

    IF r.amount > 0 THEN
      -- Normal month: clear the liability, recognise the income.
      INSERT INTO voucher_entries (
        id, voucher_id, account_id, narration, debit_amount, credit_amount,
        entry_order, created_at
      ) VALUES
        (gen_random_uuid(), v_voucher_id, v_advance_id,
         'Advances earned - ' || to_char(r.period,'Mon YYYY'), r.amount, 0, 1, NOW()),
        (gen_random_uuid(), v_voucher_id, v_account_id,
         'Advances earned - ' || to_char(r.period,'Mon YYYY'), 0, r.amount, 2, NOW());
    ELSE
      -- Net refunds exceeded advances that month (Oct 2025): reverse instead.
      INSERT INTO voucher_entries (
        id, voucher_id, account_id, narration, debit_amount, credit_amount,
        entry_order, created_at
      ) VALUES
        (gen_random_uuid(), v_voucher_id, v_account_id,
         'Net refunds - ' || to_char(r.period,'Mon YYYY'), -r.amount, 0, 1, NOW()),
        (gen_random_uuid(), v_voucher_id, v_advance_id,
         'Net refunds - ' || to_char(r.period,'Mon YYYY'), 0, -r.amount, 2, NOW());
    END IF;

    v_posted := v_posted + 1;
    v_total  := v_total + r.amount;
    RAISE NOTICE '% : % posted as % to %',
      to_char(r.period,'Mon YYYY'), r.amount, v_voucher_number, v_account_code;
  END LOOP;

  RAISE NOTICE 'Done. % vouchers, net Rs % recognised.', v_posted, v_total;
END;
$$;

-- To undo the whole batch:
--   UPDATE vouchers SET status = 'CANCELLED'
--    WHERE reference_number LIKE 'ADV-CORR-%' AND status <> 'CANCELLED';
