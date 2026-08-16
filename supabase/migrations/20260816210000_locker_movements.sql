-- Record what moved in and out of the locker, on the opening count and the
-- handover.
--
-- The locker balance was already captured on both. What was missing is the
-- movement: how much was taken OUT of the locker during the shift, and how much
-- was put IN. "Rs 40,000 in the locker" does not say whether Rs 20,000 was
-- lifted out this morning, and that is the question asked when a drawer is
-- short.
--
-- THEY DO NOT CHANGE THE RECONCILIATION, and that is deliberate.
--
--   variance = counted_cash + locker_cash + bank_deposit - expected_cash
--
-- Moving cash between the drawer and the locker changes neither side of that:
-- whatever leaves the locker arrives in the drawer and is counted there. Adding
-- these figures to the total would count the same notes twice and put every
-- handover out by the size of the movement. So they are recorded beside the
-- reconciliation, not inside it, and the generated variance column is left
-- exactly as it is.

ALTER TABLE public.cash_handovers
  ADD COLUMN IF NOT EXISTS locker_withdrawn NUMERIC(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locker_deposited NUMERIC(15,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.cash_handovers.locker_withdrawn IS
  'Taken OUT of the locker during this shift. Informational: the money is '
  'already counted in the drawer, so it is not part of variance.';
COMMENT ON COLUMN public.cash_handovers.locker_deposited IS
  'Put INTO the locker during this shift. Informational: already counted in '
  'locker_cash, so it is not part of variance.';

ALTER TABLE public.cash_opening_declarations
  ADD COLUMN IF NOT EXISTS locker_withdrawn NUMERIC(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locker_deposited NUMERIC(15,2) NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------- opening
-- Two optional parameters appended, so every existing caller keeps working.
CREATE OR REPLACE FUNCTION public.declare_opening_cash(
  p_hospital_type TEXT, p_amount NUMERIC, p_user_id UUID, p_note TEXT DEFAULT NULL,
  p_locker_withdrawn NUMERIC DEFAULT 0, p_locker_deposited NUMERIC DEFAULT 0
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_name TEXT; v_id UUID; v_hosp TEXT;
BEGIN
  v_hosp := lower(btrim(COALESCE(p_hospital_type, '')));
  IF v_hosp = '' THEN RAISE EXCEPTION 'Which counter is this for?'; END IF;
  IF p_amount IS NULL OR p_amount < 0 THEN RAISE EXCEPTION 'Enter the cash counted'; END IF;

  SELECT COALESCE(full_name, email) INTO v_name FROM "User" WHERE id = p_user_id;
  IF v_name IS NULL THEN RAISE EXCEPTION 'Unknown user'; END IF;

  IF EXISTS (SELECT 1 FROM cash_opening_declarations
              WHERE lower(btrim(hospital_type)) = v_hosp AND cash_handover_id IS NULL) THEN
    RAISE EXCEPTION 'This counter already has an opening balance waiting to be handed over. Hand the drawer over first.';
  END IF;

  INSERT INTO cash_opening_declarations (
    hospital_type, amount, declared_by, declared_by_name, note,
    locker_withdrawn, locker_deposited
  )
  VALUES (
    v_hosp, p_amount, p_user_id, v_name, NULLIF(btrim(COALESCE(p_note,'')), ''),
    GREATEST(COALESCE(p_locker_withdrawn, 0), 0), GREATEST(COALESCE(p_locker_deposited, 0), 0)
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'hospitalType', v_hosp, 'amount', p_amount, 'by', v_name);
END $$;

GRANT EXECUTE ON FUNCTION public.declare_opening_cash(TEXT, NUMERIC, UUID, TEXT, NUMERIC, NUMERIC) TO anon, authenticated;

-- --------------------------------------------------------------- handover
CREATE OR REPLACE FUNCTION public.submit_cash_handover(
  p_from_user_id UUID, p_to_user_id UUID, p_denominations JSONB,
  p_hospital_type TEXT DEFAULT NULL, p_variance_reason TEXT DEFAULT NULL,
  p_include_unattributed BOOLEAN DEFAULT true, p_notes TEXT DEFAULT NULL,
  p_declared_online NUMERIC DEFAULT NULL,
  p_locker_cash NUMERIC DEFAULT 0, p_bank_deposit NUMERIC DEFAULT 0,
  p_locker_withdrawn NUMERIC DEFAULT 0, p_locker_deposited NUMERIC DEFAULT 0
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cutover TIMESTAMPTZ; v_from TEXT; v_to TEXT;
  v_expected NUMERIC := 0; v_counted NUMERIC := 0; v_count INT := 0;
  v_upi NUMERIC := 0; v_card NUMERIC := 0; v_unmatched BOOLEAN := false;
  v_id UUID; v_no TEXT; v_preview JSONB; v_since TIMESTAMPTZ;
  v_locker NUMERIC := GREATEST(COALESCE(p_locker_cash, 0), 0);
  v_deposit NUMERIC := GREATEST(COALESCE(p_bank_deposit, 0), 0);
  v_out NUMERIC := GREATEST(COALESCE(p_locker_withdrawn, 0), 0);
  v_in NUMERIC := GREATEST(COALESCE(p_locker_deposited, 0), 0);
  v_accounted NUMERIC := 0;
BEGIN
  IF p_from_user_id IS NULL OR p_to_user_id IS NULL THEN
    RAISE EXCEPTION 'Both the person handing over and the person receiving are required';
  END IF;

  SELECT cutover_at INTO v_cutover FROM cash_handover_settings WHERE id;
  SELECT full_name INTO v_from FROM "User" WHERE id = p_from_user_id;
  SELECT full_name INTO v_to   FROM "User" WHERE id = p_to_user_id;

  SELECT COALESCE(sum((d->>'denomination')::NUMERIC * (d->>'qty')::NUMERIC), 0)
    INTO v_counted
    FROM jsonb_array_elements(COALESCE(p_denominations, '[]'::jsonb)) d;

  v_preview := cash_handover_preview(p_from_user_id, true, p_hospital_type);
  v_expected := (v_preview->>'expectedCash')::NUMERIC;
  v_upi := (v_preview->>'refUpiTotal')::NUMERIC;
  v_card := (v_preview->>'refCardTotal')::NUMERIC;

  -- Money collected has to be somewhere: in the drawer, in the locker, or
  -- already in the bank. The locker MOVEMENTS are not added here -- what left
  -- the locker is in the drawer and already counted, and what went in is in
  -- locker_cash. Adding them would count the same notes twice.
  v_accounted := v_counted + v_locker + v_deposit;

  IF round(v_accounted - v_expected, 2) <> 0 AND btrim(COALESCE(p_variance_reason,'')) = '' THEN
    RAISE EXCEPTION 'The cash accounted for differs from the software figure by %. Give a reason and the handover will still go through.',
      to_char(abs(v_accounted - v_expected), 'FM9,99,99,990.00');
  END IF;

  SELECT COALESCE(min(at), now()) INTO v_since
    FROM jsonb_to_recordset(v_preview->'lines') AS x(at TIMESTAMPTZ);

  v_no := 'CH-' || to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYMMDD') || '-' ||
          lpad(nextval('cash_handover_no_seq')::TEXT, 4, '0');

  INSERT INTO cash_handovers (
    handover_no, hospital_type, from_user_id, from_user_name, to_user_id, to_user_name,
    period_from, period_to, expected_cash, counted_cash, variance_reason,
    ref_upi_total, ref_card_total, included_unattributed, notes,
    declared_online, software_online, locker_cash, bank_deposit,
    locker_withdrawn, locker_deposited
  ) VALUES (
    v_no, p_hospital_type, p_from_user_id, v_from, p_to_user_id, v_to,
    COALESCE(v_since, v_cutover), now(), v_expected, v_counted,
    NULLIF(btrim(COALESCE(p_variance_reason,'')), ''),
    v_upi, v_card, true, NULLIF(btrim(COALESCE(p_notes,'')), ''),
    p_declared_online, v_upi + v_card, v_locker, v_deposit,
    v_out, v_in
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
    'countedCash', v_counted, 'lockerCash', v_locker, 'bankDeposit', v_deposit,
    'lockerWithdrawn', v_out, 'lockerDeposited', v_in,
    'variance', v_accounted - v_expected,
    'sourceCount', v_count, 'unmatched', v_unmatched,
    'softwareOnline', v_upi + v_card, 'declaredOnline', p_declared_online
  );
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'That handover was already recorded';
END;
$$;

DO $verify$
DECLARE v_expr TEXT; v_bad INT;
BEGIN
  -- The reconciliation must be untouched by this migration.
  SELECT pg_get_expr(d.adbin, d.adrelid) INTO v_expr
    FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
   WHERE a.attrelid='public.cash_handovers'::regclass AND a.attname='variance' AND NOT a.attisdropped;
  IF v_expr IS NULL OR v_expr LIKE '%locker_withdrawn%' OR v_expr LIKE '%locker_deposited%' THEN
    RAISE EXCEPTION 'ABORT: the movements leaked into variance (%)', v_expr;
  END IF;

  -- And no past handover may have shifted.
  SELECT count(*) INTO v_bad FROM public.cash_handovers
   WHERE round(variance - (counted_cash + locker_cash + bank_deposit - expected_cash), 2) <> 0;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'ABORT: % past handover(s) changed value', v_bad;
  END IF;

  SELECT count(*) INTO v_bad FROM public.cash_handovers
   WHERE locker_withdrawn <> 0 OR locker_deposited <> 0;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'ABORT: % row(s) seeded with a movement', v_bad;
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
