-- Lalit holds a drawer at Hope and at the pharmacy.
--
-- He could not see the Opening Cash tile. Both cash tiles are gated by
-- can_use_cash_handover(), which admits a person on the cash roster or anybody
-- carrying the cashier role. Lalit is neither: his role is pharmacist, and the
-- roster had no row for him.
--
-- Added by NAME rather than by changing his role, for the reason the roster
-- exists at all: making him a cashier would take away the pharmacist role he
-- needs for dispensing, and adding 'pharmacist' to the cash rules would hand a
-- drawer to every pharmacist at once.
--
-- Two rows, one per counter, following Tilak, who already has hope and pharmacy
-- rows for the same reason. Not '*': that is for people who work every counter,
-- and Lalit works two of the three. can_use_cash_handover ignores the hospital
-- when deciding whether the tile opens, but the nominee lists on the handover
-- screen filter by it -- so the counter matters for who he can hand to.
--
-- can_hand_over only. He holds cash rather than receiving it, the same shape as
-- Nisha and Farhan. Receiving is Avni, Tilak and Arpit.

DO $add$
DECLARE v_id UUID; v_name TEXT; v_added INT := 0; t TEXT;
BEGIN
  SELECT id, COALESCE(full_name, email) INTO v_id, v_name
    FROM public."User" WHERE lower(email) = 'lalit@gmail.com';
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'ABORT: no account for lalit@gmail.com';
  END IF;

  FOREACH t IN ARRAY ARRAY['hope', 'pharmacy'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.cash_handover_verifiers
       WHERE user_id = v_id AND hospital_type = t
    ) THEN
      INSERT INTO public.cash_handover_verifiers
        (user_id, display_name, hospital_type, can_receive, can_verify, can_hand_over, is_active)
      VALUES (v_id, v_name, t, false, false, true, true);
      v_added := v_added + 1;
    ELSE
      UPDATE public.cash_handover_verifiers
         SET can_hand_over = true, is_active = true
       WHERE user_id = v_id AND hospital_type = t;
    END IF;
  END LOOP;

  RAISE NOTICE 'Lalit: % roster row(s) added', v_added;
END
$add$;

DO $verify$
DECLARE v_id UUID; v_rows INT;
BEGIN
  SELECT id INTO v_id FROM public."User" WHERE lower(email) = 'lalit@gmail.com';

  -- The tile opens off this function, so test the function, not the row.
  IF NOT public.can_use_cash_handover(v_id) THEN
    RAISE EXCEPTION 'ABORT: Lalit still cannot open the cash tiles';
  END IF;

  SELECT count(*) INTO v_rows FROM public.cash_handover_verifiers
   WHERE user_id = v_id AND can_hand_over AND COALESCE(is_active, true);
  IF v_rows <> 2 THEN
    RAISE EXCEPTION 'ABORT: % active hand-over row(s) for Lalit, expected hope and pharmacy', v_rows;
  END IF;

  -- His role must be untouched: taking pharmacist away would cost him dispensing.
  IF (SELECT lower(role) FROM public."User" WHERE id = v_id) <> 'pharmacist' THEN
    RAISE EXCEPTION 'ABORT: Lalit''s role changed; it should not have';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
