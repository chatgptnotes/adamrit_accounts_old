-- Migration automation bootstrap — THE LAST CLIPBOARD SCRIPT.
--
-- Creates apply_migration(name, sql): records and executes a migration
-- exactly once. EXECUTE is granted ONLY to service_role, so only the server
-- key held in the project's .env can call it — the app's anon key cannot.
-- From here on, Claude applies migrations directly over the API.
--
-- Run in the Supabase dashboard SQL Editor. Safe to run twice.

BEGIN;

CREATE TABLE IF NOT EXISTS public.applied_migrations (
  name       TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.applied_migrations ENABLE ROW LEVEL SECURITY;
-- No policies: only definer functions and service_role touch it.

CREATE OR REPLACE FUNCTION public.apply_migration(p_name TEXT, p_sql TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF COALESCE(btrim(p_name), '') = '' THEN
    RAISE EXCEPTION 'Migration name required';
  END IF;
  IF EXISTS (SELECT 1 FROM public.applied_migrations WHERE name = p_name) THEN
    RETURN 'ALREADY_APPLIED ' || p_name;
  END IF;
  EXECUTE p_sql;
  INSERT INTO public.applied_migrations (name) VALUES (p_name);
  RETURN 'APPLIED ' || p_name;
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_migration(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_migration(TEXT, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_migration(TEXT, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';

DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'apply_migration'
  ) THEN
    RAISE EXCEPTION 'apply_migration was not created';
  END IF;
  RAISE NOTICE 'OK — this was the last manual script; migrations are automated now';
END;
$verify$;

COMMIT;
