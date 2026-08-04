-- Books check (c): flag ONE-OFF records, not the master templates.
--
-- The first live run raised 13 warnings for legitimate recurring masters —
-- Electricity, TDS Payment, Surgeon Fees, RMO Salary and so on. Those are
-- never "paid" through a schedule row because the team pays them via the
-- Daily Allocation sheet, and their generated rows are not even displayed
-- (Today's Allocation shows only DAILY_ALLOCATION_SENT rows). Flagging them
-- daily is exactly the cry-wolf failure this check exists to avoid.
--
-- The real bug class was different and precise: ONE-OFF execution records
-- (created by a Daily Allocation "send", marked in notes) that stayed active
-- and regenerated ₹5.85 lakh/day forever. Those are what this now watches —
-- a one-off record has no business being active for weeks.
--
-- Run in the Supabase dashboard SQL Editor. Safe to run twice.

BEGIN;

CREATE OR REPLACE FUNCTION public.run_books_health_checks()
RETURNS TABLE (check_name TEXT, severity TEXT, detail TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r         RECORD;
  v_expired INTEGER;
  v_count   INTEGER;
BEGIN
  v_expired := public.expire_due_obligations();
  IF v_expired > 0 THEN
    check_name := 'obligations_expired'; severity := 'info';
    detail := v_expired || ' obligation(s) reached their end date and were deactivated';
    RETURN NEXT;
  END IF;

  -- (a) Each company's opening balances must still net to zero.
  --     Hope Hospitals (legacy partnership) is exempt until Ruby supplies a
  --     Tally export for it — its ~₹54.3L imbalance is known and accepted.
  --     Remove the company_key exclusion once that company is restated.
  FOR r IN
    SELECT c.company_name,
           round(sum(CASE WHEN upper(coalesce(a.opening_balance_type,'DR'))='CR'
                          THEN -coalesce(a.opening_balance,0)
                          ELSE coalesce(a.opening_balance,0) END)::numeric, 2) AS net
      FROM public.chart_of_accounts a
      JOIN public.companies c ON c.id = a.company_id
     WHERE a.is_active
       AND c.company_key <> 'hope_partnership'
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

  -- (c) A ONE-OFF allocation record still active a fortnight later. These are
  --     created per send; leaving one active regenerates its amount daily
  --     forever (27-Jul batch: 27 records, ₹5.85 lakh/day). Master templates
  --     are deliberately NOT flagged — they are paid through the sheet.
  FOR r IN
    SELECT o.party_name, o.hospital_name, o.default_daily_amount, o.notes,
           substring(coalesce(o.notes,'') from '(\d{4}-\d{2}-\d{2})') AS sent_on
      FROM public.payment_obligations o
     WHERE o.is_active
       AND coalesce(o.default_daily_amount, 0) > 0
       AND (o.notes LIKE 'DAILY_ALLOCATION_EXECUTION:%'
            OR o.notes LIKE 'Created from Daily Allocation%')
       AND coalesce(
             to_date(nullif(substring(coalesce(o.notes,'') from '(\d{4}-\d{2}-\d{2})'), ''), 'YYYY-MM-DD'),
             o.created_at::date
           ) < CURRENT_DATE - 14
     ORDER BY o.default_daily_amount DESC
     LIMIT 20
  LOOP
    check_name := 'stale_oneoff_obligation'; severity := 'warning';
    detail := 'One-off allocation record "' || r.party_name || '" (' || r.hospital_name
              || ') from ' || coalesce(r.sent_on, 'an earlier send')
              || ' is still active and adds ₹' || to_char(r.default_daily_amount, 'FM99,99,99,990')
              || ' to every day — deactivate it';
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

  -- (e) Discharge state must agree with itself (4-Aug: 133 visits drifted).
  SELECT count(*) INTO v_count
    FROM public.visits
   WHERE status = 'discharged' AND coalesce(is_discharged, false) = false;
  IF v_count > 0 THEN
    check_name := 'discharge_flag_drift'; severity := 'warning';
    detail := v_count || ' visit(s) are discharged but missing the is_discharged flag '
              || '— they linger in extension alerts';
    RETURN NEXT;
  END IF;

  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.run_books_health_checks() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_books_health_checks() TO anon, authenticated;

-- What the check says now: expect NOTHING (a clean bill of health).
SELECT * FROM public.run_books_health_checks();

COMMIT;
