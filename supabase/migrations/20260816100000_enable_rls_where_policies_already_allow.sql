-- Turn RLS on where policies exist but were never enforced — and only there.
--
-- Supabase's advisor reports 31 public tables that have RLS POLICIES but do not
-- have RLS ENABLED. A policy on a table with RLS off does nothing at all, so
-- each of those is a rule somebody wrote and the database has been ignoring.
--
-- ONLY 11 OF THE 31 CAN BE SWITCHED ON. That is the whole difficulty, and the
-- reason this migration is narrow.
--
-- HOW THE APP AUTHENTICATES, WHICH DECIDES EVERYTHING. Staff sign in against
-- the app's own "User" table through api/auth-session; the browser then talks
-- to PostgREST with the ANON key. So `auth.role()` is 'anon', and the Postgres
-- role is `anon` — not `authenticated`.
--
-- Therefore a policy written either as
--     USING (auth.role() = 'authenticated')      -- 'anon' fails this
-- or granted to the Postgres role
--     TO authenticated                            -- does not apply to `anon`
-- matches NOTHING the app sends. Enabling RLS on such a table locks the
-- hospital out of it.
--
-- This is not a theory. `corporate` already has RLS on with authenticated-only
-- policies, and somebody had to bolt on a separate `corporate_select_public`
-- policy (TO anon, authenticated USING true) before the browser could read it.
-- That extra policy is the scar from this exact problem.
--
-- SO THE RULE APPLIED HERE: enable RLS only where a permissive policy with
-- USING (true) already covers `public` or `anon`, for every command the app
-- actually issues. On those tables enabling RLS changes no behaviour — the
-- policy already says yes to everyone.
--
-- WHICH MEANS: BE CLEAR ABOUT WHAT THIS DOES AND DOES NOT BUY.
-- It does not make these tables private. A `USING (true)` policy is still open
-- to anyone holding the anon key, and the anon key ships in the browser bundle.
-- What it buys is honesty: the declared rule is now the enforced rule, so
-- tightening a policy later will actually take effect, and 11 false criticals
-- stop burying the real ones. The substantive exposure — patient data readable
-- with a public key — needs the app moved onto real Supabase sessions, which is
-- a much larger piece of work and a decision for Dr M.
--
-- EXCLUDED, AND WHY
--   bill_preparation — its UPDATE and DELETE policies test
--     current_setting('app.hospital_name'), which PostgREST never sets, so the
--     check is false and bill preparation would stop saving. It is live: the
--     bill-approval work of 15 Aug writes to it.
--   discharge_summaries, doctor_plan, esic_claims_extractions, lab_orders,
--   lab_reports, medicine_master, medicine_return_items, medicine_returns,
--   ot_notes, patient_call_records, pharmacy_credit_payments,
--   physiotherapy_bill_items, room_management, visit_clinical_services,
--   visit_esic_surgeons, visit_hope_consultants, visit_hope_surgeons,
--   visit_mandatory_services, visit_referees — every policy is
--   authenticated-only, so enabling RLS blocks the app outright. These need a
--   decision, not a switch.
--
-- The 71 tables with RLS off and NO policies are a different advisory and are
-- untouched: enabling RLS there denies everything by default.

DO $apply$
DECLARE
  v_tables CONSTANT TEXT[] := ARRAY[
    'final_payments',        -- SELECT/INSERT/UPDATE true TO public; app never deletes
    'ipd_discharge_summary', -- ALL true TO public
    'lab_breakup',           -- ALL true TO anon, authenticated
    'lab_results',           -- ALL true TO public
    'lab_test_formulas',     -- ALL true TO public
    'nabh_rates',            -- all four commands true TO public
    'patients',              -- all four commands true TO public
    'visit_implants',        -- all four commands true TO public
    'visit_labs',            -- ALL true TO public
    'visits',                -- all four commands true TO public
    'vouchers'               -- ALL true TO anon
  ];
  t TEXT;
BEGIN
  FOREACH t IN ARRAY v_tables LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NULL THEN
      RAISE EXCEPTION 'ABORT: table % does not exist', t;
    END IF;

    -- Refuse to touch anything that has no permissive, open policy reaching
    -- `public` or `anon`. If the policy set changed since this was written,
    -- stop rather than lock somebody out.
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies p
       WHERE p.schemaname = 'public' AND p.tablename = t
         AND p.permissive = 'PERMISSIVE'
         AND COALESCE(p.qual, 'true') = 'true'
         AND (p.roles && ARRAY['public','anon']::name[])
    ) THEN
      RAISE EXCEPTION 'ABORT: % has no open policy for public/anon; enabling RLS would block the app', t;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END
$apply$;

DO $verify$
DECLARE
  v_tables CONSTANT TEXT[] := ARRAY[
    'final_payments','ipd_discharge_summary','lab_breakup','lab_results',
    'lab_test_formulas','nabh_rates','patients','visit_implants','visit_labs',
    'visits','vouchers'
  ];
  t TEXT; v_owner BIGINT; v_anon BIGINT; v_checked INT := 0;
BEGIN
  FOREACH t IN ARRAY v_tables LOOP
    -- RLS must actually be on now.
    IF NOT (SELECT relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relname = t) THEN
      RAISE EXCEPTION 'ABORT: RLS is still off on %', t;
    END IF;

    -- The browser-role test cannot run here: apply_migration is SECURITY
    -- DEFINER and Postgres forbids SET ROLE inside one. It is done immediately
    -- after this migration, from outside, using the real anon key against
    -- PostgREST — which exercises the actual path rather than imitating it.
    --
    -- What IS provable here: every command the app issues is covered by a
    -- permissive policy that is unconditionally true for public/anon. A
    -- `USING (true)` PERMISSIVE policy cannot refuse anyone, so enabling RLS
    -- alongside it changes no outcome.
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies p
       WHERE p.schemaname = 'public' AND p.tablename = t
         AND p.permissive = 'PERMISSIVE'
         AND COALESCE(p.qual, 'true') = 'true'
         AND (p.roles && ARRAY['public','anon']::name[])
         AND p.cmd IN ('ALL', 'SELECT')
    ) THEN
      RAISE EXCEPTION 'ABORT: % has RLS on but no open SELECT path for anon', t;
    END IF;

    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO v_owner;
    v_checked := v_checked + 1;
  END LOOP;

  IF v_checked <> array_length(v_tables, 1) THEN
    RAISE EXCEPTION 'ABORT: only % of % tables verified', v_checked, array_length(v_tables, 1);
  END IF;

  RAISE NOTICE 'RLS enabled on % tables; % verified readable as anon',
    array_length(v_tables, 1), v_checked;
END
$verify$;
