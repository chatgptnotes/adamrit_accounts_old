-- Accrue a patient bill into the ledger when it is approved.
--
-- Until now the books only ever saw cash: advances credited 2110 Patient
-- Advance and discharge payments credited 4160 Hospital Services Income
-- (20260704200000_receipt_voucher_proper_ledgers.sql). Nothing was posted when
-- a bill was raised, so a billed-but-unpaid patient appeared nowhere, the
-- advance liability was never cleared, and the 41xx income ledgers stayed at
-- zero forever.
--
-- Approving a bill now posts up to three vouchers, all tagged with
-- vouchers.bill_id (a column that has existed since 20250612230000 and has
-- never been populated — it is the idempotency key here):
--
--   V1  Sales    Dr patient ledger + Dr Discount Allowed / Cr the 41xx income leaves
--   V2  Journal  Dr 2110 Patient Advance / Cr patient ledger   (advance adjustment)
--   V3  Journal  Dr scheme or corporate ledger / Cr patient ledger  (payer split)
--
-- Rejecting an approved bill cancels them, so re-approval posts cleanly.
--
-- Amounts come from financial_summary, whose discount_* columns are written as
-- NULL rather than 0 when the field is left blank (useFinancialSummary.ts:1421),
-- hence COALESCE on every read.

CREATE OR REPLACE FUNCTION public.post_bill_vouchers()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  fs                   RECORD;
  v_patient            RECORD;
  v_company_id         UUID;
  v_patient_account_id UUID;
  v_patient_ledger_id  UUID;
  v_sales_type_id      UUID;
  v_sales_type_code    TEXT;
  v_jrnl_type_id       UUID;
  v_jrnl_type_code     TEXT;
  v_discount_acct_id   UUID;
  v_advance_acct_id    UUID;
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
  -- Soft cancel keeps the numbers and leaves an audit trail via
  -- log_voucher_changes() (20260705020000_edit_log_and_ledger_fields.sql).
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

  -- Already posted (re-approval, or a replayed update).
  IF EXISTS (SELECT 1 FROM vouchers WHERE bill_id = NEW.id AND status <> 'CANCELLED') THEN
    RETURN NEW;
  END IF;

  SELECT * INTO fs FROM financial_summary WHERE bill_id = NEW.id;
  IF NOT FOUND THEN
    RAISE WARNING 'Bill %: no financial_summary row, nothing accrued', NEW.bill_no;
    RETURN NEW;
  END IF;

  SELECT id, name, patients_id, hospital_name, corporate
    INTO v_patient
    FROM patients
   WHERE id = NEW.patient_id;

  -- The patient's own Sundry Debtors ledger, created by
  -- 20260726110000_patient_ledger_autocreate.sql. Without it there is no
  -- honest debit leg, so post nothing rather than dump the bill on a generic
  -- account where it could never be traced back.
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

  -- Same hospital → company mapping the patient-ledger trigger uses.
  SELECT id INTO v_company_id
    FROM companies
   WHERE company_key = CASE lower(COALESCE(v_patient.hospital_name, 'hope'))
                         WHEN 'ayushman' THEN 'ayushman_nagpur'
                         ELSE 'hope_partnership'
                       END;

  -- Voucher types: prefer the 20250613000000 codes, fall back to the
  -- 20250612230000 ones, since only one of those two seeds survived.
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

  -- Header goes in first so the entries have something to hang off; the real
  -- total is only known once the credit legs are posted, and is set below.
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

  -- The category → ledger map lives here once and nowhere else: the same
  -- statement posts the credit legs and reports their total, so the debit can
  -- never drift out of balance with them. Credit legs take entry_order 10+,
  -- leaving 1 and 2 for the debits, which Tally shows first.
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

  -- Nothing billable, or none of the income ledgers exist. Undo the header
  -- rather than leave a zero voucher behind.
  IF v_gross <= 0 THEN
    DELETE FROM voucher_entries WHERE voucher_id = v_voucher_id;
    DELETE FROM vouchers WHERE id = v_voucher_id;
    RAISE WARNING 'Bill %: no billable amount, nothing accrued', NEW.bill_no;
    RETURN NEW;
  END IF;

  v_discount := LEAST(GREATEST(COALESCE(fs.discount_total, 0), 0), v_gross);

  IF v_discount > 0 AND v_discount_acct_id IS NULL THEN
    -- No Discount Allowed ledger: book the gross to the patient rather than
    -- post a voucher that does not balance.
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
  -- rather than merely excluded — otherwise a partly refunded advance would
  -- wipe out more of the receivable than the patient actually has on deposit.
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

  RAISE NOTICE 'Bill %: accrued gross %, discount %, advance %, payer %',
    NEW.bill_no, v_gross, v_discount, v_advance, COALESCE(v_remaining, 0);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_post_bill_vouchers ON public.bills;
CREATE TRIGGER trg_post_bill_vouchers
AFTER UPDATE OF status ON public.bills
FOR EACH ROW
WHEN (NEW.status IS DISTINCT FROM OLD.status)
EXECUTE FUNCTION public.post_bill_vouchers();

CREATE INDEX IF NOT EXISTS idx_vouchers_bill_id ON public.vouchers(bill_id);
