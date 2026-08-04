-- Three guards, so today's problems announce themselves instead of being
-- discovered by accident:
--
--   1. run_books_health_checks() — one function that asks the questions this
--      session had to ask by hand (openings netting to zero, unbalanced
--      vouchers, obligations quietly regenerating money, duplicate ledgers)
--      and raises a notification per finding. Safe to run as often as liked;
--      it re-notifies at most once a day per finding.
--   2. payment_obligations.active_until — a recurring payment can now END.
--      expire_due_obligations() deactivates them and is called by the health
--      check, so the Gandhi rent (to 04-Oct-2026) turns itself off.
--   3. A unique index that refuses a second ACTIVE ledger with the same name
--      in the same company, so the duplicates merged today cannot come back.
--
-- Run in the Supabase dashboard SQL Editor. Safe to run twice.

BEGIN;

-- ══ 2. Obligations can end ═══════════════════════════════════════════════
ALTER TABLE public.payment_obligations
  ADD COLUMN IF NOT EXISTS active_until DATE;

COMMENT ON COLUMN public.payment_obligations.active_until IS
  'Last date this obligation should generate a daily schedule row. NULL = open-ended. expire_due_obligations() deactivates it the day after.';

-- The rent Ruby ordered on 4-Aug: ₹1,00,000/day incl. Sundays, for two months.
UPDATE public.payment_obligations
   SET active_until = DATE '2026-10-04'
 WHERE id = '57b05cdd-e2b2-475f-b4eb-0d7d26e9020a'
   AND active_until IS NULL;

CREATE OR REPLACE FUNCTION public.expire_due_obligations()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  WITH expired AS (
    UPDATE public.payment_obligations
       SET is_active = false, updated_at = now()
     WHERE is_active
       AND active_until IS NOT NULL
       AND active_until < CURRENT_DATE
    RETURNING id
  )
  SELECT count(*) INTO v_count FROM expired;

  -- Nothing scheduled beyond its last day should stay payable.
  UPDATE public.daily_payment_schedule s
     SET status = 'skipped', daily_amount = 0, updated_at = now()
    FROM public.payment_obligations o
   WHERE s.obligation_id = o.id
     AND o.active_until IS NOT NULL
     AND s.schedule_date > o.active_until
     AND s.status = 'pending';

  RETURN v_count;
END;
$$;

-- ══ 3. Duplicate ledgers cannot come back ════════════════════════════════
-- Only ACTIVE ledgers are constrained: merged stubs keep their names, and a
-- company may legitimately share a name with another company.
CREATE UNIQUE INDEX IF NOT EXISTS chart_of_accounts_active_name_uniq
  ON public.chart_of_accounts (
    company_id,
    lower(btrim(regexp_replace(account_name, '[^a-zA-Z0-9]+', ' ', 'g')))
  )
  WHERE is_active;

-- ══ 1. The health checks ═════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.run_books_health_checks()
RETURNS TABLE (check_name TEXT, severity TEXT, detail TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r         RECORD;
  v_expired INTEGER;
  v_msg     TEXT;
BEGIN
  v_expired := public.expire_due_obligations();
  IF v_expired > 0 THEN
    check_name := 'obligations_expired'; severity := 'info';
    detail := v_expired || ' obligation(s) reached their end date and were deactivated';
    RETURN NEXT;
  END IF;

  -- (a) Each company's opening balances must still net to zero.
  FOR r IN
    SELECT c.company_name,
           round(sum(CASE WHEN upper(coalesce(a.opening_balance_type,'DR'))='CR'
                          THEN -coalesce(a.opening_balance,0)
                          ELSE coalesce(a.opening_balance,0) END)::numeric, 2) AS net
      FROM public.chart_of_accounts a
      JOIN public.companies c ON c.id = a.company_id
     WHERE a.is_active
     GROUP BY c.company_name
    HAVING abs(round(sum(CASE WHEN upper(coalesce(a.opening_balance_type,'DR'))='CR'
                              THEN -coalesce(a.opening_balance,0)
                              ELSE coalesce(a.opening_balance,0) END)::numeric, 2)) > 0.01
  LOOP
    check_name := 'openings_not_zero'; severity := 'warning';
    detail := r.company_name || ': opening balances net ₹' || to_char(r.net, 'FM99,99,99,990.00')
              || ' instead of zero';
    RETURN NEXT;
  END LOOP;

  -- (b) A voucher whose two sides disagree is a broken entry.
  FOR r IN
    SELECT v.voucher_number, v.voucher_date,
           round((sum(e.debit_amount) - sum(e.credit_amount))::numeric, 2) AS gap
      FROM public.vouchers v
      JOIN public.voucher_entries e ON e.voucher_id = v.id
     WHERE v.status = 'AUTHORISED'
       AND v.voucher_date >= CURRENT_DATE - 30
     GROUP BY v.id, v.voucher_number, v.voucher_date
    HAVING abs(round((sum(e.debit_amount) - sum(e.credit_amount))::numeric, 2)) > 0.01
     LIMIT 20
  LOOP
    check_name := 'voucher_unbalanced'; severity := 'critical';
    detail := 'Voucher ' || r.voucher_number || ' (' || to_char(r.voucher_date,'DD Mon') ||
              ') is out by ₹' || to_char(r.gap, 'FM99,99,99,990.00');
    RETURN NEXT;
  END LOOP;

  -- (c) An obligation still generating money that nobody has paid in 30 days.
  --     This is the ₹5.85 lakh/day of phantom rows, caught on day one.
  FOR r IN
    SELECT o.party_name, o.hospital_name, o.default_daily_amount,
           max(s.schedule_date) FILTER (WHERE s.paid_amount > 0) AS last_paid
      FROM public.payment_obligations o
      LEFT JOIN public.daily_payment_schedule s ON s.obligation_id = o.id
     WHERE o.is_active
       AND coalesce(o.default_daily_amount, 0) > 0
     GROUP BY o.id, o.party_name, o.hospital_name, o.default_daily_amount
    HAVING coalesce(max(s.schedule_date) FILTER (WHERE s.paid_amount > 0), DATE '2000-01-01')
             < CURRENT_DATE - 30
       AND count(s.id) FILTER (WHERE s.schedule_date >= CURRENT_DATE - 30) >= 10
     LIMIT 20
  LOOP
    check_name := 'obligation_never_paid'; severity := 'warning';
    detail := r.party_name || ' (' || r.hospital_name || ') is scheduling ₹'
              || to_char(r.default_daily_amount, 'FM99,99,99,990') || '/day but has not been paid'
              || coalesce(' since ' || to_char(r.last_paid, 'DD Mon YYYY'), ' at all')
              || ' — end-date it or deactivate it';
    RETURN NEXT;
  END LOOP;

  -- (d) Duplicate active ledgers (the unique index prevents new ones; this
  --     catches anything created before it existed).
  FOR r IN
    SELECT c.company_name, a.account_name, count(*) AS copies
      FROM public.chart_of_accounts a
      JOIN public.companies c ON c.id = a.company_id
     WHERE a.is_active
     GROUP BY c.company_name,
              lower(btrim(regexp_replace(a.account_name, '[^a-zA-Z0-9]+', ' ', 'g'))),
              a.account_name
    HAVING count(*) > 1
     LIMIT 20
  LOOP
    check_name := 'duplicate_ledger'; severity := 'warning';
    detail := r.company_name || ': "' || r.account_name || '" exists ' || r.copies || ' times';
    RETURN NEXT;
  END LOOP;

  -- (e) Discharge state must agree with itself (today: 133 visits drifted).
  SELECT count(*) INTO v_expired
    FROM public.visits
   WHERE status = 'discharged' AND coalesce(is_discharged, false) = false;
  IF v_expired > 0 THEN
    check_name := 'discharge_flag_drift'; severity := 'warning';
    detail := v_expired || ' visit(s) are discharged but missing the is_discharged flag '
              || '— they linger in extension alerts';
    RETURN NEXT;
  END IF;

  RETURN;
END;
$$;

-- The wrapper the schedule calls: run the checks and record each finding as a
-- notification (deduped per day, so a standing problem nags once a day).
CREATE OR REPLACE FUNCTION public.notify_books_health()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r       RECORD;
  v_new   INTEGER := 0;
BEGIN
  FOR r IN SELECT * FROM public.run_books_health_checks() LOOP
    IF EXISTS (
      SELECT 1 FROM public.notifications
       WHERE notification_type = 'books_health'
         AND message = r.detail
         AND created_at >= CURRENT_DATE
    ) THEN CONTINUE; END IF;

    INSERT INTO public.notifications (
      notification_type, title, message, recipient_role, hospital_name,
      source_table, payload
    ) VALUES (
      'books_health',
      CASE r.severity WHEN 'critical' THEN 'Books check — needs attention today'
                      WHEN 'warning'  THEN 'Books check — please review'
                      ELSE 'Books check' END,
      r.detail, 'all', NULL, 'run_books_health_checks',
      jsonb_build_object('check', r.check_name, 'severity', r.severity)
    );
    v_new := v_new + 1;
  END LOOP;
  RETURN v_new;
END;
$$;

REVOKE ALL ON FUNCTION public.run_books_health_checks() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_books_health() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expire_due_obligations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_books_health_checks() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_books_health() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_due_obligations() TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
