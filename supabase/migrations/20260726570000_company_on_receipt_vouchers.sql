-- Put a company on every receipt voucher.
--
-- create_receipt_voucher_for_payment is the single path behind all three
-- receipt sources - advance_payment, final_payments and
-- patient_payment_transactions, which is where pharmacy sales arrive. It has
-- never set company_id.
--
-- A company's trial balance is built from its own vouchers, so a voucher with
-- none appears in nobody's. It still balances, which is why this went unseen
-- until the day-one check asked whether every voucher carried a company.
--
-- 124 such vouchers existed since the cutover. 85 were recovered from the
-- patient already on the voucher; the 39 left were all pharmacy sales, where
-- no patient is matched.
--
-- So the company is resolved the way everything else resolves it - from the
-- patient - and a pharmacy transaction with no patient falls to Hope Pharmacy,
-- where the pharmacy purchases and credit sales already post.
--
-- Only company_id is added. Every other line is as it was.

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
    SELECT id INTO v_revenue_account_id
    FROM chart_of_accounts
    WHERE account_code = '2110' AND is_active = true;

    IF v_is_refund THEN
      v_credit_narration := 'Advance refunded to patient';
    END IF;

  ELSIF TG_TABLE_NAME = 'final_payments' THEN
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
    SELECT id INTO v_revenue_account_id
    FROM chart_of_accounts
    WHERE account_code = '4160' AND is_active = true;
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
  -- where the rest of the pharmacy postings go.
  SELECT public.resolve_patient_company(p.hospital_name, p.corporate)
    INTO v_company_id
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
    v_narration || ' via ' || v_payment_mode || ' - ' || v_account_name,
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
$$ LANGUAGE plpgsql;
