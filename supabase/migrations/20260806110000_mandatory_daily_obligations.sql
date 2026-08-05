-- Mandatory daily obligations (Director, 5-Aug-2026).
--
-- Rent, Gandhi rent, Gandhi lab, electricity, Dr. Nikhil Khobragade and
-- Dr. Bansod must appear in the Daily Payment Allocation obligation report
-- EVERY day. The mechanism already exists: an ACTIVE payment_obligations row
-- (a "Master") is scheduled daily by the generator; rows stamped
-- DAILY_ALLOCATION_EXECUTION are one-off records and never reappear — which
-- is all these parties currently have.
--
-- For each party: if an active Master already exists, leave it; otherwise
-- clone the best execution record (keeps its ledger mapping and amount) into
-- a Master. The Gandhi rent Master expires 4-Oct-2026 per the Director's
-- earlier decision.
--
-- Run in the Supabase dashboard SQL Editor. Safe to run twice.

BEGIN;

DO $seed$
DECLARE
  v_want RECORD;
  v_tpl  RECORD;
  v_have INT;
BEGIN
  FOR v_want IN
    SELECT * FROM (VALUES
      ('bansod',                'Dr. Vijay Bansod',        NULL::date),
      ('khobra',                'Dr. Nikhil Khobragade',   NULL::date),
      ('gandhi lab',            'Gandhi Lab',              NULL::date),
      ('gandhi research',       'Gandhi Rent (Research Institute)', DATE '2026-10-04'),
      ('electric',              'Electricity',             NULL::date),
      ('hospital rent',         'Hospital Rent',           NULL::date)
    ) AS w(pattern, label, until)
  LOOP
    -- Already covered by an active Master (not an execution record)?
    SELECT count(*) INTO v_have
      FROM public.payment_obligations
     WHERE is_active
       AND party_name ILIKE '%' || v_want.pattern || '%'
       AND COALESCE(notes, '') NOT LIKE 'DAILY_ALLOCATION_EXECUTION%'
       AND COALESCE(notes, '') NOT LIKE 'Created from Daily Allocation%';
    IF v_have > 0 THEN
      RAISE NOTICE 'OK — % already has an active Master', v_want.label;
      CONTINUE;
    END IF;

    -- The best existing record to clone: prefers a ledger mapping, then recency.
    SELECT * INTO v_tpl
      FROM public.payment_obligations
     WHERE party_name ILIKE '%' || v_want.pattern || '%'
     ORDER BY (chart_of_accounts_id IS NOT NULL) DESC, updated_at DESC
     LIMIT 1;
    IF v_tpl.id IS NULL THEN
      RAISE NOTICE 'SKIPPED — no existing record found for % (add it on the Daily Allocation page)', v_want.label;
      CONTINUE;
    END IF;

    INSERT INTO public.payment_obligations (
      party_name, category, sub_category, default_daily_amount, priority,
      company_id, chart_of_accounts_id, ledger_account_id, expense_account_id,
      hospital_name, is_active, active_until, notes
    ) VALUES (
      v_tpl.party_name, 'fixed', COALESCE(v_tpl.sub_category, 'other'),
      COALESCE(v_tpl.default_daily_amount, 0), COALESCE(v_tpl.priority, 10),
      v_tpl.company_id, v_tpl.chart_of_accounts_id, v_tpl.ledger_account_id,
      v_tpl.expense_account_id, v_tpl.hospital_name, true, v_want.until,
      'MASTER: mandatory in daily allocation every day (Director, 5-Aug-2026)'
    );
    RAISE NOTICE 'CREATED Master for % (as "%", daily %)',
      v_want.label, v_tpl.party_name, COALESCE(v_tpl.default_daily_amount, 0);
  END LOOP;
END;
$seed$;

-- Proof: every wanted party now has at least one active Master.
DO $verify$
DECLARE
  v_missing TEXT := '';
  v_p TEXT;
BEGIN
  FOREACH v_p IN ARRAY ARRAY['bansod', 'khobra', 'gandhi lab', 'gandhi research', 'electric', 'rent']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.payment_obligations
       WHERE is_active AND party_name ILIKE '%' || v_p || '%'
         AND COALESCE(notes, '') NOT LIKE 'DAILY_ALLOCATION_EXECUTION%'
         AND COALESCE(notes, '') NOT LIKE 'Created from Daily Allocation%'
    ) THEN
      v_missing := v_missing || v_p || ', ';
    END IF;
  END LOOP;
  IF v_missing <> '' THEN
    RAISE EXCEPTION 'Still no active Master for: %', v_missing;
  END IF;
  RAISE NOTICE 'OK — all six mandatory parties will appear in the daily allocation every day';
END;
$verify$;

COMMIT;
