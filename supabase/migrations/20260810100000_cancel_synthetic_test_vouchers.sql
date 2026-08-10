-- Cancel the seven synthetic test vouchers found in the 10-Aug books review.
--
-- These are the only vouchers whose narration marks the VOUCHER ITSELF as a
-- test — no vendor, no service, no patient behind any of them. Together they
-- come to ₹108.
--
--   PUR-000017  ₹100  "test"
--   PV0073        ₹2  "#test"
--   REC12485      ₹2  "against @OPD Consultation #test2"
--   PUR0616       ₹1  "Test"
--   PV0865        ₹1  "Payment to M.L. Enterprises ... — Refri test"
--   JV0897        ₹1  "Spot commission Baba Khan — Test, invoice MLE-1338"
--   PV-000285     ₹1  "Payment voucher PV-20260730-034 - test"
--
-- CANCELLED, not deleted — the same treatment the 6-Aug audit gave 21 other
-- test vouchers. DayBook.tsx:193 lists only AUTHORISED rows unless "show
-- cancelled" is ticked, so these leave the day book while the record of them
-- having been reviewed and voided stays in the books.
--
-- Deliberately NOT touched:
--   * the 21 already CANCELLED (incl. ₹12,00,000 PV-000114) — already correct;
--   * 41 real pharmacy/diagnostics postings whose PATIENT is named "test…" —
--     real money owed to Nobal Scan, Amapath Pathology, INSIGHT SCAN, Helix;
--   * PV0086/PV0087/PV0088/PV0125 — real July expenses (ICU carpentry, printer
--     cartridge, internet) that merely carry a "#test" tag;
--   * SV-000036, JV0418, JV0884 — real postings for fake patients; those
--     belong to a patient-level cleanup, not here.
--
-- Rows are copied to backup_cancelled_test_vouchers_20260810 first, so the
-- previous status and narration can be restored exactly.
--
-- No BEGIN/COMMIT: apply_migration() EXECUTEs this inside a function, which is
-- already atomic and rejects transaction commands.
--
-- Apply with: python3 scripts/apply-migration.py \
--   supabase/migrations/20260810100000_cancel_synthetic_test_vouchers.sql

-- ------------------------------------------------------------------
-- 1. The seven, by id. Named explicitly — no pattern matching on the
--    word "test", which cannot tell a test voucher from a real bill
--    that happens to be tagged #test.
-- ------------------------------------------------------------------
DROP TABLE IF EXISTS targets;

CREATE TEMP TABLE targets (id UUID PRIMARY KEY) ON COMMIT DROP;
INSERT INTO targets (id) VALUES
  ('3e9fa947-2ad4-4c2e-ad08-627630ffc517'),  -- PUR-000017  ₹100
  ('17df1dd6-1f21-47d3-ae2e-fbaa0203666b'),  -- PV0073        ₹2
  ('3694ddab-5d77-4bb7-90d0-3213c5f6bce0'),  -- REC12485      ₹2
  ('d15a384a-989e-4cf0-8eac-b57141340dec'),  -- PUR0616       ₹1
  ('74f67b84-cc9e-4d88-bd6f-f025a2ba884f'),  -- PV0865        ₹1
  ('77e6b662-e239-43d0-a75f-bfb24bcbceff'),  -- JV0897        ₹1
  ('a55ffe18-5500-4fa7-a034-57bcac8b9a67');  -- PV-000285     ₹1

-- ------------------------------------------------------------------
-- 2. Guards. Anything unexpected aborts before a single row changes.
-- ------------------------------------------------------------------
DO $guard$
DECLARE
  v_found  INTEGER;
  v_big    INTEGER;
  v_linked INTEGER;
BEGIN
  SELECT count(*) INTO v_found
    FROM public.vouchers v JOIN targets t ON t.id = v.id;
  IF v_found <> 7 THEN
    RAISE EXCEPTION 'Expected 7 target vouchers, found % — ids have moved', v_found;
  END IF;

  -- The largest of the seven is ₹100. Anything above that is not this set.
  SELECT count(*) INTO v_big
    FROM public.vouchers v JOIN targets t ON t.id = v.id
   WHERE v.total_amount > 100;
  IF v_big > 0 THEN
    RAISE EXCEPTION 'Refusing: % target(s) exceed ₹100', v_big;
  END IF;

  -- None of these is an on-behalf pair; a linked voucher would mean the
  -- other company's book moves too, which this script does not handle.
  SELECT count(*) INTO v_linked
    FROM public.vouchers v JOIN targets t ON t.id = v.id
   WHERE v.linked_voucher_id IS NOT NULL
      OR EXISTS (SELECT 1 FROM public.vouchers c WHERE c.linked_voucher_id = v.id);
  IF v_linked > 0 THEN
    RAISE EXCEPTION 'Refusing: % target(s) are linked to another company''s voucher', v_linked;
  END IF;
END
$guard$;

-- ------------------------------------------------------------------
-- 3. Backup: the exact rows as they stand now.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.backup_cancelled_test_vouchers_20260810
  (LIKE public.vouchers INCLUDING DEFAULTS);

INSERT INTO public.backup_cancelled_test_vouchers_20260810
SELECT v.*
  FROM public.vouchers v
  JOIN targets t ON t.id = v.id
 WHERE NOT EXISTS (
   SELECT 1 FROM public.backup_cancelled_test_vouchers_20260810 b WHERE b.id = v.id);

-- ------------------------------------------------------------------
-- 4. Cancel, with the reason recorded in the narration. Re-running
--    changes nothing: already-cancelled rows are skipped, so the note
--    is never appended twice.
-- ------------------------------------------------------------------
UPDATE public.vouchers v
   SET status = 'CANCELLED',
       narration = coalesce(v.narration, '')
                 || ' [Cancelled: synthetic test voucher, books review 10-Aug-2026]',
       updated_at = now()
  FROM targets t
 WHERE t.id = v.id
   AND v.status <> 'CANCELLED';

-- ------------------------------------------------------------------
-- 5. Prove it.
-- ------------------------------------------------------------------
DO $verify$
DECLARE
  v_open   INTEGER;
  v_saved  INTEGER;
BEGIN
  SELECT count(*) INTO v_open
    FROM public.vouchers v JOIN targets t ON t.id = v.id
   WHERE v.status <> 'CANCELLED';
  IF v_open > 0 THEN
    RAISE EXCEPTION 'Verification failed: % target(s) are still open', v_open;
  END IF;

  SELECT count(*) INTO v_saved FROM public.backup_cancelled_test_vouchers_20260810;
  RAISE NOTICE 'All 7 cancelled. % row(s) held in backup_cancelled_test_vouchers_20260810.', v_saved;
END
$verify$;
