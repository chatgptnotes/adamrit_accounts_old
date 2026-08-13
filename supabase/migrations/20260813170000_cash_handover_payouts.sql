-- Subtract the cash that leaves the drawer.
--
-- The handover counted money coming IN and nothing going OUT, so a payment
-- voucher paid in cash never reduced the figure: Nisha paid Rs 1 of Hospital
-- Expenses from Cash (HOPE) and the drawer still claimed to hold the full
-- amount. Over a day of petty cash that gap is the difference between a
-- cashier balancing and being told they are short.
--
-- payment_vouchers carries hospital_type and the ledger it was paid from, but
-- no user -- nothing records WHICH person handed the money over the counter.
-- So a payout reduces the counter, not a person, and is shown on its own line
-- rather than being silently netted off someone's name.

ALTER TABLE public.payment_vouchers
  ADD COLUMN IF NOT EXISTS cash_handover_id UUID;

CREATE INDEX IF NOT EXISTS payment_vouchers_cash_unclaimed_idx
  ON public.payment_vouchers (voucher_date DESC)
  WHERE cash_handover_id IS NULL;

-- One definition of "paid out of the cash drawer", used by every query below.
CREATE OR REPLACE FUNCTION public.cash_payouts_pool(p_hospital_type TEXT DEFAULT NULL)
RETURNS TABLE (id UUID, amount NUMERIC, at TIMESTAMPTZ, label TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT v.id, COALESCE(v.amount, 0), v.created_at,
         COALESCE(NULLIF(btrim(v.person_name), ''), 'Cash payment')
    FROM public.payment_vouchers v, (SELECT cutover_at FROM cash_handover_settings WHERE id) c
   WHERE v.cash_handover_id IS NULL
     AND COALESCE(v.amount, 0) > 0
     AND v.created_at >= c.cutover_at
     -- Paid from a cash ledger, not a bank one. Both the live per-company
     -- "Cash" and the deactivated "Cash in Hand" stub match, because the
     -- payment voucher rail still posts to the stub.
     AND lower(COALESCE(v.account_ledger_name, '')) LIKE '%cash%'
     AND (COALESCE(btrim(p_hospital_type), '') = ''
          OR lower(btrim(COALESCE(v.hospital_type, ''))) = lower(btrim(p_hospital_type)));
$$;

CREATE OR REPLACE FUNCTION public.cash_position_by_holder(
  p_hospital_type TEXT DEFAULT NULL
)
RETURNS TABLE (
  holder_user_id UUID, holder_name TEXT, attribution TEXT,
  net_cash NUMERIC, receipt_count INTEGER, oldest_uncollected TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH cutover AS (SELECT cutover_at FROM cash_handover_settings WHERE id),
  scope AS (SELECT lower(btrim(COALESCE(p_hospital_type, ''))) AS h),
  pool AS (
    SELECT a.collected_by_user_id AS uid,
           NULLIF(btrim(COALESCE(a.billing_executive, '')), '') AS label,
           COALESCE(a.advance_amount, 0) AS amount, a.payment_date AS at
      FROM advance_payment a
      LEFT JOIN patients pt ON pt.id = a.patient_id, cutover c, scope s
     WHERE a.cash_handover_id IS NULL
       AND upper(btrim(COALESCE(a.payment_mode, ''))) = 'CASH'
       AND COALESCE(a.is_refund, false) = false
       AND COALESCE(a.status, 'ACTIVE') = 'ACTIVE'
       AND COALESCE(a.advance_amount, 0) > 0
       AND a.payment_date >= c.cutover_at
       AND (s.h = '' OR lower(btrim(COALESCE(pt.hospital_name, ''))) = s.h)
    UNION ALL
    SELECT f.collected_by_user_id, NULL, COALESCE(f.amount, 0), f.payment_date
      FROM final_payments f
      LEFT JOIN patients pt ON pt.id = f.patient_id, cutover c, scope s
     WHERE f.cash_handover_id IS NULL
       AND upper(btrim(COALESCE(f.mode_of_payment, ''))) = 'CASH'
       AND COALESCE(f.amount, 0) > 0
       AND f.payment_date >= c.cutover_at
       AND (s.h = '' OR lower(btrim(COALESCE(pt.hospital_name, ''))) = s.h)
  ),
  keyed AS (
    SELECT p.uid,
           CASE WHEN p.uid IS NOT NULL THEN 'login'
                WHEN p.label IS NOT NULL THEN 'name' ELSE 'none' END AS attribution,
           CASE WHEN p.uid IS NOT NULL THEN COALESCE(u.full_name, u.email, 'Unknown user')
                WHEN p.label IS NOT NULL THEN p.label
                ELSE 'Not recorded to anyone' END AS holder_name,
           p.amount, p.at
      FROM pool p LEFT JOIN "User" u ON u.id = p.uid
  ),
  receipts AS (
    SELECT k.uid AS holder_user_id, k.holder_name, k.attribution,
           sum(k.amount)::NUMERIC AS net_cash, count(*)::INT AS receipt_count,
           min(k.at) AS oldest_uncollected
      FROM keyed k
     GROUP BY k.uid, k.holder_name, k.attribution
  ),
  payouts AS (
    SELECT NULL::UUID, 'Cash paid out (vouchers)'::TEXT, 'payout'::TEXT,
           (-sum(amount))::NUMERIC, count(*)::INT, min(at)
      FROM cash_payouts_pool(p_hospital_type)
     HAVING count(*) > 0
  )
  SELECT * FROM receipts
  UNION ALL
  SELECT * FROM payouts
  ORDER BY 4 DESC;
$$;

CREATE OR REPLACE FUNCTION public.cash_handover_preview(
  p_user_id UUID,
  p_include_unattributed BOOLEAN DEFAULT false,
  p_hospital_type TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cutover TIMESTAMPTZ; v_hosp TEXT;
  v_mine NUMERIC := 0; v_mine_n INT := 0;
  v_uatt NUMERIC := 0; v_uatt_n INT := 0;
  v_pay NUMERIC := 0; v_pay_n INT := 0;
  v_upi NUMERIC := 0; v_card NUMERIC := 0;
  v_lines JSONB;
BEGIN
  SELECT cutover_at INTO v_cutover FROM cash_handover_settings WHERE id;
  v_hosp := lower(btrim(COALESCE(p_hospital_type, '')));

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
    COALESCE(jsonb_agg(jsonb_build_object(
      'table', tbl, 'id', sid, 'amount', amount, 'at', at,
      'who', who, 'patient', patient_name, 'mine', (uid = p_user_id)
    ) ORDER BY at DESC) FILTER (WHERE uid = p_user_id OR (p_include_unattributed AND uid IS NULL)), '[]'::jsonb)
  INTO v_mine, v_mine_n, v_uatt, v_uatt_n, v_lines
  FROM pool;

  SELECT COALESCE(sum(amount),0), COALESCE(count(*),0)
    INTO v_pay, v_pay_n
  FROM cash_payouts_pool(p_hospital_type);

  IF p_include_unattributed AND v_pay_n > 0 THEN
    v_lines := v_lines || (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'table', 'payment_vouchers', 'id', id::text, 'amount', -amount,
        'at', at, 'who', label, 'patient', NULL, 'mine', false
      ) ORDER BY at DESC), '[]'::jsonb)
      FROM cash_payouts_pool(p_hospital_type)
    );
  END IF;

  SELECT COALESCE(sum(COALESCE(a.advance_amount,0)) FILTER (WHERE upper(btrim(COALESCE(a.payment_mode,''))) IN ('UPI','ONLINE','NEFT','RTGS','PHONEPE','GPAY')), 0),
         COALESCE(sum(COALESCE(a.advance_amount,0)) FILTER (WHERE upper(btrim(COALESCE(a.payment_mode,''))) IN ('CARD','CREDIT CARD','DEBIT CARD')), 0)
    INTO v_upi, v_card
  FROM advance_payment a
  LEFT JOIN patients pt ON pt.id = a.patient_id
  WHERE COALESCE(a.is_refund,false) = false
    AND COALESCE(a.status,'ACTIVE') = 'ACTIVE'
    AND a.payment_date >= date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata')
    AND (a.collected_by_user_id = p_user_id OR a.collected_by_user_id IS NULL)
    AND (v_hosp = '' OR lower(btrim(COALESCE(pt.hospital_name,''))) = v_hosp);

  RETURN jsonb_build_object(
    'cutoverAt', v_cutover,
    'hospitalType', NULLIF(v_hosp, ''),
    'mineAmount', v_mine, 'mineCount', v_mine_n,
    'unattributedAmount', v_uatt, 'unattributedCount', v_uatt_n,
    'payoutAmount', v_pay, 'payoutCount', v_pay_n,
    'includeUnattributed', COALESCE(p_include_unattributed,false),
    'expectedCash', v_mine
                    + CASE WHEN COALESCE(p_include_unattributed,false) THEN v_uatt - v_pay ELSE 0 END,
    'refUpiTotal', v_upi, 'refCardTotal', v_card,
    'lines', v_lines
  );
END $$;

REVOKE ALL ON FUNCTION public.cash_payouts_pool(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cash_payouts_pool(TEXT) TO anon, authenticated;

DO $verify$
DECLARE v_n INT; v_neg NUMERIC;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='payment_vouchers'
                    AND column_name='cash_handover_id') THEN
    RAISE EXCEPTION 'ABORT: payment_vouchers.cash_handover_id missing';
  END IF;

  -- A payout must reduce the drawer, never add to it.
  SELECT count(*), COALESCE(min(net_cash),0) INTO v_n, v_neg
    FROM cash_position_by_holder(NULL) WHERE attribution = 'payout';
  IF v_n > 0 AND v_neg >= 0 THEN
    RAISE EXCEPTION 'ABORT: cash paid out was not shown as a reduction (%)', v_neg;
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
