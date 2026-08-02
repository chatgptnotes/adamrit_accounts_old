-- Patient receipts are income, not advances. (Owner's order, 2026-08-03.)
--
-- The hospital's books have always run cash-basis: money received from a
-- patient is income the day it is received. The "Patient Advance" ledger
-- (2110, a pooled current liability) must stop being used. Every patient
-- receipt now credits one of the four legacy income ledgers that came in
-- with the Tally import:
--
--   Hope / DRM patients:   'OPD PT INCOME (HOPE)'          / 'IPD PT INCOME (Hope)'
--   Ayushman patients:     'OPD Patient Income [Ayushman]' / 'IPD Patient Income'
--
-- Selection: the patient's hospital_name picks the pair (ayushman vs hope),
-- visits.patient_type ('OPD' / 'IPD') picks the ledger, and the copy is
-- chosen by the patient's company (each company carries its own copy of the
-- four names — see the probe below).
--
-- ---------------------------------------------------------------------------
-- LIVE-DB PROBE (read-only REST, 2026-08-02, project xvkxccqaopbnkvwgyfjv):
--
--   Patient Advance:
--     2110 'Patient Advance'  id 4e2a9b84-58ae-455f-9ed4-74ba09855f01
--       voucher_entries all-time: 11,115 (bulk pre-cutover / cancelled)
--       LIVE post-cutover (voucher_date >= 2026-07-25, status <> CANCELLED):
--         503 credit legs (all advance receipts, reference_number = advance_payment.id)
--           8 debit legs (7 advance refunds + 'Advance adjusted against bill' JVs)
--       opening_balance 0.00
--
--   Income ledgers (each name exists in three company copies; entry counts all-time):
--     company 4adfe31a drm_pvt_ltd:
--       2e0a5321 'OPD PT INCOME (HOPE)'           0 entries
--       101bb519 'IPD PT INCOME (Hope)'           7 entries
--       94897b79 'OPD Patient Income [Ayushman]'  0 entries
--       4deefab1 'IPD Patient Income'             0 entries
--     company 5a9cc083 ayushman_nagpur:
--       40bb73e0 'OPD PT INCOME (HOPE)'           0 entries
--       74e8c36a 'IPD PT INCOME (Hope)'           1 entry
--       e250a62f 'OPD Patient Income [Ayushman]'  0 entries
--       bcd93e9a 'IPD Patient Income'             0 entries
--     company d718b1f4 hope_partnership (company inactive, ledgers active):
--       090e7c13 / 25b32972 / 720df265 / c757a512  0 entries each
-- ---------------------------------------------------------------------------
--
-- WHAT THIS SCRIPT DOES (single transaction, idempotent — safe to re-run):
--   1. resolve_patient_income_ledger(patient, visit code): one resolver for
--      trigger-time and backfill, so the rule cannot drift.
--   2. create_receipt_voucher_for_payment(): the advance_payment branch now
--      credits the resolved income ledger. Falls back to 4160 Hospital
--      Services Income with a WARNING if the named ledger is missing —
--      never to 2110, never to the patient's ledger.
--   3. post_bill_vouchers(): the billing-time 'Advance adjusted' journal used
--      to debit 2110 (liability -> receivable transfer). With receipts booked
--      straight to income that journal would strand debits on a dead ledger,
--      so its debit leg now comes out of the same income ledger the receipt
--      credited: income already recognised on receipt is reclassified to
--      settle the receivable the bill accrual raises. Net income for a billed
--      visit stays exactly the billed amount — no double count.
--   4. Re-posts the existing LIVE post-cutover legs on 2110 (503 Cr + 8 Dr as
--      probed) onto the resolved income ledger. Legs whose visit context does
--      not resolve are LEFT UNTOUCHED — see the report query at the bottom.
--   5. Deactivates 2110 ONLY IF no live post-cutover leg still references it
--      and its opening balance is zero; otherwise leaves it active and says why.
--
-- Deliberately NOT changed (noted for the record):
--   * final_payments receipts keep crediting the patient's own ledger: they
--     settle the receivable the bill accrual creates. Crediting income there
--     as well would double-count against the accrual's income legs.
--   * Post-cutover advance receipts that 20260730120000 already moved onto
--     the patient's personal ledger (not 2110) are out of this order's scope;
--     a report query for them is at the bottom for a follow-up decision.
--   * Pre-cutover vouchers are not the book of record (Tally cutover
--     2026-07-25) and are not touched.

BEGIN;

-- ===========================================================================
-- 1. The resolver. Returns NULL when it cannot decide (missing patient,
--    visit not found, patient_type not OPD/IPD, ledger name absent) so the
--    caller can fall back — or, in the backfill, leave the entry alone.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.resolve_patient_income_ledger(
  p_patient_id UUID,
  p_visit_code TEXT   -- the printed visit code (visits.visit_id / advance_payment.visit_id), NOT visits.id
) RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hospital         TEXT;
  v_corporate        TEXT;
  v_patient_type     TEXT;
  v_ledger_name      TEXT;
  v_pref_company_key TEXT;
  v_company_id       UUID;
  v_ledger_id        UUID;
BEGIN
  IF p_patient_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT lower(COALESCE(p.hospital_name, '')), p.corporate
    INTO v_hospital, v_corporate
    FROM patients p
   WHERE p.id = p_patient_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- OPD vs IPD comes from the visit. No visit, no guess.
  IF COALESCE(btrim(p_visit_code), '') <> '' THEN
    SELECT upper(COALESCE(v.patient_type, ''))
      INTO v_patient_type
      FROM visits v
     WHERE v.visit_id = p_visit_code
     LIMIT 1;
  END IF;

  IF v_patient_type IS NULL OR v_patient_type NOT IN ('OPD', 'IPD') THEN
    RETURN NULL;
  END IF;

  -- The four legacy names, exactly as they stand in chart_of_accounts.
  IF v_hospital = 'ayushman' THEN
    v_ledger_name      := CASE v_patient_type WHEN 'OPD'
                            THEN 'OPD Patient Income [Ayushman]'
                            ELSE 'IPD Patient Income' END;
    v_pref_company_key := 'ayushman_nagpur';
  ELSE
    v_ledger_name      := CASE v_patient_type WHEN 'OPD'
                            THEN 'OPD PT INCOME (HOPE)'
                            ELSE 'IPD PT INCOME (Hope)' END;
    v_pref_company_key := 'drm_pvt_ltd';
  END IF;

  v_company_id := public.resolve_patient_company(v_hospital, v_corporate);

  -- Each company carries its own copy of the name. Prefer the patient's own
  -- company's copy, then the hospital's home company, then any active copy.
  SELECT ca.id
    INTO v_ledger_id
    FROM chart_of_accounts ca
    LEFT JOIN companies c ON c.id = ca.company_id
   WHERE lower(ca.account_name) = lower(v_ledger_name)
     AND ca.is_active = true
   ORDER BY (ca.company_id = v_company_id)        DESC NULLS LAST,
            (c.company_key = v_pref_company_key)  DESC NULLS LAST
   LIMIT 1;

  RETURN v_ledger_id;   -- NULL when the named ledger does not exist
END;
$$;

-- ===========================================================================
-- 2. The receipt trigger. Body identical to 20260730120000 except the
--    advance_payment credit side (marked CASH BASIS below): it credits the
--    resolved income ledger instead of the patient's ledger / 2110.
--    Trigger bindings on advance_payment / final_payments /
--    patient_payment_transactions are untouched.
-- ===========================================================================
CREATE OR REPLACE FUNCTION create_receipt_voucher_for_payment()
RETURNS TRIGGER AS $$
DECLARE
  v_voucher_id UUID;
  v_voucher_number TEXT;
  v_voucher_type_id UUID;
  v_voucher_type_code TEXT;
  v_debit_account_id UUID;
  v_revenue_account_id UUID;
  v_patient_id UUID;
  v_payment_amount DECIMAL(15,2);
  v_payment_mode TEXT;
  v_payment_date DATE;
  v_remarks TEXT;
  v_account_name TEXT;
  v_narration TEXT;
  v_bank_account_id UUID;
  v_bank_account_name TEXT;
  v_patient_ledger_id UUID;
  v_patient_name TEXT;
  v_credit_narration TEXT;
  v_is_refund BOOLEAN := false;
  v_cancelled INTEGER := 0;
  v_company_id UUID;
BEGIN
  -- ========================================================================
  -- Edits and deletions: retire the voucher this row previously produced.
  -- ========================================================================
  IF TG_TABLE_NAME = 'advance_payment' AND TG_OP IN ('UPDATE', 'DELETE') THEN
    UPDATE vouchers
       SET status           = 'CANCELLED',
           last_modified_by = 'advance-payment-sync',
           updated_at       = NOW()
     WHERE reference_number = OLD.id::TEXT
       AND status <> 'CANCELLED';
    GET DIAGNOSTICS v_cancelled = ROW_COUNT;

    IF TG_OP = 'DELETE' THEN
      IF v_cancelled = 0 THEN
        RAISE WARNING 'Deleted advance % had no linked voucher; if it was posted before this migration its voucher is now orphaned.', OLD.id;
      END IF;
      RETURN OLD;
    END IF;

    -- Safety: a row recorded before this migration carries no link, so nothing
    -- was cancelled above and its original voucher is still live. Posting a
    -- fresh one would double-count the payment, so do neither and say so.
    IF v_cancelled = 0 THEN
      RAISE WARNING 'Advance % edited but has no linked voucher (pre-dates the link); ledger not updated.', NEW.id;
      RETURN NEW;
    END IF;

    -- A row cancelled by the user should not come back as a new voucher.
    IF COALESCE(NEW.status, 'ACTIVE') = 'CANCELLED' THEN
      RETURN NEW;
    END IF;
  END IF;

  -- ========================================================================
  -- Extract payment details based on which table triggered this
  -- ========================================================================
  IF TG_TABLE_NAME = 'final_payments' THEN
    v_payment_amount := NEW.amount;
    v_payment_mode := NEW.mode_of_payment;
    v_payment_date := CURRENT_DATE;
    v_remarks := NEW.payment_remark;
    v_bank_account_id := NEW.bank_account_id;
    v_bank_account_name := NEW.bank_account_name;

    SELECT patient_id INTO v_patient_id
    FROM visits
    WHERE visit_id = NEW.visit_id;

    v_narration := 'Payment received on final bill';

  ELSIF TG_TABLE_NAME = 'advance_payment' THEN
    v_payment_amount := NEW.advance_amount;
    v_payment_mode := NEW.payment_mode;
    v_payment_date := NEW.payment_date::DATE;
    v_patient_id := NEW.patient_id;
    v_remarks := NEW.remarks;
    v_bank_account_id := NEW.bank_account_id;
    v_bank_account_name := NEW.bank_account_name;
    v_is_refund := COALESCE(NEW.is_refund, false);

    v_narration := CASE WHEN v_is_refund
                        THEN 'Advance refunded to patient'
                        ELSE 'Advance payment received' END;

  ELSIF TG_TABLE_NAME = 'patient_payment_transactions' THEN
    v_payment_amount := NEW.amount;
    v_payment_mode := NEW.payment_mode;
    v_payment_date := NEW.payment_date;
    v_patient_id := NEW.patient_id;
    v_remarks := NEW.narration;
    v_bank_account_id := NULL;
    v_bank_account_name := NULL;

    v_narration := COALESCE(
      NEW.narration,
      CASE NEW.payment_source
        WHEN 'OPD_SERVICE' THEN 'OPD service payment received'
        WHEN 'PHARMACY' THEN 'Pharmacy bill payment received'
        WHEN 'PHYSIOTHERAPY' THEN 'Physiotherapy payment received'
        WHEN 'DIRECT_SALE' THEN 'Direct pharmacy sale payment received'
        ELSE 'Payment received'
      END
    );
  END IF;

  -- Skip zero/negative amounts: they created junk 0.00 vouchers
  IF v_payment_amount IS NULL OR v_payment_amount <= 0 THEN
    RETURN NEW;
  END IF;

  -- ========================================================================
  -- Determine which account holds the cash
  -- ========================================================================
  v_account_name := 'Cash in Hand';
  v_debit_account_id := NULL;

  IF v_payment_mode IN ('CASH', 'Cash', 'cash') THEN
    IF v_remarks IS NOT NULL AND v_remarks != '' THEN
      IF v_remarks ILIKE '%sbi%' OR v_remarks ILIKE '%state bank%' OR v_remarks ILIKE '%drm%' THEN
        v_account_name := 'STATE BANK OF INDIA (DRM)';
      ELSIF v_remarks ILIKE '%saraswat%' THEN
        v_account_name := 'SARASWAT BANK';
      END IF;
    END IF;

  ELSIF v_payment_mode IN ('ONLINE', 'Online', 'online', 'Bank Transfer', 'BANK TRANSFER') THEN
    IF v_bank_account_id IS NOT NULL THEN
      SELECT id, account_name INTO v_debit_account_id, v_account_name
      FROM chart_of_accounts
      WHERE id = v_bank_account_id
        AND is_active = true;

      RAISE NOTICE 'ONLINE payment: Using bank_account_id % (%)', v_bank_account_id, v_account_name;

    ELSIF v_bank_account_name IS NOT NULL AND v_bank_account_name != '' THEN
      SELECT id, account_name INTO v_debit_account_id, v_account_name
      FROM chart_of_accounts
      WHERE account_name = v_bank_account_name
        AND is_active = true;

      RAISE NOTICE 'ONLINE payment: Using bank_account_name "%"', v_account_name;

    ELSIF v_remarks IS NOT NULL AND v_remarks != '' THEN
      IF v_remarks ILIKE '%sbi%' OR v_remarks ILIKE '%state bank%' OR v_remarks ILIKE '%drm%' THEN
        v_account_name := 'STATE BANK OF INDIA (DRM)';
      ELSIF v_remarks ILIKE '%saraswat%' THEN
        v_account_name := 'SARASWAT BANK';
      ELSE
        RAISE WARNING 'ONLINE payment: No bank specified, defaulting to Cash in Hand';
      END IF;
    ELSE
      RAISE WARNING 'ONLINE payment: No bank information provided, defaulting to Cash in Hand';
    END IF;

  ELSIF v_payment_mode IN ('UPI', 'NEFT', 'RTGS', 'CARD', 'CHEQUE', 'DD') THEN
    IF v_bank_account_id IS NOT NULL THEN
      SELECT id, account_name INTO v_debit_account_id, v_account_name
      FROM chart_of_accounts
      WHERE id = v_bank_account_id
        AND is_active = true;
    ELSIF v_bank_account_name IS NOT NULL AND v_bank_account_name != '' THEN
      SELECT id, account_name INTO v_debit_account_id, v_account_name
      FROM chart_of_accounts
      WHERE account_name = v_bank_account_name
        AND is_active = true;
    ELSIF v_remarks IS NOT NULL AND v_remarks != '' THEN
      IF v_remarks ILIKE '%sbi%' OR v_remarks ILIKE '%state bank%' OR v_remarks ILIKE '%drm%' THEN
        v_account_name := 'STATE BANK OF INDIA (DRM)';
      ELSIF v_remarks ILIKE '%saraswat%' THEN
        v_account_name := 'SARASWAT BANK';
      END IF;
    END IF;
  END IF;

  -- Pharmacy non-cash payments route to Canara Bank HOPE PHARMACY
  IF v_debit_account_id IS NULL
     AND v_account_name = 'Cash in Hand'
     AND v_payment_mode NOT IN ('CASH', 'Cash', 'cash')
     AND TG_TABLE_NAME = 'patient_payment_transactions'
  THEN
    IF NEW.payment_source IN ('PHARMACY', 'DIRECT_SALE') THEN
      SELECT id, account_name INTO v_debit_account_id, v_account_name
      FROM chart_of_accounts
      WHERE account_code = '1124' AND is_active = true;

      IF v_debit_account_id IS NOT NULL THEN
        RAISE NOTICE 'PHARMACY payment: Routing % to Canara Bank HOPE PHARMACY', v_payment_mode;
      END IF;
    END IF;
  END IF;

  IF v_debit_account_id IS NULL THEN
    SELECT id INTO v_debit_account_id
    FROM chart_of_accounts
    WHERE account_name = v_account_name
      AND is_active = true;
  END IF;

  IF v_debit_account_id IS NULL THEN
    RAISE WARNING 'Account "%" not found or inactive, falling back to Cash in Hand', v_account_name;

    SELECT id INTO v_debit_account_id
    FROM chart_of_accounts
    WHERE account_code = '1110' AND account_name = 'Cash in Hand';

    v_account_name := 'Cash in Hand';
  END IF;

  -- ========================================================================
  -- Voucher type. Money going out is a Payment, not a Receipt.
  -- ========================================================================
  IF v_is_refund THEN
    SELECT id, voucher_type_code INTO v_voucher_type_id, v_voucher_type_code
      FROM voucher_types
     WHERE voucher_category = 'PAYMENT' AND is_active = true
     ORDER BY CASE voucher_type_code WHEN 'PAY' THEN 1 WHEN 'PV' THEN 2 ELSE 3 END
     LIMIT 1;
  END IF;

  IF v_voucher_type_id IS NULL THEN
    SELECT id, voucher_type_code INTO v_voucher_type_id, v_voucher_type_code
    FROM voucher_types
    WHERE voucher_type_code IN ('REC', 'RV')
      AND voucher_category = 'RECEIPT'
      AND is_active = true
    ORDER BY CASE WHEN voucher_type_code = 'REC' THEN 1 ELSE 2 END
    LIMIT 1;
  END IF;

  -- ========================================================================
  -- The non-cash side
  -- ========================================================================
  v_credit_narration := 'Patient payment received';

  IF TG_TABLE_NAME = 'advance_payment' THEN
    -- CASH BASIS (owner order, 2026-08-03). A patient receipt is income the
    -- day it is received. It credits one of the four legacy income ledgers,
    -- picked by hospital (hope vs ayushman) and OPD/IPD from the visit.
    -- 2110 Patient Advance is retired and must never be posted to again;
    -- the patient's personal ledger is not used for advances either.
    v_patient_ledger_id  := NULL;
    v_revenue_account_id := public.resolve_patient_income_ledger(v_patient_id, NEW.visit_id);

    IF v_revenue_account_id IS NULL THEN
      -- The named ledger is missing or the visit gives no OPD/IPD context.
      -- Still income under cash basis, so park on the generic income head,
      -- never back on 2110.
      RAISE WARNING 'Advance %: OPD/IPD income ledger not resolved (patient %, visit %); falling back to 4160 Hospital Services Income',
        NEW.id, v_patient_id, NEW.visit_id;
      SELECT id INTO v_revenue_account_id
      FROM chart_of_accounts
      WHERE account_code = '4160' AND is_active = true;
    END IF;

    v_credit_narration := CASE WHEN v_is_refund
                               THEN 'Advance refunded to patient'
                               ELSE 'Patient receipt recognised as income' END;

  ELSIF TG_TABLE_NAME = 'final_payments' THEN
    -- Unchanged: a final payment settles the receivable the bill accrual
    -- raised. Crediting income here as well would double-count revenue.
    SELECT pl.id, pl.account_id INTO v_patient_ledger_id, v_revenue_account_id
    FROM patient_ledgers pl
    WHERE pl.patient_id = v_patient_id;

    IF v_revenue_account_id IS NULL THEN
      SELECT ca.id INTO v_revenue_account_id
      FROM chart_of_accounts ca
      JOIN patients p ON ca.account_code = 'PT' || p.patients_id
      WHERE p.id = v_patient_id;
    END IF;

    IF v_revenue_account_id IS NULL THEN
      RAISE WARNING 'Patient % has no ledger, crediting income instead', v_patient_id;
      SELECT id INTO v_revenue_account_id
      FROM chart_of_accounts
      WHERE account_code = '4160' AND is_active = true;
    ELSE
      v_credit_narration := 'Settlement of patient dues';
    END IF;

  ELSE
    -- Which income this actually is. Everything used to credit 4160 Hospital
    -- Services Income, so a Rs 20 strip of paracetamol sold over the pharmacy
    -- counter showed up as hospital services revenue. The pharmacy's own sales
    -- were invisible as pharmacy sales, and 4150 Medicine Sales stayed empty
    -- while the purchases piled up against it.
    SELECT id INTO v_revenue_account_id
      FROM chart_of_accounts
     WHERE is_active = true
       AND account_code = CASE
             WHEN COALESCE(NEW.payment_source, '') IN ('PHARMACY', 'DIRECT_SALE')
               THEN '4150'   -- Medicine Sales
             ELSE '4160'     -- Hospital Services Income
           END;

    IF v_revenue_account_id IS NULL THEN
      SELECT id INTO v_revenue_account_id
        FROM chart_of_accounts
       WHERE account_code = '4160' AND is_active = true;
    END IF;
  END IF;

  IF v_revenue_account_id IS NULL THEN
    SELECT id INTO v_revenue_account_id
    FROM chart_of_accounts
    WHERE account_code = '4000' AND account_name = 'INCOME';
  END IF;

  IF v_voucher_type_id IS NULL OR v_debit_account_id IS NULL OR v_revenue_account_id IS NULL THEN
    RAISE WARNING 'Required accounts not found. Voucher not created.';
    RAISE WARNING 'Voucher Type ID: %, Cash Account ID: %, Contra Account ID: %',
                  v_voucher_type_id, v_debit_account_id, v_revenue_account_id;
    RETURN NEW;
  END IF;

  v_voucher_number := generate_voucher_number(v_voucher_type_code);
  v_voucher_id := gen_random_uuid();

  -- reference_number now links an advance to its voucher, so a later edit or
  -- deletion can find and retire it.
  -- Whose books this belongs in. The patient decides where there is one; a
  -- pharmacy transaction with no patient belongs to Hope Pharmacy, which is
  -- where the rest of the pharmacy postings go. The name comes out of the same
  -- read, for the narration.
  SELECT public.resolve_patient_company(p.hospital_name, p.corporate), p.name
    INTO v_company_id, v_patient_name
    FROM patients p WHERE p.id = v_patient_id;

  IF v_company_id IS NULL AND TG_TABLE_NAME = 'patient_payment_transactions' THEN
    SELECT id INTO v_company_id FROM companies WHERE company_key = 'hope_pharmacy';
  END IF;

  INSERT INTO vouchers (
    id, voucher_number, voucher_type_id, voucher_date, reference_number,
    narration, total_amount, patient_id, company_id, status, created_by,
    created_at, updated_at
  ) VALUES (
    v_voucher_id,
    v_voucher_number,
    v_voucher_type_id,
    v_payment_date,
    CASE
      WHEN TG_TABLE_NAME = 'final_payments'                THEN NEW.visit_id
      WHEN TG_TABLE_NAME = 'patient_payment_transactions'  THEN NEW.id::TEXT
      WHEN TG_TABLE_NAME = 'advance_payment'               THEN NEW.id::TEXT
      ELSE NULL
    END,
    -- '#name' is the tag syntax the narration box's own patient autocomplete
    -- writes, so a generated receipt reads like a typed one.
    v_narration || ' via ' || v_payment_mode || ' - ' || v_account_name
      || COALESCE(' #' || NULLIF(btrim(v_patient_name), ''), ''),
    v_payment_amount,
    v_patient_id,
    v_company_id,
    'AUTHORISED',
    CASE WHEN TG_TABLE_NAME = 'patient_payment_transactions' THEN NEW.created_by ELSE NULL END,
    NOW(),
    NOW()
  );

  IF v_is_refund THEN
    INSERT INTO voucher_entries (
      id, voucher_id, account_id, patient_ledger_id, narration,
      debit_amount, credit_amount, created_at
    ) VALUES (
      gen_random_uuid(), v_voucher_id, v_revenue_account_id, v_patient_ledger_id,
      v_credit_narration, v_payment_amount, 0, NOW()
    );

    INSERT INTO voucher_entries (
      id, voucher_id, account_id, narration,
      debit_amount, credit_amount, created_at
    ) VALUES (
      gen_random_uuid(), v_voucher_id, v_debit_account_id,
      'Refund paid to patient via ' || v_payment_mode || ' from ' || v_account_name,
      0, v_payment_amount, NOW()
    );

  ELSE
    INSERT INTO voucher_entries (
      id, voucher_id, account_id, narration,
      debit_amount, credit_amount, created_at
    ) VALUES (
      gen_random_uuid(), v_voucher_id, v_debit_account_id,
      'Payment received from patient via ' || v_payment_mode || ' to ' || v_account_name,
      v_payment_amount, 0, NOW()
    );

    INSERT INTO voucher_entries (
      id, voucher_id, account_id, patient_ledger_id, narration,
      debit_amount, credit_amount, created_at
    ) VALUES (
      gen_random_uuid(), v_voucher_id, v_revenue_account_id, v_patient_ledger_id,
      v_credit_narration, 0, v_payment_amount, NOW()
    );
  END IF;

  RAISE NOTICE 'Voucher % (%) for Rs % on account "%"',
    v_voucher_number, TG_OP, v_payment_amount, v_account_name;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ===========================================================================
-- 3. The bill trigger. Body identical to 20260726220000 except the V2
--    'Advance adjusted' journal (marked CASH BASIS below): its debit leg
--    comes out of the resolved income ledger instead of 2110. If the income
--    ledger cannot be resolved the journal is skipped with a WARNING rather
--    than posted against the retired liability head.
-- ===========================================================================
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
  v_disc_status        TEXT;
  v_disc_amount        NUMERIC(15,2);
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

  -- CASH BASIS (owner order, 2026-08-03). Receipts are booked straight to the
  -- OPD/IPD income ledgers, so the advance held for this visit already sits in
  -- income, not on 2110 Patient Advance. The V2 journal below therefore
  -- reclassifies that income against the receivable this accrual raises
  -- (Dr income ledger / Cr patient) instead of draining a liability head.
  -- Net income for a billed visit remains exactly the billed amount.
  v_advance_acct_id := public.resolve_patient_income_ledger(NEW.patient_id, NEW.visit_id);

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

  -- visit_discounts is the authority on discounts. Staff must record one and
  -- have it approved before the patient's gate pass can be generated, so for
  -- any discharged patient the decision is recorded there by construction.
  --
  -- Because it is authoritative, the presence of a row settles the matter: an
  -- approved row grants the discount, a pending or rejected one grants nothing.
  -- financial_summary is consulted only where no discount decision exists at
  -- all, and its figure is free-typed rather than approved.
  --
  -- Looked up by visit, never by joining bills to discounts: a visit carries
  -- many bill rows (mostly zero-value stubs), so a join would apply the same
  -- discount several times over. The upsert in DiscountTab.tsx is keyed on
  -- visit_id, so there is at most one row per visit.
  SELECT d.discount_amount, lower(COALESCE(d.approval_status, ''))
    INTO v_disc_amount, v_disc_status
    FROM visit_discounts d
    JOIN visits v ON v.id = d.visit_id
   WHERE v.visit_id = NEW.visit_id
   LIMIT 1;

  IF v_disc_status IS NOT NULL THEN
    v_discount := CASE WHEN v_disc_status = 'approved'
                       THEN COALESCE(v_disc_amount, 0)
                       ELSE 0 END;
  ELSIF v_has_fs THEN
    v_discount := COALESCE(fs.discount_total, 0);
  ELSE
    v_discount := 0;
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
  -- V2 — Journal voucher: knock the already-recognised receipt income
  --      off the receivable (was: drain 2110 Patient Advance)
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

  IF v_advance > 0 AND v_advance_acct_id IS NULL THEN
    RAISE WARNING 'Bill %: OPD/IPD income ledger not resolved, advance of % NOT adjusted against the receivable', NEW.bill_no, v_advance;
  END IF;

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

-- ===========================================================================
-- 4. Re-post the existing LIVE post-cutover legs on 2110.
--
--    Only vouchers the triggers made (an advance links itself by
--    reference_number; the bill JV links by bill_id), only from the
--    2026-07-25 cutover, only non-cancelled, and only legs still sitting on
--    2110 — so re-running this block finds nothing and changes nothing.
--    One leg moves per voucher and no amount changes, so every voucher stays
--    balanced. Legs whose visit context does not resolve are LEFT ALONE.
-- ===========================================================================
DO $repost$
DECLARE
  v_2110    UUID;
  v_receipt INTEGER := 0;
  v_billjv  INTEGER := 0;
  v_left    INTEGER := 0;
BEGIN
  SELECT id INTO v_2110
    FROM chart_of_accounts
   WHERE account_code = '2110'
     AND lower(account_name) LIKE '%patient advance%';

  IF v_2110 IS NULL THEN
    RAISE NOTICE 'No 2110 Patient Advance ledger found; nothing to re-post.';
    RETURN;
  END IF;

  -- (a) Advance receipts and refunds: the voucher's reference_number is the
  --     advance_payment id, which carries the visit code for OPD/IPD.
  WITH target AS (
    SELECT e.id AS entry_id,
           public.resolve_patient_income_ledger(v.patient_id, ap.visit_id) AS income_id
      FROM voucher_entries e
      JOIN vouchers v         ON v.id = e.voucher_id
      JOIN advance_payment ap ON ap.id::TEXT = v.reference_number
     WHERE e.account_id = v_2110
       AND v.status <> 'CANCELLED'
       AND v.voucher_date >= DATE '2026-07-25'
  )
  UPDATE voucher_entries e
     SET account_id = t.income_id
    FROM target t
   WHERE e.id = t.entry_id
     AND t.income_id IS NOT NULL;
  GET DIAGNOSTICS v_receipt = ROW_COUNT;

  -- (b) 'Advance adjusted' journals from bill approval: resolved through the
  --     bill's visit. These are debit legs; they now come out of income,
  --     matching the rewritten post_bill_vouchers.
  WITH target AS (
    SELECT e.id AS entry_id,
           public.resolve_patient_income_ledger(v.patient_id, b.visit_id) AS income_id
      FROM voucher_entries e
      JOIN vouchers v ON v.id = e.voucher_id
      JOIN bills b    ON b.id = v.bill_id
     WHERE e.account_id = v_2110
       AND v.status <> 'CANCELLED'
       AND v.voucher_date >= DATE '2026-07-25'
  )
  UPDATE voucher_entries e
     SET account_id = t.income_id
    FROM target t
   WHERE e.id = t.entry_id
     AND t.income_id IS NOT NULL;
  GET DIAGNOSTICS v_billjv = ROW_COUNT;

  SELECT COUNT(*) INTO v_left
    FROM voucher_entries e
    JOIN vouchers v ON v.id = e.voucher_id
   WHERE e.account_id = v_2110
     AND v.status <> 'CANCELLED'
     AND v.voucher_date >= DATE '2026-07-25';

  RAISE NOTICE 'Re-posted % receipt/refund leg(s) and % bill-adjustment leg(s) from Patient Advance to the income ledgers; % live post-cutover leg(s) remain (see report query in the migration comments).',
    v_receipt, v_billjv, v_left;
END;
$repost$;

-- ===========================================================================
-- 5. Retire 2110 Patient Advance — but ONLY if it is fully re-posted:
--    no live post-cutover leg still references it and its opening balance is
--    zero (probed 0.00 on 2026-08-02). Pre-cutover entries are not the book
--    of record (Tally cutover) and were soft-cancelled by square_the_cutover,
--    so they do not block retirement. If anything live remains, the ledger
--    stays active so the unresolved legs still roll up somewhere visible.
-- ===========================================================================
DO $retire$
DECLARE
  v_2110    UUID;
  v_left    INTEGER;
  v_opening NUMERIC;
BEGIN
  SELECT id, COALESCE(opening_balance, 0) INTO v_2110, v_opening
    FROM chart_of_accounts
   WHERE account_code = '2110'
     AND lower(account_name) LIKE '%patient advance%';

  IF v_2110 IS NULL THEN
    RETURN;
  END IF;

  SELECT COUNT(*) INTO v_left
    FROM voucher_entries e
    JOIN vouchers v ON v.id = e.voucher_id
   WHERE e.account_id = v_2110
     AND v.status <> 'CANCELLED'
     AND v.voucher_date >= DATE '2026-07-25';

  IF v_left = 0 AND v_opening = 0 THEN
    UPDATE chart_of_accounts
       SET is_active = false,
           updated_at = NOW()
     WHERE id = v_2110
       AND is_active = true;
    RAISE NOTICE 'Patient Advance (2110) fully re-posted; ledger deactivated.';
  ELSE
    RAISE NOTICE 'Patient Advance (2110) left ACTIVE: % live post-cutover leg(s) still reference it (opening balance %). Resolve them with the report query below, re-run this migration, and it will retire itself.',
      v_left, v_opening;
  END IF;
END;
$retire$;

COMMIT;

-- ===========================================================================
-- REPORT QUERIES (read-only; run by hand after the migration)
-- ===========================================================================

-- R1. Legs still on Patient Advance whose visit context could not be resolved
--     (no visit row for the code, patient_type not OPD/IPD, or income ledger
--     name missing). These were deliberately left rather than guessed.
--
-- SELECT vch.voucher_number, vch.voucher_date, vch.narration,
--        e.debit_amount, e.credit_amount,
--        vch.reference_number, vch.bill_id,
--        p.name AS patient, p.hospital_name,
--        ap.visit_id AS advance_visit_code, vis.patient_type
--   FROM voucher_entries e
--   JOIN vouchers vch ON vch.id = e.voucher_id
--   LEFT JOIN patients p ON p.id = vch.patient_id
--   LEFT JOIN advance_payment ap ON ap.id::TEXT = vch.reference_number
--   LEFT JOIN visits vis ON vis.visit_id = ap.visit_id
--  WHERE e.account_id = (SELECT id FROM chart_of_accounts WHERE account_code = '2110')
--    AND vch.status <> 'CANCELLED'
--    AND vch.voucher_date >= DATE '2026-07-25'
--  ORDER BY vch.voucher_date;

-- R2. Out of this order's scope, for a follow-up decision: post-cutover
--     advance receipts whose credit leg 20260730120000 moved onto the
--     patient's PERSONAL ledger (not 2110). Under strict cash basis these
--     would also belong on the income ledgers, but moving them interacts
--     with bill accruals and final-payment settlements already posted
--     against those patient ledgers, so they were not touched here.
--
-- SELECT vch.voucher_number, vch.voucher_date, vch.narration,
--        e.credit_amount, ca.account_name AS credited_ledger
--   FROM voucher_entries e
--   JOIN vouchers vch ON vch.id = e.voucher_id
--   JOIN chart_of_accounts ca ON ca.id = e.account_id
--   JOIN advance_payment ap ON ap.id::TEXT = vch.reference_number
--  WHERE vch.status <> 'CANCELLED'
--    AND vch.voucher_date >= DATE '2026-07-25'
--    AND e.credit_amount > 0
--    AND ca.account_code LIKE 'PT%'
--  ORDER BY vch.voucher_date;
