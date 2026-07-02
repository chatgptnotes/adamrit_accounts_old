-- ============================================================================
-- Fix Trigger Error Handling
-- Date: 2025-11-01
-- Purpose: Make trigger more resilient - don't fail payment save if voucher creation fails
-- ============================================================================

-- ============================================================================
-- Update trigger function with better error handling
-- ============================================================================
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
BEGIN
  -- Wrap everything in exception handler so payment save doesn't fail
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

    -- ========================================================================
    -- Determine which account to debit
    -- ========================================================================
    v_account_name := 'Cash in Hand'; -- Default
    v_debit_account_id := NULL;

    -- Handle CASH payments
    IF v_payment_mode IN ('CASH', 'Cash', 'cash') THEN
      -- Check remarks for bank routing keywords
      IF v_remarks IS NOT NULL AND v_remarks != '' THEN
        IF v_remarks ILIKE '%sbi%' OR v_remarks ILIKE '%state bank%' OR v_remarks ILIKE '%drm%' THEN
          v_account_name := 'STATE BANK OF INDIA (DRM)';
        ELSIF v_remarks ILIKE '%saraswat%' THEN
          v_account_name := 'SARASWAT BANK';
        END IF;
      END IF;

    -- Handle ONLINE and Bank Transfer payments
    ELSIF v_payment_mode IN ('ONLINE', 'Online', 'online', 'Bank Transfer', 'BANK TRANSFER') THEN
      -- Use bank_account_id if provided
      IF v_bank_account_id IS NOT NULL THEN
        SELECT id, account_name INTO v_debit_account_id, v_account_name
        FROM chart_of_accounts
        WHERE id = v_bank_account_id
          AND is_active = true;

        RAISE NOTICE 'ONLINE payment: Using bank_account_id % (%)', v_bank_account_id, v_account_name;

      -- Fallback to bank_account_name
      ELSIF v_bank_account_name IS NOT NULL AND v_bank_account_name != '' THEN
        SELECT id, account_name INTO v_debit_account_id, v_account_name
        FROM chart_of_accounts
        WHERE account_name = v_bank_account_name
          AND is_active = true;

        RAISE NOTICE 'ONLINE payment: Using bank_account_name "%"', v_account_name;

      -- Final fallback: parse remarks
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

    -- Handle other electronic payment modes
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

    -- Get debit account ID if not already set
    IF v_debit_account_id IS NULL THEN
      SELECT id INTO v_debit_account_id
      FROM chart_of_accounts
      WHERE account_name = v_account_name
        AND is_active = true;
    END IF;

    -- Fallback to Cash in Hand
    IF v_debit_account_id IS NULL THEN
      RAISE WARNING 'Account "%" not found, falling back to Cash in Hand', v_account_name;

      SELECT id INTO v_debit_account_id
      FROM chart_of_accounts
      WHERE account_code = '1110' AND account_name = 'Cash in Hand';

      v_account_name := 'Cash in Hand';
    END IF;

    -- Get Receipt voucher type ID
    SELECT id, voucher_type_code INTO v_voucher_type_id, v_voucher_type_code
    FROM voucher_types
    WHERE voucher_type_code IN ('REC', 'RV')
      AND voucher_category = 'RECEIPT'
      AND is_active = true
    ORDER BY CASE WHEN voucher_type_code = 'REC' THEN 1 ELSE 2 END
    LIMIT 1;

    -- Get Income account ID
    SELECT id INTO v_revenue_account_id
    FROM chart_of_accounts
    WHERE account_code = '4000' AND account_name = 'INCOME';

    -- Check if required accounts exist
    IF v_voucher_type_id IS NULL OR v_debit_account_id IS NULL OR v_revenue_account_id IS NULL THEN
      RAISE WARNING 'Required accounts not found. Voucher not created. Voucher Type: %, Debit Account: %, Revenue Account: %',
                    v_voucher_type_id, v_debit_account_id, v_revenue_account_id;
      -- DON'T FAIL - just return without creating voucher
      RETURN NEW;
    END IF;

    -- Generate voucher number
    v_voucher_number := generate_voucher_number(v_voucher_type_code);
    v_voucher_id := gen_random_uuid();

    -- Create voucher header
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
      COALESCE(NEW.created_by, 'system'),
      NOW(),
      NOW()
    );

    -- Create voucher entry 1: DEBIT
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

    -- Create voucher entry 2: CREDIT
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
      v_revenue_account_id,
      'Patient payment received',
      0,
      v_payment_amount,
      NOW()
    );

    RAISE NOTICE 'SUCCESS: Receipt voucher % created for % payment of Rs % to account "%"',
      v_voucher_number, v_payment_mode, v_payment_amount, v_account_name;

  EXCEPTION
    WHEN OTHERS THEN
      -- Log the error but DON'T fail the payment save
      RAISE WARNING 'Error creating voucher for payment: % %', SQLERRM, SQLSTATE;
      RAISE NOTICE 'Payment will be saved but voucher was not created';
      -- Continue and return NEW so payment save succeeds
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Update comment
COMMENT ON FUNCTION create_receipt_voucher_for_payment() IS
'Automatically creates Receipt vouchers for ALL payment modes. Uses error handling to prevent payment save failures if voucher creation fails.';

-- Success message
DO $$
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE '✓ Trigger updated with error handling!';
  RAISE NOTICE '========================================';
  RAISE NOTICE '';
  RAISE NOTICE 'Changes:';
  RAISE NOTICE '- Added try-catch error handling';
  RAISE NOTICE '- Payment save will NOT fail if voucher creation fails';
  RAISE NOTICE '- Errors are logged as warnings instead';
  RAISE NOTICE '';
  RAISE NOTICE 'Now you can save payments even if voucher creation fails!';
  RAISE NOTICE '========================================';
END $$;
