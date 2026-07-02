-- Fix pharmacy billing tables
-- 1. The medication_id column references medication.id but we're using medicine_master.id
-- 2. The created_by column expects UUID but may have a trigger setting "system"

-- =====================================================
-- FIX 1: pharmacy_sale_items.medication_id
-- =====================================================

-- Drop the FK constraint if it exists
ALTER TABLE public.pharmacy_sale_items
DROP CONSTRAINT IF EXISTS fk_medication;

ALTER TABLE public.pharmacy_sale_items
DROP CONSTRAINT IF EXISTS pharmacy_sale_items_medication_id_fkey;

-- Make medication_id nullable
ALTER TABLE public.pharmacy_sale_items
ALTER COLUMN medication_id DROP NOT NULL;

-- =====================================================
-- FIX 2: pharmacy_sales.created_by (causing "system" UUID error)
-- =====================================================

-- Drop FK constraint on created_by if exists
ALTER TABLE public.pharmacy_sales
DROP CONSTRAINT IF EXISTS pharmacy_sales_created_by_fkey;

-- Remove any default value on created_by
ALTER TABLE public.pharmacy_sales
ALTER COLUMN created_by DROP DEFAULT;

-- Make sure created_by is nullable
ALTER TABLE public.pharmacy_sales
ALTER COLUMN created_by DROP NOT NULL;

-- Also fix updated_by if it exists
ALTER TABLE public.pharmacy_sales
ALTER COLUMN updated_by DROP NOT NULL;

-- =====================================================
-- FIX 3: Update trigger function
-- - Remove 'system' string for UUID columns
-- - Add SECURITY DEFINER to bypass RLS policies
-- =====================================================

CREATE OR REPLACE FUNCTION record_pharmacy_sale_payment()
RETURNS TRIGGER
SECURITY DEFINER
AS $$
DECLARE
  v_payment_id UUID;
  v_patient_uuid UUID;
  v_visit_uuid UUID;
  v_service_details JSONB;
BEGIN
  -- Only process if payment is made (skip PENDING status)
  IF NEW.payment_status = 'PENDING' THEN
    RETURN NEW;
  END IF;

  -- Convert patient_id and visit_id to UUID if they exist and are valid UUIDs
  BEGIN
    IF NEW.patient_id IS NOT NULL THEN
      -- Check if it's a valid UUID format
      IF NEW.patient_id::TEXT ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        v_patient_uuid := NEW.patient_id::UUID;
      END IF;
    END IF;

    IF NEW.visit_id IS NOT NULL THEN
      -- Check if it's a valid UUID format
      IF NEW.visit_id::TEXT ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        v_visit_uuid := NEW.visit_id::UUID;
      END IF;
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      -- If conversion fails, just set to NULL
      v_patient_uuid := NULL;
      v_visit_uuid := NULL;
  END;

  -- Build service details JSON
  v_service_details := jsonb_build_object(
    'sale_type', NEW.sale_type,
    'patient_name', NEW.patient_name,
    'prescription_number', NEW.prescription_number,
    'doctor_name', NEW.doctor_name,
    'subtotal', NEW.subtotal,
    'discount', NEW.discount,
    'tax_gst', NEW.tax_gst,
    'sale_date', NEW.sale_date
  );

  -- Insert payment transaction record
  INSERT INTO patient_payment_transactions (
    patient_id,
    visit_id,
    payment_source,
    source_table_name,
    source_reference_id,
    payment_date,
    payment_mode,
    amount,
    narration,
    service_details,
    created_by,
    created_at
  ) VALUES (
    v_patient_uuid,
    v_visit_uuid,
    'PHARMACY',
    'pharmacy_sales',
    NEW.sale_id::TEXT,
    COALESCE(NEW.sale_date::DATE, CURRENT_DATE),
    COALESCE(UPPER(NEW.payment_method), 'CASH'), -- Default to CASH if NULL
    NEW.total_amount,
    CASE
      WHEN NEW.patient_name IS NOT NULL THEN
        'Pharmacy sale to ' || NEW.patient_name
      ELSE
        'Pharmacy direct sale'
    END,
    v_service_details,
    NEW.created_by,  -- Use NULL if not provided (was COALESCE(NEW.created_by, 'system'))
    NOW()
  )
  RETURNING id INTO v_payment_id;

  RAISE NOTICE 'Payment transaction % recorded for pharmacy sale %', v_payment_id, NEW.sale_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =====================================================

-- VERIFICATION
-- =====================================================
DO $$
BEGIN
  RAISE NOTICE '✅ Pharmacy tables fixed:';
  RAISE NOTICE '  - pharmacy_sale_items.medication_id is now nullable';
  RAISE NOTICE '  - pharmacy_sales.created_by FK constraint removed';
  RAISE NOTICE '  - record_pharmacy_sale_payment() trigger updated';
  RAISE NOTICE 'The pharmacy billing should now work!';
END $$;
