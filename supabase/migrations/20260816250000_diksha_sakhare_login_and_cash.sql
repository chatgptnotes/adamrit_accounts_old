-- Diksha Sakhare takes the Hope cash counter.
--
-- Two things, both blocking her right now:
--
-- 1. THE ADDRESS. Her account carried diksha@gmail.com, which is not hers.
--    Dr M gave sakharediksha54@gmail.com as the correct one. Sign-in matches
--    email OR google_email (api/auth-session.ts), so setting the email is what
--    lets her in.
--
--    NOT TOUCHING google_email. It already held a third address --
--    dikshasakhare722@gmail.com -- which was there before today and was not
--    part of the instruction. Removing it could lock her out if that is the
--    Google account actually signed into her browser, and this change is
--    urgent enough that a second failed login matters. Both addresses will
--    therefore work; flagged for Dr M to trim once she is in.
--
-- 2. THE COUNTER. Both cash tiles gate on can_use_cash_handover(), which
--    admits a person on the cash roster or one carrying the cashier role. She
--    is a receptionist with no roster row, so neither tile opened.
--
--    Added by NAME, not by changing her role, for the reason the roster
--    exists: making her a cashier would take away the receptionist role she
--    needs for registration, and adding 'receptionist' to the cash rules would
--    hand a drawer to every receptionist at once.
--
--    can_hand_over only, at hope. She holds the drawer rather than receiving
--    it -- the same shape as Nisha, whose counter she is taking. Receiving
--    stays with Avni, Tilak and Arpit.

DO $change$
DECLARE
  v_id UUID := '42da42fc-c815-4cd0-96ee-8e09169f7882';
  v_name TEXT; v_taken INT;
BEGIN
  SELECT COALESCE(full_name, email) INTO v_name FROM public."User" WHERE id = v_id;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'ABORT: Diksha Sakhare (%) is not there', v_id;
  END IF;

  -- The new address must not already belong to somebody else, or sign-in
  -- becomes ambiguous between two accounts.
  SELECT count(*) INTO v_taken FROM public."User"
   WHERE id <> v_id
     AND (lower(email) = 'sakharediksha54@gmail.com'
          OR lower(COALESCE(google_email, '')) = 'sakharediksha54@gmail.com');
  IF v_taken > 0 THEN
    RAISE EXCEPTION 'ABORT: sakharediksha54@gmail.com already belongs to % other account(s)', v_taken;
  END IF;

  UPDATE public."User"
     SET email = 'sakharediksha54@gmail.com'
   WHERE id = v_id;

  IF NOT EXISTS (
    SELECT 1 FROM public.cash_handover_verifiers
     WHERE user_id = v_id AND hospital_type = 'hope'
  ) THEN
    INSERT INTO public.cash_handover_verifiers
      (user_id, display_name, hospital_type, can_receive, can_verify, can_hand_over, is_active)
    VALUES (v_id, v_name, 'hope', false, false, true, true);
  ELSE
    UPDATE public.cash_handover_verifiers
       SET can_hand_over = true, is_active = true
     WHERE user_id = v_id AND hospital_type = 'hope';
  END IF;
END
$change$;

DO $verify$
DECLARE
  v_id UUID := '42da42fc-c815-4cd0-96ee-8e09169f7882';
  v_email TEXT; v_role TEXT; v_n INT;
BEGIN
  SELECT lower(email), lower(role) INTO v_email, v_role FROM public."User" WHERE id = v_id;

  IF v_email <> 'sakharediksha54@gmail.com' THEN
    RAISE EXCEPTION 'ABORT: her address is %, expected sakharediksha54@gmail.com', v_email;
  END IF;

  -- The address Dr M asked to remove must be gone from every account.
  SELECT count(*) INTO v_n FROM public."User"
   WHERE lower(email) = 'diksha@gmail.com'
      OR lower(COALESCE(google_email, '')) = 'diksha@gmail.com';
  IF v_n > 0 THEN
    RAISE EXCEPTION 'ABORT: diksha@gmail.com still on % account(s)', v_n;
  END IF;

  -- The tile opens off this function, so test the function, not the row.
  IF NOT public.can_use_cash_handover(v_id) THEN
    RAISE EXCEPTION 'ABORT: Diksha still cannot open the cash tiles';
  END IF;

  -- Her registration role must survive: taking receptionist away would stop
  -- her doing the job she is actually employed for.
  IF v_role <> 'receptionist' THEN
    RAISE EXCEPTION 'ABORT: her role changed to %, it should not have', v_role;
  END IF;

  -- She holds cash; she must not also be able to receive her own handover.
  SELECT count(*) INTO v_n FROM public.cash_handover_verifiers
   WHERE user_id = v_id AND can_receive;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'ABORT: she can receive as well as hand over';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
