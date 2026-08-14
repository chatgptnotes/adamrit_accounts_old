-- Restrict the Cash Handover tile to the people who actually handle cash.
--
-- Today it is open to all 104 active users: modulesForUser() ignores the tile
-- access matrix outright, and the cash-handover module declares no roles.
--
-- Gating it to the cashier role alone was the obvious move and would have been
-- wrong. The people who hand cash over are Nisha (receptionist) and Farhan
-- (pharmacist); the people who receive or verify it are CMD, Shailesh, Ruby,
-- Viji, Avni, Tilak and Arpit. Not one of them is a cashier, and the only
-- account that is -- Abuzar -- has never signed in. A role gate would have
-- locked out everybody who uses the screen and left it to nobody.
--
-- The reason is structural: a person holds exactly one role, and Nisha needs
-- receptionist to register patients while Farhan needs pharmacist to dispense.
-- They take cash as part of those jobs. So access here is by NAME, which is
-- what cash_handover_verifiers already does for receiving and verifying. The
-- only missing half is who may hand over -- so it is added here.

ALTER TABLE public.cash_handover_verifiers
  ADD COLUMN IF NOT EXISTS can_hand_over BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.cash_handover_verifiers.can_hand_over IS
  'May submit a handover -- i.e. holds a drawer. Distinct from can_receive '
  'and can_verify, which are the other side of the same transaction.';

-- The table was built before anyone could be listed purely as a hand-over
-- source, so its check demanded can_receive OR can_verify. A counter clerk who
-- only hands cash over is neither, and would have been refused. The rule still
-- stands -- a roster row must grant SOMETHING -- it just now counts the third
-- capability too.
ALTER TABLE public.cash_handover_verifiers
  DROP CONSTRAINT IF EXISTS cash_handover_verifiers_use_ck;
ALTER TABLE public.cash_handover_verifiers
  ADD CONSTRAINT cash_handover_verifiers_use_ck
  CHECK (can_receive OR can_verify OR can_hand_over);

-- The two people who demonstrably hand over cash. Named from the handover
-- record itself rather than assumed, so this cannot lock out someone who was
-- doing it yesterday.
DO $seed$
DECLARE r RECORD; v_added INT := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT ch.from_user_id AS user_id, ch.from_user_name AS name, ch.hospital_type
      FROM public.cash_handovers ch
     WHERE ch.from_user_id IS NOT NULL
  LOOP
    IF EXISTS (SELECT 1 FROM public.cash_handover_verifiers v WHERE v.user_id = r.user_id) THEN
      UPDATE public.cash_handover_verifiers
         SET can_hand_over = true, is_active = true
       WHERE user_id = r.user_id;
    ELSE
      INSERT INTO public.cash_handover_verifiers
        (user_id, display_name, hospital_type, can_receive, can_verify, can_hand_over, is_active)
      VALUES (r.user_id, r.name, r.hospital_type, false, false, true, true);
      v_added := v_added + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'Named % new hand-over user(s)', v_added;
END
$seed$;

-- One question, asked the same way by every screen: may this person open Cash
-- Handover at all? True for anyone named on the roster in any capacity, and
-- for anyone carrying the cashier role, so a new cashier works on day one
-- without needing a roster row as well.
CREATE OR REPLACE FUNCTION public.can_use_cash_handover(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.cash_handover_verifiers v
     WHERE v.user_id = p_user_id
       AND COALESCE(v.is_active, true) <> false
       AND (v.can_receive OR v.can_verify OR v.can_hand_over)
  ) OR EXISTS (
    SELECT 1 FROM public."User" u
     WHERE u.id = p_user_id
       AND lower(u.role) = 'cashier'
       AND COALESCE(u.is_active, true) <> false
  );
$$;

GRANT EXECUTE ON FUNCTION public.can_use_cash_handover(UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.can_use_cash_handover(UUID) TO authenticated;

DO $verify$
DECLARE v_id UUID; v_ok BOOLEAN; v_total INT;
BEGIN
  -- Everyone who has ever handed cash over must still be able to.
  FOR v_id IN SELECT DISTINCT from_user_id FROM public.cash_handovers WHERE from_user_id IS NOT NULL LOOP
    IF NOT public.can_use_cash_handover(v_id) THEN
      RAISE EXCEPTION 'ABORT: a past hand-over user would be locked out (%)', v_id;
    END IF;
  END LOOP;

  -- So must every verifier and receiver.
  FOR v_id IN SELECT user_id FROM public.cash_handover_verifiers WHERE COALESCE(is_active, true) LOOP
    IF NOT public.can_use_cash_handover(v_id) THEN
      RAISE EXCEPTION 'ABORT: a rostered verifier would be locked out (%)', v_id;
    END IF;
  END LOOP;

  -- And the cashier role must work on its own, with no roster row.
  SELECT id INTO v_id FROM public."User" WHERE lower(email) = 'abuzar@adamrit.com';
  IF v_id IS NOT NULL AND NOT public.can_use_cash_handover(v_id) THEN
    RAISE EXCEPTION 'ABORT: the cashier role alone does not grant access';
  END IF;

  -- But it must actually EXCLUDE someone, or it is decoration. Pick an active
  -- user who is neither rostered nor a cashier.
  SELECT u.id INTO v_id FROM public."User" u
   WHERE COALESCE(u.is_active, true) <> false
     AND lower(COALESCE(u.role, '')) <> 'cashier'
     AND NOT EXISTS (SELECT 1 FROM public.cash_handover_verifiers v WHERE v.user_id = u.id)
   LIMIT 1;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'ABORT: could not find anyone to check exclusion against';
  END IF;
  IF public.can_use_cash_handover(v_id) THEN
    RAISE EXCEPTION 'ABORT: the gate admits everybody; it restricts nothing';
  END IF;

  SELECT count(*) INTO v_total FROM public.cash_handover_verifiers
   WHERE COALESCE(is_active, true) AND (can_receive OR can_verify OR can_hand_over);
  RAISE NOTICE 'Cash handover roster: % named people', v_total;
END
$verify$;

NOTIFY pgrst, 'reload schema';
