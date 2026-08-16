-- Every change to an opening balance leaves a record.
--
-- WHY. On 16-Aug Ayushman's Cash opening was found holding Rs 14,698 where the
-- Tally restatement had put Rs 51,85,800 -- a Rs 51,71,102 hole in the trial
-- balance. The figure was straightforward to restore. Establishing WHO changed
-- it, and when, was impossible: the Opening Balances screen writes no audit
-- row, does not maintain updated_at, and logs nothing to user_activity_log.
-- The row still carried a 3-Aug timestamp set by an unrelated migration.
--
-- These are cutover figures reconciled against Tally. A silent edit to one is
-- indistinguishable from a silent edit to the books themselves.
--
-- AT THE TABLE, NOT IN THE SCREEN. A trigger catches every writer -- the
-- Opening Balances screen, a future screen nobody has written yet, a migration,
-- an ad-hoc session. Auditing inside OpeningBalances.tsx would cover exactly
-- one of those and quietly miss the rest.
--
-- IT CAN BLOCK A WRITE, deliberately. If the audit row cannot be written the
-- change does not happen. An audit that drops rows under load is worse than no
-- audit, because it is trusted. This is a rare accounting edit, not a hot path:
-- it cannot stop the hospital admitting, billing or dispensing.
--
-- NAMING THE PERSON now works because SUPABASE_USER_JWT=1 went on earlier
-- today, so a signed-in staff member reaches Postgres as `authenticated` and
-- auth.uid() carries their User id. Writes without a JWT -- migrations, the
-- service role -- are recorded as such rather than skipped.

-- ---------------------------------------------------------------------------
-- 1. The record. Append-only: no updated_at, and nothing may edit it.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.opening_balance_audit (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Deliberately NO foreign key to chart_of_accounts: the history of a ledger
  -- must survive the ledger.
  account_id           UUID        NOT NULL,
  company_id           UUID,
  account_code         TEXT,
  account_name         TEXT,
  change_kind          TEXT        NOT NULL,   -- 'INSERT' | 'UPDATE'
  old_balance          NUMERIC,
  old_balance_type     TEXT,
  new_balance          NUMERIC,
  new_balance_type     TEXT,
  -- Signed, credits positive, so a reader can see the effect on the trial
  -- balance without redoing the Dr/Cr arithmetic.
  delta_cr             NUMERIC     NOT NULL,
  changed_by           UUID,                   -- auth.uid(), when there is one
  changed_by_name      TEXT,
  db_role              TEXT        NOT NULL,   -- anon / authenticated / service
  changed_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS opening_balance_audit_account_idx
  ON public.opening_balance_audit (account_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS opening_balance_audit_when_idx
  ON public.opening_balance_audit (changed_at DESC);

-- ---------------------------------------------------------------------------
-- 2. The recorder.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_opening_balance_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     UUID;
  v_name    TEXT;
  v_role    TEXT;
  v_old_bal NUMERIC;
  v_old_typ TEXT;
  v_signed  NUMERIC;
BEGIN
  -- auth.uid() throws rather than returning NULL when no JWT is present, which
  -- is exactly the case for a migration or the service role.
  BEGIN
    v_uid := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_uid := NULL;
  END;

  BEGIN
    v_role := COALESCE(auth.role(), current_user);
  EXCEPTION WHEN OTHERS THEN
    v_role := current_user;
  END;

  IF v_uid IS NOT NULL THEN
    SELECT COALESCE(u.full_name, u.email) INTO v_name FROM public."User" u WHERE u.id = v_uid;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_old_bal := OLD.opening_balance;
    v_old_typ := OLD.opening_balance_type;
  END IF;

  -- Credits positive, the same basis run_books_health_checks() uses.
  v_signed :=
      CASE WHEN upper(COALESCE(NEW.opening_balance_type, 'DR')) = 'CR'
           THEN COALESCE(NEW.opening_balance, 0) ELSE -COALESCE(NEW.opening_balance, 0) END
    - CASE WHEN upper(COALESCE(v_old_typ, 'DR')) = 'CR'
           THEN COALESCE(v_old_bal, 0) ELSE -COALESCE(v_old_bal, 0) END;

  INSERT INTO public.opening_balance_audit (
    account_id, company_id, account_code, account_name, change_kind,
    old_balance, old_balance_type, new_balance, new_balance_type,
    delta_cr, changed_by, changed_by_name, db_role
  ) VALUES (
    NEW.id, NEW.company_id, NEW.account_code, NEW.account_name, TG_OP,
    v_old_bal, v_old_typ, NEW.opening_balance, NEW.opening_balance_type,
    v_signed, v_uid, v_name, v_role
  );

  RETURN NULL;  -- AFTER trigger; the return value is not used
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. When it fires.
--    AFTER, never BEFORE INSERT — a child row written before its parent exists
--    is the pattern that stopped every bill saving for 18 days
--    (docs/money-path-rules.md, rule 2).
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS audit_opening_balance_update ON public.chart_of_accounts;
CREATE TRIGGER audit_opening_balance_update
  AFTER UPDATE OF opening_balance, opening_balance_type
  ON public.chart_of_accounts
  FOR EACH ROW
  WHEN (OLD.opening_balance     IS DISTINCT FROM NEW.opening_balance
     OR OLD.opening_balance_type IS DISTINCT FROM NEW.opening_balance_type)
  EXECUTE FUNCTION public.audit_opening_balance_change();

-- A ledger created already holding money is the other way an opening appears.
DROP TRIGGER IF EXISTS audit_opening_balance_insert ON public.chart_of_accounts;
CREATE TRIGGER audit_opening_balance_insert
  AFTER INSERT
  ON public.chart_of_accounts
  FOR EACH ROW
  WHEN (COALESCE(NEW.opening_balance, 0) <> 0)
  EXECUTE FUNCTION public.audit_opening_balance_change();

-- ---------------------------------------------------------------------------
-- 4. Close the other half of the forensic gap: updated_at was never maintained,
--    which is why the drifted row still read 3-Aug. Only touched when an
--    opening actually changes, so no other behaviour shifts.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.stamp_opening_balance_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stamp_opening_balance_updated_at ON public.chart_of_accounts;
CREATE TRIGGER stamp_opening_balance_updated_at
  BEFORE UPDATE OF opening_balance, opening_balance_type
  ON public.chart_of_accounts
  FOR EACH ROW
  WHEN (OLD.opening_balance     IS DISTINCT FROM NEW.opening_balance
     OR OLD.opening_balance_type IS DISTINCT FROM NEW.opening_balance_type)
  EXECUTE FUNCTION public.stamp_opening_balance_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Who may read it. Readable by staff, writable by nobody: there is no
--    INSERT/UPDATE/DELETE policy, so the SECURITY DEFINER trigger is the only
--    way a row is ever created.
--
--    TO public rather than TO anon: a policy naming anon alone strands the
--    table the moment a signed-in user arrives as `authenticated`, which is
--    what 20260816110000 had to repair on two clinical tables.
-- ---------------------------------------------------------------------------
ALTER TABLE public.opening_balance_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS opening_balance_audit_read ON public.opening_balance_audit;
CREATE POLICY opening_balance_audit_read
  ON public.opening_balance_audit
  FOR SELECT TO public
  USING (true);

GRANT SELECT ON public.opening_balance_audit TO anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.opening_balance_audit FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Prove the trigger fires, then undo the proof.
--    The inner block has an EXCEPTION clause, so it is a savepoint: the test
--    write and its audit row are both rolled back, and nothing survives.
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE
  v_id      UUID;
  v_before  NUMERIC;
  v_rows    INT;
  v_stamped TIMESTAMPTZ;
BEGIN
  SELECT id, opening_balance INTO v_id, v_before
    FROM public.chart_of_accounts
   WHERE is_active
   ORDER BY id
   LIMIT 1;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'ABORT: no active ledger to test against';
  END IF;

  BEGIN
    UPDATE public.chart_of_accounts
       SET opening_balance = COALESCE(v_before, 0) + 1.23
     WHERE id = v_id;

    SELECT count(*) INTO v_rows
      FROM public.opening_balance_audit
     WHERE account_id = v_id AND change_kind = 'UPDATE';
    IF v_rows = 0 THEN
      RAISE EXCEPTION 'ABORT: the audit trigger did not record an opening-balance change';
    END IF;

    SELECT updated_at INTO v_stamped FROM public.chart_of_accounts WHERE id = v_id;
    IF v_stamped < now() - interval '1 minute' THEN
      RAISE EXCEPTION 'ABORT: updated_at was not stamped by the change';
    END IF;

    -- Everything above is correct; unwind it.
    RAISE EXCEPTION 'ROLLBACK_SELFTEST';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'ROLLBACK_SELFTEST' THEN
      RAISE;
    END IF;
  END;

  -- The test must have left nothing behind.
  IF (SELECT opening_balance FROM public.chart_of_accounts WHERE id = v_id)
     IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'ABORT: the self-test changed a real opening balance';
  END IF;
  IF EXISTS (SELECT 1 FROM public.opening_balance_audit) THEN
    RAISE EXCEPTION 'ABORT: the self-test left an audit row behind';
  END IF;

  RAISE NOTICE 'Opening-balance auditing is live; the self-test rolled back cleanly.';
END
$verify$;

NOTIFY pgrst, 'reload schema';
