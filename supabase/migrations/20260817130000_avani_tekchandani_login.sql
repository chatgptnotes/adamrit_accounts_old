-- Avani signs in with her real address.
--
-- THE INSTRUCTION (17 Aug, Dr M): avnitekchandani3@gmail.com should be allowed
-- for Avani, as accountant and as a cashier.
--
-- WHAT WAS ACTUALLY MISSING. Only one thing: the address. Her account
-- ("Avni", 4bb9bfad-343d-4742-99c5-0c3818411676) carries avni@gmail.com, which
-- is a placeholder of the same kind as diksha@ and nisha@ were -- nobody signs
-- in with it. avnitekchandani3@gmail.com was on NO account, so Google sign-in
-- had nothing to match and she could not get in at all. The two rights Dr M
-- named she already holds:
--
--   * ACCOUNTANT. Her role is admin, which is in ACCOUNTING_ROLES
--     (src/lib/accounting-access.ts:1), so voucher create and alter on the
--     desktop Accounting screen and the accountingOnly tablet tiles are already
--     open. Setting role = 'accountant' would be a DOWNGRADE from admin, not a
--     grant, so her role is deliberately left alone.
--   * CASHIER. She is on cash_handover_verifiers at hospital_type '*' with
--     can_receive, so can_use_cash_handover() is already true and both cash
--     tiles already open for her. She is one of the three who RECEIVE handovers
--     (with Tilak and Arpit) -- see 20260816250000's header.
--
-- ADDED AS google_email, NOT AS email. Sign-in matches either
-- (lookup_user_by_email, 20260814110000), but every hardcoded allowlist in the
-- source matches the PRIMARY email column -- OFFICE_TILE_EMAILS carries
-- 'avni@gmail.com' (src/lib/officeTileAccess.ts:44). Replacing the email would
-- take the Accounts and Expense Bills tiles away from her the same instant,
-- silently, with nothing logged: exactly what happened to Diksha on 16-Aug and
-- what the comment at accounting-access.ts:12-18 was written to prevent. Both
-- addresses therefore work and no source file has to change or be redeployed.
--
-- NOT GRANTING can_hand_over. Letting her hand a drawer over as well as
-- receive would put both halves of a handover in one pair of hands, which is
-- the one arrangement this roster exists to prevent (20260815280000:92-97
-- aborts on it). If Dr M wants her holding a counter drawer, that is a separate
-- decision about who then receives from her, and a separate migration.

DO $change$
DECLARE
  v_id UUID := '4bb9bfad-343d-4742-99c5-0c3818411676';
  v_name TEXT; v_taken INT;
BEGIN
  SELECT COALESCE(full_name, email) INTO v_name FROM public."User" WHERE id = v_id;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'ABORT: Avani (%) is not there', v_id;
  END IF;

  -- The new address must not already belong to somebody else, or sign-in
  -- becomes ambiguous between two accounts.
  SELECT count(*) INTO v_taken FROM public."User"
   WHERE id <> v_id
     AND (lower(btrim(email)) = 'avnitekchandani3@gmail.com'
          OR lower(btrim(COALESCE(google_email, ''))) = 'avnitekchandani3@gmail.com');
  IF v_taken > 0 THEN
    RAISE EXCEPTION 'ABORT: avnitekchandani3@gmail.com already belongs to % other account(s)', v_taken;
  END IF;

  UPDATE public."User"
     SET google_email = 'avnitekchandani3@gmail.com',
         is_active = true
   WHERE id = v_id;
END
$change$;

DO $verify$
DECLARE
  v_id UUID := '4bb9bfad-343d-4742-99c5-0c3818411676';
  v_email TEXT; v_google TEXT; v_role TEXT; v_n INT;
BEGIN
  SELECT lower(btrim(email)), lower(btrim(COALESCE(google_email, ''))), lower(btrim(role))
    INTO v_email, v_google, v_role
    FROM public."User" WHERE id = v_id;

  IF v_google <> 'avnitekchandani3@gmail.com' THEN
    RAISE EXCEPTION 'ABORT: her google_email is %, expected avnitekchandani3@gmail.com', v_google;
  END IF;

  -- Sign-in is the whole point, so test the function the login path calls,
  -- not the column it happens to read.
  SELECT count(*) INTO v_n
    FROM public.lookup_user_by_email('avnitekchandani3@gmail.com');
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'ABORT: the new address resolves to % accounts, expected 1', v_n;
  END IF;

  -- The old address must keep working: the source allowlists still carry it,
  -- and losing it costs her the Accounts and Expense Bills tiles.
  IF v_email <> 'avni@gmail.com' THEN
    RAISE EXCEPTION 'ABORT: her primary email changed to %, it should not have', v_email;
  END IF;
  SELECT count(*) INTO v_n FROM public.lookup_user_by_email('avni@gmail.com');
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'ABORT: avni@gmail.com resolves to % accounts, expected 1', v_n;
  END IF;

  -- Accountant: admin is what carries her voucher rights. A silent downgrade
  -- here would cost her the Accounting screen.
  IF v_role <> 'admin' THEN
    RAISE EXCEPTION 'ABORT: her role is %, it should still be admin', v_role;
  END IF;

  -- Cashier: the cash tiles open off this function, so test the function.
  IF NOT public.can_use_cash_handover(v_id) THEN
    RAISE EXCEPTION 'ABORT: Avani cannot open the cash tiles';
  END IF;

  -- She receives handovers; she must not also be able to hand one over.
  SELECT count(*) INTO v_n FROM public.cash_handover_verifiers
   WHERE user_id = v_id AND can_hand_over;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'ABORT: she can hand over as well as receive';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
