-- Separate the two counters' cash.
--
-- Hope and Ayushman were showing each other's transactions: advance_payment
-- carries no hospital column, so the drawer queries had nothing to filter on
-- and both hospitals read one shared pool. Switching hospital changed nothing
-- on screen, and a Hope cashier could have claimed Ayushman's takings.
--
-- The hospital comes from the patient the receipt belongs to
-- (patients.hospital_name, 'hope' | 'ayushman'). Checked against 30 days of
-- live data: every one of 1,000 sampled cash receipts resolves through that
-- join, none has a null patient_id, and the split is real -- 879 Ayushman
-- receipts against 121 Hope.
--
-- NULL/blank p_hospital_type means "every hospital", which is what the
-- director's overview wants; the tablet always passes the cashier's own.

DROP FUNCTION IF EXISTS public.cash_handover_preview(UUID, BOOLEAN);
DROP FUNCTION IF EXISTS public.cash_position_by_holder();

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
    'includeUnattributed', COALESCE(p_include_unattributed,false),
    'expectedCash', v_mine + CASE WHEN COALESCE(p_include_unattributed,false) THEN v_uatt ELSE 0 END,
    'refUpiTotal', v_upi, 'refCardTotal', v_card,
    'lines', v_lines
  );
END $$;

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
  )
  SELECT k.uid, k.holder_name, k.attribution,
         sum(k.amount)::NUMERIC, count(*)::INT, min(k.at)
    FROM keyed k
   GROUP BY k.uid, k.holder_name, k.attribution
   ORDER BY sum(k.amount) DESC;
$$;

-- submit must claim only its own hospital's receipts.
CREATE OR REPLACE FUNCTION public.submit_cash_handover(
  p_from_user_id UUID, p_to_user_id UUID, p_denominations JSONB,
  p_hospital_type TEXT DEFAULT NULL, p_variance_reason TEXT DEFAULT NULL,
  p_include_unattributed BOOLEAN DEFAULT false, p_notes TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cutover TIMESTAMPTZ; v_from TEXT; v_to TEXT;
  v_expected NUMERIC := 0; v_counted NUMERIC := 0; v_count INT := 0;
  v_upi NUMERIC := 0; v_card NUMERIC := 0;
  v_id UUID; v_no TEXT; v_preview JSONB; v_since TIMESTAMPTZ;
BEGIN
  IF p_from_user_id IS NULL OR p_to_user_id IS NULL THEN
    RAISE EXCEPTION 'Both the person handing over and the person receiving are required';
  END IF;
  IF p_from_user_id = p_to_user_id THEN
    RAISE EXCEPTION 'Cash cannot be handed over to yourself';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('cash_handover_submit:' || lower(btrim(COALESCE(p_hospital_type,'*'))), 0));

  SELECT cutover_at INTO v_cutover FROM cash_handover_settings WHERE id;

  SELECT COALESCE(full_name, email) INTO v_from FROM "User" WHERE id = p_from_user_id;
  IF v_from IS NULL THEN RAISE EXCEPTION 'The person handing over is not a known user'; END IF;

  SELECT COALESCE(v.display_name, u.full_name, u.email) INTO v_to
    FROM "User" u LEFT JOIN cash_handover_verifiers v ON v.user_id = u.id
   WHERE u.id = p_to_user_id LIMIT 1;
  IF v_to IS NULL THEN RAISE EXCEPTION 'The person receiving is not a known user'; END IF;

  IF NOT cash_handover_may(p_to_user_id, p_hospital_type, 'receive') THEN
    RAISE EXCEPTION 'Cash can only be handed to a nominated receiver at this hospital. Ask a director to add this person to the cash handover list.';
  END IF;

  SELECT COALESCE(sum((d->>'denomination')::INT * (d->>'qty')::INT), 0) INTO v_counted
  FROM jsonb_array_elements(COALESCE(p_denominations, '[]'::jsonb)) d
  WHERE COALESCE((d->>'qty')::INT, 0) > 0;

  v_preview := cash_handover_preview(p_from_user_id, p_include_unattributed, p_hospital_type);
  v_expected := (v_preview->>'expectedCash')::NUMERIC;
  v_upi := (v_preview->>'refUpiTotal')::NUMERIC;
  v_card := (v_preview->>'refCardTotal')::NUMERIC;

  IF round(v_counted - v_expected, 2) <> 0 AND btrim(COALESCE(p_variance_reason,'')) = '' THEN
    RAISE EXCEPTION 'The counted cash differs from the software figure by %. Give a reason and the handover will still go through.',
      to_char(abs(v_counted - v_expected), 'FM9,99,99,990.00');
  END IF;

  SELECT COALESCE(min(at), now()) INTO v_since
    FROM jsonb_to_recordset(v_preview->'lines') AS x(at TIMESTAMPTZ);

  v_no := 'CH-' || to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYMMDD') || '-' ||
          lpad(nextval('cash_handover_no_seq')::TEXT, 4, '0');

  INSERT INTO cash_handovers (
    handover_no, hospital_type, from_user_id, from_user_name, to_user_id, to_user_name,
    period_from, period_to, expected_cash, counted_cash, variance_reason,
    ref_upi_total, ref_card_total, included_unattributed, notes
  ) VALUES (
    v_no, p_hospital_type, p_from_user_id, v_from, p_to_user_id, v_to,
    COALESCE(v_since, v_cutover), now(), v_expected, v_counted,
    NULLIF(btrim(COALESCE(p_variance_reason,'')), ''),
    v_upi, v_card, COALESCE(p_include_unattributed,false), NULLIF(btrim(COALESCE(p_notes,'')), '')
  ) RETURNING id INTO v_id;

  INSERT INTO cash_handover_denominations (handover_id, denomination, qty)
  SELECT v_id, (d->>'denomination')::INT, (d->>'qty')::INT
    FROM jsonb_array_elements(COALESCE(p_denominations, '[]'::jsonb)) d
   WHERE COALESCE((d->>'qty')::INT, 0) > 0;

  INSERT INTO cash_handover_sources (handover_id, source_table, source_id, amount,
                                     collected_at, collected_by_user_id, collected_by_label, patient_name)
  SELECT v_id, x.tbl, x.id, x.amount, x.at, p_from_user_id, x.who, x.patient
    FROM jsonb_to_recordset(v_preview->'lines')
      AS x(tbl TEXT, id TEXT, amount NUMERIC, at TIMESTAMPTZ, who TEXT, patient TEXT, mine BOOLEAN);
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE advance_payment SET cash_handover_id = v_id
   WHERE id::text IN (SELECT source_id FROM cash_handover_sources
                       WHERE handover_id = v_id AND source_table = 'advance_payment');
  UPDATE final_payments SET cash_handover_id = v_id
   WHERE id::text IN (SELECT source_id FROM cash_handover_sources
                       WHERE handover_id = v_id AND source_table = 'final_payments');

  UPDATE cash_handovers SET source_count = v_count WHERE id = v_id;

  RETURN jsonb_build_object(
    'handoverId', v_id, 'handoverNo', v_no, 'expectedCash', v_expected,
    'countedCash', v_counted, 'variance', v_counted - v_expected, 'sourceCount', v_count
  );
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Someone handed over these receipts a moment ago. Reopen the screen and count again.';
END $$;

REVOKE ALL ON FUNCTION public.cash_handover_preview(UUID, BOOLEAN, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cash_position_by_holder(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cash_handover_preview(UUID, BOOLEAN, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cash_position_by_holder(TEXT) TO anon, authenticated;

DO $verify$
DECLARE v_all NUMERIC; v_hope NUMERIC; v_ayush NUMERIC;
BEGIN
  SELECT COALESCE(sum(net_cash),0) INTO v_all   FROM cash_position_by_holder(NULL);
  SELECT COALESCE(sum(net_cash),0) INTO v_hope  FROM cash_position_by_holder('hope');
  SELECT COALESCE(sum(net_cash),0) INTO v_ayush FROM cash_position_by_holder('ayushman');

  -- The two counters must partition the pool, not duplicate it.
  IF round(v_hope + v_ayush, 2) > round(v_all, 2) THEN
    RAISE EXCEPTION 'ABORT: hospitals overlap -- hope % + ayushman % exceeds all %', v_hope, v_ayush, v_all;
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
