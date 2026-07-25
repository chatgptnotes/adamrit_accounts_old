-- Removes the historical duplicate final-bill receipt vouchers left behind by the
-- two triggers on final_payments (see
-- supabase/migrations/20260725110000_fix_duplicate_final_payment_vouchers.sql).
--
-- A duplicate is defined narrowly: two or more AUTHORISED vouchers with the same
-- reference_number (the visit id), the same narration, and the SAME created_at
-- timestamp to the microsecond -- i.e. minted inside one transaction by the two
-- triggers. The oldest voucher of each group is kept; the rest are deleted along
-- with their voucher_entries.
--
-- As of 2026-07-25 this matches 706 vouchers, of which 705 carry a total_amount of
-- 0.00 and one carries 350.00.
--
-- DELETES DATA. Run the SELECT in step 1 first and check the count before running
-- step 2. Run this AFTER the trigger fix, or the duplicates will come straight back.

-- 1. Preview -------------------------------------------------------------------
WITH ranked AS (
  SELECT id, voucher_number, reference_number, total_amount, created_at,
         ROW_NUMBER() OVER (
           PARTITION BY reference_number, narration, created_at
           ORDER BY voucher_number
         ) AS rn
  FROM vouchers
  WHERE narration ILIKE '%final bill%'
    AND status = 'AUTHORISED'
    AND reference_number IS NOT NULL
)
SELECT COUNT(*)                       AS vouchers_to_delete,
       COUNT(*) FILTER (WHERE total_amount <> 0) AS with_nonzero_amount,
       COALESCE(SUM(total_amount), 0) AS total_amount_removed
FROM ranked
WHERE rn > 1;

-- 2. Delete --------------------------------------------------------------------
DO $$
DECLARE
  v_entries INTEGER;
  v_vouchers INTEGER;
BEGIN
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

-- 3. Verify --------------------------------------------------------------------
SELECT reference_number, created_at, COUNT(*) AS vouchers
FROM vouchers
WHERE narration ILIKE '%final bill%'
  AND status = 'AUTHORISED'
  AND reference_number IS NOT NULL
GROUP BY reference_number, narration, created_at
HAVING COUNT(*) > 1;
-- Expected: zero rows.
