-- Stop the discharge receipt from booking a second sale.
--
-- 20260726130000_post_bill_vouchers.sql accrues revenue when a bill is
-- approved (Dr patient ledger / Cr the 41xx income leaves). If the discharge
-- receipt kept crediting 4160 Hospital Services Income, every rupee would hit
-- the P&L twice — once when billed and again when collected. Collecting cash
-- against a bill settles a receivable, so the credit leg becomes the patient's
-- own ledger.
--
-- Body copied verbatim from 20260704200000_receipt_voucher_proper_ledgers.sql
-- with only the credit-side resolution changed. The advance_payment branch
-- (Cr 2110 Patient Advance) and all the bank-routing logic are untouched.
--
-- No trigger is re-attached here: 20260725110000 exists precisely because a
-- hand-run duplicate trigger double-minted 706 vouchers. CREATE OR REPLACE
-- FUNCTION is enough — the existing triggers pick up the new body.

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
BEGIN
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

    -- Get patient_id from visit
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

    v_narration := 'Advance payment received';

  ELSIF TG_TABLE_NAME = 'patient_payment_transactions' THEN
    v_payment_amount := NEW.amount;
    v_payment_mode := NEW.payment_mode;
    v_payment_date := NEW.payment_date;
    v_patient_id := NEW.patient_id;
    v_remarks := NEW.narration;
    v_bank_account_id := NULL; -- This table doesn't have bank_account_id yet
    v_bank_account_name := NULL;

    -- Use custom narration or build from payment source
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
  -- Determine which account to debit based on payment mode and bank selection
  -- ========================================================================

  -- Default to Cash in Hand
  v_account_name := 'Cash in Hand';
  v_debit_account_id := NULL;

  -- Handle CASH payments
  IF v_payment_mode IN ('CASH', 'Cash', 'cash') THEN
    -- Check if remarks contains bank routing keywords (backward compatibility)
    IF v_remarks IS NOT NULL AND v_remarks != '' THEN
      IF v_remarks ILIKE '%sbi%' OR v_remarks ILIKE '%state bank%' OR v_remarks ILIKE '%drm%' THEN
        v_account_name := 'STATE BANK OF INDIA (DRM)';
      ELSIF v_remarks ILIKE '%saraswat%' THEN
        v_account_name := 'SARASWAT BANK';
      END IF;
    END IF;

  -- Handle ONLINE and Bank Transfer payments
  ELSIF v_payment_mode IN ('ONLINE', 'Online', 'online', 'Bank Transfer', 'BANK TRANSFER') THEN
    -- Use bank_account_id if provided (preferred method)
    IF v_bank_account_id IS NOT NULL THEN
      SELECT id, account_name INTO v_debit_account_id, v_account_name
      FROM chart_of_accounts
      WHERE id = v_bank_account_id
        AND is_active = true;

      RAISE NOTICE 'ONLINE payment: Using bank_account_id % (%)', v_bank_account_id, v_account_name;

    -- Fallback to bank_account_name if bank_account_id lookup failed
    ELSIF v_bank_account_name IS NOT NULL AND v_bank_account_name != '' THEN
      SELECT id, account_name INTO v_debit_account_id, v_account_name
      FROM chart_of_accounts
      WHERE account_name = v_bank_account_name
        AND is_active = true;

      RAISE NOTICE 'ONLINE payment: Using bank_account_name "%"', v_account_name;

    -- Final fallback: parse remarks for bank keywords
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

  -- Handle other electronic payment modes (UPI, NEFT, RTGS, etc.)
  ELSIF v_payment_mode IN ('UPI', 'NEFT', 'RTGS', 'CARD', 'CHEQUE', 'DD') THEN
    -- Check if bank account is specified
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
      -- Parse remarks for bank keywords
      IF v_remarks ILIKE '%sbi%' OR v_remarks ILIKE '%state bank%' OR v_remarks ILIKE '%drm%' THEN
        v_account_name := 'STATE BANK OF INDIA (DRM)';
      ELSIF v_remarks ILIKE '%saraswat%' THEN
        v_account_name := 'SARASWAT BANK';
      END IF;
    END IF;
  END IF;

  -- ========================================================================
  -- Route PHARMACY non-cash payments to Canara Bank HOPE PHARMACY
  -- When payment comes from pharmacy via patient_payment_transactions and
  -- no bank was explicitly set, route non-cash payments to account 1124
  -- ========================================================================
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

  -- ========================================================================
  -- Get the debit account ID if not already set
  -- ========================================================================
  IF v_debit_account_id IS NULL THEN
    SELECT id INTO v_debit_account_id
    FROM chart_of_accounts
    WHERE account_name = v_account_name
      AND is_active = true;
  END IF;

  -- Fallback to Cash in Hand if specific account not found
  IF v_debit_account_id IS NULL THEN
    RAISE WARNING 'Account "%" not found or inactive, falling back to Cash in Hand', v_account_name;

    SELECT id INTO v_debit_account_id
    FROM chart_of_accounts
    WHERE account_code = '1110' AND account_name = 'Cash in Hand';

    v_account_name := 'Cash in Hand';
  END IF;

  -- ========================================================================
  -- Get other required account IDs
  -- ========================================================================

  -- Get Receipt voucher type ID - try 'REC' first, then 'RV'
  SELECT id, voucher_type_code INTO v_voucher_type_id, v_voucher_type_code
  FROM voucher_types
  WHERE voucher_type_code IN ('REC', 'RV')
    AND voucher_category = 'RECEIPT'
    AND is_active = true
  ORDER BY CASE WHEN voucher_type_code = 'REC' THEN 1 ELSE 2 END
  LIMIT 1;

  -- Credit side.
  --  * Advances are a liability (Patient Advance) until the bill is raised.
  --  * A final payment settles the receivable that post_bill_vouchers() raised
  --    at bill approval, so it credits the patient's own ledger. Crediting
  --    income here as well would double-count the revenue.
  --  * Everything else (OPD, pharmacy, physio, direct sale) is billed and
  --    collected in one step, so it still credits income directly.
  v_credit_narration := 'Patient payment received';

  IF TG_TABLE_NAME = 'advance_payment' THEN
    SELECT id INTO v_revenue_account_id
    FROM chart_of_accounts
    WHERE account_code = '2110' AND is_active = true;  -- Patient Advance

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
      -- Patient has no ledger (pre-20260726110000 record with no UID).
      -- Fall back to the old behaviour rather than skipping the voucher.
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
    WHERE account_code = '4160' AND is_active = true;  -- Hospital Services Income
  END IF;

  -- Fallback to the old INCOME account if the specific ledger is missing
  IF v_revenue_account_id IS NULL THEN
    SELECT id INTO v_revenue_account_id
    FROM chart_of_accounts
    WHERE account_code = '4000' AND account_name = 'INCOME';
  END IF;

  -- If required accounts don't exist, log error and skip
  IF v_voucher_type_id IS NULL OR v_debit_account_id IS NULL OR v_revenue_account_id IS NULL THEN
    RAISE WARNING 'Required accounts not found. Voucher not created.';
    RAISE WARNING 'Voucher Type ID: %, Debit Account ID: %, Revenue Account ID: %',
                  v_voucher_type_id, v_debit_account_id, v_revenue_account_id;
    RETURN NEW;
  END IF;

  -- ========================================================================
  -- Generate voucher number
  -- ========================================================================
  v_voucher_number := generate_voucher_number(v_voucher_type_code);
  v_voucher_id := gen_random_uuid();

  -- ========================================================================
  -- Create voucher header
  -- ========================================================================
  INSERT INTO vouchers (
    id,
    voucher_number,
    voucher_type_id,
    voucher_date,
    reference_number,
    narration,
    total_amount,
    patient_id,
    status,
    created_by,
    created_at,
    updated_at
  ) VALUES (
    v_voucher_id,
    v_voucher_number,
    v_voucher_type_id,
    v_payment_date,
    CASE
      WHEN TG_TABLE_NAME = 'final_payments' THEN NEW.visit_id
      WHEN TG_TABLE_NAME = 'patient_payment_transactions' THEN NEW.id::TEXT
      ELSE NULL
    END,
    v_narration || ' via ' || v_payment_mode || ' - ' || v_account_name,
    v_payment_amount,
    v_patient_id,
    'AUTHORISED',
    CASE WHEN TG_TABLE_NAME = 'patient_payment_transactions' THEN NEW.created_by ELSE NULL END,
    NOW(),
    NOW()
  );

  -- ========================================================================
  -- Create voucher entry 1: DEBIT Bank/Cash Account
  -- ========================================================================
  INSERT INTO voucher_entries (
    id,
    voucher_id,
    account_id,
    narration,
    debit_amount,
    credit_amount,
    created_at
  ) VALUES (
    gen_random_uuid(),
    v_voucher_id,
    v_debit_account_id,
    'Payment received from patient via ' || v_payment_mode || ' to ' || v_account_name,
    v_payment_amount,
    0,
    NOW()
  );

  -- ========================================================================
  -- Create voucher entry 2: CREDIT patient ledger / advance / income
  -- ========================================================================
  INSERT INTO voucher_entries (
    id,
    voucher_id,
    account_id,
    patient_ledger_id,
    narration,
    debit_amount,
    credit_amount,
    created_at
  ) VALUES (
    gen_random_uuid(),
    v_voucher_id,
    v_revenue_account_id,
    v_patient_ledger_id,
    v_credit_narration,
    0,
    v_payment_amount,
    NOW()
  );

  -- ========================================================================
  -- Success log with account information
  -- ========================================================================
  RAISE NOTICE 'SUCCESS: Receipt voucher % created for % payment of Rs % to account "%"',
    v_voucher_number, v_payment_mode, v_payment_amount, v_account_name;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
