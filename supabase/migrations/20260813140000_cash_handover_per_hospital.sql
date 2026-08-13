-- Nominate people per hospital, not globally.
--
-- The first cut had one roster for the whole group, but the counters are run
-- separately: at Ayushman Nagpur the cash goes to Arpit and the count is
-- verified by Ruby or Viji, which has nothing to do with who receives at Hope.
--
-- hospital_type '*' means every hospital, so the rows created before this
-- migration keep working exactly as they did.

ALTER TABLE public.cash_handover_verifiers
  ADD COLUMN IF NOT EXISTS hospital_type TEXT NOT NULL DEFAULT '*';

-- user_id alone is no longer unique: the same person can hold different rights
-- at different hospitals.
ALTER TABLE public.cash_handover_verifiers
  DROP CONSTRAINT IF EXISTS cash_handover_verifiers_user_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS cash_handover_verifiers_user_hospital_uidx
  ON public.cash_handover_verifiers (user_id, hospital_type);

COMMENT ON COLUMN public.cash_handover_verifiers.hospital_type IS
  'Which counter this nomination applies to. ''*'' means every hospital.';

-- Does this person hold this right at this hospital?
CREATE OR REPLACE FUNCTION public.cash_handover_may(
  p_user_id UUID, p_hospital_type TEXT, p_right TEXT
) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM cash_handover_verifiers v
     WHERE v.user_id = p_user_id
       AND v.is_active
       AND (CASE WHEN p_right = 'receive' THEN v.can_receive ELSE v.can_verify END)
       AND (v.hospital_type = '*'
            OR lower(btrim(v.hospital_type)) = lower(btrim(COALESCE(p_hospital_type, '')))
            OR COALESCE(btrim(p_hospital_type), '') = '')
  );
$$;

CREATE OR REPLACE FUNCTION public.set_cash_handover_verifier(
  p_user_id UUID,
  p_can_receive BOOLEAN DEFAULT true,
  p_can_verify BOOLEAN DEFAULT true,
  p_is_active BOOLEAN DEFAULT true,
  p_actor TEXT DEFAULT NULL,
  p_hospital_type TEXT DEFAULT '*'
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_name TEXT; v_hosp TEXT;
BEGIN
  SELECT COALESCE(full_name, email) INTO v_name FROM "User" WHERE id = p_user_id;
  IF v_name IS NULL THEN RAISE EXCEPTION 'Unknown user'; END IF;
  IF NOT (p_can_receive OR p_can_verify) THEN
    RAISE EXCEPTION 'A nominated person must be able to receive cash, verify it, or both';
  END IF;

  v_hosp := lower(btrim(COALESCE(NULLIF(btrim(p_hospital_type), ''), '*')));

  INSERT INTO cash_handover_verifiers (user_id, display_name, can_receive, can_verify,
                                       is_active, added_by, hospital_type)
  VALUES (p_user_id, v_name, p_can_receive, p_can_verify, p_is_active, p_actor, v_hosp)
  ON CONFLICT (user_id, hospital_type) DO UPDATE
    SET display_name = EXCLUDED.display_name, can_receive = EXCLUDED.can_receive,
        can_verify = EXCLUDED.can_verify, is_active = EXCLUDED.is_active,
        added_by = COALESCE(EXCLUDED.added_by, cash_handover_verifiers.added_by),
        updated_at = now();

  RETURN jsonb_build_object('userId', p_user_id, 'name', v_name, 'hospitalType', v_hosp);
END $$;

-- Receiving is now checked at the hospital the handover belongs to.
CREATE OR REPLACE FUNCTION public.submit_cash_handover(
  p_from_user_id UUID,
  p_to_user_id   UUID,
  p_denominations JSONB,
  p_hospital_type TEXT DEFAULT NULL,
  p_variance_reason TEXT DEFAULT NULL,
  p_include_unattributed BOOLEAN DEFAULT false,
  p_notes TEXT DEFAULT NULL
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

  PERFORM pg_advisory_xact_lock(hashtextextended('cash_handover_submit', 0));

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

  SELECT COALESCE(sum((d->>'denomination')::INT * (d->>'qty')::INT), 0)
    INTO v_counted
  FROM jsonb_array_elements(COALESCE(p_denominations, '[]'::jsonb)) d
  WHERE COALESCE((d->>'qty')::INT, 0) > 0;

  v_preview := cash_handover_preview(p_from_user_id, p_include_unattributed);
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
    'handoverId', v_id, 'handoverNo', v_no,
    'expectedCash', v_expected, 'countedCash', v_counted,
    'variance', v_counted - v_expected, 'sourceCount', v_count
  );
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Someone handed over these receipts a moment ago. Reopen the screen and count again.';
END $$;

-- Verifying is checked against the hospital the handover was submitted for.
CREATE OR REPLACE FUNCTION public.verify_cash_handover(
  p_handover_id UUID, p_user_id UUID, p_note TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_no TEXT; v_status TEXT; v_name TEXT; v_from UUID; v_hosp TEXT;
BEGIN
  SELECT COALESCE(v.display_name, u.full_name, u.email) INTO v_name
    FROM "User" u LEFT JOIN cash_handover_verifiers v ON v.user_id = u.id
   WHERE u.id = p_user_id LIMIT 1;
  IF v_name IS NULL THEN RAISE EXCEPTION 'Unknown user'; END IF;

  SELECT from_user_id, hospital_type INTO v_from, v_hosp
    FROM cash_handovers WHERE id = p_handover_id;
  IF v_from IS NULL THEN RAISE EXCEPTION 'That handover no longer exists'; END IF;

  IF NOT cash_handover_may(p_user_id, v_hosp, 'verify') THEN
    RAISE EXCEPTION 'Only a nominated verifier for this hospital can confirm a cash count';
  END IF;

  IF v_from = p_user_id THEN
    RAISE EXCEPTION 'The person who handed the cash over cannot verify their own count';
  END IF;

  UPDATE cash_handovers
     SET status = 'VERIFIED', verified_at = now(), verified_by_user_id = p_user_id,
         verified_by_name = v_name, verify_note = NULLIF(btrim(COALESCE(p_note,'')), ''),
         updated_at = now()
   WHERE id = p_handover_id AND status = 'ACCEPTED'
   RETURNING handover_no INTO v_no;

  IF v_no IS NULL THEN
    SELECT status INTO v_status FROM cash_handovers WHERE id = p_handover_id;
    RAISE EXCEPTION 'A handover must be accepted by the receiver before it can be verified (this one is %)', lower(v_status);
  END IF;

  RETURN jsonb_build_object('handoverNo', v_no, 'status', 'VERIFIED');
END $$;

REVOKE ALL ON FUNCTION public.set_cash_handover_verifier(UUID, BOOLEAN, BOOLEAN, BOOLEAN, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cash_handover_may(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_cash_handover_verifier(UUID, BOOLEAN, BOOLEAN, BOOLEAN, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cash_handover_may(UUID, TEXT, TEXT) TO anon, authenticated;

DO $verify$
DECLARE v_u UUID; v_ok BOOLEAN;
BEGIN
  SELECT id INTO v_u FROM "User" ORDER BY created_at LIMIT 1;

  -- a nomination scoped to one hospital must not apply at another
  INSERT INTO cash_handover_verifiers (user_id, display_name, can_receive, can_verify, hospital_type)
  VALUES (v_u, 'selftest', true, true, 'ayushman')
  ON CONFLICT (user_id, hospital_type) DO UPDATE SET can_receive = true, can_verify = true, is_active = true;

  IF NOT cash_handover_may(v_u, 'ayushman', 'receive') THEN
    RAISE EXCEPTION 'ABORT: an ayushman nomination did not apply at ayushman';
  END IF;
  IF cash_handover_may(v_u, 'hope', 'receive') THEN
    RAISE EXCEPTION 'ABORT: an ayushman-only nomination leaked to hope';
  END IF;

  DELETE FROM cash_handover_verifiers WHERE user_id = v_u AND hospital_type = 'ayushman' AND display_name = 'selftest';

  -- and the same person may hold different rights at two hospitals
  IF EXISTS (SELECT 1 FROM cash_handover_verifiers WHERE display_name = 'selftest') THEN
    RAISE EXCEPTION 'ABORT: self-test rows were left behind';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
