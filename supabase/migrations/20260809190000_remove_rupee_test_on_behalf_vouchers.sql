-- Remove the ₹1 "On behalf of" test vouchers.
--
-- Testing the On-Behalf feature left ₹1 payment vouchers in the live books
-- (PV0828 / PV0829 on 08-Aug, and any others at the same amount). Nothing at
-- ₹1 is a real hospital payment, and none of these reached a statement, so
-- they are deleted rather than reversed — a reversal would leave four junk
-- rows in the Day Book instead of none.
--
-- Only the PAYMENT voucher is deleted. Its journal on the other company
-- follows through vouchers.linked_voucher_id, which migration
-- 20260805180000 rebuilt as ON DELETE CASCADE.
--
-- Everything is copied to backup tables first, so this is recoverable.
--
-- Eight tables reference vouchers(id) WITHOUT a cascade rule (voucher
-- attachments, payment reconciliation, sub-allocations, monthly obligations,
-- Rupali/Akshay payouts, outstanding invoices). If any of them points at one
-- of these vouchers the DELETE raises a foreign-key error and the whole
-- transaction rolls back — that means the voucher was not test data after
-- all, and it must be looked at by hand.
--
-- Apply with: python3 scripts/apply-migration.py \
--   supabase/migrations/20260809190000_remove_rupee_test_on_behalf_vouchers.sql
--
-- No BEGIN/COMMIT: apply_migration() EXECUTEs this inside a function, which
-- is already atomic, and transaction commands are rejected there. The NOTICE
-- lines below go to the Postgres log, not to the caller — the backup table
-- is the readable record of what was removed.

-- ------------------------------------------------------------------
-- 1. Backup tables. Kept, not dropped — this is the undo.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.backup_rupee_test_vouchers_20260809
  (LIKE public.vouchers INCLUDING DEFAULTS);

CREATE TABLE IF NOT EXISTS public.backup_rupee_test_voucher_entries_20260809
  (LIKE public.voucher_entries INCLUDING DEFAULTS);

-- ------------------------------------------------------------------
-- 2. The candidates: ₹1 on-behalf PAYMENT vouchers (the parents).
--    A parent carries on_behalf_of_company_id and links to nothing;
--    the journal on the other side is the one carrying linked_voucher_id.
-- ------------------------------------------------------------------
DROP TABLE IF EXISTS doomed_parents;
DROP TABLE IF EXISTS doomed_children;

CREATE TEMP TABLE doomed_parents ON COMMIT DROP AS
SELECT v.id, v.voucher_number, v.voucher_date, v.total_amount, v.narration
  FROM public.vouchers v
 WHERE v.total_amount = 1
   AND v.linked_voucher_id IS NULL
   AND (
         v.on_behalf_of_company_id IS NOT NULL
      OR v.narration ILIKE '%on behalf of%'
       );

-- Their journals, recorded for the backup and for the notice below.
CREATE TEMP TABLE doomed_children ON COMMIT DROP AS
SELECT v.id, v.voucher_number, v.voucher_date, v.total_amount, v.narration
  FROM public.vouchers v
 WHERE v.linked_voucher_id IN (SELECT id FROM doomed_parents);

-- ------------------------------------------------------------------
-- 3. Guards. A predicate that has gone wrong must not reach the DELETE.
-- ------------------------------------------------------------------
DO $guard$
DECLARE
  v_parents  INTEGER;
  v_children INTEGER;
  v_wrong    INTEGER;
  v_row      RECORD;
BEGIN
  SELECT count(*) INTO v_parents  FROM doomed_parents;
  SELECT count(*) INTO v_children FROM doomed_children;

  -- Nothing at any other amount may be caught by this script.
  SELECT count(*) INTO v_wrong
    FROM doomed_parents WHERE total_amount <> 1;
  IF v_wrong > 0 THEN
    RAISE EXCEPTION 'Refusing to run: % candidate(s) are not ₹1', v_wrong;
  END IF;

  -- A blast radius this large means the predicate is wrong, not the data.
  IF v_parents > 20 THEN
    RAISE EXCEPTION 'Refusing to run: % candidates found, expected a handful', v_parents;
  END IF;

  RAISE NOTICE '--- payment vouchers to delete: % ---', v_parents;
  FOR v_row IN SELECT * FROM doomed_parents ORDER BY voucher_number LOOP
    RAISE NOTICE '  % (%) ₹% — %',
      v_row.voucher_number, v_row.voucher_date, v_row.total_amount,
      left(coalesce(v_row.narration, ''), 90);
  END LOOP;

  RAISE NOTICE '--- journals that cascade with them: % ---', v_children;
  FOR v_row IN SELECT * FROM doomed_children ORDER BY voucher_number LOOP
    RAISE NOTICE '  % (%) ₹% — %',
      v_row.voucher_number, v_row.voucher_date, v_row.total_amount,
      left(coalesce(v_row.narration, ''), 90);
  END LOOP;
END
$guard$;

-- ------------------------------------------------------------------
-- 4. Back up both sides, and their double-entry lines, before deleting.
-- ------------------------------------------------------------------
INSERT INTO public.backup_rupee_test_voucher_entries_20260809
SELECT e.*
  FROM public.voucher_entries e
 WHERE e.voucher_id IN (SELECT id FROM doomed_parents
                        UNION ALL
                        SELECT id FROM doomed_children)
   AND NOT EXISTS (
     SELECT 1 FROM public.backup_rupee_test_voucher_entries_20260809 b
      WHERE b.id = e.id);

INSERT INTO public.backup_rupee_test_vouchers_20260809
SELECT v.*
  FROM public.vouchers v
 WHERE v.id IN (SELECT id FROM doomed_parents
                UNION ALL
                SELECT id FROM doomed_children)
   AND NOT EXISTS (
     SELECT 1 FROM public.backup_rupee_test_vouchers_20260809 b
      WHERE b.id = v.id);

-- ------------------------------------------------------------------
-- 5. Delete the parents. The journals go with them, by cascade.
-- ------------------------------------------------------------------
DELETE FROM public.vouchers
 WHERE id IN (SELECT id FROM doomed_parents);

-- ------------------------------------------------------------------
-- 6. Prove it — both sides gone, and the backup holds what was removed.
-- ------------------------------------------------------------------
DO $verify$
DECLARE
  v_left     INTEGER;
  v_orphans  INTEGER;
  v_saved    INTEGER;
BEGIN
  SELECT count(*) INTO v_left
    FROM public.vouchers v
   WHERE v.total_amount = 1
     AND v.linked_voucher_id IS NULL
     AND (v.on_behalf_of_company_id IS NOT NULL
       OR v.narration ILIKE '%on behalf of%');
  IF v_left > 0 THEN
    RAISE EXCEPTION 'Verification failed: % ₹1 on-behalf payment voucher(s) remain', v_left;
  END IF;

  SELECT count(*) INTO v_orphans
    FROM public.vouchers v
    JOIN doomed_children c ON c.id = v.id;
  IF v_orphans > 0 THEN
    RAISE EXCEPTION 'Verification failed: % journal(s) survived the cascade', v_orphans;
  END IF;

  SELECT count(*) INTO v_saved FROM public.backup_rupee_test_vouchers_20260809;
  RAISE NOTICE 'Done. % voucher(s) held in backup_rupee_test_vouchers_20260809.', v_saved;
END
$verify$;
