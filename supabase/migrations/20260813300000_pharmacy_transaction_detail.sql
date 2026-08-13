-- Give the pharmacy report its individual transactions.
--
-- The till showed a total and a holder, with no way to see what made it up.
-- A figure nobody can open is a figure nobody can check -- the same complaint
-- that led to opening up the cash-paid-out line.
--
-- Adds the bill number and the payment reference so each row is identifiable
-- on paper as well as on screen. Callers read the columns by name, so the two
-- functions that use this pool are unaffected.

DROP FUNCTION IF EXISTS public.pharmacy_cash_pool();

CREATE OR REPLACE FUNCTION public.pharmacy_cash_pool()
RETURNS TABLE (
  id TEXT, source_table TEXT, amount NUMERIC, at TIMESTAMPTZ,
  mode TEXT, uid UUID, label TEXT, who TEXT, reference TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH cutover AS (SELECT cutover_at FROM cash_handover_settings WHERE id)
  SELECT s.sale_id::text, 'pharmacy_sales',
         COALESCE(s.total_amount, 0), s.created_at,
         upper(btrim(COALESCE(s.payment_method, ''))),
         COALESCE(s.collected_by_user_id, s.created_by),
         COALESCE(NULLIF(btrim(s.patient_name), ''), 'Pharmacy sale'),
         (SELECT COALESCE(u.full_name, u.email) FROM "User" u WHERE u.id = s.created_by),
         NULLIF(btrim(COALESCE(s.bill_number, '')), '')
    FROM pharmacy_sales s, cutover c
   WHERE s.cash_handover_id IS NULL
     AND COALESCE(s.total_amount, 0) > 0
     AND s.created_at >= c.cutover_at
     AND upper(btrim(COALESCE(s.status, 'COMPLETED'))) <> 'CANCELLED'
     AND upper(btrim(COALESCE(s.payment_method, ''))) <> 'CREDIT'
  UNION ALL
  SELECT p.id::text, 'pharmacy_credit_payments',
         COALESCE(p.amount, 0), p.created_at,
         upper(btrim(COALESCE(p.payment_method, ''))),
         p.collected_by_user_id,
         COALESCE(NULLIF(btrim(p.patient_name), ''), 'Credit bill payment'),
         COALESCE(NULLIF(btrim(COALESCE(p.pharmacy_executive, '')), ''),
                  NULLIF(btrim(NULLIF(COALESCE(p.received_by, ''), 'Unknown')), '')),
         NULLIF(btrim(COALESCE(p.payment_reference, '')), '')
    FROM pharmacy_credit_payments p, cutover c
   WHERE p.cash_handover_id IS NULL
     AND COALESCE(p.amount, 0) > 0
     AND p.created_at >= c.cutover_at;
$$;

REVOKE ALL ON FUNCTION public.pharmacy_cash_pool() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pharmacy_cash_pool() TO anon, authenticated;

DO $verify$
DECLARE v_cols INT; v_cash NUMERIC; v_sum JSONB;
BEGIN
  SELECT count(*) INTO v_cols
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace,
         unnest(COALESCE(p.proargnames, ARRAY[]::TEXT[])) AS a
   WHERE n.nspname = 'public' AND p.proname = 'pharmacy_cash_pool';
  IF v_cols <> 9 THEN
    RAISE EXCEPTION 'ABORT: pharmacy_cash_pool should expose 9 columns, got %', v_cols;
  END IF;

  -- The two callers must survive the drop, and still agree.
  v_sum := pharmacy_cash_summary();
  SELECT COALESCE(sum(net_cash), 0) INTO v_cash
    FROM pharmacy_position_by_holder() WHERE attribution <> 'payout';
  IF round(v_cash, 2) <> round((v_sum->>'cashAmount')::NUMERIC, 2) THEN
    RAISE EXCEPTION 'ABORT: drawer % no longer equals cash taken %', v_cash, v_sum->>'cashAmount';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
