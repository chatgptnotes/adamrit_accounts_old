-- Hope Pharmacy keeps its own drawer.
--
-- The pharmacy is a separate company with its own Cash ledger and its own
-- staff (Farhan, Ruchika, Lalit, Siddhanth), and none of its money was in the
-- handover at all: pharmacy_sales and pharmacy_credit_payments were never read.
-- Over 30 days that is Rs 1,50,093 of cash sales and Rs 24,496 collected
-- against credit bills, plus Rs 99,812 taken online.
--
-- Cash is what gets counted and handed over. UPI is reported beside it and
-- never counted, because that money is in the bank, not in the drawer.
--
-- The scope word is 'pharmacy'. It behaves like 'hope' and 'ayushman' do, so
-- one screen can switch between the three counters.

ALTER TABLE public.pharmacy_credit_payments
  ADD COLUMN IF NOT EXISTS collected_by_user_id UUID REFERENCES public."User"(id),
  ADD COLUMN IF NOT EXISTS cash_handover_id UUID;

CREATE INDEX IF NOT EXISTS pharmacy_credit_payments_cash_unclaimed_idx
  ON public.pharmacy_credit_payments (payment_date DESC)
  WHERE cash_handover_id IS NULL AND upper(btrim(payment_method)) = 'CASH';

-- Everything the pharmacy took in, cash and online, still unclaimed.
CREATE OR REPLACE FUNCTION public.pharmacy_cash_pool()
RETURNS TABLE (
  id TEXT, source_table TEXT, amount NUMERIC, at TIMESTAMPTZ,
  mode TEXT, uid UUID, label TEXT, who TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH cutover AS (SELECT cutover_at FROM cash_handover_settings WHERE id)
  SELECT s.sale_id::text, 'pharmacy_sales',
         COALESCE(s.total_amount, 0), s.created_at,
         upper(btrim(COALESCE(s.payment_method, ''))),
         COALESCE(s.collected_by_user_id, s.created_by),
         COALESCE(NULLIF(btrim(s.patient_name), ''), 'Pharmacy sale'),
         -- created_by is a uuid here, so it is a user id, not a name.
         (SELECT COALESCE(u.full_name, u.email) FROM "User" u WHERE u.id = s.created_by)
    FROM pharmacy_sales s, cutover c
   WHERE s.cash_handover_id IS NULL
     AND COALESCE(s.total_amount, 0) > 0
     AND s.created_at >= c.cutover_at
     AND upper(btrim(COALESCE(s.status, 'COMPLETED'))) <> 'CANCELLED'
     AND upper(btrim(COALESCE(s.payment_method, ''))) <> 'CREDIT'
  UNION ALL
  -- Money collected later against a credit bill is cash through the same till.
  SELECT p.id::text, 'pharmacy_credit_payments',
         COALESCE(p.amount, 0), p.created_at,
         upper(btrim(COALESCE(p.payment_method, ''))),
         p.collected_by_user_id,
         COALESCE(NULLIF(btrim(p.patient_name), ''), 'Credit bill payment'),
         -- received_by reads 'Unknown' on every row; pharmacy_executive
         -- carries the name someone actually typed.
         COALESCE(NULLIF(btrim(COALESCE(p.pharmacy_executive, '')), ''),
                  NULLIF(btrim(NULLIF(COALESCE(p.received_by, ''), 'Unknown')), ''))
    FROM pharmacy_credit_payments p, cutover c
   WHERE p.cash_handover_id IS NULL
     AND COALESCE(p.amount, 0) > 0
     AND p.created_at >= c.cutover_at;
$$;

-- Who is holding pharmacy cash. Same shape as the hospital counters so one
-- table renders all three.
CREATE OR REPLACE FUNCTION public.pharmacy_position_by_holder()
RETURNS TABLE (
  holder_user_id UUID, holder_name TEXT, attribution TEXT,
  net_cash NUMERIC, receipt_count INTEGER, oldest_uncollected TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH keyed AS (
    SELECT p.uid,
           CASE WHEN p.uid IS NOT NULL THEN 'login'
                WHEN p.who IS NOT NULL THEN 'name' ELSE 'none' END AS attribution,
           CASE WHEN p.uid IS NOT NULL THEN COALESCE(u.full_name, u.email, 'Unknown user')
                WHEN p.who IS NOT NULL THEN p.who
                ELSE 'Not recorded to anyone' END AS holder_name,
           p.amount, p.at
      FROM pharmacy_cash_pool() p
      LEFT JOIN "User" u ON u.id = p.uid
     WHERE p.mode = 'CASH'
  ),
  receipts AS (
    SELECT k.uid, k.holder_name, k.attribution,
           sum(k.amount)::NUMERIC AS net_cash, count(*)::INT AS n, min(k.at) AS oldest
      FROM keyed k GROUP BY k.uid, k.holder_name, k.attribution
  ),
  payouts AS (
    -- The pharmacy's own Cash ledger, so hospital payments never appear here.
    SELECT NULL::UUID, 'Cash paid out (vouchers)'::TEXT, 'payout'::TEXT,
           (-sum(ve.credit_amount))::NUMERIC, count(*)::INT, min(v.created_at)
      FROM voucher_entries ve
      JOIN vouchers v ON v.id = ve.voucher_id
      JOIN chart_of_accounts a ON a.id = ve.account_id
      JOIN companies c ON c.id = a.company_id,
           (SELECT cutover_at FROM cash_handover_settings WHERE id) cut
     WHERE ve.credit_amount > 0
       AND v.status = 'AUTHORISED'
       AND COALESCE(v.is_optional, false) = false
       AND v.created_at >= cut.cutover_at
       AND c.company_key = 'hope_pharmacy'
       AND a.account_group IN ('CASH', 'Cash-in-Hand')
    HAVING count(*) > 0
  )
  SELECT * FROM receipts
  UNION ALL
  SELECT * FROM payouts
  ORDER BY 4 DESC;
$$;

-- Cash counted, online reported beside it.
CREATE OR REPLACE FUNCTION public.pharmacy_cash_summary()
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'cashAmount',   COALESCE(sum(amount) FILTER (WHERE mode = 'CASH'), 0),
    'cashCount',    COALESCE(count(*)    FILTER (WHERE mode = 'CASH'), 0),
    'upiAmount',    COALESCE(sum(amount) FILTER (WHERE mode IN ('UPI','ONLINE','PHONEPE','GPAY','NEFT','RTGS')), 0),
    'upiCount',     COALESCE(count(*)    FILTER (WHERE mode IN ('UPI','ONLINE','PHONEPE','GPAY','NEFT','RTGS')), 0),
    'cardAmount',   COALESCE(sum(amount) FILTER (WHERE mode IN ('CARD','CREDIT CARD','DEBIT CARD')), 0),
    'cardCount',    COALESCE(count(*)    FILTER (WHERE mode IN ('CARD','CREDIT CARD','DEBIT CARD')), 0)
  ) FROM pharmacy_cash_pool();
$$;

REVOKE ALL ON FUNCTION public.pharmacy_cash_pool() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pharmacy_position_by_holder() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pharmacy_cash_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pharmacy_cash_pool() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pharmacy_position_by_holder() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pharmacy_cash_summary() TO anon, authenticated;

DO $verify$
DECLARE v_credit INT; v_cash NUMERIC; v_sum JSONB;
BEGIN
  -- Credit sales are not money in the drawer and must never be counted.
  SELECT count(*) INTO v_credit FROM pharmacy_cash_pool() WHERE mode = 'CREDIT';
  IF v_credit > 0 THEN
    RAISE EXCEPTION 'ABORT: % credit sale(s) leaked into the pharmacy drawer', v_credit;
  END IF;

  -- The drawer counts cash only; UPI is reported but never added in.
  v_sum := pharmacy_cash_summary();
  SELECT COALESCE(sum(net_cash), 0) INTO v_cash
    FROM pharmacy_position_by_holder() WHERE attribution <> 'payout';
  IF round(v_cash, 2) <> round((v_sum->>'cashAmount')::NUMERIC, 2) THEN
    RAISE EXCEPTION 'ABORT: drawer % does not equal cash taken %', v_cash, v_sum->>'cashAmount';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
