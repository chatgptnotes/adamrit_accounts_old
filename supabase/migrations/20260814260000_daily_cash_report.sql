-- Avani's daily cash report, and the shortage or excess it sends to directors.
--
-- Cash is counted at handover and the variance is recorded there, but nobody
-- is told. A shortage sits in a row on a register that a director has to think
-- to open, which means it is found at month end or not at all. The person who
-- checks the drawer needs a way to say "today is short 400, here is why" and
-- have that reach the people who carry the loss.
--
-- TWO RULES THIS FOLLOWS, BOTH BORROWED RATHER THAN INVENTED
--
-- 1. The client never supplies the figures. Avani picks a day and a counter;
--    everything else is computed here, exactly as cash_handover_preview does
--    it, because a report of a shortage must not be typed by hand by the
--    person reporting it.
--
-- 2. The shortage is not a second reconciliation. It is the sum of the
--    variances on that day's handovers -- the same number the cashier already
--    had to explain when the drawer was counted. Inventing a parallel
--    calculation here would give the hospital two different answers to "how
--    much was missing" and no way to choose between them.
--
-- What the report adds is context around that number: what was opened with,
-- what came in and from whom, what was paid out, what was banked, and what
-- was handed on. A bare "short 400" is unactionable; the day around it is not.

CREATE TABLE IF NOT EXISTS public.cash_daily_reports (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_date    DATE NOT NULL,
  hospital_type  TEXT NOT NULL,
  -- SHORTAGE | EXCESS | BALANCED, decided from the figures, never typed.
  kind           TEXT NOT NULL CHECK (kind IN ('SHORTAGE', 'EXCESS', 'BALANCED')),
  variance       NUMERIC(15,2) NOT NULL,
  -- The day as it stood when the report was sent. A report is evidence, and
  -- evidence that silently restates itself when later rows land is not.
  snapshot       JSONB NOT NULL,
  note           TEXT,
  reported_by    UUID REFERENCES public."User"(id),
  reported_by_name TEXT,
  directors_told INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cash_daily_reports_day
  ON public.cash_daily_reports (report_date DESC, hospital_type);

ALTER TABLE public.cash_daily_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cash_daily_reports_read ON public.cash_daily_reports;
CREATE POLICY cash_daily_reports_read
  ON public.cash_daily_reports FOR SELECT USING (true);

COMMENT ON TABLE public.cash_daily_reports IS
  'One cashier-day reported to the directors: the variance, the day around it, '
  'and who sent it. Written by report_daily_cash().';

-- ---------------------------------------------------------------------------
-- The day, computed. Read-only and safe to call as often as the screen likes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.daily_cash_summary(
  p_date DATE, p_hospital_type TEXT
) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_hosp TEXT := lower(btrim(COALESCE(p_hospital_type, '')));
  v_day  DATE := COALESCE(p_date, (now() AT TIME ZONE 'Asia/Kolkata')::date);
  v_company_key TEXT;
  v_opening NUMERIC := 0; v_collected NUMERIC := 0; v_paid NUMERIC := 0;
  v_deposit NUMERIC := 0; v_handed NUMERIC := 0; v_variance NUMERIC := 0;
  v_by_cashier JSONB := '[]'::jsonb; v_handovers JSONB := '[]'::jsonb;
BEGIN
  IF v_hosp = '' THEN RAISE EXCEPTION 'Which counter is this for?'; END IF;
  v_company_key := cash_bank_company_key(v_hosp);

  -- Opening counted on the day. Timestamps are stored UTC; the hospital's day
  -- is IST, so without the conversion an evening count lands on tomorrow.
  SELECT COALESCE(sum(amount), 0) INTO v_opening
    FROM cash_opening_declarations
   WHERE lower(btrim(hospital_type)) = v_hosp
     AND (created_at AT TIME ZONE 'Asia/Kolkata')::date = v_day;

  IF v_hosp = 'pharmacy' THEN
    -- Two passes over the same till: one for the total, one grouped by the
    -- person who took it.
    SELECT COALESCE(sum(amount), 0) INTO v_collected FROM (
      SELECT COALESCE(s.total_amount, 0) AS amount FROM pharmacy_sales s
       WHERE COALESCE(s.total_amount, 0) > 0
         AND upper(btrim(COALESCE(s.status, 'COMPLETED'))) <> 'CANCELLED'
         AND upper(btrim(COALESCE(s.payment_method, ''))) = 'CASH'
         AND (s.created_at AT TIME ZONE 'Asia/Kolkata')::date = v_day
      UNION ALL
      SELECT COALESCE(p.amount, 0) FROM pharmacy_credit_payments p
       WHERE COALESCE(p.amount, 0) > 0
         AND upper(btrim(COALESCE(p.payment_method, ''))) = 'CASH'
         AND (p.created_at AT TIME ZONE 'Asia/Kolkata')::date = v_day
    ) t;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'who', who, 'amount', amount, 'count', n) ORDER BY amount DESC), '[]'::jsonb)
      INTO v_by_cashier
      FROM (
        SELECT who, sum(amount) AS amount, count(*) AS n FROM (
          SELECT COALESCE((SELECT COALESCE(u.full_name, u.email) FROM "User" u
                            WHERE u.id = COALESCE(s.collected_by_user_id, s.created_by)),
                          'Not recorded') AS who,
                 COALESCE(s.total_amount, 0) AS amount
            FROM pharmacy_sales s
           WHERE COALESCE(s.total_amount, 0) > 0
             AND upper(btrim(COALESCE(s.status, 'COMPLETED'))) <> 'CANCELLED'
             AND upper(btrim(COALESCE(s.payment_method, ''))) = 'CASH'
             AND (s.created_at AT TIME ZONE 'Asia/Kolkata')::date = v_day
          UNION ALL
          SELECT COALESCE(NULLIF(btrim(COALESCE(p.pharmacy_executive, '')), ''),
                          NULLIF(btrim(NULLIF(COALESCE(p.received_by, ''), 'Unknown')), ''),
                          'Not recorded'),
                 COALESCE(p.amount, 0)
            FROM pharmacy_credit_payments p
           WHERE COALESCE(p.amount, 0) > 0
             AND upper(btrim(COALESCE(p.payment_method, ''))) = 'CASH'
             AND (p.created_at AT TIME ZONE 'Asia/Kolkata')::date = v_day
        ) rows GROUP BY who
      ) g;
  ELSE
    SELECT COALESCE(sum(amount), 0) INTO v_collected FROM (
      SELECT COALESCE(a.advance_amount, 0) AS amount
        FROM advance_payment a LEFT JOIN patients pt ON pt.id = a.patient_id
       WHERE upper(btrim(COALESCE(a.payment_mode, ''))) = 'CASH'
         AND COALESCE(a.is_refund, false) = false
         AND COALESCE(a.status, 'ACTIVE') = 'ACTIVE'
         AND COALESCE(a.advance_amount, 0) > 0
         AND (a.payment_date AT TIME ZONE 'Asia/Kolkata')::date = v_day
         AND lower(btrim(COALESCE(pt.hospital_name, ''))) = v_hosp
      UNION ALL
      SELECT COALESCE(f.amount, 0)
        FROM final_payments f LEFT JOIN patients pt ON pt.id = f.patient_id
       WHERE upper(btrim(COALESCE(f.mode_of_payment, ''))) = 'CASH'
         AND COALESCE(f.amount, 0) > 0
         AND (f.payment_date AT TIME ZONE 'Asia/Kolkata')::date = v_day
         AND lower(btrim(COALESCE(pt.hospital_name, ''))) = v_hosp
    ) t;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'who', who, 'amount', amount, 'count', n) ORDER BY amount DESC), '[]'::jsonb)
      INTO v_by_cashier
      FROM (
        SELECT who, sum(amount) AS amount, count(*) AS n FROM (
          SELECT COALESCE(
                   (SELECT COALESCE(u.full_name, u.email) FROM "User" u WHERE u.id = a.collected_by_user_id),
                   NULLIF(btrim(COALESCE(a.billing_executive, '')), ''),
                   'Not recorded') AS who,
                 COALESCE(a.advance_amount, 0) AS amount
            FROM advance_payment a LEFT JOIN patients pt ON pt.id = a.patient_id
           WHERE upper(btrim(COALESCE(a.payment_mode, ''))) = 'CASH'
             AND COALESCE(a.is_refund, false) = false
             AND COALESCE(a.status, 'ACTIVE') = 'ACTIVE'
             AND COALESCE(a.advance_amount, 0) > 0
             AND (a.payment_date AT TIME ZONE 'Asia/Kolkata')::date = v_day
             AND lower(btrim(COALESCE(pt.hospital_name, ''))) = v_hosp
          UNION ALL
          SELECT COALESCE(
                   (SELECT COALESCE(u.full_name, u.email) FROM "User" u WHERE u.id = f.collected_by_user_id),
                   'Final bill counter'),
                 COALESCE(f.amount, 0)
            FROM final_payments f LEFT JOIN patients pt ON pt.id = f.patient_id
           WHERE upper(btrim(COALESCE(f.mode_of_payment, ''))) = 'CASH'
             AND COALESCE(f.amount, 0) > 0
             AND (f.payment_date AT TIME ZONE 'Asia/Kolkata')::date = v_day
             AND lower(btrim(COALESCE(pt.hospital_name, ''))) = v_hosp
        ) rows GROUP BY who
      ) g;
  END IF;

  -- Cash out of the drawer on the day, split into money paid away and money
  -- carried to the bank. Both credit the Cash ledger; only the narration tells
  -- them apart, and a deposit is not a payout.
  SELECT
    COALESCE(sum(t.amount) FILTER (WHERE NOT t.is_deposit), 0),
    COALESCE(sum(t.amount) FILTER (WHERE t.is_deposit), 0)
    INTO v_paid, v_deposit
  FROM (
    SELECT sum(ve.credit_amount) AS amount,
           (min(v.narration) LIKE 'Cash deposited into%') AS is_deposit
      FROM voucher_entries ve
      JOIN vouchers v ON v.id = ve.voucher_id
      JOIN chart_of_accounts a ON a.id = ve.account_id
      JOIN companies c ON c.id = a.company_id
     WHERE ve.credit_amount > 0
       AND v.status = 'AUTHORISED'
       AND COALESCE(v.is_optional, false) = false
       AND c.company_key = v_company_key
       AND lower(btrim(regexp_replace(a.account_name, '[^a-zA-Z0-9]+', ' ', 'g')))
           IN ('cash', 'cash in hand')
       AND v.voucher_date = v_day
     GROUP BY v.id
  ) t;

  -- The day's handovers, and the variance that is the point of the report.
  SELECT COALESCE(sum(counted_cash), 0), COALESCE(sum(variance), 0),
         COALESCE(jsonb_agg(jsonb_build_object(
           'handoverNo', handover_no, 'from', from_user_name, 'to', to_user_name,
           'expected', expected_cash, 'counted', counted_cash,
           'locker', locker_cash, 'deposit', bank_deposit,
           'variance', variance, 'reason', variance_reason, 'status', status,
           'at', submitted_at) ORDER BY submitted_at), '[]'::jsonb)
    INTO v_handed, v_variance, v_handovers
    FROM cash_handovers
   WHERE lower(btrim(COALESCE(hospital_type, ''))) = v_hosp
     AND status <> 'CANCELLED'
     AND (submitted_at AT TIME ZONE 'Asia/Kolkata')::date = v_day;

  RETURN jsonb_build_object(
    'date', v_day,
    'hospitalType', v_hosp,
    'companyKey', v_company_key,
    'opening', v_opening,
    'collected', v_collected,
    'paidOut', v_paid,
    'deposited', v_deposit,
    'handedOver', v_handed,
    -- What should still be in the drawer if nothing is missing.
    'stillInDrawer', v_opening + v_collected - v_paid - v_deposit - v_handed,
    'variance', v_variance,
    'kind', CASE WHEN round(v_variance, 2) < 0 THEN 'SHORTAGE'
                 WHEN round(v_variance, 2) > 0 THEN 'EXCESS'
                 ELSE 'BALANCED' END,
    'byCashier', v_by_cashier,
    'handovers', v_handovers
  );
END $$;

-- ---------------------------------------------------------------------------
-- Send it. Snapshots the day and tells every director.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.report_daily_cash(
  p_date DATE, p_hospital_type TEXT, p_user_id UUID, p_note TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_summary JSONB; v_variance NUMERIC; v_kind TEXT; v_name TEXT;
  v_id UUID; v_told INT := 0; v_label TEXT; v_note TEXT;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'Sign in before reporting'; END IF;
  SELECT COALESCE(full_name, email) INTO v_name FROM "User" WHERE id = p_user_id;
  IF v_name IS NULL THEN RAISE EXCEPTION 'Unknown user'; END IF;

  v_summary  := daily_cash_summary(p_date, p_hospital_type);
  v_variance := (v_summary->>'variance')::NUMERIC;
  v_kind     := v_summary->>'kind';
  v_note     := NULLIF(btrim(COALESCE(p_note, '')), '');

  -- A difference has to be explained by the person reporting it, exactly as
  -- the cashier had to explain it at the handover. A balanced day needs no
  -- words.
  IF v_kind <> 'BALANCED' AND v_note IS NULL THEN
    RAISE EXCEPTION 'Say what happened. The day is % by %.',
      lower(v_kind), to_char(abs(v_variance), 'FM9,99,99,990.00');
  END IF;

  v_label := CASE lower(btrim(p_hospital_type))
               WHEN 'hope' THEN 'DRM Hope Hospital'
               WHEN 'ayushman' THEN 'Ayushman Nagpur'
               WHEN 'pharmacy' THEN 'Hope Pharmacy'
               ELSE p_hospital_type END;

  INSERT INTO cash_daily_reports (
    report_date, hospital_type, kind, variance, snapshot, note,
    reported_by, reported_by_name
  ) VALUES (
    (v_summary->>'date')::date, lower(btrim(p_hospital_type)), v_kind, v_variance,
    v_summary, v_note, p_user_id, v_name
  ) RETURNING id INTO v_id;

  -- One row per director rather than a broadcast: a null recipient shows the
  -- alert to everybody, and a shortage is not everybody's business.
  INSERT INTO notifications (
    notification_type, title, message, recipient_user_id, recipient_role,
    hospital_name, source_table, source_id
  )
  SELECT
    'cash_daily_report',
    CASE v_kind
      WHEN 'SHORTAGE' THEN 'Cash short — ' || v_label
      WHEN 'EXCESS'   THEN 'Cash over — '  || v_label
      ELSE 'Cash balanced — ' || v_label END,
    v_name || ' reported ' || v_label || ' for ' ||
    to_char((v_summary->>'date')::date, 'DD Mon YYYY') || ': ' ||
    CASE v_kind
      WHEN 'BALANCED' THEN 'the drawer balanced.'
      ELSE lower(v_kind) || ' of Rs ' || to_char(abs(v_variance), 'FM9,99,99,990.00') || '.' END ||
    ' Collected Rs ' || to_char((v_summary->>'collected')::numeric, 'FM9,99,99,990.00') ||
    ', handed over Rs ' || to_char((v_summary->>'handedOver')::numeric, 'FM9,99,99,990.00') ||
    COALESCE('. Note: ' || v_note, ''),
    u.id, 'superadmin', lower(btrim(p_hospital_type)), 'cash_daily_reports', v_id::text
  FROM "User" u
  WHERE u.role IN ('superadmin', 'super_admin')
    AND COALESCE(u.is_active, true);
  GET DIAGNOSTICS v_told = ROW_COUNT;

  UPDATE cash_daily_reports SET directors_told = v_told WHERE id = v_id;

  RETURN jsonb_build_object(
    'id', v_id, 'kind', v_kind, 'variance', v_variance, 'directorsTold', v_told
  );
END $$;

REVOKE ALL ON FUNCTION public.daily_cash_summary(DATE, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.report_daily_cash(DATE, TEXT, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.daily_cash_summary(DATE, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.report_daily_cash(DATE, TEXT, UUID, TEXT) TO anon, authenticated;

DO $verify$
DECLARE
  v_u UUID; v_u2 UUID; v_s JSONB; v_res JSONB; v_ok BOOLEAN; v_rows INT; v_notes INT;
BEGIN
  SELECT id INTO v_u FROM "User" WHERE role IN ('superadmin','super_admin') LIMIT 1;
  -- Two people: the table refuses a handover from someone to themselves, and
  -- rightly so.
  SELECT id INTO v_u2 FROM "User" WHERE id <> v_u LIMIT 1;
  IF v_u IS NULL OR v_u2 IS NULL THEN
    RAISE EXCEPTION 'ABORT: need a director and one other user to self-test';
  END IF;

  -- (a) the summary answers for every counter without blowing up
  FOREACH v_s IN ARRAY ARRAY['"hope"'::jsonb, '"ayushman"'::jsonb, '"pharmacy"'::jsonb] LOOP
    PERFORM daily_cash_summary((now() AT TIME ZONE 'Asia/Kolkata')::date, v_s #>> '{}');
  END LOOP;

  -- (b) a counter must be named
  v_ok := false;
  BEGIN
    PERFORM daily_cash_summary(CURRENT_DATE, '');
  EXCEPTION WHEN SQLSTATE 'P0001' THEN v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'ABORT: an unnamed counter was summarised'; END IF;

  -- (c) the arithmetic holds: what is left is what came in less what went out
  v_s := daily_cash_summary((now() AT TIME ZONE 'Asia/Kolkata')::date, 'hope');
  IF round((v_s->>'stillInDrawer')::numeric, 2) <> round(
       (v_s->>'opening')::numeric + (v_s->>'collected')::numeric
       - (v_s->>'paidOut')::numeric - (v_s->>'deposited')::numeric
       - (v_s->>'handedOver')::numeric, 2) THEN
    RAISE EXCEPTION 'ABORT: the day does not add up';
  END IF;

  -- (d) a day that is out cannot be reported without a word of explanation.
  --     Proven on a counter invented for the test, so no real day is touched.
  INSERT INTO cash_handovers (handover_no, hospital_type, from_user_id, from_user_name,
    to_user_id, to_user_name, period_from, period_to, expected_cash, counted_cash,
    variance_reason, status)
  VALUES ('SELFTEST-DCR', 'selftestctr', v_u, 'Self test from', v_u2, 'Self test to',
          now(), now(), 500, 100, 'self test', 'SUBMITTED');

  v_ok := false;
  BEGIN
    PERFORM report_daily_cash((now() AT TIME ZONE 'Asia/Kolkata')::date, 'selftestctr', v_u, NULL);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_ok := (SQLERRM LIKE '%Say what happened%');
  END;
  IF NOT v_ok THEN
    DELETE FROM cash_handovers WHERE handover_no = 'SELFTEST-DCR';
    RAISE EXCEPTION 'ABORT: a shortage was reported with no explanation';
  END IF;

  -- (e) with a reason it goes, is called a SHORTAGE, and reaches the directors
  v_res := report_daily_cash((now() AT TIME ZONE 'Asia/Kolkata')::date, 'selftestctr', v_u, 'self test');
  IF v_res->>'kind' <> 'SHORTAGE' THEN
    RAISE EXCEPTION 'ABORT: 100 counted against 500 expected was called %', v_res->>'kind';
  END IF;
  IF (v_res->>'directorsTold')::int < 1 THEN
    RAISE EXCEPTION 'ABORT: no director was told';
  END IF;

  SELECT count(*) INTO v_notes FROM notifications
   WHERE source_table = 'cash_daily_reports' AND source_id = v_res->>'id';
  IF v_notes <> (v_res->>'directorsTold')::int THEN
    RAISE EXCEPTION 'ABORT: % alerts for % directors', v_notes, v_res->>'directorsTold';
  END IF;

  -- Clean the self-test out completely.
  DELETE FROM notifications WHERE source_table = 'cash_daily_reports' AND source_id = v_res->>'id';
  DELETE FROM cash_daily_reports WHERE id = (v_res->>'id')::uuid;
  DELETE FROM cash_handovers WHERE handover_no = 'SELFTEST-DCR';

  SELECT count(*) INTO v_rows FROM cash_handovers WHERE hospital_type = 'selftestctr';
  IF v_rows > 0 THEN RAISE EXCEPTION 'ABORT: self-test handover left behind'; END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
