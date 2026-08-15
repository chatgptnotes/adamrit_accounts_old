-- Two tables would have been lost the moment staff became `authenticated`.
--
-- Found in the pre-flight check before switching SUPABASE_USER_JWT on.
-- `complications` and `visit_anesthetists` have RLS ENABLED and exactly one
-- policy each, granted only to the `anon` role:
--
--   ALL TO anon USING (true) WITH CHECK (true)
--
-- Today that is fine, because the browser only ever presents the anon key. But
-- the whole point of the JWT work is that a signed-in person stops being `anon`
-- and becomes `authenticated` — and an `anon`-only policy does not apply to
-- `authenticated`. These two tables would have gone dark for every signed-in
-- user at once: complications appear on discharge summaries, and
-- visit_anesthetists feeds anaesthetist billing.
--
-- This is the mirror image of the problem being fixed on the other 19 tables,
-- and a good argument for granting policies TO public rather than naming a
-- single role: `public` covers both, and cannot be stranded by a change in how
-- people authenticate.
--
-- So each gets a matching policy for `authenticated`. Nothing widens: anyone
-- who can already reach these tables with the anon key — which ships in the
-- browser — can reach them today. This only stops a signed-in member of staff
-- having LESS access than an anonymous visitor, which is plainly absurd and
-- would have taken two clinical screens down.

DO $apply$
DECLARE
  v_tables CONSTANT TEXT[] := ARRAY['complications', 'visit_anesthetists'];
  t TEXT;
BEGIN
  FOREACH t IN ARRAY v_tables LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NULL THEN
      RAISE EXCEPTION 'ABORT: table % does not exist', t;
    END IF;

    -- Only act where the anon-only shape is genuinely present. If somebody has
    -- since granted access properly, leave it alone.
    IF EXISTS (
      SELECT 1 FROM pg_policies p
       WHERE p.schemaname = 'public' AND p.tablename = t
         AND (p.roles && ARRAY['authenticated','public']::name[])
    ) THEN
      CONTINUE;
    END IF;

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
      t || '_authenticated_same_as_anon', t);
  END LOOP;
END
$apply$;

DO $verify$
DECLARE
  v_tables CONSTANT TEXT[] := ARRAY['complications', 'visit_anesthetists'];
  t TEXT;
BEGIN
  FOREACH t IN ARRAY v_tables LOOP
    -- A signed-in user must now have a way in.
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies p
       WHERE p.schemaname = 'public' AND p.tablename = t
         AND p.permissive = 'PERMISSIVE'
         AND (p.roles && ARRAY['authenticated','public']::name[])
         AND COALESCE(p.qual, 'true') = 'true'
    ) THEN
      RAISE EXCEPTION 'ABORT: % is still unreachable for an authenticated user', t;
    END IF;

    -- And the anonymous route must survive, because the switch is not on yet
    -- and every request today is still anon.
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies p
       WHERE p.schemaname = 'public' AND p.tablename = t
         AND p.permissive = 'PERMISSIVE'
         AND (p.roles && ARRAY['anon','public']::name[])
         AND COALESCE(p.qual, 'true') = 'true'
    ) THEN
      RAISE EXCEPTION 'ABORT: % lost its anon access, which is what works today', t;
    END IF;
  END LOOP;

  -- Nothing else in the database may still be anon-only, or the switch will
  -- strand it the same way.
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
    RAISE EXCEPTION 'ABORT: another anon-only table appeared; it would break when the switch goes on';
  END IF;
END
$verify$;
