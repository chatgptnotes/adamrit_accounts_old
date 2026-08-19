-- Lalit Meshram's Google address had one character wrong.
--
-- THE INSTRUCTION (19 Aug, Dr M): tm9772403@gmail.com, Lalit Meshram, cashier
-- for Hope hospital and Hope pharmacy.
--
-- HE IS ALREADY BOTH. b379e60a (lalit@gmail.com, pharmacist) holds two live
-- cash roster rows — hospital_type 'hope' and hospital_type 'pharmacy', both
-- can_hand_over — so can_use_cash_handover() already admits him at both
-- counters. Nothing about his cash rights needs to change, and this migration
-- deliberately does not touch them.
--
-- WHAT WAS ACTUALLY WRONG. His google_email was stored as im9772403@gmail.com
-- and the real address is tm9772403@gmail.com — an i where a t belongs. Google
-- sign-in matches on that column, so the typo means the door does not open for
-- him however correctly he types it.
--
-- THE PRIMARY EMAIL IS NOT TOUCHED, and that is the point. lalit@gmail.com
-- stays as his identity in the books. /api/auth-session returns the row's
-- PRIMARY email whichever door was used, and ACCOUNTING_EMAILS and
-- OFFICE_TILE_EMAILS both match on it — changing the primary would revoke his
-- voucher rights and his Accounts and Expense Bills tiles in the same breath,
-- which is exactly what happened to Diksha on 16 Aug and to Nisha this week.
--
-- AMBIGUITY IS REFUSED. If any other account already holds the new address, in
-- either column, sign-in would become ambiguous between two rows and this
-- aborts rather than create that.

DO $fix$
DECLARE
  v_lalit UUID := 'b379e60a-e732-4511-b9ed-b8ddc690dbd3';
  v_clash INT;
  v_current TEXT;
BEGIN
  SELECT google_email INTO v_current FROM public."User" WHERE id = v_lalit;
  IF v_current IS NULL THEN
    RAISE EXCEPTION 'ABORT: b379e60a has no google_email — this is not the account described';
  END IF;
  IF lower(btrim(v_current)) NOT IN ('im9772403@gmail.com', 'tm9772403@gmail.com') THEN
    RAISE EXCEPTION 'ABORT: b379e60a holds %, not the address this migration was written for', v_current;
  END IF;

  SELECT count(*) INTO v_clash
    FROM public."User"
   WHERE id <> v_lalit
     AND (lower(btrim(email)) = 'tm9772403@gmail.com'
          OR lower(btrim(google_email)) = 'tm9772403@gmail.com');
  IF v_clash > 0 THEN
    RAISE EXCEPTION 'ABORT: % other account(s) already hold tm9772403@gmail.com', v_clash;
  END IF;

  UPDATE public."User"
     SET google_email = 'tm9772403@gmail.com'
   WHERE id = v_lalit;
END
$fix$;

DO $verify$
DECLARE
  v_n INT;
  v_primary TEXT;
  v_roster INT;
BEGIN
  -- 1. The new address resolves to exactly one account.
  SELECT count(*) INTO v_n FROM public."User"
   WHERE lower(btrim(email)) = 'tm9772403@gmail.com'
      OR lower(btrim(google_email)) = 'tm9772403@gmail.com';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'ABORT: the new address resolves to % accounts, not 1', v_n;
  END IF;

  -- 2. His identity in the books is unchanged — the tiles hang off this.
  SELECT email INTO v_primary FROM public."User"
   WHERE id = 'b379e60a-e732-4511-b9ed-b8ddc690dbd3';
  IF lower(btrim(v_primary)) <> 'lalit@gmail.com' THEN
    RAISE EXCEPTION 'ABORT: his primary email is now %, it must stay lalit@gmail.com', v_primary;
  END IF;

  -- 3. He can still hand over at both counters.
  SELECT count(*) INTO v_roster FROM public.cash_handover_verifiers
   WHERE user_id = 'b379e60a-e732-4511-b9ed-b8ddc690dbd3'
     AND is_active AND can_hand_over
     AND hospital_type IN ('hope', 'pharmacy');
  IF v_roster <> 2 THEN
    RAISE EXCEPTION 'ABORT: he holds % live hand-over rows across hope and pharmacy, expected 2', v_roster;
  END IF;

  IF NOT public.can_use_cash_handover('b379e60a-e732-4511-b9ed-b8ddc690dbd3'::uuid) THEN
    RAISE EXCEPTION 'ABORT: he can no longer use cash handover';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
