-- Let a cashier record cash the system cannot match to them.
--
-- Nisha held Rs 379 and could not hand it over: her counter shares the
-- hope@gmail.com login, so every receipt she took is attributed to that
-- account and not to her. Signed in as herself she had nothing to claim, and
-- the guard added earlier today refused the handover outright. The cash really
-- did pass to Avni and nothing recorded it.
--
-- That guard was right about the danger it was built for -- a handover that
-- claims nothing leaves the same cash claimable again -- but it could not tell
-- "nothing to claim because the code is broken" from "nothing to claim because
-- the receipts sit under somebody else's login".
--
-- So an unmatched handover is allowed and labelled as such. It is a custody
-- record: it says money passed from one named person to another and was
-- counted, while being honest that it reconciles against no receipts. The
-- register shows it, so it can never be mistaken for a clean handover.

ALTER TABLE public.cash_handovers
  ADD COLUMN IF NOT EXISTS is_unmatched BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.cash_handovers.is_unmatched IS
  'True when no receipts could be claimed -- a declared count, not a reconciled one.';

CREATE OR REPLACE FUNCTION public.submit_cash_handover(
  p_from_user_id UUID, p_to_user_id UUID, p_denominations JSONB,
  p_hospital_type TEXT DEFAULT NULL, p_variance_reason TEXT DEFAULT NULL,
  p_include_unattributed BOOLEAN DEFAULT false, p_notes TEXT DEFAULT NULL
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
  SELECT v_id, x."table", x.id, x.amount, x.at, p_from_user_id, x.who, x.patient
    FROM jsonb_to_recordset(v_preview->'lines')
      AS x("table" TEXT, id TEXT, amount NUMERIC, at TIMESTAMPTZ, who TEXT, patient TEXT, mine BOOLEAN)
   WHERE x."table" IS NOT NULL
     AND x."table" <> 'payment_vouchers';
  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- No receipts to claim is a fact about the data, not a reason to lose the
  -- record that cash changed hands. It is flagged, not hidden.
  v_unmatched := (v_count = 0);

  PERFORM claim_handover_sources(v_id);
  UPDATE cash_handovers
     SET source_count = v_count, is_unmatched = v_unmatched
   WHERE id = v_id;

  RETURN jsonb_build_object(
    'handoverId', v_id, 'handoverNo', v_no, 'expectedCash', v_expected,
    'countedCash', v_counted, 'variance', v_counted - v_expected,
    'sourceCount', v_count, 'unmatched', v_unmatched
  );
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Someone handed over these receipts a moment ago. Reopen the screen and count again.';
END $$;

DO $verify$
DECLARE v_a UUID; v_b UUID; v_r JSONB; v_id UUID;
BEGIN
  SELECT id INTO v_a FROM "User" WHERE lower(email) = 'nisha@gmail.com';
  SELECT id INTO v_b FROM "User" WHERE lower(email) = 'avni@gmail.com';
  IF v_a IS NULL OR v_b IS NULL THEN RAISE EXCEPTION 'ABORT: test users missing'; END IF;

  -- The exact case that failed: cash counted, nothing claimable.
  v_r := submit_cash_handover(v_a, v_b, '[{"denomination":100,"qty":1}]'::jsonb,
                              'hope', 'self-test', false, NULL);
  IF NOT (v_r->>'unmatched')::BOOLEAN THEN
    RAISE EXCEPTION 'ABORT: a handover claiming nothing was not flagged unmatched';
  END IF;
  IF (v_r->>'sourceCount')::INT <> 0 THEN
    RAISE EXCEPTION 'ABORT: expected no claimed sources';
  END IF;

  v_id := (v_r->>'handoverId')::UUID;
  PERFORM release_handover_sources(v_id);
  DELETE FROM cash_handovers WHERE id = v_id;

  -- And counting nothing at all is still refused.
  BEGIN
    PERFORM submit_cash_handover(v_a, v_b, '[]'::jsonb, 'hope', 'x', false, NULL);
    RAISE EXCEPTION 'ABORT: a handover with no notes counted was accepted';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'ABORT:%' THEN RAISE; END IF;
  END;
END
$verify$;

NOTIFY pgrst, 'reload schema';
