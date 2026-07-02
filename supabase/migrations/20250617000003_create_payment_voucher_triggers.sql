-- Automatic Payment to Voucher Entry System
-- Creates Receipt vouchers automatically when CASH payments are received
-- This populates the Cash Book with all cash receipts

-- ============================================================================
-- STEP 1: Create function to generate voucher number
-- ============================================================================
CREATE OR REPLACE FUNCTION generate_voucher_number(voucher_type_code TEXT)
RETURNS TEXT AS $$
DECLARE
  current_num INTEGER;
  new_number TEXT;
BEGIN
  -- Get and increment the current number for this voucher type
  UPDATE voucher_types
  SET current_number = current_number + 1
  WHERE voucher_type_code = generate_voucher_number.voucher_type_code
  RETURNING current_number INTO current_num;

  -- Format: REC-001, PAY-001, etc.
  new_number := voucher_type_code || '-' || LPAD(current_num::TEXT, 3, '0');

  RETURN new_number;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- STEP 2: Create function to auto-create receipt voucher for cash payments
-- ============================================================================
CREATE OR REPLACE FUNCTION create_receipt_voucher_for_payment()
RETURNS TRIGGER AS $$
DECLARE
  v_voucher_id UUID;
  v_voucher_number TEXT;
  v_voucher_type_id UUID;
  v_cash_account_id UUID;
  v_revenue_account_id UUID;
  v_patient_id UUID;
  v_payment_amount DECIMAL(15,2);
  v_payment_mode TEXT;
  v_payment_date DATE;
BEGIN
  -- Extract payment details based on which table triggered this
  IF TG_TABLE_NAME = 'final_payments' THEN
    v_payment_amount := NEW.amount;
    v_payment_mode := NEW.mode_of_payment;
    v_payment_date := CURRENT_DATE;

    -- Get patient_id from visit
    SELECT patient_id INTO v_patient_id
    FROM visits
    WHERE visit_id = NEW.visit_id;

  ELSIF TG_TABLE_NAME = 'advance_payment' THEN
    v_payment_amount := NEW.advance_amount;
    v_payment_mode := NEW.payment_mode;
    v_payment_date := NEW.payment_date::DATE;
    v_patient_id := NEW.patient_id;

  END IF;

  -- Only process CASH payments
  IF v_payment_mode NOT IN ('CASH', 'Cash', 'cash') THEN
    RETURN NEW;
  END IF;

  -- Get Receipt voucher type ID
  SELECT id INTO v_voucher_type_id
  FROM voucher_types
  WHERE voucher_type_code = 'REC';

  -- Get Cash in Hand account ID (account code 1110)
  SELECT id INTO v_cash_account_id
  FROM chart_of_accounts
  WHERE account_code = '1110' AND account_name = 'Cash in Hand';

  -- Get Income account ID for revenue (using INCOME account code 4000)
  SELECT id INTO v_revenue_account_id
  FROM chart_of_accounts
  WHERE account_code = '4000' AND account_name = 'INCOME';

  -- If accounts don't exist, log error and skip
  IF v_cash_account_id IS NULL OR v_revenue_account_id IS NULL THEN
    RAISE WARNING 'Cash or Revenue account not found. Voucher not created.';
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
      WHEN TG_TABLE_NAME = 'final_payments' THEN 'Cash payment received on final bill'
      WHEN TG_TABLE_NAME = 'advance_payment' THEN 'Advance cash payment received'
      ELSE 'Cash payment received'
    END,
    v_payment_amount,
    v_patient_id,
    'AUTHORISED',  -- Auto-authorize cash receipts
    COALESCE(NEW.created_by, 'system'),
    NOW(),
    NOW()
  );

  -- Create voucher entry 1: DEBIT Cash in Hand
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
    v_cash_account_id,
    'Cash received from patient',
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

  RAISE NOTICE 'Receipt voucher % created for cash payment of %', v_voucher_number, v_payment_amount;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- STEP 3: Create triggers on payment tables
-- ============================================================================

-- Trigger for final_payments (discharge payments)
DROP TRIGGER IF EXISTS trg_final_payment_create_voucher ON final_payments;
CREATE TRIGGER trg_final_payment_create_voucher
  AFTER INSERT ON final_payments
  FOR EACH ROW
  EXECUTE FUNCTION create_receipt_voucher_for_payment();

-- Trigger for advance_payment (advance receipts)
DROP TRIGGER IF EXISTS trg_advance_payment_create_voucher ON advance_payment;
CREATE TRIGGER trg_advance_payment_create_voucher
  AFTER INSERT ON advance_payment
  FOR EACH ROW
  EXECUTE FUNCTION create_receipt_voucher_for_payment();

-- ============================================================================
-- STEP 4: Ensure Receipt voucher type exists
-- ============================================================================
INSERT INTO voucher_types (
  id,
  voucher_type_code,
  voucher_type_name,
  voucher_category,
  numbering_method,
  prefix,
  starting_number,
  current_number,
  is_active,
  created_at
) VALUES (
  gen_random_uuid(),
  'REC',
  'Cash Receipt',
  'RECEIPT',
  'AUTO',
  'REC',
  1,
  0,
  true,
  NOW()
)
ON CONFLICT (voucher_type_code) DO NOTHING;

-- ============================================================================
-- STEP 5: Add helpful comment
-- ============================================================================
COMMENT ON FUNCTION create_receipt_voucher_for_payment() IS
'Automatically creates Receipt vouchers in the accounting system when CASH payments are received. This ensures Cash Book is automatically updated with all cash receipts.';
