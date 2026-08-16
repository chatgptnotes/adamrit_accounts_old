-- Undo my restore. The protection goes back on.
--
-- 094affa added a permissive "app access pending identity" policy to 39 tables
-- because a Final Bill could not save an ECG charge. I read that as the
-- signed-in database identity failing, and I was wrong.
--
-- The identity works. 7111e1f had verified it end to end against production
-- before switching those tables on -- login, a 359-character token, signature
-- checked as role=authenticated, the database accepting it. What it also warned
-- about was the one case I then walked into: a browser tab opened BEFORE that
-- deploy holds no token, because the token is fetched on page load. The Final
-- Bill tab was old. A refresh was the whole fix, and has now been confirmed as
-- the whole fix.
--
-- My probes said "anon" because I made them with the raw anon key, which is
-- anon by definition and proves nothing about a signed-in browser. Reasoning
-- from that, I reopened nineteen deliberately-closed clinical tables --
-- discharge summaries, doctor plans, OT notes, patient call records -- to
-- anyone holding the public key, and twenty more besides.
--
-- This drops only the policy I created, by exact name. Every policy that was
-- there before is untouched, so each table returns precisely to the state
-- 7111e1f left it in.

-- The tables I touched, remembered before the drop so the checks below can be
-- about my change and nothing else.
CREATE TEMP TABLE _undo_targets ON COMMIT DROP AS
  SELECT tablename FROM pg_policies
   WHERE schemaname = 'public' AND policyname = 'app access pending identity';

DO $undo$
DECLARE r RECORD; v_dropped INT := 0;
BEGIN
  FOR r IN SELECT tablename FROM _undo_targets LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', 'app access pending identity', r.tablename);
    v_dropped := v_dropped + 1;
  END LOOP;
  IF v_dropped = 0 THEN
    RAISE EXCEPTION 'ABORT: nothing to undo — the restore policy is not present';
  END IF;
  RAISE NOTICE 'Dropped the restore policy from % table(s)', v_dropped;
END
$undo$;

DO $verify$
DECLARE v_left INT; v_naked TEXT := ''; r RECORD;
BEGIN
  -- Not one of mine may survive.
  SELECT count(*) INTO v_left FROM pg_policies
   WHERE schemaname='public' AND policyname='app access pending identity';
  IF v_left > 0 THEN
    RAISE EXCEPTION 'ABORT: % restore policy/policies still in place', v_left;
  END IF;

  -- No table I touched may be left with RLS on and no policy at all: that is
  -- not protection, it is a table nobody but the service role can ever read,
  -- and it would take a ward screen down rather than secure it. Scoped to my
  -- own targets -- plenty of server-only tables were already in that state
  -- deliberately, and they are none of this migration's business.
  FOR r IN
    SELECT c.relname AS t
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN _undo_targets u ON u.tablename = c.relname
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
       AND NOT EXISTS (SELECT 1 FROM pg_policies p
                        WHERE p.schemaname='public' AND p.tablename = c.relname)
  LOOP
    v_naked := v_naked || r.t || ' ';
  END LOOP;
  IF v_naked <> '' THEN
    RAISE EXCEPTION 'ABORT: RLS on with no policy at all: %', v_naked;
  END IF;

  -- The nineteen 7111e1f closed must be shut to the public key again.
  FOR r IN
    SELECT unnest(ARRAY['discharge_summaries','doctor_plan','lab_orders','lab_reports',
      'medicine_master','medicine_return_items','medicine_returns','ot_notes',
      'patient_call_records','pharmacy_credit_payments','physiotherapy_bill_items',
      'room_management','visit_clinical_services','visit_esic_surgeons',
      'visit_hope_consultants','visit_hope_surgeons','visit_mandatory_services',
      'visit_referees']) AS t
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_policies p
       WHERE p.schemaname='public' AND p.tablename = r.t
         AND COALESCE(p.qual,'true')='true' AND COALESCE(p.with_check,'true')='true'
         AND (p.roles && ARRAY['public','anon']::name[])
    ) THEN
      RAISE EXCEPTION 'ABORT: % is still open to the anon key', r.t;
    END IF;
  END LOOP;

  -- And the cashbook table locked earlier stays locked.
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='cashbook_handwritten_uploads'
       AND (roles && ARRAY['public','anon']::name[])
  ) THEN
    RAISE EXCEPTION 'ABORT: the cashbook table came open again';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
