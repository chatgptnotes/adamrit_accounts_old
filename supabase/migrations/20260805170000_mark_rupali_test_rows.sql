-- Mark the two pre-accounting Rupali test rows.
--
-- The first two RAVI MAHATO submissions (5-Aug, before record_rupali_visit
-- existed) are register rows with no voucher — test data that cannot be
-- deleted because the register is append-only. This one-time correction
-- labels them so reconciliation reads them for what they are. The
-- immutability trigger is lifted for exactly this statement and restored.
--
-- Run in the Supabase dashboard SQL Editor. Safe to run twice.

BEGIN;

ALTER TABLE public.rupali_visit_logs DISABLE TRIGGER trg_rupali_visit_logs_immutable;

UPDATE public.rupali_visit_logs
   SET purpose_reason = purpose_reason || ' [TEST ENTRY — made before accounting wiring; no voucher]'
 WHERE voucher_id IS NULL
   AND lower(patient_name) = 'ravi mahato'
   AND created_at::date = DATE '2026-08-05'
   AND purpose_reason NOT LIKE '%TEST ENTRY%';

ALTER TABLE public.rupali_visit_logs ENABLE TRIGGER trg_rupali_visit_logs_immutable;

-- Proof: both voucher-less rows are labelled, none remain unlabelled, and
-- the register is immutable again.
DO $verify$
DECLARE
  v_unmarked INT;
  v_marked   INT;
BEGIN
  SELECT count(*) FILTER (WHERE purpose_reason NOT LIKE '%TEST ENTRY%'),
         count(*) FILTER (WHERE purpose_reason LIKE '%TEST ENTRY%')
    INTO v_unmarked, v_marked
    FROM public.rupali_visit_logs
   WHERE voucher_id IS NULL;
  IF v_unmarked > 0 THEN
    RAISE EXCEPTION '% voucher-less register rows are still unmarked', v_unmarked;
  END IF;
  RAISE NOTICE 'OK — % voucher-less test row(s) labelled', v_marked;

  BEGIN
    DELETE FROM public.rupali_visit_logs WHERE voucher_id IS NULL;
    RAISE EXCEPTION 'register rows were deletable — immutability trigger did not come back';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      IF SQLERRM NOT LIKE '%immutable%' THEN RAISE; END IF;
      RAISE NOTICE 'OK — register is append-only again';
  END;
END;
$verify$;

COMMIT;
