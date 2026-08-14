-- Tell the directors when the cash was NOT handed over, and NOT reported.
--
-- Every alert in this module so far fires on something that happened: a
-- handover with a variance, a handover left waiting. The failure that actually
-- loses money is the one where nothing happens at all -- the drawer is never
-- counted, nobody reports it, and there is no row anywhere to notice. Silence
-- reads exactly like a quiet day.
--
-- "Immediately" is not literally available for an absence: you cannot alert on
-- a handover the moment it fails to occur, only once the day has run out of
-- time for it. So this is a cut-off. From 21:00 IST the day is judged, and a
-- counter that took cash and handed none over, or that nobody reported, is
-- raised to the directors within the hour.
--
-- Two separate failures, deliberately not merged:
--
--   * NO HANDOVER  -- cash came in and none of it was passed on. This is about
--     the cashier, and it is the one that loses money.
--   * NO REPORT    -- Avani did not send the day's report. The cash may be
--     perfectly fine; what is missing is the check.
--
-- A counter that took no cash at all is not chased for a handover. There is
-- nothing to hand over, and an alert that cries wolf on every quiet Sunday is
-- an alert people learn to close without reading.
--
-- Runs as plain SQL under pg_cron. No pg_net, no edge function, nothing that
-- can be switched off elsewhere without anyone noticing.

CREATE OR REPLACE FUNCTION public.notify_missing_cash_duties(
  p_date DATE DEFAULT NULL,
  p_after_hour INT DEFAULT 21
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_day DATE := COALESCE(p_date, (now() AT TIME ZONE 'Asia/Kolkata')::date);
  v_hour INT := extract(hour FROM (now() AT TIME ZONE 'Asia/Kolkata'))::int;
  v_counter TEXT; v_label TEXT; v_summary JSONB;
  v_collected NUMERIC; v_handovers INT; v_reported INT;
  v_raised INT := 0; v_skipped INT := 0;
BEGIN
  -- Only judge a day that has had its chance. Called explicitly with a past
  -- date -- a catch-up, or a director asking about yesterday -- the hour of
  -- the moment is irrelevant.
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

    -- 1. Cash taken, nothing handed over.
    IF v_collected > 0 AND v_handovers = 0 THEN
      IF alert_missing_cash_duty(
           'cash_handover_missing', v_day, v_counter,
           'No cash handed over — ' || v_label,
           v_label || ' took Rs ' || to_char(v_collected, 'FM9,99,99,990.00') ||
           ' in cash on ' || to_char(v_day, 'DD Mon YYYY') ||
           ' and none of it has been handed over. The drawer has not been counted.')
      THEN v_raised := v_raised + 1; ELSE v_skipped := v_skipped + 1; END IF;
    END IF;

    -- 2. Nobody reported the day. Chased whenever there was any cash activity
    --    at all, handed over or not -- a handover without a report is still an
    --    unchecked day.
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

/**
 * One alert, to every director, once per counter per day per kind.
 *
 * Returns true if it raised something and false if it had already been raised.
 * The dedupe is what makes it safe to run this every hour: the first run after
 * the cut-off tells them, and the rest stay quiet.
 */
CREATE OR REPLACE FUNCTION public.alert_missing_cash_duty(
  p_type TEXT, p_day DATE, p_counter TEXT, p_title TEXT, p_message TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_key TEXT := p_counter || ':' || p_day::text; v_n INT;
BEGIN
  IF EXISTS (SELECT 1 FROM notifications
              WHERE notification_type = p_type
                AND source_table = 'cash_daily_duty'
                AND source_id = v_key) THEN
    RETURN false;
  END IF;

  INSERT INTO notifications (
    notification_type, title, message, recipient_user_id, recipient_role,
    hospital_name, source_table, source_id
  )
  SELECT p_type, p_title, p_message, u.id, 'superadmin', p_counter,
         'cash_daily_duty', v_key
    FROM "User" u
   WHERE u.role IN ('superadmin', 'super_admin')
     AND COALESCE(u.is_active, true);
  GET DIAGNOSTICS v_n = ROW_COUNT;

  RETURN v_n > 0;
END $$;

REVOKE ALL ON FUNCTION public.notify_missing_cash_duties(DATE, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.alert_missing_cash_duty(TEXT, DATE, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_missing_cash_duties(DATE, INT) TO anon, authenticated;

-- Hourly from 21:00 to 23:00 IST (15:30-17:30 UTC), then once more at 06:30
-- IST for anything the night missed. Deduped, so the directors are told once.
SELECT cron.unschedule('cash-duty-watchdog')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cash-duty-watchdog');

SELECT cron.schedule(
  'cash-duty-watchdog',
  '30 15,16,17,1 * * *',
  $cron$ SELECT public.notify_missing_cash_duties(); $cron$
);

DO $verify$
DECLARE
  v_u UUID; v_u2 UUID; v_res JSONB; v_day DATE := DATE '2001-01-01';
  v_before INT; v_after INT; v_second INT; v_directors INT;
BEGIN
  SELECT id INTO v_u FROM "User" WHERE role IN ('superadmin','super_admin') LIMIT 1;
  SELECT id INTO v_u2 FROM "User" WHERE id <> v_u LIMIT 1;
  IF v_u IS NULL OR v_u2 IS NULL THEN
    RAISE EXCEPTION 'ABORT: need two users to self-test';
  END IF;
  SELECT count(*) INTO v_directors FROM "User"
   WHERE role IN ('superadmin','super_admin') AND COALESCE(is_active, true);

  -- (a) before the cut-off, an unjudged day is left alone
  v_res := notify_missing_cash_duties(NULL, 99);
  IF (v_res->>'raised')::int <> 0 THEN
    RAISE EXCEPTION 'ABORT: the day was judged before its cut-off';
  END IF;

  -- (b) a long-dead date with no activity raises nothing. This is the
  --     cries-wolf case: quiet days must stay quiet.
  v_res := notify_missing_cash_duties(v_day, 0);
  IF (v_res->>'raised')::int <> 0 THEN
    RAISE EXCEPTION 'ABORT: a day with no cash at all was alerted on';
  END IF;

  -- (c) the alert itself reaches every director, once.
  --
  --     Asserted through the helper on a counter of its own rather than by
  --     forcing cash onto a real one: the loop above is proven by (b), and
  --     manufacturing a fake handover against 'hope' to test an alert would
  --     leave a false shortage in the hospital's own register if any step
  --     after it failed.
  SELECT count(*) INTO v_before FROM notifications WHERE source_table = 'cash_daily_duty';

  IF NOT alert_missing_cash_duty('cash_handover_missing', v_day, 'selftest-dutyctr',
                                 'self test', 'self test') THEN
    RAISE EXCEPTION 'ABORT: the first alert did not raise';
  END IF;
  SELECT count(*) INTO v_after FROM notifications WHERE source_table = 'cash_daily_duty';
  IF v_after - v_before <> v_directors THEN
    RAISE EXCEPTION 'ABORT: % alerts for % directors', v_after - v_before, v_directors;
  END IF;

  -- (d) running again must NOT tell them twice. This is what makes an hourly
  --     schedule safe.
  IF alert_missing_cash_duty('cash_handover_missing', v_day, 'selftest-dutyctr',
                             'self test', 'self test') THEN
    RAISE EXCEPTION 'ABORT: the same failure was raised twice';
  END IF;
  SELECT count(*) INTO v_second FROM notifications WHERE source_table = 'cash_daily_duty';
  IF v_second <> v_after THEN
    RAISE EXCEPTION 'ABORT: a duplicate alert was written';
  END IF;

  -- (e) the two failures are separate: a report chase is not silenced by a
  --     handover chase on the same counter and day
  IF NOT alert_missing_cash_duty('cash_report_missing', v_day, 'selftest-dutyctr',
                                 'self test', 'self test') THEN
    RAISE EXCEPTION 'ABORT: the missing report was silenced by the missing handover';
  END IF;

  DELETE FROM notifications
   WHERE source_table = 'cash_daily_duty' AND source_id LIKE 'selftest-dutyctr:%';

  IF EXISTS (SELECT 1 FROM notifications WHERE source_id LIKE 'selftest-dutyctr:%') THEN
    RAISE EXCEPTION 'ABORT: self-test alerts left behind';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cash-duty-watchdog') THEN
    RAISE EXCEPTION 'ABORT: the watchdog was not scheduled';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
