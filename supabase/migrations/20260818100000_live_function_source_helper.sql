-- Read the LIVE source of a function, so a rebuild starts from what is actually
-- running rather than from a migration file that may have drifted.
-- CLAUDE.md money rule 3 exists because those two have differed before.
-- Read-only, service-role only: it returns source text and changes nothing.
CREATE OR REPLACE FUNCTION public.live_function_source(p_name TEXT)
RETURNS TABLE(fn TEXT, args TEXT, src TEXT, md5 TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
  SELECT p.proname::TEXT,
         pg_get_function_identity_arguments(p.oid)::TEXT,
         pg_get_functiondef(p.oid)::TEXT,
         md5(pg_get_functiondef(p.oid))::TEXT
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = p_name;
$$;
REVOKE ALL ON FUNCTION public.live_function_source(TEXT) FROM PUBLIC, anon, authenticated;
