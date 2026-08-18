-- Staff sign in as themselves. The placeholder addresses go.
--
-- THE INSTRUCTION (18 Aug, Dr M): "shailesh@gmail.com is to be removed", then
-- "such placeholder emails have to be removed for cashier accountant and
-- receptionist".
--
-- WHAT A PLACEHOLDER IS HERE. A bare first name at gmail.com that nobody owns
-- -- shailesh@, nisha@, avni@, diksha@ -- invented when the account was made.
-- The person's real address was later added as google_email, so they sign in
-- with Google while the fake one stays as their identity in the books.
--
-- ONLY THE TWO IN SCOPE THAT HAVE A REAL ADDRESS TO MOVE TO ARE TOUCHED:
--
--   shailesh@gmail.com  -> shaileshninave37@gmail.com   accountant, on the roster
--   nisha@gmail.com     -> im.nishasharma@gmail.com     receptionist, on the roster
--
-- FOUR RECEPTIONISTS ARE DELIBERATELY LEFT ALONE, because their placeholder is
-- the ONLY address they have and removing it would lock them out:
--
--   tulsidas@gmail.com   signed in 10-Aug
--   ashvini@gmail.com    signed in 10-Aug
--   arti@gmail.com       never signed in
--   reception@gmail.com  never signed in
--
-- Two of those are in daily use. Their real addresses have to come from Dr M
-- first; guessing one would take a working login away from somebody mid-shift.
--
-- THE SOURCE LISTS CHANGE IN THE SAME COMMIT. This is the whole danger of the
-- change: OFFICE_TILE_EMAILS, ACCOUNTING_EMAILS and VOUCHER_TILE_EMAILS match
-- on the PRIMARY email column, so the moment it changes the old entry goes
-- dead and the person loses voucher rights and the Accounts / Expense Bills
-- tiles with no error anywhere. That is exactly what happened to Diksha on
-- 16-Aug. src/lib/officeTileAccess.ts and src/lib/accounting-access.ts are
-- updated alongside this migration; neither is any use without the other.
--
-- google_email is cleared once the real address becomes the primary, so one
-- person has one address rather than the same one recorded twice.

DO $change$
DECLARE
  v_shailesh UUID := '8ee5788d-eb91-4764-8a9d-edc21b0cd647';
  v_nisha    UUID;
  v_taken    INT;
BEGIN
  SELECT id INTO v_nisha FROM public."User"
   WHERE lower(btrim(email)) = 'nisha@gmail.com' AND is_active;

  -- Neither new address may already belong to somebody else, or sign-in
  -- becomes ambiguous between two accounts.
  SELECT count(*) INTO v_taken FROM public."User"
   WHERE id NOT IN (v_shailesh, COALESCE(v_nisha, v_shailesh))
     AND lower(btrim(email)) IN ('shaileshninave37@gmail.com', 'im.nishasharma@gmail.com');
  IF v_taken > 0 THEN
    RAISE EXCEPTION 'ABORT: % other account(s) already hold one of the new addresses', v_taken;
  END IF;

  UPDATE public."User"
     SET email = 'shaileshninave37@gmail.com', google_email = NULL
   WHERE id = v_shailesh;

  IF v_nisha IS NOT NULL THEN
    UPDATE public."User"
       SET email = 'im.nishasharma@gmail.com', google_email = NULL
     WHERE id = v_nisha;
  END IF;
END
$change$;

DO $verify$
DECLARE
  v_n INT; v_role TEXT;
BEGIN
  -- The placeholders must be gone from every account, both columns.
  SELECT count(*) INTO v_n FROM public."User"
   WHERE lower(btrim(email)) IN ('shailesh@gmail.com', 'nisha@gmail.com')
      OR lower(btrim(COALESCE(google_email, ''))) IN ('shailesh@gmail.com', 'nisha@gmail.com');
  IF v_n > 0 THEN
    RAISE EXCEPTION 'ABORT: the placeholder address is still on % account(s)', v_n;
  END IF;

  -- Each real address must resolve to exactly one account, or sign-in is
  -- ambiguous and the login screen picks whichever row is newest.
  SELECT count(*) INTO v_n FROM public.lookup_user_by_email('shaileshninave37@gmail.com');
  IF v_n <> 1 THEN RAISE EXCEPTION 'ABORT: Shailesh resolves to % accounts', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.lookup_user_by_email('im.nishasharma@gmail.com');
  IF v_n <> 1 THEN RAISE EXCEPTION 'ABORT: Nisha resolves to % accounts', v_n; END IF;

  -- Their roles and cash rights must survive the rename untouched.
  SELECT lower(btrim(role)) INTO v_role FROM public."User"
   WHERE lower(btrim(email)) = 'shaileshninave37@gmail.com';
  IF v_role <> 'accountant' THEN
    RAISE EXCEPTION 'ABORT: Shailesh is now %, expected accountant', v_role;
  END IF;

  SELECT count(*) INTO v_n FROM public."User" u
   WHERE lower(btrim(u.email)) IN ('shaileshninave37@gmail.com', 'im.nishasharma@gmail.com')
     AND public.can_use_cash_handover(u.id);
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'ABORT: only % of the two can still open the cash tiles', v_n;
  END IF;

  -- The four with no real address must NOT have been touched.
  SELECT count(*) INTO v_n FROM public."User"
   WHERE is_active
     AND lower(btrim(email)) IN ('tulsidas@gmail.com', 'ashvini@gmail.com', 'arti@gmail.com', 'reception@gmail.com');
  IF v_n <> 4 THEN
    RAISE EXCEPTION 'ABORT: % of the four receptionists remain, expected all 4 left alone', v_n;
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
