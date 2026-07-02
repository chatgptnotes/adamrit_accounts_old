-- ============================================================================
-- FIX: Update trigger to handle ONLINE/Bank payments
-- Date: 2025-11-03
-- Problem: Trigger only created vouchers for CASH payments, ignoring ONLINE
-- Solution: Process both CASH and ONLINE, use correct account based on mode
-- ============================================================================

CREATE OR REPLACE FUNCTION create_receipt_voucher_for_payment()
RETURNS TRIGGER AS $$
DECLARE
  v_voucher_id UUID;
  v_voucher_number TEXT;
  v_voucher_type_id UUID;
  v_debit_account_id UUID;  -- Changed from v_cash_account_id
  v_revenue_account_id UUID;
  v_patient_id UUID;
  v_payment_amount DECIMAL(15,2);
  v_payment_mode TEXT;
  v_payment_date DATE;
  v_bank_account_id UUID;  -- NEW: Store bank account ID
BEGIN
  -- Extract payment details based on which table triggered this
  IF TG_TABLE_NAME = 'final_payments' THEN
    v_payment_amount := NEW.amount;
    v_payment_mode := NEW.mode_of_payment;
    v_payment_date := CURRENT_DATE;
    v_bank_account_id := NEW.bank_account_id;  -- NEW: Get bank account

    -- Get patient_id from visit
    SELECT patient_id INTO v_patient_id
    FROM visits
    WHERE visit_id = NEW.visit_id;

  ELSIF TG_TABLE_NAME = 'advance_payment' THEN
    v_payment_amount := NEW.advance_amount;
    v_payment_mode := NEW.payment_mode;
    v_payment_date := NEW.payment_date::DATE;
    v_patient_id := NEW.patient_id;
    v_bank_account_id := NEW.bank_account_id;  -- NEW: Get bank account

  END IF;

  -- REMOVED: CASH-only check - now we process both CASH and ONLINE!

  -- NEW: Select debit account based on payment mode
  IF v_payment_mode IN ('CASH', 'Cash', 'cash') THEN
    -- For CASH: Use Cash in Hand account (account code 1110)
    SELECT id INTO v_debit_account_id
    FROM chart_of_accounts
    WHERE account_code = '1110' AND account_name = 'Cash in Hand';

    IF v_debit_account_id IS NULL THEN
      RAISE WARNING 'Cash in Hand account not found. Voucher not created.';
      RETURN NEW;
    END IF;

  ELSIF v_payment_mode IN ('ONLINE', 'Online', 'online') THEN
    -- For ONLINE: Use bank account from payment record
    v_debit_account_id := v_bank_account_id;

    IF v_debit_account_id IS NULL THEN
      RAISE WARNING 'Bank account not specified for ONLINE payment. Voucher not created.';
      RETURN NEW;
    END IF;

  ELSE
    -- Other payment modes: skip voucher creation
    RAISE NOTICE 'Payment mode % not handled by auto-voucher system', v_payment_mode;
    RETURN NEW;
  END IF;

  -- Get Receipt voucher type ID
  SELECT id INTO v_voucher_type_id
  FROM voucher_types
  WHERE voucher_type_code = 'REC';

  -- Get Income account ID for revenue (using INCOME account code 4000)
  SELECT id INTO v_revenue_account_id
  FROM chart_of_accounts
  WHERE account_code = '4000' AND account_name = 'INCOME';

  -- If revenue account doesn't exist, log error and skip
  IF v_revenue_account_id IS NULL THEN
    RAISE WARNING 'Revenue account not found. Voucher not created.';
    RETURN NEW;
  END IF;

  -- Generate voucher number
  v_voucher_number := generate_voucher_number('REC');
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
      ELSE NULL
    END,
    CASE
      WHEN TG_TABLE_NAME = 'final_payments' AND v_payment_mode IN ('CASH', 'Cash', 'cash') THEN 'Cash payment received on final bill'
      WHEN TG_TABLE_NAME = 'final_payments' AND v_payment_mode IN ('ONLINE', 'Online', 'online') THEN 'Online payment received on final bill'
      WHEN TG_TABLE_NAME = 'advance_payment' AND v_payment_mode IN ('CASH', 'Cash', 'cash') THEN 'Advance cash payment received'
      WHEN TG_TABLE_NAME = 'advance_payment' AND v_payment_mode IN ('ONLINE', 'Online', 'online') THEN 'Advance payment received via ONLINE - ' || COALESCE((SELECT account_name FROM chart_of_accounts WHERE id = v_bank_account_id), 'BANK')
      ELSE 'Payment received'
    END,
    v_payment_amount,
    v_patient_id,
    'AUTHORISED',  -- Auto-authorize receipts
    COALESCE(NEW.created_by, 'system'),
    NOW(),
    NOW()
  );

  -- Create voucher entry 1: DEBIT Cash/Bank Account
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
    v_debit_account_id,  -- Now uses bank account for ONLINE, cash for CASH
    CASE
      WHEN v_payment_mode IN ('CASH', 'Cash', 'cash') THEN 'Cash received from patient'
      ELSE 'Advance payment received via ONLINE - ' || COALESCE((SELECT account_name FROM chart_of_accounts WHERE id = v_bank_account_id), 'BANK')
    END,
    v_payment_amount,
    0,
    NOW()
  );

  -- Create voucher entry 2: CREDIT Revenue/Income
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

  RAISE NOTICE 'Receipt voucher % created for % payment of %', v_voucher_number, v_payment_mode, v_payment_amount;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION create_receipt_voucher_for_payment() IS
'Automatically creates Receipt vouchers for both CASH and ONLINE payments. For CASH, debits Cash in Hand. For ONLINE, debits the specified bank account.';

-- ============================================================================
-- Verification Message
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ TRIGGER UPDATED - Now handles ONLINE payments!';
  RAISE NOTICE '';
  RAISE NOTICE 'Changes:';
  RAISE NOTICE '  - CASH payments → Debit Cash in Hand (1110)';
  RAISE NOTICE '  - ONLINE payments → Debit Bank Account from payment record';
  RAISE NOTICE '  - Both → Credit Income (4000)';
  RAISE NOTICE '';
  RAISE NOTICE 'NOTE: Existing Nov 3 payments need vouchers created manually.';
  RAISE NOTICE 'Future ONLINE payments will auto-create vouchers!';
  RAISE NOTICE '═══════════════════════════════════════════════════════════';
END $$;
