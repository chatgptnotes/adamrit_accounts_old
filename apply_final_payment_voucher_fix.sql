-- ============================================================================
-- Final bill: stop double receipt vouchers, and clear the historical duplicates.
--
-- final_payments carries two triggers with different names that both call
-- create_receipt_voucher_for_payment():
--   trg_final_payment_create_voucher              AFTER INSERT
--   trigger_create_receipt_voucher_final_payment  AFTER INSERT OR UPDATE
-- Both fire on every insert, so each final bill payment mints two vouchers.
-- 706 of the 751 final-bill payments between 2026-03-25 and 2026-07-04 are affected.
--
-- Run the steps in order. Step 2 is read-only -- check its numbers before Step 3.
--
-- Source files:
--   supabase/migrations/20260725110000_fix_duplicate_final_payment_vouchers.sql
--   cleanup_duplicate_final_payment_vouchers.sql
-- ============================================================================


-- ============================================================================
-- STEP 1 -- Stop new duplicates. Safe, no data deleted.
-- Drops every voucher trigger on final_payments, recreates exactly one, on INSERT.
-- ============================================================================
DO $$
DECLARE
  rec RECORD;
  dropped INTEGER := 0;
BEGIN
  FOR rec IN
    SELECT t.tgname
    FROM pg_trigger t
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE t.tgrelid = 'public.final_payments'::regclass
      AND NOT t.tgisinternal
      AND p.proname = 'create_receipt_voucher_for_payment'
  LOOP
    EXECUTE format('DROP TRIGGER %I ON public.final_payments', rec.tgname);
    RAISE NOTICE 'Dropped duplicate voucher trigger: %', rec.tgname;
    dropped := dropped + 1;
  END LOOP;

  RAISE NOTICE 'Removed % voucher trigger(s) from final_payments', dropped;
END $$;

CREATE TRIGGER trg_final_payment_create_voucher
  AFTER INSERT ON public.final_payments
  FOR EACH ROW
  EXECUTE FUNCTION create_receipt_voucher_for_payment();

-- Assert exactly one remains.
DO $$
DECLARE
  n INTEGER;
  rec RECORD;
BEGIN
  SELECT COUNT(*) INTO n
  FROM pg_trigger t
  JOIN pg_proc p ON p.oid = t.tgfoid
  WHERE t.tgrelid = 'public.final_payments'::regclass
    AND NOT t.tgisinternal
    AND p.proname = 'create_receipt_voucher_for_payment';

  RAISE NOTICE '=== voucher triggers on final_payments: % ===', n;
  FOR rec IN
    SELECT pg_get_triggerdef(t.oid) AS def
    FROM pg_trigger t
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE t.tgrelid = 'public.final_payments'::regclass
      AND NOT t.tgisinternal
      AND p.proname = 'create_receipt_voucher_for_payment'
  LOOP
    RAISE NOTICE '  %', rec.def;
  END LOOP;

  IF n <> 1 THEN
    RAISE EXCEPTION 'Expected exactly 1 voucher trigger on final_payments, found %', n;
  END IF;
END $$;


-- ============================================================================
-- STEP 2 -- Preview. Read-only, deletes nothing.
-- Expect: vouchers_to_delete = 706, with_nonzero_amount = 1, total = 350.00
-- If the numbers look very different, STOP and check before running Step 3.
-- ============================================================================
WITH ranked AS (
  SELECT id, total_amount,
         ROW_NUMBER() OVER (
           PARTITION BY reference_number, narration, created_at
           ORDER BY voucher_number
         ) AS rn
  FROM vouchers
  WHERE narration ILIKE '%final bill%'
    AND status = 'AUTHORISED'
    AND reference_number IS NOT NULL
)
SELECT COUNT(*)                                  AS vouchers_to_delete,
       COUNT(*) FILTER (WHERE total_amount <> 0) AS with_nonzero_amount,
       COALESCE(SUM(total_amount), 0)            AS total_amount_removed
FROM ranked
WHERE rn > 1;


  -- ============================================================================
  -- STEP 3 -- Delete the duplicates. DELETES DATA.
  --
  -- A duplicate is two or more AUTHORISED vouchers sharing the same visit
  -- (reference_number), the same narration AND the same created_at to the
  -- microsecond -- i.e. minted inside one transaction by the two triggers. The
  -- oldest of each pair is kept.
  --
  -- Expected: 706 vouchers, 1412 voucher_entries.
  -- ============================================================================
  DO $$
  DECLARE
    v_entries INTEGER;
    v_vouchers INTEGER;
  BEGIN
    DROP TABLE IF EXISTS dup_vouchers;
    CREATE TEMP TABLE dup_vouchers ON COMMIT DROP AS
    WITH ranked AS (
      SELECT id,
            ROW_NUMBER() OVER (
              PARTITION BY reference_number, narration, created_at
              ORDER BY voucher_number
            ) AS rn
      FROM vouchers
      WHERE narration ILIKE '%final bill%'
        AND status = 'AUTHORISED'
        AND reference_number IS NOT NULL
    )
    SELECT id FROM ranked WHERE rn > 1;

    DELETE FROM voucher_entries WHERE voucher_id IN (SELECT id FROM dup_vouchers);
    GET DIAGNOSTICS v_entries = ROW_COUNT;

    DELETE FROM vouchers WHERE id IN (SELECT id FROM dup_vouchers);
    GET DIAGNOSTICS v_vouchers = ROW_COUNT;

    RAISE NOTICE 'Deleted % duplicate final-bill vouchers and % voucher entries',
      v_vouchers, v_entries;
  END $$;


  -- ============================================================================
  -- STEP 4 -- Verify. Expect ZERO rows.
  -- ============================================================================
  SELECT reference_number, created_at, COUNT(*) AS vouchers
  FROM vouchers
  WHERE narration ILIKE '%final bill%'
    AND status = 'AUTHORISED'
    AND reference_number IS NOT NULL
  GROUP BY reference_number, narration, created_at
  HAVING COUNT(*) > 1;
