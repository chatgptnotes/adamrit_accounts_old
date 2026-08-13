-- Reconcile against the counter, not against one person. And count the online.
--
-- Two real handovers went in this evening and both read "Software Rs 0":
-- Farhan handed over Rs 8,800 and Nisha Rs 380, each against a software figure
-- of zero, while the pharmacy till plainly held Rs 5,630 in cash and Rs 7,700
-- taken online.
--
-- The figure was only ever counting receipts attributed to the person handing
-- over. That is almost never anybody: counter staff shared one login until
-- today, the pharmacy till stamped nobody until this afternoon, and final-bill
-- payments still stamp nobody at all. So the number a cashier was asked to
-- reconcile against was structurally zero, and every handover looked like a
-- total discrepancy.
--
-- A drawer is a place, not a person. Expected is now everything unclaimed at
-- that counter -- whoever collected it -- less the cash paid out of it. The
-- per-person split stays in the response, for the report rather than the sum.
-- Claiming already stops two people handing the same money over twice.
--
-- Online is reported beside it and never added in: it is in the bank, not in
-- the drawer. The cashier can now declare what they believe was taken online,
-- so the two can be compared on the slip.

ALTER TABLE public.cash_handovers
  ADD COLUMN IF NOT EXISTS declared_online NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS software_online NUMERIC(15,2);

COMMENT ON COLUMN public.cash_handovers.declared_online IS
  'What the cashier says was taken online this shift. Never part of the cash count.';
COMMENT ON COLUMN public.cash_handovers.software_online IS
  'What the software had recorded online at the moment of handover.';

CREATE OR REPLACE FUNCTION public.cash_handover_preview(
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

CREATE OR REPLACE FUNCTION public.submit_cash_handover(
  p_from_user_id UUID, p_to_user_id UUID, p_denominations JSONB,
  p_hospital_type TEXT DEFAULT NULL, p_variance_reason TEXT DEFAULT NULL,
  p_include_unattributed BOOLEAN DEFAULT true, p_notes TEXT DEFAULT NULL,
  p_declared_online NUMERIC DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cutover TIMESTAMPTZ; v_from TEXT; v_to TEXT;
  v_expected NUMERIC := 0; v_counted NUMERIC := 0; v_count INT := 0;
  v_upi NUMERIC := 0; v_card NUMERIC := 0; v_unmatched BOOLEAN := false;
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
    RAISE EXCEPTION 'Cash can only be handed to a nominated receiver at this counter. Ask a director to add this person to the cash handover list.';
  END IF;

  SELECT COALESCE(sum((d->>'denomination')::INT * (d->>'qty')::INT), 0) INTO v_counted
  FROM jsonb_array_elements(COALESCE(p_denominations, '[]'::jsonb)) d
  WHERE COALESCE((d->>'qty')::INT, 0) > 0;

  IF v_counted <= 0 THEN
    RAISE EXCEPTION 'Count the notes before handing over';
  END IF;

  v_preview := cash_handover_preview(p_from_user_id, true, p_hospital_type);
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
    ref_upi_total, ref_card_total, included_unattributed, notes,
    declared_online, software_online
  ) VALUES (
    v_no, p_hospital_type, p_from_user_id, v_from, p_to_user_id, v_to,
    COALESCE(v_since, v_cutover), now(), v_expected, v_counted,
    NULLIF(btrim(COALESCE(p_variance_reason,'')), ''),
    v_upi, v_card, true, NULLIF(btrim(COALESCE(p_notes,'')), ''),
    p_declared_online, v_upi + v_card
  ) RETURNING id INTO v_id;

  INSERT INTO cash_handover_denominations (handover_id, denomination, qty)
  SELECT v_id, (d->>'denomination')::INT, (d->>'qty')::INT
    FROM jsonb_array_elements(COALESCE(p_denominations, '[]'::jsonb)) d
   WHERE COALESCE((d->>'qty')::INT, 0) > 0;

  INSERT INTO cash_handover_sources (handover_id, source_table, source_id, amount,
                                     collected_at, collected_by_user_id, collected_by_label, patient_name)
  SELECT v_id, x."table", x.id, x.amount, x.at, p_from_user_id, x.who, x.patient
    FROM jsonb_to_recordset(v_preview->'lines')
      AS x("table" TEXT, id TEXT, amount NUMERIC, at TIMESTAMPTZ, who TEXT, patient TEXT, mine BOOLEAN)
   WHERE x."table" IS NOT NULL AND x."table" <> 'payment_vouchers';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_unmatched := (v_count = 0);

  PERFORM claim_handover_sources(v_id);
  UPDATE cash_handovers SET source_count = v_count, is_unmatched = v_unmatched WHERE id = v_id;

  RETURN jsonb_build_object(
    'handoverId', v_id, 'handoverNo', v_no, 'expectedCash', v_expected,
    'countedCash', v_counted, 'variance', v_counted - v_expected,
    'sourceCount', v_count, 'unmatched', v_unmatched,
    'softwareOnline', v_upi + v_card, 'declaredOnline', p_declared_online
  );
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Someone handed over these receipts a moment ago. Reopen the screen and count again.';
END $$;

DO $verify$
DECLARE v_p JSONB; v_pharm NUMERIC;
BEGIN
  -- Farhan's screen must now show the pharmacy till, not zero.
  v_p := cash_handover_preview(
    (SELECT id FROM "User" WHERE lower(email) = 'farhan@hope.com'), true, 'pharmacy');
  SELECT COALESCE(sum(amount), 0) INTO v_pharm FROM pharmacy_cash_pool() WHERE mode = 'CASH';
  IF round((v_p->>'counterAmount')::NUMERIC, 2) <> round(v_pharm, 2) THEN
    RAISE EXCEPTION 'ABORT: counter total % does not match the till %',
      v_p->>'counterAmount', v_pharm;
  END IF;
  IF (v_p->>'refUpiTotal')::NUMERIC <= 0 THEN
    RAISE EXCEPTION 'ABORT: the online figure is missing from the pharmacy preview';
  END IF;

  -- And Hope must still work.
  PERFORM cash_handover_preview(
    (SELECT id FROM "User" WHERE lower(email) = 'nisha@gmail.com'), true, 'hope');
END
$verify$;

NOTIFY pgrst, 'reload schema';
