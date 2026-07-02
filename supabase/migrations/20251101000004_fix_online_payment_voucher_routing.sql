-- ============================================================================
-- Fix Online Payment Voucher Routing
-- Date: 2025-11-01
-- Purpose: Enable voucher creation for ONLINE and Bank Transfer payments
--          Use bank_account_id and bank_account_name from payment tables
--
-- FIXED:
--   1. Now handles both 'REC' and 'RV' voucher type codes
--   2. Automatically inserts 'REC' if missing for compatibility
--   3. Function accepts TEXT dates (frontend sends strings, not DATE objects)
--   4. Includes generate_voucher_number function (self-contained)
--   5. Drops old function signature to prevent PostgreSQL function overloading
--   6. All VARCHAR columns cast to TEXT to match return type
-- ============================================================================

-- ============================================================================
-- STEP 1: Ensure ledger statement function exists
-- ============================================================================
-- Drop the old function with DATE parameters to avoid function overloading issues
-- PostgreSQL treats functions with different parameter types as separate functions
DROP FUNCTION IF EXISTS get_ledger_statement_with_patients(TEXT, DATE, DATE, TEXT);

-- Now create the function with TEXT parameters (frontend sends date strings)
CREATE OR REPLACE FUNCTION get_ledger_statement_with_patients(
  p_account_name TEXT,
  p_from_date TEXT,
  p_to_date TEXT,
  p_mrn_filter TEXT DEFAULT NULL
)
RETURNS TABLE (
  voucher_date DATE,
  voucher_number TEXT,
  voucher_type TEXT,
  narration TEXT,
  patient_name TEXT,
  mrn_number TEXT,
  patient_id UUID,
  visit_id TEXT,
  visit_type TEXT,
  patient_type TEXT,
  payment_type TEXT,
  debit_amount DECIMAL,
  credit_amount DECIMAL,
  payment_mode TEXT,
  remarks TEXT,
  is_refund BOOLEAN,
  bank_account TEXT,
  account_code TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    v.voucher_date,
    v.voucher_number::TEXT,
    vt.voucher_type_name::TEXT as voucher_type,
    v.narration::TEXT,

    -- Patient Details
    COALESCE(p.name::TEXT, 'Unknown') as patient_name,
    COALESCE(p.patients_id::TEXT, '') as mrn_number,
    v.patient_id,

    -- Visit Details
    COALESCE(vis.visit_id::TEXT, '') as visit_id,
    COALESCE(vis.visit_type::TEXT, '') as visit_type,
    COALESCE(vis.patient_type::TEXT, '') as patient_type,

    -- Payment Type Classification
    CASE
      WHEN ap.id IS NOT NULL AND ap.is_refund = FALSE THEN 'ADVANCE_PAYMENT'
      WHEN ap.id IS NOT NULL AND ap.is_refund = TRUE THEN 'ADVANCE_REFUND'
      WHEN fp.id IS NOT NULL THEN 'FINAL_PAYMENT'
      ELSE 'OTHER'
    END as payment_type,

    -- Amount Details
    ve.debit_amount,
    ve.credit_amount,

    -- Payment Mode and Remarks
    COALESCE(ap.payment_mode::TEXT, fp.mode_of_payment::TEXT, '') as payment_mode,
    COALESCE(ap.remarks::TEXT, fp.payment_remark::TEXT, '') as remarks,
    COALESCE(ap.is_refund, FALSE) as is_refund,

    -- Bank Account Info
    coa.account_name::TEXT as bank_account,
    coa.account_code::TEXT

  FROM voucher_entries ve

  -- Join vouchers table
  INNER JOIN vouchers v ON ve.voucher_id = v.id

  -- Join chart of accounts to filter by bank
  INNER JOIN chart_of_accounts coa ON ve.account_id = coa.id

  -- Join voucher types
  LEFT JOIN voucher_types vt ON v.voucher_type_id = vt.id

  -- Join patients table (FK: vouchers.patient_id -> patients.id)
  LEFT JOIN patients p ON v.patient_id = p.id

  -- Join visits table (FK: visits.patient_id -> patients.id)
  LEFT JOIN visits vis ON vis.patient_id = v.patient_id

  -- Join advance_payment to identify advance payments
  LEFT JOIN advance_payment ap ON (
    ap.patient_id = v.patient_id
    AND DATE(ap.payment_date) = v.voucher_date
    AND ap.advance_amount = GREATEST(ve.debit_amount, ve.credit_amount)
  )

  -- Join final_payments to identify final payments
  LEFT JOIN final_payments fp ON (
    fp.visit_id = vis.visit_id
    AND DATE(fp.created_at) = v.voucher_date
    AND fp.amount = GREATEST(ve.debit_amount, ve.credit_amount)
  )

  -- Filters
  WHERE coa.account_name = p_account_name
    AND v.voucher_date BETWEEN p_from_date::DATE AND p_to_date::DATE
    AND v.status = 'AUTHORISED'
    AND (p_mrn_filter IS NULL OR p.patients_id ILIKE '%' || p_mrn_filter || '%')

  ORDER BY v.voucher_date DESC, v.voucher_number DESC;
END;
$$ LANGUAGE plpgsql;

-- Add comment to function
COMMENT ON FUNCTION get_ledger_statement_with_patients IS
'Retrieves ledger statement entries for a specific bank account with complete patient details including MRN, visit ID, and payment type classification';

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION get_ledger_statement_with_patients TO authenticated;

-- ============================================================================
-- STEP 2: Create/Update voucher number generation function
-- ============================================================================
-- Drop existing function first to allow parameter name change
DROP FUNCTION IF EXISTS generate_voucher_number(TEXT);

-- This function generates sequential voucher numbers like REC-001, REC-002, etc.
CREATE OR REPLACE FUNCTION generate_voucher_number(p_voucher_type_code TEXT)
RETURNS TEXT AS $$
DECLARE
  current_num INTEGER;
  new_number TEXT;
BEGIN
  -- Get and increment the current number for this voucher type
  UPDATE voucher_types
  SET current_number = current_number + 1
  WHERE voucher_types.voucher_type_code = p_voucher_type_code
  RETURNING current_number INTO current_num;

  -- Handle case where voucher type doesn't exist
  IF current_num IS NULL THEN
    RAISE EXCEPTION 'Voucher type % not found in voucher_types table', p_voucher_type_code;
  END IF;

  -- Format: REC-001, RV-001, etc.
  new_number := p_voucher_type_code || '-' || LPAD(current_num::TEXT, 3, '0');

  RETURN new_number;
END;
$$ LANGUAGE plpgsql;

-- Add comment
COMMENT ON FUNCTION generate_voucher_number IS 'Generates sequential voucher numbers for different voucher types';

-- ============================================================================
-- STEP 3: Ensure 'REC' voucher type exists (for compatibility)
-- ============================================================================
-- Insert 'REC' voucher type if it doesn't exist (works with both old and new databases)
INSERT INTO voucher_types (voucher_type_code, voucher_type_name, voucher_category, prefix, current_number, is_active)
VALUES ('REC', 'Receipt Voucher', 'RECEIPT', 'REC', 1, true)
ON CONFLICT (voucher_type_code) DO NOTHING;

-- ============================================================================
-- STEP 4: Update payment voucher trigger to handle ALL payment modes
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
      -- Get account details using the bank_account_id
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

  -- Get Income account ID for revenue
  SELECT id INTO v_revenue_account_id
  FROM chart_of_accounts
  WHERE account_code = '4000' AND account_name = 'INCOME';

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
    COALESCE(NEW.created_by, 'system'),
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
  -- Create voucher entry 2: CREDIT Revenue/Income
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
    v_revenue_account_id,
    'Patient payment received',
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

-- ============================================================================
-- Update function comment
-- ============================================================================
COMMENT ON FUNCTION create_receipt_voucher_for_payment() IS
'Automatically creates Receipt vouchers for ALL payment modes (CASH, ONLINE, UPI, etc.).
Routes payments to appropriate bank accounts using bank_account_id/bank_account_name from payment tables.
Fallback: parses remarks field for bank keywords. Ensures all payments appear in ledger statements.';

-- ============================================================================
-- Success message
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE '✓ Online payment voucher routing fixed!';
  RAISE NOTICE '========================================';
  RAISE NOTICE '';
  RAISE NOTICE 'Payment Routing Logic:';
  RAISE NOTICE '  1. ONLINE/Bank Transfer payments:';
  RAISE NOTICE '     - Uses bank_account_id from payment table (preferred)';
  RAISE NOTICE '     - Falls back to bank_account_name';
  RAISE NOTICE '     - Final fallback: parses remarks for keywords';
  RAISE NOTICE '';
  RAISE NOTICE '  2. CASH payments:';
  RAISE NOTICE '     - Routes to Cash in Hand (default)';
  RAISE NOTICE '     - Can be overridden via remarks keywords';
  RAISE NOTICE '';
  RAISE NOTICE '  3. Other modes (UPI, NEFT, RTGS, etc.):';
  RAISE NOTICE '     - Uses bank_account_id if provided';
  RAISE NOTICE '     - Falls back to Cash in Hand';
  RAISE NOTICE '';
  RAISE NOTICE 'All payments now create voucher entries and appear in ledger!';
  RAISE NOTICE '========================================';
END $$;
