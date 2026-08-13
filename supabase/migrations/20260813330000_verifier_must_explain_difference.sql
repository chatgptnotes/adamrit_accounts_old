-- The verifier explains the difference too.
--
-- The cashier already has to give a reason when the count does not match. The
-- verifier -- the independent person who counts it again -- had nowhere to put
-- their own finding, so the only account of a shortage was the account given
-- by the person who was short.
--
-- Where there is a difference, verifying now requires the verifier's own note.
-- Where the count matches, a note stays optional: there is nothing to explain.

CREATE OR REPLACE FUNCTION public.verify_cash_handover(
  p_handover_id UUID, p_user_id UUID, p_note TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_no TEXT; v_status TEXT; v_name TEXT; v_from UUID; v_hosp TEXT; v_var NUMERIC;
BEGIN
  SELECT COALESCE(v.display_name, u.full_name, u.email) INTO v_name
    FROM "User" u LEFT JOIN cash_handover_verifiers v ON v.user_id = u.id
   WHERE u.id = p_user_id LIMIT 1;
  IF v_name IS NULL THEN RAISE EXCEPTION 'Unknown user'; END IF;

  SELECT from_user_id, hospital_type, variance INTO v_from, v_hosp, v_var
    FROM cash_handovers WHERE id = p_handover_id;
  IF v_from IS NULL THEN RAISE EXCEPTION 'That handover no longer exists'; END IF;

  IF NOT cash_handover_may(p_user_id, v_hosp, 'verify') THEN
    RAISE EXCEPTION 'Only a nominated verifier for this counter can confirm a cash count';
  END IF;

  IF v_from = p_user_id THEN
    RAISE EXCEPTION 'The person who handed the cash over cannot verify their own count';
  END IF;

  -- A difference needs the verifier's own account of it, not just the
  -- cashier's. Signing off a shortage in silence is the thing this feature
  -- exists to prevent.
  IF round(COALESCE(v_var, 0), 2) <> 0 AND btrim(COALESCE(p_note, '')) = '' THEN
    RAISE EXCEPTION 'This count is out by %. Record what you found before verifying it.',
      to_char(abs(v_var), 'FM9,99,99,990.00');
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

DO $verify$
DECLARE
  v_a UUID; v_b UUID; v_c UUID; v_h UUID; v_ok BOOLEAN;
BEGIN
  SELECT id INTO v_a FROM "User" WHERE lower(email) = 'nisha@gmail.com';
  SELECT id INTO v_b FROM "User" WHERE lower(email) = 'avni@gmail.com';
  SELECT id INTO v_c FROM "User" WHERE lower(email) = 'cmd@hopehospital.com';
  IF v_a IS NULL OR v_b IS NULL OR v_c IS NULL THEN
    RAISE EXCEPTION 'ABORT: test users missing';
  END IF;

  INSERT INTO cash_handovers (handover_no, hospital_type, from_user_id, from_user_name,
                              to_user_id, to_user_name, period_from, period_to,
                              expected_cash, counted_cash, variance_reason, status,
                              accepted_at, accepted_by_name)
  VALUES ('CH-VERIFYTEST', 'hope', v_a, 'a', v_b, 'b', now(), now(),
          1000, 900, 'cashier says short', 'ACCEPTED', now(), 'b')
  RETURNING id INTO v_h;

  -- Signing off a difference without a word must be refused.
  v_ok := false;
  BEGIN
    PERFORM verify_cash_handover(v_h, v_c, NULL);
  EXCEPTION WHEN others THEN v_ok := true;
  END;
  IF NOT v_ok THEN
    DELETE FROM cash_handovers WHERE id = v_h;
    RAISE EXCEPTION 'ABORT: a shortage was verified with no note';
  END IF;

  -- With a note it goes through, and the note is kept.
  PERFORM verify_cash_handover(v_h, v_c, 'recounted with the cashier, 100 short, noted');
  IF (SELECT verify_note FROM cash_handovers WHERE id = v_h) IS NULL THEN
    DELETE FROM cash_handovers WHERE id = v_h;
    RAISE EXCEPTION 'ABORT: the verifier note was not kept';
  END IF;

  DELETE FROM cash_handovers WHERE id = v_h;
  IF EXISTS (SELECT 1 FROM cash_handovers WHERE handover_no = 'CH-VERIFYTEST') THEN
    RAISE EXCEPTION 'ABORT: self-test row left behind';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
