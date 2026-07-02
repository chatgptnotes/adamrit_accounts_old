-- ========================================================
-- ADD FORMULA FOR IRON STUDIES PROFILE NESTED SUB-TESTS
-- ========================================================
-- Migration Date: 2025-01-24
-- Description: Adds formula for Transferin Saturation calculation
--              in IRON STUDIES PROFILE test
--
-- Formula: Serum Iron / Total iron binding capacity (TIBC) * 100
-- ========================================================

-- First, let's see what data exists in lab_test_config for IRON STUDIES
DO $$
DECLARE
    v_lab_id UUID;
    v_test_name TEXT := 'IRON STUDIES PROFILE';
    v_nested_data JSONB;
BEGIN
    -- Get lab_id from labs table (assuming single lab setup)
    SELECT id INTO v_lab_id FROM public.labs LIMIT 1;

    IF v_lab_id IS NULL THEN
        RAISE NOTICE 'No lab found in labs table';
        RETURN;
    END IF;

    RAISE NOTICE 'Lab ID: %', v_lab_id;

    -- Check existing nested_sub_tests structure
    SELECT nested_sub_tests INTO v_nested_data
    FROM public.lab_test_config
    WHERE test_name ILIKE '%IRON%STUDIES%' OR test_name ILIKE '%Iron%Studies%'
    LIMIT 1;

    IF v_nested_data IS NOT NULL THEN
        RAISE NOTICE 'Nested sub-tests found: %', v_nested_data;
    ELSE
        RAISE NOTICE 'No nested sub-tests found for IRON STUDIES test';
    END IF;

    -- Get exact test name
    SELECT DISTINCT test_name INTO v_test_name
    FROM public.lab_test_config
    WHERE test_name ILIKE '%IRON%STUDIES%' OR test_name ILIKE '%Iron%Studies%'
    LIMIT 1;

    IF v_test_name IS NULL THEN
        RAISE NOTICE 'IRON STUDIES test not found in lab_test_config';
        RETURN;
    END IF;

    RAISE NOTICE 'Exact test name: %', v_test_name;

    -- Insert formula for Transferin Saturation (handle various name formats)
    -- Try common name variations
    INSERT INTO public.lab_test_formulas (id, lab_id, test_name, sub_test_name, formula, test_type, is_active)
    VALUES
        (gen_random_uuid(), v_lab_id, v_test_name, 'Transferin Saturation',
         'Serum Iron / Total iron binding capacity (TIBC) * 100', 'Numeric', true)
    ON CONFLICT (lab_id, test_name, sub_test_name)
    DO UPDATE SET
        formula = EXCLUDED.formula,
        updated_at = NOW();

    RAISE NOTICE 'Formula added/updated for Transferin Saturation';

    -- Also try alternate spelling: Transferrin (with double 'r')
    INSERT INTO public.lab_test_formulas (id, lab_id, test_name, sub_test_name, formula, test_type, is_active)
    VALUES
        (gen_random_uuid(), v_lab_id, v_test_name, 'Transferrin Saturation',
         'Serum Iron / Total iron binding capacity (TIBC) * 100', 'Numeric', true)
    ON CONFLICT (lab_id, test_name, sub_test_name)
    DO UPDATE SET
        formula = EXCLUDED.formula,
        updated_at = NOW();

    RAISE NOTICE 'Formula added/updated for Transferrin Saturation (alternate spelling)';

END $$;

-- Verification query (run manually to check results)
-- SELECT * FROM lab_test_formulas WHERE test_name ILIKE '%IRON%';
-- SELECT test_name, nested_sub_tests FROM lab_test_config WHERE test_name ILIKE '%IRON%';
