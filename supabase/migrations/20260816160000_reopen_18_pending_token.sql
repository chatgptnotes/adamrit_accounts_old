-- Reopen the remaining 18, deliberately and temporarily.
--
-- Asked for after the position was put plainly: the signed-in token is not
-- reaching PostgREST, so every table that requires `authenticated` is
-- unreachable by staff, not only the one that surfaced. visit_clinical_services
-- was unblocked when billing hit it; discharge summaries, lab orders, medicine
-- master, OT notes and the rest would fail the same way the moment a nurse or a
-- pharmacist opened them. Nobody had hit them yet this morning.
--
-- This is the same trade the last one was, made openly this time: the data goes
-- back within reach of the public anon key so that clinical and pharmacy work
-- does not stop mid-shift. It is not an improvement and it is not permanent.
--
-- WHAT WOULD MAKE THIS UNNECESSARY. api/_auth.ts mints the database token only
-- when SUPABASE_USER_JWT is exactly the string '1' and SUPABASE_JWT_SECRET is
-- set. Vercel marks both sensitive, so the value cannot be read from the CLI.
-- Once a signed-in page is confirmed to receive a dbToken, every policy added
-- here comes off again -- one statement per table, the same name each time:
--
--   DROP POLICY "app access pending identity" ON public.<table>;
--
-- The 19th table, visit_clinical_services, already carries this policy from
-- 20260816150000 and is left alone.

DO $reopen$
DECLARE
  v_tables CONSTANT TEXT[] := ARRAY[
    'discharge_summaries', 'doctor_plan', 'esic_claims_extractions',
    'lab_orders', 'lab_reports', 'medicine_master', 'medicine_return_items',
    'medicine_returns', 'ot_notes', 'patient_call_records',
    'pharmacy_credit_payments', 'physiotherapy_bill_items', 'room_management',
    'visit_esic_surgeons', 'visit_hope_consultants', 'visit_hope_surgeons',
    'visit_mandatory_services', 'visit_referees'
  ];
  t TEXT; v_done INT := 0;
BEGIN
  FOREACH t IN ARRAY v_tables LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NULL THEN
      RAISE EXCEPTION 'ABORT: table % does not exist', t;
    END IF;
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'app access pending identity', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO public USING (true) WITH CHECK (true)',
      'app access pending identity', t);
    EXECUTE format(
      'COMMENT ON TABLE public.%I IS %L', t,
      'TEMPORARILY readable with the public anon key (16-Aug-2026): the signed-in '
      'token is not reaching PostgREST. Re-close once it is: '
      'DROP POLICY "app access pending identity".');
    v_done := v_done + 1;
  END LOOP;
  RAISE NOTICE 'Reopened % table(s) pending the token fix', v_done;
END
$reopen$;

DO $verify$
DECLARE t TEXT; v_missing TEXT := '';
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'discharge_summaries','doctor_plan','esic_claims_extractions','lab_orders','lab_reports',
    'medicine_master','medicine_return_items','medicine_returns','ot_notes',
    'patient_call_records','pharmacy_credit_payments','physiotherapy_bill_items',
    'room_management','visit_esic_surgeons','visit_hope_consultants','visit_hope_surgeons',
    'visit_mandatory_services','visit_referees','visit_clinical_services'])
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname='public' AND tablename=t
         AND COALESCE(qual,'true')='true' AND COALESCE(with_check,'true')='true'
         AND (roles && ARRAY['public','anon']::name[])
    ) THEN
      v_missing := v_missing || t || ' ';
    END IF;
  END LOOP;
  IF v_missing <> '' THEN
    RAISE EXCEPTION 'ABORT: still unreachable by the app: %', v_missing;
  END IF;

  -- The cashbook table was locked on its own merits -- nothing references it,
  -- no trigger touches it, and the token has no bearing on that. It stays shut.
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='cashbook_handwritten_uploads'
       AND (roles && ARRAY['public','anon']::name[])
  ) THEN
    RAISE EXCEPTION 'ABORT: the cashbook table was reopened; it should not have been';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
