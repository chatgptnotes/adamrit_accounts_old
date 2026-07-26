-- Book the discount given at discharge, so a patient's ledger closes at nil.
--
-- Private patients settle on the day they are discharged; where they cannot pay
-- in full, the balance is given as a discount. The accrual only posted a
-- discount leg when financial_summary.discount_total was set, and that table
-- has 5 rows against 373 real bills. So a patient given a Rs 10,000 concession
-- would show Rs 10,000 owing indefinitely - an unrecorded discount masquerading
-- as debt.
--
-- visit_discounts already records these with an approval workflow (33 approved,
-- Rs 42,497 at the time of writing) and is now the fallback source. Only
-- approved discounts count: a pending or rejected one must not reduce a
-- receivable.
--
-- Body otherwise identical to 20260726190000.

CREATE OR REPLACE FUNCTION public.post_bill_vouchers()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  fs                   RECORD;
  v_patient            RECORD;
  v_has_fs             BOOLEAN := false;
  v_company_id         UUID;
  v_patient_account_id UUID;
  v_patient_ledger_id  UUID;
  v_sales_type_id      UUID;
  v_sales_type_code    TEXT;
  v_jrnl_type_id       UUID;
  v_jrnl_type_code     TEXT;
  v_discount_acct_id   UUID;
  v_advance_acct_id    UUID;
  v_income_acct_id     UUID;
  v_payer_account_id   UUID;
  v_voucher_id         UUID;
  v_voucher_number     TEXT;
  v_voucher_date       DATE;
  v_gross              NUMERIC(15,2) := 0;
  v_discount           NUMERIC(15,2) := 0;
  v_net                NUMERIC(15,2) := 0;
  v_advance            NUMERIC(15,2) := 0;
  v_remaining          NUMERIC(15,2) := 0;
BEGIN
  -- ------------------------------------------------------------------
  -- Rejection: an approved bill sent back to DRAFT unwinds its vouchers.
  -- ------------------------------------------------------------------
  IF OLD.status = 'APPROVED' AND NEW.status IS DISTINCT FROM 'APPROVED' THEN
    UPDATE vouchers
       SET status = 'CANCELLED', updated_at = NOW()
     WHERE bill_id = NEW.id
       AND status <> 'CANCELLED';
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM 'APPROVED' OR OLD.status = 'APPROVED' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM vouchers WHERE bill_id = NEW.id AND status <> 'CANCELLED') THEN
    RETURN NEW;
  END IF;

  -- A missing summary is now the normal case, not a reason to stop.
  SELECT * INTO fs FROM financial_summary WHERE bill_id = NEW.id;
  v_has_fs := FOUND;

  SELECT id, name, patients_id, hospital_name, corporate
    INTO v_patient
    FROM patients
   WHERE id = NEW.patient_id;

  SELECT pl.id, pl.account_id
    INTO v_patient_ledger_id, v_patient_account_id
    FROM patient_ledgers pl
   WHERE pl.patient_id = NEW.patient_id;

  IF v_patient_account_id IS NULL AND v_patient.patients_id IS NOT NULL THEN
    SELECT id INTO v_patient_account_id
      FROM chart_of_accounts
     WHERE account_code = 'PT' || v_patient.patients_id;
  END IF;

  IF v_patient_account_id IS NULL THEN
    RAISE WARNING 'Bill %: patient % has no ledger, nothing accrued', NEW.bill_no, NEW.patient_id;
    RETURN NEW;
  END IF;

  -- Resolved centrally: Ayushman is its own hospital, the legacy partnership
  -- keeps only its remaining panels, everything else is DRM Hope Pvt Ltd.
  v_company_id := public.resolve_patient_company(v_patient.hospital_name, v_patient.corporate);

  SELECT id, voucher_type_code INTO v_sales_type_id, v_sales_type_code
    FROM voucher_types
   WHERE voucher_category = 'SALES' AND is_active = true
   ORDER BY CASE voucher_type_code WHEN 'SV' THEN 1 WHEN 'SAL' THEN 2 ELSE 3 END
   LIMIT 1;

  SELECT id, voucher_type_code INTO v_jrnl_type_id, v_jrnl_type_code
    FROM voucher_types
   WHERE voucher_category = 'JOURNAL' AND is_active = true
   ORDER BY CASE voucher_type_code WHEN 'JV' THEN 1 WHEN 'JOU' THEN 2 ELSE 3 END
   LIMIT 1;

  IF v_sales_type_id IS NULL OR v_jrnl_type_id IS NULL THEN
    RAISE WARNING 'Bill %: SALES/JOURNAL voucher type missing, nothing accrued', NEW.bill_no;
    RETURN NEW;
  END IF;

  SELECT id INTO v_discount_acct_id FROM chart_of_accounts WHERE account_code = '5300';
  SELECT id INTO v_advance_acct_id  FROM chart_of_accounts WHERE account_code = '2110';

  -- bills.date is quoted because `date` is also a type name. Round-tripping
  -- through TEXT keeps this working whether the column is date or text.
  v_voucher_date := COALESCE(NULLIF(NEW."date"::TEXT, '')::DATE, CURRENT_DATE);

  -- ==================================================================
  -- V1 — Sales voucher: revenue accrual
  -- ==================================================================
  v_voucher_id := gen_random_uuid();
  v_voucher_number := generate_voucher_number(v_sales_type_code);

  INSERT INTO vouchers (
    id, voucher_number, voucher_type_id, voucher_date, reference_number,
    narration, total_amount, patient_id, bill_id, company_id, status,
    created_by, created_at, updated_at
  ) VALUES (
    v_voucher_id, v_voucher_number, v_sales_type_id, v_voucher_date, NEW.bill_no,
    'Bill ' || NEW.bill_no || ' - ' || COALESCE(v_patient.name, 'patient'),
    0, NEW.patient_id, NEW.id, v_company_id, 'AUTHORISED',
    COALESCE(NEW.approved_by, 'system'), NOW(), NOW()
  );

  -- Preferred path: a real per-department breakdown. The category → ledger map
  -- lives here once and nowhere else - the same statement posts the credit legs
  -- and reports their total, so the debit can never drift out of balance with
  -- them. Credit legs take entry_order 10+, leaving 1 and 2 for the debits.
  IF v_has_fs THEN
    WITH legs(code, amount, label) AS (
      VALUES
        ('4110', COALESCE(fs.total_amount_consultation, 0), 'Consultation'),
        ('4120', COALESCE(fs.total_amount_clinical_services, 0)
               + COALESCE(fs.total_amount_mandatory_services, 0)
               + COALESCE(fs.total_amount_physiotherapy, 0),  'Procedures & services'),
        ('4130', COALESCE(fs.total_amount_surgery, 0)
               + COALESCE(fs.total_amount_surgery_internal_report, 0), 'Surgery'),
        ('4140', COALESCE(fs.total_amount_laboratory_services, 0)
               + COALESCE(fs.total_amount_radiology, 0),      'Investigations'),
        ('4150', COALESCE(fs.total_amount_pharmacy, 0),       'Pharmacy'),
        ('4170', COALESCE(fs.total_amount_accommodation_charges, 0)
               + COALESCE(fs.total_amount_private, 0),        'Accommodation'),
        ('4180', COALESCE(fs.total_amount_implant, 0)
               + COALESCE(fs.total_amount_implant_cost, 0)
               + COALESCE(fs.total_amount_blood, 0),          'Implants & consumables')
    ),
    posted AS (
      INSERT INTO voucher_entries (
        id, voucher_id, account_id, narration,
        debit_amount, credit_amount, entry_order, created_at
      )
      SELECT gen_random_uuid(), v_voucher_id, a.id,
             l.label || ' - bill ' || NEW.bill_no, 0, l.amount,
             10 + (row_number() OVER (ORDER BY l.code))::INTEGER, NOW()
        FROM legs l
        JOIN chart_of_accounts a ON a.account_code = l.code
       WHERE l.amount > 0
      RETURNING credit_amount
    )
    SELECT COALESCE(SUM(credit_amount), 0) INTO v_gross FROM posted;
  END IF;

  -- Fallback: no summary, or one that totals nothing. Credit the bill total to
  -- a single income ledger. Loses the department split but covers every bill,
  -- which is the difference between a receivable that exists and one that
  -- does not.
  IF v_gross <= 0 THEN
    DELETE FROM voucher_entries WHERE voucher_id = v_voucher_id;

    SELECT id INTO v_income_acct_id
      FROM chart_of_accounts
     WHERE account_code = '4160' AND is_active = true;

    v_gross := GREATEST(COALESCE(NEW.total_amount, 0), 0);

    IF v_gross > 0 AND v_income_acct_id IS NOT NULL THEN
      INSERT INTO voucher_entries (
        id, voucher_id, account_id, narration,
        debit_amount, credit_amount, entry_order, created_at
      ) VALUES (
        gen_random_uuid(), v_voucher_id, v_income_acct_id,
        'Bill ' || NEW.bill_no || ' (no category breakdown)', 0, v_gross, 10, NOW()
      );
    ELSE
      IF v_income_acct_id IS NULL THEN
        RAISE WARNING 'Bill %: ledger 4160 Hospital Services Income missing', NEW.bill_no;
      END IF;
      v_gross := 0;
    END IF;
  END IF;

  IF v_gross <= 0 THEN
    DELETE FROM voucher_entries WHERE voucher_id = v_voucher_id;
    DELETE FROM vouchers WHERE id = v_voucher_id;
    RAISE WARNING 'Bill %: no billable amount, nothing accrued', NEW.bill_no;
    RETURN NEW;
  END IF;

  -- Discount source, in order of preference. The financial summary is the
  -- richer figure but is populated on barely any bill, so fall back to the
  -- approved discount recorded against the visit.
  --
  -- This matters for private patients specifically. Their bill is settled on
  -- the day they are discharged, and where they cannot pay in full the balance
  -- is written off as a discount. If that write-off is never posted, their
  -- ledger keeps showing it as debt forever - phantom receivables that quietly
  -- accumulate across every concession given.
  --
  -- Looked up by visit rather than by joining bills to discounts: a visit
  -- carries many bill rows (mostly zero-value stubs), so joining would apply
  -- the same discount several times over.
  IF v_has_fs AND COALESCE(fs.discount_total, 0) > 0 THEN
    v_discount := COALESCE(fs.discount_total, 0);
  ELSE
    SELECT COALESCE(sum(d.discount_amount), 0)
      INTO v_discount
      FROM visit_discounts d
      JOIN visits v ON v.id = d.visit_id
     WHERE v.visit_id = NEW.visit_id
       AND lower(COALESCE(d.approval_status, '')) = 'approved';
  END IF;

  -- Never more than the bill itself, and never negative.
  v_discount := LEAST(GREATEST(COALESCE(v_discount, 0), 0), v_gross);

  IF v_discount > 0 AND v_discount_acct_id IS NULL THEN
    RAISE WARNING 'Bill %: ledger 5300 Discount Allowed missing, discount not booked', NEW.bill_no;
    v_discount := 0;
  END IF;

  v_net := v_gross - v_discount;

  INSERT INTO voucher_entries (
    id, voucher_id, account_id, patient_ledger_id, narration,
    debit_amount, credit_amount, entry_order, created_at
  ) VALUES (
    gen_random_uuid(), v_voucher_id, v_patient_account_id, v_patient_ledger_id,
    'Being bill ' || NEW.bill_no || ' raised', v_net, 0, 1, NOW()
  );

  IF v_discount > 0 THEN
    INSERT INTO voucher_entries (
      id, voucher_id, account_id, narration,
      debit_amount, credit_amount, entry_order, created_at
    ) VALUES (
      gen_random_uuid(), v_voucher_id, v_discount_acct_id,
      'Discount on bill ' || NEW.bill_no, v_discount, 0, 2, NOW()
    );
  END IF;

  UPDATE vouchers SET total_amount = v_gross WHERE id = v_voucher_id;

  -- ==================================================================
  -- V2 — Journal voucher: knock the advance off the receivable
  -- ==================================================================
  -- A refund is stored as its own row with is_refund = true and the amount in
  -- advance_amount (AdvancePaymentModal.tsx:611), so it has to be netted off
  -- rather than merely excluded.
  SELECT COALESCE(SUM(
           CASE WHEN COALESCE(is_refund, false) THEN -advance_amount ELSE advance_amount END
         ), 0)
    INTO v_advance
    FROM advance_payment
   WHERE visit_id = NEW.visit_id
     AND COALESCE(status, 'ACTIVE') <> 'CANCELLED';

  v_advance := LEAST(GREATEST(v_advance, 0), v_net);

  IF v_advance > 0 AND v_advance_acct_id IS NOT NULL THEN
    v_voucher_id := gen_random_uuid();
    v_voucher_number := generate_voucher_number(v_jrnl_type_code);

    INSERT INTO vouchers (
      id, voucher_number, voucher_type_id, voucher_date, reference_number,
      narration, total_amount, patient_id, bill_id, company_id, status,
      created_by, created_at, updated_at
    ) VALUES (
      v_voucher_id, v_voucher_number, v_jrnl_type_id, v_voucher_date, NEW.bill_no,
      'Advance adjusted against bill ' || NEW.bill_no,
      v_advance, NEW.patient_id, NEW.id, v_company_id, 'AUTHORISED',
      COALESCE(NEW.approved_by, 'system'), NOW(), NOW()
    );

    INSERT INTO voucher_entries (
      id, voucher_id, account_id, patient_ledger_id, narration,
      debit_amount, credit_amount, entry_order, created_at
    ) VALUES
      (gen_random_uuid(), v_voucher_id, v_advance_acct_id, NULL,
       'Advance adjusted - bill ' || NEW.bill_no, v_advance, 0, 1, NOW()),
      (gen_random_uuid(), v_voucher_id, v_patient_account_id, v_patient_ledger_id,
       'Advance adjusted - bill ' || NEW.bill_no, 0, v_advance, 2, NOW());
  END IF;

  -- ==================================================================
  -- V3 — Journal voucher: move the balance to the scheme / corporate payer
  -- ==================================================================
  SELECT c.ledger_account_id INTO v_payer_account_id
    FROM corporate c
   WHERE lower(btrim(c.name)) = lower(btrim(COALESCE(
           (SELECT v.corporate FROM visits v WHERE v.visit_id = NEW.visit_id),
           v_patient.corporate)))
     AND c.ledger_account_id IS NOT NULL
   LIMIT 1;

  v_remaining := v_net - v_advance;

  IF v_payer_account_id IS NOT NULL AND v_remaining > 0 THEN
    v_voucher_id := gen_random_uuid();
    v_voucher_number := generate_voucher_number(v_jrnl_type_code);

    INSERT INTO vouchers (
      id, voucher_number, voucher_type_id, voucher_date, reference_number,
      narration, total_amount, patient_id, bill_id, company_id, status,
      created_by, created_at, updated_at
    ) VALUES (
      v_voucher_id, v_voucher_number, v_jrnl_type_id, v_voucher_date, NEW.bill_no,
      'Bill ' || NEW.bill_no || ' transferred to payer',
      v_remaining, NEW.patient_id, NEW.id, v_company_id, 'AUTHORISED',
      COALESCE(NEW.approved_by, 'system'), NOW(), NOW()
    );

    INSERT INTO voucher_entries (
      id, voucher_id, account_id, patient_ledger_id, narration,
      debit_amount, credit_amount, entry_order, created_at
    ) VALUES
      (gen_random_uuid(), v_voucher_id, v_payer_account_id, NULL,
       'Claim receivable - bill ' || NEW.bill_no, v_remaining, 0, 1, NOW()),
      (gen_random_uuid(), v_voucher_id, v_patient_account_id, v_patient_ledger_id,
       'Transferred to payer - bill ' || NEW.bill_no, 0, v_remaining, 2, NOW());
  END IF;

  RAISE NOTICE 'Bill %: accrued gross % (split=%), discount %, advance %',
    NEW.bill_no, v_gross, v_has_fs, v_discount, v_advance;

  RETURN NEW;
END;
$$;
