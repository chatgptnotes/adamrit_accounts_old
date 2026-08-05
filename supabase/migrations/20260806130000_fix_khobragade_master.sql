-- Correction: the mandatory-obligations seeder's 'khobra' pattern matched an
-- M.L. Enterprises invoice record ("M.L. Enterprises · test34235 (RM Sanjay
-- Khobragade)") and made THAT a daily Master. Retire it and promote the real
-- Dr. Nikhil Khobragade instead.
--
-- Run in the Supabase dashboard SQL Editor. Safe to run twice.

BEGIN;

-- 1. The bogus Master goes.
UPDATE public.payment_obligations
   SET is_active = false,
       notes = 'Retired: wrongly promoted by 20260806110000 (was an ML invoice record)'
 WHERE is_active
   AND notes LIKE 'MASTER%'
   AND party_name ILIKE '%m.l. enterprises%';

-- 2. The real doctor becomes the Master (skip if one already exists).
DO $fix$
DECLARE
  v_tpl RECORD;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.payment_obligations
     WHERE is_active
       AND party_name ILIKE '%khobra%'
       AND party_name NOT ILIKE '%m.l.%'
       AND COALESCE(notes, '') NOT LIKE 'DAILY_ALLOCATION_EXECUTION%'
       AND COALESCE(notes, '') NOT LIKE 'Created from Daily Allocation%'
  ) THEN
    RAISE NOTICE 'OK — Dr. Khobragade already has an active Master';
    RETURN;
  END IF;

  SELECT * INTO v_tpl
    FROM public.payment_obligations
   WHERE party_name ILIKE '%khobra%'
     AND party_name NOT ILIKE '%m.l.%'
     AND party_name NOT ILIKE '%sanjay%'
   ORDER BY (chart_of_accounts_id IS NOT NULL) DESC, updated_at DESC
   LIMIT 1;
  IF v_tpl.id IS NULL THEN
    RAISE EXCEPTION 'No Dr. Khobragade record found to promote';
  END IF;

  INSERT INTO public.payment_obligations (
    party_name, category, sub_category, default_daily_amount, priority,
    company_id, chart_of_accounts_id, ledger_account_id, expense_account_id,
    hospital_name, is_active, notes
  ) VALUES (
    v_tpl.party_name, 'fixed', COALESCE(v_tpl.sub_category, 'other'),
    COALESCE(v_tpl.default_daily_amount, 0), COALESCE(v_tpl.priority, 10),
    v_tpl.company_id, v_tpl.chart_of_accounts_id, v_tpl.ledger_account_id,
    v_tpl.expense_account_id, v_tpl.hospital_name, true,
    'MASTER: mandatory in daily allocation every day (Director, 5-Aug-2026)'
  );
  RAISE NOTICE 'CREATED Master for "%" (daily %)', v_tpl.party_name, COALESCE(v_tpl.default_daily_amount, 0);
END;
$fix$;

-- Proof.
DO $verify$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.payment_obligations
     WHERE is_active AND notes LIKE 'MASTER%' AND party_name ILIKE '%m.l. enterprises%'
  ) THEN
    RAISE EXCEPTION 'The bogus ML Master is still active';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.payment_obligations
     WHERE is_active AND party_name ILIKE '%khobra%' AND party_name NOT ILIKE '%m.l.%'
       AND COALESCE(notes, '') NOT LIKE 'DAILY_ALLOCATION_EXECUTION%'
       AND COALESCE(notes, '') NOT LIKE 'Created from Daily Allocation%'
  ) THEN
    RAISE EXCEPTION 'Dr. Khobragade still has no active Master';
  END IF;
  RAISE NOTICE 'OK — Dr. Khobragade is the daily Master; the ML record is retired';
END;
$verify$;

COMMIT;
