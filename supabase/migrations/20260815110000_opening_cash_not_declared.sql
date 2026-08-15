-- Notice when a counter takes cash without ever declaring what it opened with.
--
-- Forcing it was the alternative and Dr M chose not to: a hard block refuses
-- payments, and a counter that cannot take money because nobody counted a
-- drawer is a worse failure than an uncounted drawer. So the payment goes
-- through, the gap is visible to the cashier at the time, and the directors
-- hear about it that evening.
--
-- TWO QUESTIONS, DELIBERATELY DIFFERENT
--
-- The strip on the tablet asks "is there a live opening for my counter RIGHT
-- NOW" -- because if yesterday's opening was never handed over, the drawer's
-- baseline still stands and nagging for a fresh count would be wrong.
--
-- The watchdog asks "did THIS DAY have a baseline" -- declared on the day, or
-- carried in from an earlier day that is still open. A counter running a
-- continuous session across days is not chased.
--
-- A ZERO OPENING IS A REAL ANSWER. An empty drawer is legitimately Rs 0, and
-- cash_opening_for returns a SUM -- so it reads a genuine zero declaration as
-- "nothing declared". Everything here tests whether a ROW EXISTS, never
-- whether the amount is above zero. That distinction is the whole difference
-- between "counted, and it was empty" and "never counted".

/**
 * Has this counter got a live opening? The question the tablet strip asks.
 *
 * Live means declared and not yet carried into a handover -- the same
 * definition cash_opening_for uses, but answering "is there one" rather than
 * "how much", so an honest zero counts.
 */
CREATE OR REPLACE FUNCTION public.cash_opening_state(p_hospital_type TEXT)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'hospitalType', lower(btrim(COALESCE(p_hospital_type, ''))),
    'declared', EXISTS (
      SELECT 1 FROM cash_opening_declarations
       WHERE cash_handover_id IS NULL
         AND lower(btrim(hospital_type)) = lower(btrim(COALESCE(p_hospital_type, '')))
    ),
    'amount', COALESCE((
      SELECT sum(amount) FROM cash_opening_declarations
       WHERE cash_handover_id IS NULL
         AND lower(btrim(hospital_type)) = lower(btrim(COALESCE(p_hospital_type, '')))
    ), 0),
    'at', (
      SELECT max(created_at) FROM cash_opening_declarations
       WHERE cash_handover_id IS NULL
         AND lower(btrim(hospital_type)) = lower(btrim(COALESCE(p_hospital_type, '')))
    ),
    'by', (
      SELECT declared_by_name FROM cash_opening_declarations
       WHERE cash_handover_id IS NULL
         AND lower(btrim(hospital_type)) = lower(btrim(COALESCE(p_hospital_type, '')))
       ORDER BY created_at DESC LIMIT 1
    )
  );
$$;

REVOKE ALL ON FUNCTION public.cash_opening_state(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cash_opening_state(TEXT) TO anon, authenticated;

-- The evening sweep gains a third failure, beside no-handover and no-report.
CREATE OR REPLACE FUNCTION public.notify_missing_cash_duties(
  p_date DATE DEFAULT NULL,
  p_after_hour INT DEFAULT 21
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_day DATE := COALESCE(p_date, (now() AT TIME ZONE 'Asia/Kolkata')::date);
  v_hour INT := extract(hour FROM (now() AT TIME ZONE 'Asia/Kolkata'))::int;
  v_counter TEXT; v_label TEXT; v_summary JSONB;
  v_collected NUMERIC; v_handovers INT; v_reported INT; v_opened BOOLEAN;
  v_raised INT := 0; v_skipped INT := 0;
BEGIN
  IF p_date IS NULL AND v_hour < p_after_hour THEN
    RETURN jsonb_build_object('day', v_day, 'raised', 0,
      'note', format('Too early — the day is judged from %s:00 IST.', p_after_hour));
  END IF;

  FOREACH v_counter IN ARRAY ARRAY['hope', 'ayushman', 'pharmacy'] LOOP
    v_label := CASE v_counter
                 WHEN 'hope' THEN 'DRM Hope Hospital'
                 WHEN 'ayushman' THEN 'Ayushman Nagpur'
                 ELSE 'Hope Pharmacy' END;

    v_summary   := daily_cash_summary(v_day, v_counter);
    v_collected := (v_summary->>'collected')::numeric;

    SELECT count(*) INTO v_handovers FROM cash_handovers
     WHERE lower(btrim(COALESCE(hospital_type, ''))) = v_counter
       AND status <> 'CANCELLED'
       AND (submitted_at AT TIME ZONE 'Asia/Kolkata')::date = v_day;

    SELECT count(*) INTO v_reported FROM cash_daily_reports
     WHERE hospital_type = v_counter AND report_date = v_day;

    -- Declared on the day, or carried in from an earlier day still open. A
    -- counter mid-session across days is not chased for a fresh count.
    SELECT EXISTS (
      SELECT 1 FROM cash_opening_declarations
       WHERE lower(btrim(hospital_type)) = v_counter
         AND ((created_at AT TIME ZONE 'Asia/Kolkata')::date = v_day
              OR (cash_handover_id IS NULL
                  AND (created_at AT TIME ZONE 'Asia/Kolkata')::date < v_day))
    ) INTO v_opened;

    -- 1. Cash taken with no baseline to measure it against.
    IF v_collected > 0 AND NOT v_opened THEN
      IF alert_missing_cash_duty(
           'cash_opening_missing', v_day, v_counter,
           'No opening cash declared — ' || v_label,
           v_label || ' took Rs ' || to_char(v_collected, 'FM9,99,99,990.00') ||
           ' in cash on ' || to_char(v_day, 'DD Mon YYYY') ||
           ' without anyone declaring what the drawer opened with. Nothing can be' ||
           ' reconciled against a baseline that was never recorded.')
      THEN v_raised := v_raised + 1; ELSE v_skipped := v_skipped + 1; END IF;
    END IF;

    -- 2. Cash taken, nothing handed over.
    IF v_collected > 0 AND v_handovers = 0 THEN
      IF alert_missing_cash_duty(
           'cash_handover_missing', v_day, v_counter,
           'No cash handed over — ' || v_label,
           v_label || ' took Rs ' || to_char(v_collected, 'FM9,99,99,990.00') ||
           ' in cash on ' || to_char(v_day, 'DD Mon YYYY') ||
           ' and none of it has been handed over. The drawer has not been counted.')
      THEN v_raised := v_raised + 1; ELSE v_skipped := v_skipped + 1; END IF;
    END IF;

    -- 3. Nobody reported the day.
    IF v_reported = 0 AND (v_collected > 0 OR v_handovers > 0) THEN
      IF alert_missing_cash_duty(
           'cash_report_missing', v_day, v_counter,
           'No daily cash report — ' || v_label,
           'Nobody reported the cash for ' || v_label || ' on ' ||
           to_char(v_day, 'DD Mon YYYY') || '. Rs ' ||
           to_char(v_collected, 'FM9,99,99,990.00') || ' was collected across ' ||
           v_handovers || ' handover(s).')
      THEN v_raised := v_raised + 1; ELSE v_skipped := v_skipped + 1; END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('day', v_day, 'raised', v_raised, 'alreadyRaised', v_skipped);
END $$;

DO $verify$
DECLARE v_s JSONB; v_u UUID; v_id UUID; v_day DATE := DATE '2001-02-02';
BEGIN
  -- (a) a counter with nothing declared reads as not declared
  v_s := cash_opening_state('selftest-open');
  IF (v_s->>'declared')::boolean THEN
    RAISE EXCEPTION 'ABORT: an untouched counter claims to have declared';
  END IF;

  -- (b) A ZERO DECLARATION COUNTS. This is the case cash_opening_for cannot
  --     see, and the reason this function exists at all.
  SELECT id INTO v_u FROM "User" WHERE lower(email) = 'cmd@hopehospital.com';
  IF v_u IS NULL THEN SELECT id INTO v_u FROM "User" LIMIT 1; END IF;

  INSERT INTO cash_opening_declarations (hospital_type, amount, declared_by, declared_by_name, note)
  VALUES ('selftest-open', 0, v_u, 'self test', 'empty drawer')
  RETURNING id INTO v_id;

  v_s := cash_opening_state('selftest-open');
  IF NOT (v_s->>'declared')::boolean THEN
    RAISE EXCEPTION 'ABORT: a counted-and-empty drawer reads as never counted';
  END IF;
  IF (v_s->>'amount')::numeric <> 0 THEN
    RAISE EXCEPTION 'ABORT: the zero amount came back as %', v_s->>'amount';
  END IF;
  IF cash_opening_for('selftest-open') <> 0 THEN
    RAISE EXCEPTION 'ABORT: cash_opening_for changed behaviour';
  END IF;

  -- (c) once carried into a handover it is no longer live
  UPDATE cash_opening_declarations SET cash_handover_id = gen_random_uuid() WHERE id = v_id;
  IF (cash_opening_state('selftest-open')->>'declared')::boolean THEN
    RAISE EXCEPTION 'ABORT: a claimed opening still reads as live';
  END IF;

  DELETE FROM cash_opening_declarations WHERE id = v_id;

  -- (d) the watchdog still answers, and a quiet long-dead day raises nothing
  IF (notify_missing_cash_duties(v_day, 0)->>'raised')::int <> 0 THEN
    RAISE EXCEPTION 'ABORT: a day with no cash at all was alerted on';
  END IF;

  -- (e) and it is still too early to judge today unprompted
  IF (notify_missing_cash_duties(NULL, 99)->>'raised')::int <> 0 THEN
    RAISE EXCEPTION 'ABORT: the day was judged before its cut-off';
  END IF;

  IF EXISTS (SELECT 1 FROM cash_opening_declarations WHERE hospital_type = 'selftest-open') THEN
    RAISE EXCEPTION 'ABORT: self-test declaration left behind';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
