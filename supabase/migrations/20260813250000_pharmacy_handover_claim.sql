-- Let the pharmacy hand its cash over, not just look at it.
--
-- The tile could show Hope Pharmacy's till but not clear it: a handover claims
-- receipts out of advance_payment and final_payments, and the pharmacy sells
-- through pharmacy_sales and pharmacy_credit_payments. So the counter could be
-- counted and never handed on.
--
-- The claim now reaches both pharmacy tables. Everything else is unchanged --
-- same one-claim-per-receipt rule, same mandatory reason on a difference, same
-- accept-then-verify chain, and cash only. UPI is reported on the screen and
-- never claimed, because that money is in the bank.

ALTER TABLE public.cash_handover_sources
  DROP CONSTRAINT IF EXISTS cash_handover_sources_source_table_check;
ALTER TABLE public.cash_handover_sources
  ADD CONSTRAINT cash_handover_sources_source_table_check
  CHECK (source_table IN ('advance_payment', 'final_payments',
                          'pharmacy_sales', 'pharmacy_credit_payments'));

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

  IF v_hosp = 'pharmacy' THEN
    -- The pharmacy sells from its own tables. Cash only: pharmacy_cash_pool
    -- carries UPI and card too, and those are reported, never claimed.
    SELECT
      COALESCE(sum(amount) FILTER (WHERE uid = p_user_id), 0),
      COALESCE(count(*)    FILTER (WHERE uid = p_user_id), 0),
      COALESCE(sum(amount) FILTER (WHERE uid IS NULL), 0),
      COALESCE(count(*)    FILTER (WHERE uid IS NULL), 0),
      COALESCE(jsonb_agg(jsonb_build_object(
        'table', source_table, 'id', id, 'amount', amount, 'at', at,
        'who', COALESCE(who, 'Not recorded'), 'patient', label,
        'mine', (uid = p_user_id)
      ) ORDER BY at DESC) FILTER (WHERE uid = p_user_id OR (p_include_unattributed AND uid IS NULL)), '[]'::jsonb)
    INTO v_mine, v_mine_n, v_uatt, v_uatt_n, v_lines
    FROM pharmacy_cash_pool() WHERE mode = 'CASH';

    SELECT COALESCE(sum(amount) FILTER (WHERE mode IN ('UPI','ONLINE','PHONEPE','GPAY','NEFT','RTGS')), 0),
           COALESCE(sum(amount) FILTER (WHERE mode IN ('CARD','CREDIT CARD','DEBIT CARD')), 0)
      INTO v_upi, v_card
    FROM pharmacy_cash_pool();

    -- Cash out of the pharmacy's own ledger.
    SELECT COALESCE(sum(ve.credit_amount), 0), COALESCE(count(*), 0)
      INTO v_pay, v_pay_n
    FROM voucher_entries ve
    JOIN vouchers v ON v.id = ve.voucher_id
    JOIN chart_of_accounts a ON a.id = ve.account_id
    JOIN companies c ON c.id = a.company_id
    WHERE ve.credit_amount > 0
      AND v.status = 'AUTHORISED'
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
  END IF;

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

-- Claiming: the two pharmacy tables join the two hospital ones.
CREATE OR REPLACE FUNCTION public.claim_handover_sources(p_handover_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE advance_payment SET cash_handover_id = p_handover_id
   WHERE id::text IN (SELECT source_id FROM cash_handover_sources
                       WHERE handover_id = p_handover_id AND source_table = 'advance_payment');
  UPDATE final_payments SET cash_handover_id = p_handover_id
   WHERE id::text IN (SELECT source_id FROM cash_handover_sources
                       WHERE handover_id = p_handover_id AND source_table = 'final_payments');
  UPDATE pharmacy_sales SET cash_handover_id = p_handover_id
   WHERE sale_id::text IN (SELECT source_id FROM cash_handover_sources
                            WHERE handover_id = p_handover_id AND source_table = 'pharmacy_sales');
  UPDATE pharmacy_credit_payments SET cash_handover_id = p_handover_id
   WHERE id::text IN (SELECT source_id FROM cash_handover_sources
                       WHERE handover_id = p_handover_id AND source_table = 'pharmacy_credit_payments');
END $$;

CREATE OR REPLACE FUNCTION public.release_handover_sources(p_handover_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE advance_payment          SET cash_handover_id = NULL WHERE cash_handover_id = p_handover_id;
  UPDATE final_payments           SET cash_handover_id = NULL WHERE cash_handover_id = p_handover_id;
  UPDATE pharmacy_sales           SET cash_handover_id = NULL WHERE cash_handover_id = p_handover_id;
  UPDATE pharmacy_credit_payments SET cash_handover_id = NULL WHERE cash_handover_id = p_handover_id;
END $$;

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
    RAISE EXCEPTION 'Cash can only be handed to a nominated receiver at this counter. Ask a director to add this person to the cash handover list.';
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

  -- Payout lines are shown to explain the figure; they are not receipts and
  -- must never be claimed as though they were.
  INSERT INTO cash_handover_sources (handover_id, source_table, source_id, amount,
                                     collected_at, collected_by_user_id, collected_by_label, patient_name)
  SELECT v_id, x.tbl, x.id, x.amount, x.at, p_from_user_id, x.who, x.patient
    FROM jsonb_to_recordset(v_preview->'lines')
      AS x(tbl TEXT, id TEXT, amount NUMERIC, at TIMESTAMPTZ, who TEXT, patient TEXT, mine BOOLEAN)
   WHERE x.tbl <> 'payment_vouchers';
  GET DIAGNOSTICS v_count = ROW_COUNT;

  PERFORM claim_handover_sources(v_id);
  UPDATE cash_handovers SET source_count = v_count WHERE id = v_id;

  RETURN jsonb_build_object(
    'handoverId', v_id, 'handoverNo', v_no, 'expectedCash', v_expected,
    'countedCash', v_counted, 'variance', v_counted - v_expected, 'sourceCount', v_count
  );
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Someone handed over these receipts a moment ago. Reopen the screen and count again.';
END $$;

CREATE OR REPLACE FUNCTION public.cancel_cash_handover(
  p_handover_id UUID, p_user_id UUID, p_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_no TEXT;
BEGIN
  IF btrim(COALESCE(p_reason,'')) = '' THEN RAISE EXCEPTION 'Give a reason for cancelling'; END IF;

  UPDATE cash_handovers
     SET status = 'CANCELLED', cancelled_at = now(), cancel_reason = btrim(p_reason), updated_at = now()
   WHERE id = p_handover_id AND status = 'SUBMITTED' AND from_user_id = p_user_id
   RETURNING handover_no INTO v_no;

  IF v_no IS NULL THEN
    RAISE EXCEPTION 'Only the person who submitted it can cancel, and only before it is accepted';
  END IF;

  PERFORM release_handover_sources(p_handover_id);
  DELETE FROM cash_handover_sources WHERE handover_id = p_handover_id;

  RETURN jsonb_build_object('handoverNo', v_no, 'status', 'CANCELLED');
END $$;

REVOKE ALL ON FUNCTION public.claim_handover_sources(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_handover_sources(UUID) FROM PUBLIC;

DO $verify$
DECLARE v_p JSONB; v_cash NUMERIC;
BEGIN
  -- The pharmacy preview must offer cash only, never UPI.
  v_p := cash_handover_preview(
    (SELECT id FROM public."User" ORDER BY created_at LIMIT 1), true, 'pharmacy');
  SELECT COALESCE(sum(amount), 0) INTO v_cash FROM pharmacy_cash_pool() WHERE mode = 'CASH';
  IF round((v_p->>'unattributedAmount')::NUMERIC + (v_p->>'mineAmount')::NUMERIC, 2) <> round(v_cash, 2) THEN
    RAISE EXCEPTION 'ABORT: pharmacy preview % does not match its cash %',
      (v_p->>'unattributedAmount')::NUMERIC + (v_p->>'mineAmount')::NUMERIC, v_cash;
  END IF;

  -- And the hospital preview must still work.
  PERFORM cash_handover_preview(
    (SELECT id FROM public."User" ORDER BY created_at LIMIT 1), true, 'hope');
END
$verify$;

NOTIFY pgrst, 'reload schema';
