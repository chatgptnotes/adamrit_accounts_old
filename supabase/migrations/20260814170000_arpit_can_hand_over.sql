-- Arpit acts as a cashier too.
--
-- He was already on the cash roster, but only as a receiver: can_receive true,
-- can_hand_over false. So he could take a handover from the counter and could
-- not make one himself.
--
-- This grants the missing half rather than changing his role. A person holds
-- exactly one role here, and his is marketing -- switching it to cashier would
-- take away the marketing screens he uses for his actual job, which is not
-- what "also a cashier" means. can_use_cash_handover() already admits anyone on
-- the roster, so nothing else has to change for him.

DO $grant$
DECLARE v_hit INT;
BEGIN
  UPDATE public.cash_handover_verifiers v
     SET can_hand_over = true, is_active = true
    FROM public."User" u
   WHERE v.user_id = u.id
     AND lower(u.email) = 'arpit@gmail.com';
  GET DIAGNOSTICS v_hit = ROW_COUNT;
  IF v_hit < 1 THEN
    RAISE EXCEPTION 'ABORT: Arpit has no cash roster row to update';
  END IF;
END
$grant$;

DO $verify$
DECLARE v_id UUID; v_hand BOOLEAN; v_recv BOOLEAN; v_role TEXT;
BEGIN
  SELECT u.id, u.role INTO v_id, v_role
    FROM public."User" u WHERE lower(u.email) = 'arpit@gmail.com';
  SELECT can_hand_over, can_receive INTO v_hand, v_recv
    FROM public.cash_handover_verifiers WHERE user_id = v_id;

  IF NOT v_hand THEN RAISE EXCEPTION 'ABORT: Arpit still cannot hand over'; END IF;
  -- Receiving must survive: he is the Ayushman counter's nominee, and dropping
  -- it would strand the handovers that are meant to reach him.
  IF NOT v_recv THEN RAISE EXCEPTION 'ABORT: Arpit lost his receiver rights'; END IF;
  IF v_role <> 'marketing' THEN
    RAISE EXCEPTION 'ABORT: Arpit''s role changed to %, it should be untouched', v_role;
  END IF;
  IF NOT public.can_use_cash_handover(v_id) THEN
    RAISE EXCEPTION 'ABORT: Arpit cannot open Cash Handover';
  END IF;
END
$verify$;
