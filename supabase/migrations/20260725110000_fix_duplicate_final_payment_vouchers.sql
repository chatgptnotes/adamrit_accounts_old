-- Fix: every final payment creates TWO receipt vouchers.
--
-- final_payments carries two triggers that both call
-- create_receipt_voucher_for_payment():
--
--   trg_final_payment_create_voucher            AFTER INSERT
--     (supabase/migrations/20250617000003_create_payment_voucher_triggers.sql:177)
--   trigger_create_receipt_voucher_final_payment  AFTER INSERT OR UPDATE
--     (create_final_payment_voucher_trigger.sql, run by hand on 2025-11-08)
--
-- The names differ, so the migration's DROP TRIGGER IF EXISTS never removed the
-- hand-made one. Both fire on the same INSERT and mint a voucher each -- 706 of
-- the 751 final-bill payments between 2026-03-25 and 2026-07-04 have exactly two
-- vouchers with identical created_at timestamps. The second trigger also fires on
-- UPDATE, so merely touching a final_payments row mints yet another voucher.
--
-- This drops every trigger on final_payments that calls the voucher function and
-- recreates exactly one, AFTER INSERT only.
--
-- Historical duplicates are NOT touched here -- see
-- cleanup_duplicate_final_payment_vouchers.sql for that.
--
-- Run this in the Supabase dashboard SQL Editor (project xvkxccqaopbnkvwgyfjv).
-- Safe to run twice.

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

-- Exactly one, on INSERT only.
CREATE TRIGGER trg_final_payment_create_voucher
  AFTER INSERT ON public.final_payments
  FOR EACH ROW
  EXECUTE FUNCTION create_receipt_voucher_for_payment();

-- Report ----------------------------------------------------------------------
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
    SELECT t.tgname, pg_get_triggerdef(t.oid) AS def
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
