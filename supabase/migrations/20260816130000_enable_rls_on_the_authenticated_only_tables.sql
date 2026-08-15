-- The 19 authenticated-only tables finally enforce their own rules.
--
-- These have carried `auth.role() = 'authenticated'` policies since they were
-- created, and the database has ignored every one of them, because RLS was
-- never enabled. It could not be enabled: staff sign in against our own "User"
-- table, the browser presented the anon key, and `auth.role()` was 'anon'.
-- Switching RLS on would have locked out 85 of 109 active staff.
--
-- That is now fixed at the root. api/auth-session mints a Supabase-signed JWT
-- at login and reportingFetch presents it, so a signed-in person really is
-- `authenticated` to the database. Verified end to end against production
-- before this migration was written:
--
--   1. login                 ok
--   2. dbToken returned      359 chars, three parts
--   3. signature verified    role=authenticated aud=authenticated ref=xvkxcc…
--   4. database accepted it  empty insert refused 23502 (NOT NULL), not 42501
--
-- WHAT CHANGES FOR REAL. Until now these tables were readable and writable by
-- anyone holding the anon key — which ships inside the browser bundle and is
-- therefore public. After this, they require a signed-in member of staff.
-- That is the first genuine access control on this data: discharge summaries,
-- doctor plans, OT notes, patient call records, medicine returns.
--
-- ONE TRANSITIONAL COST, stated plainly: a tab left open from before the
-- deploy still holds no token, because the token is fetched on page load. Those
-- sessions keep working everywhere else and lose only these 19 tables until the
-- page is refreshed. Done at ~01:30 IST deliberately — the quietest hour — and
-- a refresh is the whole remedy.
--
-- bill_preparation stays excluded: its UPDATE/DELETE policies test
-- current_setting('app.hospital_name'), which PostgREST never sets, so those
-- would fail for authenticated users too. It needs its policies rewritten
-- first, not RLS switched on.
--
-- Reversal is one statement per table:
--   ALTER TABLE public.<name> DISABLE ROW LEVEL SECURITY;

DO $apply$
DECLARE
  v_tables CONSTANT TEXT[] := ARRAY[
    'discharge_summaries', 'doctor_plan', 'esic_claims_extractions',
    'lab_orders', 'lab_reports', 'medicine_master', 'medicine_return_items',
    'medicine_returns', 'ot_notes', 'patient_call_records',
    'pharmacy_credit_payments', 'physiotherapy_bill_items', 'room_management',
    'visit_clinical_services', 'visit_esic_surgeons', 'visit_hope_consultants',
    'visit_hope_surgeons', 'visit_mandatory_services', 'visit_referees'
  ];
  t TEXT;
BEGIN
  FOREACH t IN ARRAY v_tables LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NULL THEN
      RAISE EXCEPTION 'ABORT: table % does not exist', t;
    END IF;

    -- A signed-in person must have a way in, or this locks the ward out of a
    -- clinical table. Accepts either shape: granted TO authenticated, or
    -- granted broadly with an auth.role() test in the predicate.
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies p
       WHERE p.schemaname = 'public' AND p.tablename = t
         AND p.permissive = 'PERMISSIVE'
         AND p.cmd IN ('ALL', 'SELECT')
         AND (
           (p.roles && ARRAY['authenticated','public']::name[])
           AND (COALESCE(p.qual, 'true') = 'true'
                OR p.qual ILIKE '%authenticated%')
         )
    ) THEN
      RAISE EXCEPTION 'ABORT: % has no readable path for an authenticated user', t;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END
$apply$;

DO $verify$
DECLARE
  v_tables CONSTANT TEXT[] := ARRAY[
    'discharge_summaries', 'doctor_plan', 'esic_claims_extractions',
    'lab_orders', 'lab_reports', 'medicine_master', 'medicine_return_items',
    'medicine_returns', 'ot_notes', 'patient_call_records',
    'pharmacy_credit_payments', 'physiotherapy_bill_items', 'room_management',
    'visit_clinical_services', 'visit_esic_surgeons', 'visit_hope_consultants',
    'visit_hope_surgeons', 'visit_mandatory_services', 'visit_referees'
  ];
  t TEXT; v_on INT := 0;
BEGIN
  FOREACH t IN ARRAY v_tables LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class c
              JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relname = t) THEN
      RAISE EXCEPTION 'ABORT: RLS is still off on %', t;
    END IF;
    v_on := v_on + 1;
  END LOOP;

  IF v_on <> array_length(v_tables, 1) THEN
    RAISE EXCEPTION 'ABORT: only % of % tables enabled', v_on, array_length(v_tables, 1);
  END IF;

  -- Nothing anywhere may now be reachable only by anon: the app no longer
  -- presents anon for a signed-in person, so such a table would be stranded.
  IF EXISTS (
    SELECT 1 FROM pg_policies p
      JOIN pg_class c ON c.relname = p.tablename
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
     WHERE p.schemaname = 'public' AND c.relrowsecurity
       AND 'anon' = ANY(p.roles)
       AND NOT EXISTS (
         SELECT 1 FROM pg_policies q
          WHERE q.schemaname = 'public' AND q.tablename = p.tablename
            AND (q.roles && ARRAY['authenticated','public']::name[]))
  ) THEN
    RAISE EXCEPTION 'ABORT: an anon-only table exists and would be stranded';
  END IF;

  RAISE NOTICE 'RLS now enforced on % previously-ignored tables', v_on;
END
$verify$;
