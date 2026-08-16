-- Verify-only. Re-run after adding opening_balance_audit. Changes nothing; raises if the switch would break a write.
--
-- The earlier check (20260816110000) asked "does this table have ANY policy an
-- authenticated user can use?". That is too coarse. A table can hold a SELECT
-- policy for authenticated and an INSERT policy only for anon: the coarse check
-- passes, and the moment SUPABASE_USER_JWT=1 goes on, saving silently fails.
--
-- Two things must line up per command, not per table:
--   1. the table-level GRANT (permission denied -> HTTP 403), and
--   2. a permissive RLS policy (no grant of rows -> 0 rows, no error).
--
-- Anything anon can do today, an authenticated user must still be able to do.
-- This file is deliberately read-only so it can be re-run after any policy work.

DO $verify$
DECLARE
  v_cmds CONSTANT TEXT[] := ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'];
  v_priv TEXT;
  v_cmd TEXT;
  r RECORD;
  v_lost TEXT := '';
BEGIN
  FOREACH v_cmd IN ARRAY v_cmds LOOP
    v_priv := v_cmd;  -- privilege names match the command names

    FOR r IN
      SELECT c.oid, c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relkind = 'r'
         AND c.relrowsecurity
    LOOP
      -- (1) GRANT: anon may, authenticated may not.
      IF has_table_privilege('anon', r.oid, v_priv)
         AND NOT has_table_privilege('authenticated', r.oid, v_priv) THEN
        v_lost := v_lost || format(E'\n  GRANT %s missing on %s', v_cmd, r.relname);
        CONTINUE;
      END IF;

      -- (2) POLICY: a permissive policy anon can use, with none for authenticated.
      IF EXISTS (
        SELECT 1 FROM pg_policies p
         WHERE p.schemaname = 'public' AND p.tablename = r.relname
           AND p.permissive = 'PERMISSIVE'
           AND p.cmd IN (v_cmd, 'ALL')
           AND p.roles && ARRAY['anon', 'public']::name[]
      ) AND NOT EXISTS (
        SELECT 1 FROM pg_policies p
         WHERE p.schemaname = 'public' AND p.tablename = r.relname
           AND p.permissive = 'PERMISSIVE'
           AND p.cmd IN (v_cmd, 'ALL')
           AND p.roles && ARRAY['authenticated', 'public']::name[]
      ) THEN
        v_lost := v_lost || format(E'\n  %s policy missing on %s', v_cmd, r.relname);
      END IF;
    END LOOP;
  END LOOP;

  IF v_lost <> '' THEN
    RAISE EXCEPTION 'ABORT: these would stop working when SUPABASE_USER_JWT=1:%', v_lost;
  END IF;

  RAISE NOTICE 'Every command anon can run today, an authenticated user can run too.';
END
$verify$;
