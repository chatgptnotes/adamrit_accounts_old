-- A statement number for the whole cash session, not just the handover.
--
-- Every handover already carries a unique CH- number, and that is a receipt
-- for one act: this person passed this money to that person at that moment.
-- What has no name is the SESSION around it -- the drawer opened with a
-- counted figure, took money all day, paid some out, banked some, and was
-- handed on once or twice. A director asking "show me the statement for Hope
-- on Thursday" has nothing to quote.
--
-- WHAT BOUNDS A SESSION
--
-- One counter, one working day, in IST. That is the boundary the rest of the
-- module already uses -- daily_cash_summary computes exactly this, and the
-- watchdog judges exactly this -- so a statement number that meant anything
-- else would give the hospital two different ideas of "the day" to reconcile.
--
-- It also gives Dr M what he asked for: two handovers on the same counter on
-- the same day SHARE a statement number, because they are two parts of one
-- session, while the CH- numbers stay distinct because they are still two
-- separate acts.
--
-- The day is IST, taken from submitted_at. Stored UTC, an evening handover
-- lands on tomorrow without the conversion, and a statement that puts the
-- night shift on the wrong date is worse than no statement.
--
-- THE TRIGGER NEVER RAISES. Same lesson as this afternoon: it runs while a
-- handover is being written, and an exception here would not refuse the
-- handover cleanly, it would destroy it. A session that cannot be created
-- leaves session_id NULL and the handover intact -- a missing statement number
-- is a cosmetic gap, a lost handover is money nobody can trace.

CREATE SEQUENCE IF NOT EXISTS public.cash_session_no_seq;

CREATE TABLE IF NOT EXISTS public.cash_sessions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  statement_no   TEXT NOT NULL UNIQUE,
  hospital_type  TEXT NOT NULL,
  session_date   DATE NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One session per counter per day. This is the whole definition, enforced
-- rather than merely intended.
CREATE UNIQUE INDEX IF NOT EXISTS cash_sessions_one_per_counter_per_day
  ON public.cash_sessions (lower(btrim(hospital_type)), session_date);

ALTER TABLE public.cash_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cash_sessions_read ON public.cash_sessions;
CREATE POLICY cash_sessions_read ON public.cash_sessions FOR SELECT USING (true);

COMMENT ON TABLE public.cash_sessions IS
  'One counter, one day: the statement number a whole cash session is quoted '
  'by. Handovers within it keep their own CH- numbers.';

ALTER TABLE public.cash_handovers
  ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES public.cash_sessions(id);

CREATE INDEX IF NOT EXISTS cash_handovers_session ON public.cash_handovers (session_id);

/**
 * The session for a counter on a day, made if it does not exist yet.
 *
 * ON CONFLICT then re-select, rather than check-then-insert: two cashiers
 * handing over at the same second would otherwise race and one would fail on
 * the unique index, taking a real handover down with it.
 */
CREATE OR REPLACE FUNCTION public.cash_session_for(
  p_hospital_type TEXT, p_date DATE
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_hosp TEXT := lower(btrim(COALESCE(p_hospital_type, '')));
  v_day  DATE := COALESCE(p_date, (now() AT TIME ZONE 'Asia/Kolkata')::date);
  v_id   UUID;
BEGIN
  IF v_hosp = '' THEN RETURN NULL; END IF;

  SELECT id INTO v_id FROM cash_sessions
   WHERE lower(btrim(hospital_type)) = v_hosp AND session_date = v_day;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  INSERT INTO cash_sessions (statement_no, hospital_type, session_date)
  VALUES ('CS-' || to_char(v_day, 'YYMMDD') || '-' ||
          lpad(nextval('cash_session_no_seq')::TEXT, 4, '0'), v_hosp, v_day)
  ON CONFLICT (lower(btrim(hospital_type)), session_date) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM cash_sessions
     WHERE lower(btrim(hospital_type)) = v_hosp AND session_date = v_day;
  END IF;

  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.attach_cash_session()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.session_id IS NOT NULL THEN RETURN NEW; END IF;
  BEGIN
    NEW.session_id := cash_session_for(
      NEW.hospital_type,
      (COALESCE(NEW.submitted_at, now()) AT TIME ZONE 'Asia/Kolkata')::date);
  EXCEPTION WHEN OTHERS THEN
    -- Never take a handover down for the sake of a statement number.
    RAISE WARNING 'Could not attach a cash session to %: %', NEW.handover_no, SQLERRM;
    NEW.session_id := NULL;
  END;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_attach_cash_session ON public.cash_handovers;
CREATE TRIGGER trg_attach_cash_session
  BEFORE INSERT ON public.cash_handovers
  FOR EACH ROW EXECUTE FUNCTION public.attach_cash_session();

-- Every handover already recorded gets its session too, so the report is not
-- half numbered. Cancelled ones included: they happened, and a statement that
-- silently omits a cancelled handover hides the thing most worth seeing.
DO $backfill$
DECLARE r RECORD; v_n INT := 0;
BEGIN
  FOR r IN SELECT id, hospital_type, submitted_at, created_at
             FROM cash_handovers WHERE session_id IS NULL
            ORDER BY COALESCE(submitted_at, created_at)
  LOOP
    UPDATE cash_handovers
       SET session_id = cash_session_for(
             r.hospital_type,
             (COALESCE(r.submitted_at, r.created_at, now()) AT TIME ZONE 'Asia/Kolkata')::date)
     WHERE id = r.id;
    v_n := v_n + 1;
  END LOOP;
  RAISE NOTICE 'Backfilled % handover(s) into sessions', v_n;
END
$backfill$;

DO $verify$
DECLARE
  v_a UUID; v_b UUID; v_no TEXT; v_n INT; v_u UUID; v_u2 UUID;
BEGIN
  -- (a) same counter, same day = one session; different day or counter = not.
  v_a := cash_session_for('selftest-sess', DATE '2001-01-01');
  v_b := cash_session_for('SELFTEST-SESS', DATE '2001-01-01');   -- case only
  IF v_a IS NULL OR v_a <> v_b THEN
    RAISE EXCEPTION 'ABORT: the same counter and day produced two sessions';
  END IF;
  IF cash_session_for('selftest-sess', DATE '2001-01-02') = v_a THEN
    RAISE EXCEPTION 'ABORT: a different day shared a session';
  END IF;
  IF cash_session_for('selftest-sess2', DATE '2001-01-01') = v_a THEN
    RAISE EXCEPTION 'ABORT: a different counter shared a session';
  END IF;

  -- (b) two handovers on one counter-day SHARE the statement number, which is
  --     the whole point, while keeping their own CH- numbers.
  SELECT id INTO v_u  FROM "User" LIMIT 1;
  SELECT id INTO v_u2 FROM "User" WHERE id <> v_u LIMIT 1;
  INSERT INTO cash_handovers (handover_no, hospital_type, from_user_id, from_user_name,
    to_user_id, to_user_name, period_from, period_to, expected_cash, counted_cash,
    variance_reason, status, submitted_at)
  VALUES ('SELFTEST-S1', 'selftest-sess', v_u, 'A', v_u2, 'B',
          now(), now(), 10, 10, NULL, 'SUBMITTED', TIMESTAMPTZ '2001-01-01 10:00+05:30'),
         ('SELFTEST-S2', 'selftest-sess', v_u, 'A', v_u2, 'B',
          now(), now(), 20, 20, NULL, 'SUBMITTED', TIMESTAMPTZ '2001-01-01 18:00+05:30');

  SELECT count(DISTINCT session_id) INTO v_n FROM cash_handovers
   WHERE handover_no IN ('SELFTEST-S1', 'SELFTEST-S2');
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'ABORT: two handovers in one session got % statement numbers', v_n;
  END IF;
  IF (SELECT count(*) FROM cash_handovers WHERE handover_no IN ('SELFTEST-S1','SELFTEST-S2')
       AND session_id IS NULL) > 0 THEN
    RAISE EXCEPTION 'ABORT: a handover got no session at all';
  END IF;

  DELETE FROM cash_handovers WHERE handover_no IN ('SELFTEST-S1', 'SELFTEST-S2');
  DELETE FROM cash_sessions WHERE hospital_type IN ('selftest-sess', 'selftest-sess2');

  -- (c) every real handover now has a statement number
  SELECT count(*) INTO v_n FROM cash_handovers WHERE session_id IS NULL;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'ABORT: % handover(s) still have no statement number', v_n;
  END IF;

  -- (d) and the numbers themselves are unique
  SELECT count(*) INTO v_n FROM (
    SELECT statement_no FROM cash_sessions GROUP BY statement_no HAVING count(*) > 1
  ) d;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'ABORT: % statement number(s) are duplicated', v_n;
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
