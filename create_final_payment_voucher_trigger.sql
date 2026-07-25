-- ============================================================================
-- DO NOT RUN. Superseded by
-- supabase/migrations/20260725110000_fix_duplicate_final_payment_vouchers.sql
--
-- The trigger below is named differently from trg_final_payment_create_voucher
-- in supabase/migrations/20250617000003_create_payment_voucher_triggers.sql, so
-- running this leaves BOTH on final_payments and every final payment mints two
-- receipt vouchers. It also fires on UPDATE, so touching a final_payments row
-- mints another one. Kept for history only.
-- ============================================================================

-- ============================================================================
-- CREATE: Trigger for Final Payments Voucher Creation
-- Date: 2025-11-08
-- Purpose: Automatically create vouchers when final payments are saved
--
-- ISSUE: Function exists but trigger was never created
-- RESULT: Vouchers created without patient_id → ledger doesn't show them
-- ============================================================================

-- ============================================================================
-- STEP 1: Check if trigger already exists
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trigger_create_receipt_voucher_final_payment'
      AND tgrelid = 'final_payments'::regclass
  ) THEN
    RAISE NOTICE '✓ Trigger already exists on final_payments table';
  ELSE
    RAISE NOTICE '✗ Trigger does NOT exist - will create it';
  END IF;
END $$;

-- ============================================================================
-- STEP 2: Drop trigger if it exists (to recreate fresh)
-- ============================================================================

DROP TRIGGER IF EXISTS trigger_create_receipt_voucher_final_payment ON final_payments;

-- ============================================================================
-- STEP 3: Create the trigger
-- ============================================================================

CREATE TRIGGER trigger_create_receipt_voucher_final_payment
  AFTER INSERT OR UPDATE ON final_payments
  FOR EACH ROW
  EXECUTE FUNCTION create_receipt_voucher_for_payment();

-- ============================================================================
-- STEP 4: Grant permissions
-- ============================================================================

-- The trigger will execute with the permissions of the function
-- Function already has SECURITY DEFINER, so no additional grants needed

-- ============================================================================
-- STEP 5: Clean up bad voucher data (vouchers without patient_id)
-- ============================================================================

DO $$
DECLARE
  v_deleted_count INTEGER;
BEGIN
  -- Delete voucher entries for vouchers without patient_id
  DELETE FROM voucher_entries
  WHERE voucher_id IN (
    SELECT id FROM vouchers
    WHERE patient_id IS NULL
      AND voucher_date >= '2025-11-08'::DATE
  );

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  RAISE NOTICE 'Deleted % voucher entries with NULL patient_id', v_deleted_count;

  -- Delete vouchers without patient_id
  DELETE FROM vouchers
  WHERE patient_id IS NULL
    AND voucher_date >= '2025-11-08'::DATE;

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  RAISE NOTICE 'Deleted % vouchers with NULL patient_id', v_deleted_count;
END $$;

-- ============================================================================
-- STEP 6: Trigger voucher creation for existing final payments
-- ============================================================================

DO $$
DECLARE
  v_payment RECORD;
  v_count INTEGER := 0;
BEGIN
  -- Re-trigger voucher creation for today's final payments
  FOR v_payment IN
    SELECT id, visit_id, patient_id
    FROM final_payments
    WHERE payment_date >= '2025-11-08'::DATE
      AND patient_id IS NOT NULL
  LOOP
    -- Update the record to trigger the AFTER UPDATE trigger
    UPDATE final_payments
    SET updated_at = NOW()
    WHERE id = v_payment.id;

    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'Triggered voucher creation for % final payments', v_count;
END $$;

-- ============================================================================
-- SUCCESS MESSAGE
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════';
  RAISE NOTICE '✅✅✅ TRIGGER CREATED AND DATA FIXED ✅✅✅';
  RAISE NOTICE '═══════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Changes made:';
  RAISE NOTICE '  1. ✓ Created trigger on final_payments table';
  RAISE NOTICE '  2. ✓ Deleted vouchers with NULL patient_id';
  RAISE NOTICE '  3. ✓ Re-triggered voucher creation for existing payments';
  RAISE NOTICE '';
  RAISE NOTICE 'Result:';
  RAISE NOTICE '  → New vouchers created with proper patient_id';
  RAISE NOTICE '  → Ledger should now show final payment entries';
  RAISE NOTICE '  → All future final payments will auto-create vouchers';
  RAISE NOTICE '═══════════════════════════════════════════════════════════';
END $$;
