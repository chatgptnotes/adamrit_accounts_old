-- Leave exactly one submit_cash_handover and one declare_opening_cash.
--
-- Postgres does not replace a function when the parameter list grows: CREATE OR
-- REPLACE with two extra trailing parameters creates a SECOND function and
-- leaves the first in place. Successive migrations each added a parameter, so
-- the live database was carrying four submit_cash_handover overloads (7, 8, 10
-- and 12 arguments) and two declare_opening_cash (4 and 6).
--
-- Overloads that differ only by defaulted trailing parameters are AMBIGUOUS.
-- A ten-argument call matches the 10-arg exactly and the 12-arg by defaults,
-- and Postgres refuses to choose:
--
--   function submit_cash_handover(uuid, uuid, jsonb, unknown, unknown,
--     boolean, unknown, unknown, integer, integer) is not unique
--
-- That is a hard failure, at the counter, at the moment a cashier submits a
-- shift. The app happens to escape it by naming all twelve parameters, so
-- PostgREST resolves to the 12-arg -- but the hazard is one caller away, and
-- the money-path test suite is already failing on it.
--
-- Nothing else calls these. The only database object referencing either name is
-- run_money_path_tests(), and the only application call sites are the two in
-- src/lib/cashHandover.ts, both of which send the full parameter set.
--
-- Dropped by exact signature rather than DROP ... CASCADE: naming each one is
-- the check that this migration removes the four it means to and nothing else.

DROP FUNCTION IF EXISTS public.submit_cash_handover(uuid, uuid, jsonb, text, text, boolean, text);
DROP FUNCTION IF EXISTS public.submit_cash_handover(uuid, uuid, jsonb, text, text, boolean, text, numeric);
DROP FUNCTION IF EXISTS public.submit_cash_handover(uuid, uuid, jsonb, text, text, boolean, text, numeric, numeric, numeric);
DROP FUNCTION IF EXISTS public.declare_opening_cash(text, numeric, uuid, text);

DO $verify$
DECLARE
  v_submit INT; v_declare INT; v_sig TEXT;
BEGIN
  SELECT count(*) INTO v_submit FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'submit_cash_handover';
  SELECT count(*) INTO v_declare FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'declare_opening_cash';

  IF v_submit <> 1 THEN
    RAISE EXCEPTION 'ABORT: % submit_cash_handover remain, expected 1', v_submit;
  END IF;
  IF v_declare <> 1 THEN
    RAISE EXCEPTION 'ABORT: % declare_opening_cash remain, expected 1', v_declare;
  END IF;

  -- The survivor must be the one the application actually calls. Dropping the
  -- wrong one would leave a single unambiguous function that rejects every
  -- request the app makes.
  SELECT p.oid::regprocedure::text INTO v_sig FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'submit_cash_handover';
  IF v_sig NOT LIKE '%numeric,numeric,numeric,numeric)' THEN
    RAISE EXCEPTION 'ABORT: wrong submit_cash_handover survived: %', v_sig;
  END IF;

  SELECT p.oid::regprocedure::text INTO v_sig FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'declare_opening_cash';
  IF v_sig <> 'declare_opening_cash(text,numeric,uuid,text,numeric,numeric)' THEN
    RAISE EXCEPTION 'ABORT: wrong declare_opening_cash survived: %', v_sig;
  END IF;

  -- Every parameter the application names must exist on the survivor, or the
  -- call fails at runtime with "function ... does not exist".
  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'submit_cash_handover'
     AND ARRAY['p_from_user_id','p_to_user_id','p_denominations','p_hospital_type',
               'p_variance_reason','p_include_unattributed','p_notes','p_declared_online',
               'p_locker_cash','p_bank_deposit','p_locker_withdrawn','p_locker_deposited']
         <@ p.proargnames;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ABORT: the surviving submit_cash_handover is missing a parameter the app sends';
  END IF;
END
$verify$;

-- The grants were attached to the signatures, so re-state them for the survivors.
GRANT EXECUTE ON FUNCTION public.submit_cash_handover(
  uuid, uuid, jsonb, text, text, boolean, text, numeric, numeric, numeric, numeric, numeric
) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declare_opening_cash(text, numeric, uuid, text, numeric, numeric)
  TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
