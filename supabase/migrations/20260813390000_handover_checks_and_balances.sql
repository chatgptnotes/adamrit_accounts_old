-- Three more controls, and the opening balance wired into the figure.
--
-- 1. The drawer now starts from the declared opening, so it stops reading
--    negative and the apologetic paragraph on every screen can go.
--
-- 2. Blind verification. The verifier records what THEY counted, and the
--    handover keeps both numbers. Two people agreeing a false figure is the
--    failure this module exists to catch, and it cannot be caught if the
--    second person is shown the first person's answer before counting.
--
-- 3. Stale handovers. Both of today's real handovers sat unaccepted for hours
--    with nobody prompted, so anything left waiting is now findable and can be
--    chased once a day.
--
-- 4. Shared-login detection. hope@gmail.com was found by hand, by noticing the
--    name picked at the till kept differing from the login that saved it. The
--    same comparison is now a query, so the next shared login announces itself.

-- ---------------------------------------------------------------- 1. opening

-- The existing figure, untouched, moved aside so the wrapper below can add the
-- opening without this long body being written out twice and drifting.
CREATE OR REPLACE FUNCTION public.cash_handover_preview_core(
  p_user_id UUID,
  p_include_unattributed BOOLEAN DEFAULT true,
  p_hospital_type TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cutover TIMESTAMPTZ; v_hosp TEXT;
  v_mine NUMERIC := 0; v_mine_n INT := 0;
  v_all NUMERIC := 0; v_all_n INT := 0;
  v_uatt NUMERIC := 0; v_uatt_n INT := 0;
  v_pay NUMERIC := 0; v_pay_n INT := 0;
  v_upi NUMERIC := 0; v_card NUMERIC := 0;
  v_lines JSONB;
BEGIN
  SELECT cutover_at INTO v_cutover FROM cash_handover_settings WHERE id;
  v_hosp := lower(btrim(COALESCE(p_hospital_type, '')));

  IF v_hosp = 'pharmacy' THEN
    SELECT
      COALESCE(sum(amount) FILTER (WHERE uid = p_user_id), 0),
      COALESCE(count(*)    FILTER (WHERE uid = p_user_id), 0),
      COALESCE(sum(amount) FILTER (WHERE uid IS NULL), 0),
      COALESCE(count(*)    FILTER (WHERE uid IS NULL), 0),
      COALESCE(sum(amount), 0), COALESCE(count(*), 0),
      COALESCE(jsonb_agg(jsonb_build_object(
        'table', source_table, 'id', id, 'amount', amount, 'at', at,
        'who', COALESCE(who, 'Not recorded'), 'patient', label,
        'mine', (uid = p_user_id)
      ) ORDER BY at DESC), '[]'::jsonb)
    INTO v_mine, v_mine_n, v_uatt, v_uatt_n, v_all, v_all_n, v_lines
    FROM pharmacy_cash_pool() WHERE mode = 'CASH';

    SELECT COALESCE(sum(amount) FILTER (WHERE mode IN ('UPI','ONLINE','PHONEPE','GPAY','NEFT','RTGS')), 0),
           COALESCE(sum(amount) FILTER (WHERE mode IN ('CARD','CREDIT CARD','DEBIT CARD')), 0)
      INTO v_upi, v_card
    FROM pharmacy_cash_pool();

    SELECT COALESCE(sum(ve.credit_amount), 0), COALESCE(count(*), 0)
      INTO v_pay, v_pay_n
    FROM voucher_entries ve
    JOIN vouchers v ON v.id = ve.voucher_id
    JOIN chart_of_accounts a ON a.id = ve.account_id
    JOIN companies c ON c.id = a.company_id
    WHERE ve.credit_amount > 0 AND v.status = 'AUTHORISED'
      AND COALESCE(v.is_optional, false) = false
      AND v.created_at >= v_cutover
      AND c.company_key = 'hope_pharmacy'
      AND a.account_group IN ('CASH', 'Cash-in-Hand');
  ELSE
    WITH pool AS (
      SELECT a.id::text AS sid, 'advance_payment' AS tbl,
             COALESCE(a.advance_amount,0) AS amount, a.payment_date AS at,
             a.collected_by_user_id AS uid,
             COALESCE(NULLIF(btrim(a.billing_executive),''),'Not recorded') AS who,
             a.patient_name
        FROM advance_payment a
        LEFT JOIN patients pt ON pt.id = a.patient_id
       WHERE a.cash_handover_id IS NULL
         AND upper(btrim(COALESCE(a.payment_mode,''))) = 'CASH'
         AND COALESCE(a.is_refund,false) = false
         AND COALESCE(a.status,'ACTIVE') = 'ACTIVE'
         AND COALESCE(a.advance_amount,0) > 0
         AND a.payment_date >= v_cutover
         AND (v_hosp = '' OR lower(btrim(COALESCE(pt.hospital_name,''))) = v_hosp)
      UNION ALL
      SELECT f.id::text, 'final_payments', COALESCE(f.amount,0), f.payment_date,
             f.collected_by_user_id, 'Final bill counter', NULL
        FROM final_payments f
        LEFT JOIN patients pt ON pt.id = f.patient_id
       WHERE f.cash_handover_id IS NULL
         AND upper(btrim(COALESCE(f.mode_of_payment,''))) = 'CASH'
         AND COALESCE(f.amount,0) > 0
         AND f.payment_date >= v_cutover
         AND (v_hosp = '' OR lower(btrim(COALESCE(pt.hospital_name,''))) = v_hosp)
    )
    SELECT
      COALESCE(sum(amount) FILTER (WHERE uid = p_user_id), 0),
      COALESCE(count(*)    FILTER (WHERE uid = p_user_id), 0),
      COALESCE(sum(amount) FILTER (WHERE uid IS NULL), 0),
      COALESCE(count(*)    FILTER (WHERE uid IS NULL), 0),
      COALESCE(sum(amount), 0), COALESCE(count(*), 0),
      COALESCE(jsonb_agg(jsonb_build_object(
        'table', tbl, 'id', sid, 'amount', amount, 'at', at,
        'who', who, 'patient', patient_name, 'mine', (uid = p_user_id)
      ) ORDER BY at DESC), '[]'::jsonb)
    INTO v_mine, v_mine_n, v_uatt, v_uatt_n, v_all, v_all_n, v_lines
    FROM pool;

    SELECT COALESCE(sum(amount),0), COALESCE(count(*),0)
      INTO v_pay, v_pay_n
    FROM cash_payouts_pool(p_hospital_type);

    SELECT COALESCE(sum(COALESCE(a.advance_amount,0)) FILTER (WHERE upper(btrim(COALESCE(a.payment_mode,''))) IN ('UPI','ONLINE','NEFT','RTGS','PHONEPE','GPAY')), 0),
           COALESCE(sum(COALESCE(a.advance_amount,0)) FILTER (WHERE upper(btrim(COALESCE(a.payment_mode,''))) IN ('CARD','CREDIT CARD','DEBIT CARD')), 0)
      INTO v_upi, v_card
    FROM advance_payment a
    LEFT JOIN patients pt ON pt.id = a.patient_id
    WHERE COALESCE(a.is_refund,false) = false
      AND COALESCE(a.status,'ACTIVE') = 'ACTIVE'
      AND a.payment_date >= v_cutover
      AND (v_hosp = '' OR lower(btrim(COALESCE(pt.hospital_name,''))) = v_hosp);
  END IF;

  RETURN jsonb_build_object(
    'cutoverAt', v_cutover,
    'hospitalType', NULLIF(v_hosp, ''),
    'mineAmount', v_mine, 'mineCount', v_mine_n,
    'unattributedAmount', v_uatt, 'unattributedCount', v_uatt_n,
    'counterAmount', v_all, 'counterCount', v_all_n,
    'payoutAmount', v_pay, 'payoutCount', v_pay_n,
    'includeUnattributed', true,
    -- The drawer: everything taken at this counter and not yet handed on,
    -- less what has been paid out of it.
    'expectedCash', v_all - v_pay,
    'refUpiTotal', v_upi, 'refCardTotal', v_card,
    'lines', v_lines
  );
END $$;

CREATE OR REPLACE FUNCTION public.cash_handover_preview(
  p_user_id UUID,
  p_include_unattributed BOOLEAN DEFAULT true,
  p_hospital_type TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_base JSONB; v_opening NUMERIC;
BEGIN
  v_base := cash_handover_preview_core(p_user_id, p_include_unattributed, p_hospital_type);
  v_opening := cash_opening_for(p_hospital_type);
  RETURN v_base
    || jsonb_build_object(
         'openingCash', v_opening,
         'expectedCash', (v_base->>'expectedCash')::NUMERIC + v_opening);
END $$;

-- ------------------------------------------------------- 2. blind verifying

ALTER TABLE public.cash_handovers
  ADD COLUMN IF NOT EXISTS verifier_counted NUMERIC(15,2);

COMMENT ON COLUMN public.cash_handovers.verifier_counted IS
  'What the verifier counted themselves, recorded before they are shown the cashier''s figure.';

CREATE OR REPLACE FUNCTION public.verify_cash_handover(
  p_handover_id UUID, p_user_id UUID, p_note TEXT DEFAULT NULL,
  p_verifier_counted NUMERIC DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_no TEXT; v_status TEXT; v_name TEXT; v_from UUID; v_hosp TEXT;
  v_var NUMERIC; v_counted NUMERIC; v_gap NUMERIC;
BEGIN
  SELECT COALESCE(v.display_name, u.full_name, u.email) INTO v_name
    FROM "User" u LEFT JOIN cash_handover_verifiers v ON v.user_id = u.id
   WHERE u.id = p_user_id LIMIT 1;
  IF v_name IS NULL THEN RAISE EXCEPTION 'Unknown user'; END IF;

  SELECT from_user_id, hospital_type, variance, counted_cash
    INTO v_from, v_hosp, v_var, v_counted
    FROM cash_handovers WHERE id = p_handover_id;
  IF v_from IS NULL THEN RAISE EXCEPTION 'That handover no longer exists'; END IF;

  IF NOT cash_handover_may(p_user_id, v_hosp, 'verify') THEN
    RAISE EXCEPTION 'Only a nominated verifier for this counter can confirm a cash count';
  END IF;
  IF v_from = p_user_id THEN
    RAISE EXCEPTION 'The person who handed the cash over cannot verify their own count';
  END IF;

  IF round(COALESCE(v_var, 0), 2) <> 0 AND btrim(COALESCE(p_note, '')) = '' THEN
    RAISE EXCEPTION 'This count is out by %. Record what you found before verifying it.',
      to_char(abs(v_var), 'FM9,99,99,990.00');
  END IF;

  -- If the verifier counted for themselves and got a different number, that is
  -- a finding in its own right and has to be explained, whatever the cashier's
  -- figure did against the software.
  IF p_verifier_counted IS NOT NULL THEN
    v_gap := round(p_verifier_counted - COALESCE(v_counted, 0), 2);
    IF v_gap <> 0 AND btrim(COALESCE(p_note, '')) = '' THEN
      RAISE EXCEPTION 'You counted % against the % handed over. Say what you found.',
        to_char(p_verifier_counted, 'FM9,99,99,990.00'), to_char(v_counted, 'FM9,99,99,990.00');
    END IF;
  END IF;

  UPDATE cash_handovers
     SET status = 'VERIFIED', verified_at = now(), verified_by_user_id = p_user_id,
         verified_by_name = v_name, verify_note = NULLIF(btrim(COALESCE(p_note,'')), ''),
         verifier_counted = p_verifier_counted, updated_at = now()
   WHERE id = p_handover_id AND status = 'ACCEPTED'
   RETURNING handover_no INTO v_no;

  IF v_no IS NULL THEN
    SELECT status INTO v_status FROM cash_handovers WHERE id = p_handover_id;
    RAISE EXCEPTION 'A handover must be accepted by the receiver before it can be verified (this one is %)', lower(v_status);
  END IF;

  RETURN jsonb_build_object('handoverNo', v_no, 'status', 'VERIFIED',
                            'verifierCounted', p_verifier_counted,
                            'agrees', p_verifier_counted IS NULL
                                      OR round(p_verifier_counted - v_counted, 2) = 0);
END $$;

-- ---------------------------------------------------------- 3. left waiting

CREATE OR REPLACE FUNCTION public.stale_handovers(p_hours INT DEFAULT 12)
RETURNS TABLE (
  id UUID, handover_no TEXT, hospital_type TEXT, status TEXT,
  from_user_name TEXT, to_user_name TEXT, counted_cash NUMERIC,
  waiting_since TIMESTAMPTZ, hours_waiting NUMERIC, waiting_on TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT h.id, h.handover_no, h.hospital_type, h.status,
         h.from_user_name, h.to_user_name, h.counted_cash,
         COALESCE(h.accepted_at, h.submitted_at),
         round(extract(epoch FROM now() - COALESCE(h.accepted_at, h.submitted_at)) / 3600.0, 1),
         CASE WHEN h.status = 'SUBMITTED' THEN h.to_user_name ELSE 'a verifier' END
    FROM cash_handovers h
   WHERE h.status IN ('SUBMITTED', 'ACCEPTED')
     AND COALESCE(h.accepted_at, h.submitted_at) < now() - make_interval(hours => p_hours)
   ORDER BY COALESCE(h.accepted_at, h.submitted_at);
$$;

-- Announces them once a day, the way the books health check already does.
CREATE OR REPLACE FUNCTION public.notify_stale_handovers(p_hours INT DEFAULT 12)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row RECORD; v_n INT := 0;
BEGIN
  FOR v_row IN SELECT * FROM stale_handovers(p_hours) LOOP
    -- One reminder per handover per day, not one per page load.
    IF EXISTS (SELECT 1 FROM notifications
                WHERE source_table = 'cash_handovers' AND source_id = v_row.id::TEXT
                  AND notification_type = 'cash_handover_stale'
                  AND created_at > now() - interval '20 hours') THEN
      CONTINUE;
    END IF;
    BEGIN
      INSERT INTO notifications (notification_type, title, message, recipient_role,
                                 source_table, source_id, payload)
      VALUES ('cash_handover_stale',
              'A cash handover is still waiting',
              v_row.handover_no || ': ' || v_row.from_user_name || ' handed ₹'
                || to_char(v_row.counted_cash, 'FM99,99,99,990') || ' to ' || v_row.to_user_name
                || ' ' || v_row.hours_waiting || ' hours ago, still waiting on ' || v_row.waiting_on || '.',
              'all', 'cash_handovers', v_row.id::TEXT,
              jsonb_build_object('hoursWaiting', v_row.hours_waiting, 'status', v_row.status));
      v_n := v_n + 1;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END LOOP;
  RETURN v_n;
END $$;

-- -------------------------------------------------------- 4. shared logins

CREATE OR REPLACE FUNCTION public.shared_login_report(p_days INT DEFAULT 30)
RETURNS TABLE (
  login TEXT, login_name TEXT, distinct_names INT, names TEXT,
  receipts INT, total NUMERIC
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.email,
         COALESCE(u.full_name, u.email),
         count(DISTINCT lower(btrim(a.billing_executive)))::INT,
         string_agg(DISTINCT btrim(a.billing_executive), ', ' ORDER BY btrim(a.billing_executive)),
         count(*)::INT,
         sum(COALESCE(a.advance_amount, 0))
    FROM advance_payment a
    JOIN public."User" u ON u.id = a.collected_by_user_id
   WHERE a.created_at >= now() - make_interval(days => p_days)
     AND NULLIF(btrim(COALESCE(a.billing_executive, '')), '') IS NOT NULL
   GROUP BY u.email, COALESCE(u.full_name, u.email)
   -- More than one person's name typed under one login is the signal.
  HAVING count(DISTINCT lower(btrim(a.billing_executive))) > 1
   ORDER BY count(DISTINCT lower(btrim(a.billing_executive))) DESC;
$$;

REVOKE ALL ON FUNCTION public.stale_handovers(INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_stale_handovers(INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.shared_login_report(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.stale_handovers(INT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_stale_handovers(INT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shared_login_report(INT) TO anon, authenticated;

DO $verify$
DECLARE v_u UUID; v_p JSONB; v_before NUMERIC; v_after NUMERIC;
BEGIN
  SELECT id INTO v_u FROM "User" WHERE lower(email) = 'nisha@gmail.com';

  v_p := cash_handover_preview(v_u, true, 'hope');
  v_before := (v_p->>'expectedCash')::NUMERIC;

  PERFORM declare_opening_cash('hope', 1000, v_u, 'self test');
  v_p := cash_handover_preview(v_u, true, 'hope');
  v_after := (v_p->>'expectedCash')::NUMERIC;

  IF round(v_after - v_before, 2) <> 1000 THEN
    DELETE FROM cash_opening_declarations WHERE note = 'self test';
    RAISE EXCEPTION 'ABORT: the opening did not reach the drawer (% -> %)', v_before, v_after;
  END IF;
  IF (v_p->>'openingCash')::NUMERIC <> 1000 THEN
    DELETE FROM cash_opening_declarations WHERE note = 'self test';
    RAISE EXCEPTION 'ABORT: openingCash is not reported';
  END IF;

  DELETE FROM cash_opening_declarations WHERE note = 'self test';

  -- The other three must at least run.
  PERFORM 1 FROM stale_handovers(0);
  PERFORM 1 FROM shared_login_report(60);
END
$verify$;

NOTIFY pgrst, 'reload schema';
