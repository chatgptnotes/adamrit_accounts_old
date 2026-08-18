-- Shailesh signs in with his own address.
--
-- THE INSTRUCTION (18 Aug, Dr M): shaileshninave37@gmail.com — allow as
-- cashier and accountant.
--
-- WHAT HE ALREADY HAS. Two accounts, both his:
--
--   Accountant@adamrit.com   role accountant, on the cash roster (can_verify),
--                            cash tiles already open
--   shailesh@gmail.com       role superadmin, not on the roster
--
-- The new address goes on the ACCOUNTANT account, because that is the one that
-- already carries both halves of what Dr M asked for: the accountant role puts
-- him in ACCOUNTING_ROLES (src/lib/accounting-access.ts) for voucher create and
-- alter, and his roster row is what opens the cash screens. Nothing about
-- either account's role changes.
--
-- ADDED AS google_email, NOT AS email. Sign-in matches either
-- (lookup_user_by_email, 20260814110000), but the hardcoded allowlists in the
-- source match the PRIMARY email column — OFFICE_TILE_EMAILS carries BOTH
-- 'accountant@adamrit.com' and 'shailesh@gmail.com'
-- (src/lib/officeTileAccess.ts:42-43). Replacing either would take the Accounts
-- and Expense Bills tiles away from him the same instant, silently, which is
-- what happened to Diksha on 16-Aug. Both old addresses keep working and no
-- source file has to change or be redeployed.
--
-- THE TWO ACCOUNTS ARE NOT MERGED. One of them is a superadmin login. Folding
-- them together would either hand accountant rights a superadmin's reach or
-- take a working login away from him, and neither was asked for. Flagged for
-- Dr M rather than decided here.
--
-- NOT GRANTING can_hand_over. He can VERIFY handovers. A person who can both
-- hand cash over and verify it is the one arrangement the roster exists to
-- prevent — 20260815280000 aborts on exactly that pairing. If he is to hold a
-- counter drawer, his verify right has to move to somebody else first, and
-- that is a separate decision.

DO $change$
DECLARE
  v_id UUID := '8e03be25-906e-4293-8bf5-59f6b6618cdd';
  v_name TEXT; v_taken INT;
BEGIN
  SELECT COALESCE(full_name, email) INTO v_name FROM public."User" WHERE id = v_id;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'ABORT: Shailesh''s accountant account (%) is not there', v_id;
  END IF;

  -- The new address must not already belong to somebody else, or sign-in
  -- becomes ambiguous between two accounts.
  SELECT count(*) INTO v_taken FROM public."User"
   WHERE id <> v_id
     AND (lower(btrim(email)) = 'shaileshninave37@gmail.com'
          OR lower(btrim(COALESCE(google_email, ''))) = 'shaileshninave37@gmail.com');
  IF v_taken > 0 THEN
    RAISE EXCEPTION 'ABORT: shaileshninave37@gmail.com already belongs to % other account(s)', v_taken;
  END IF;

  UPDATE public."User"
     SET google_email = 'shaileshninave37@gmail.com',
         is_active = true
   WHERE id = v_id;
END
$change$;

DO $verify$
DECLARE
  v_id UUID := '8e03be25-906e-4293-8bf5-59f6b6618cdd';
  v_email TEXT; v_google TEXT; v_role TEXT; v_n INT;
BEGIN
  SELECT lower(btrim(email)), lower(btrim(COALESCE(google_email, ''))), lower(btrim(role))
    INTO v_email, v_google, v_role
    FROM public."User" WHERE id = v_id;

  IF v_google <> 'shaileshninave37@gmail.com' THEN
    RAISE EXCEPTION 'ABORT: his google_email is %, expected shaileshninave37@gmail.com', v_google;
  END IF;

  -- Sign-in is the point, so test the function the login path calls.
  SELECT count(*) INTO v_n FROM public.lookup_user_by_email('shaileshninave37@gmail.com');
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'ABORT: the new address resolves to % accounts, expected 1', v_n;
  END IF;

  -- Both existing logins must keep working: the source allowlists carry them.
  IF v_email <> 'accountant@adamrit.com' THEN
    RAISE EXCEPTION 'ABORT: his primary email changed to %, it should not have', v_email;
  END IF;
  SELECT count(*) INTO v_n FROM public.lookup_user_by_email('shailesh@gmail.com');
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'ABORT: shailesh@gmail.com no longer resolves';
  END IF;

  -- Accountant: the role is what carries his voucher rights.
  IF v_role <> 'accountant' THEN
    RAISE EXCEPTION 'ABORT: his role is %, it should still be accountant', v_role;
  END IF;

  -- Cashier: the cash tiles open off this function, so test the function.
  IF NOT public.can_use_cash_handover(v_id) THEN
    RAISE EXCEPTION 'ABORT: Shailesh cannot open the cash tiles';
  END IF;

  -- He verifies handovers; he must not also be able to hand one over.
  SELECT count(*) INTO v_n FROM public.cash_handover_verifiers
   WHERE user_id = v_id AND can_hand_over;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'ABORT: he can hand over as well as verify';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
