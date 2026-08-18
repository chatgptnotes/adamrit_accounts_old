-- Two reception logins that nobody has ever used.
--
-- THE INSTRUCTION (18 Aug, Dr M): remove arti@gmail.com and reception@gmail.com.
--
-- Both are placeholder addresses invented when the account was made, both are
-- receptionist accounts, and NEITHER HAS EVER BEEN SIGNED INTO -- last_login_at
-- is null on both, one created 8-Jul and the other 14-Jul. A shared
-- "reception@" login is the worse of the two: any work done through it is
-- attributable to nobody, which is the shared-login problem 20260813340000 had
-- to unpick after the fact on the cash side.
--
-- DEACTIVATED, NOT DELETED. is_active = false is refused at sign-in
-- (api/auth-session.ts checks it explicitly), and every picker in the app
-- filters on it, so the accounts are gone from the user's point of view. The
-- row stays because "User" is referenced by id from a dozen tables and a hard
-- DELETE turns any reference into a dangling id rather than an error. Verified
-- below that neither holds a reference today -- no roster row, no handover, no
-- opening, no tile assignment, no notification, and nothing created by them --
-- so if Dr M wants them physically gone, that is now a safe one-line follow-up
-- rather than a guess.
--
-- THE OTHER TWO PLACEHOLDERS ARE UNTOUCHED. tulsidas@gmail.com and
-- ashvini@gmail.com both signed in on 10-Aug and a placeholder is the only
-- address either has, so removing them would lock two working receptionists
-- out mid-shift. They wait for their real addresses.

DO $change$
DECLARE
  v_ids UUID[] := ARRAY[
    '114e91cb-5e70-4333-a3e3-32ae2a609269',  -- arti@gmail.com
    '3d0aa98b-076c-464a-ab27-7ba215d7f96c'   -- reception@gmail.com
  ];
  v_used INT;
  v_refs INT;
BEGIN
  -- Never retire an account somebody is actually working from.
  SELECT count(*) INTO v_used FROM public."User"
   WHERE id = ANY(v_ids) AND last_login_at IS NOT NULL;
  IF v_used > 0 THEN
    RAISE EXCEPTION 'ABORT: % of these accounts has been signed into — it is in use', v_used;
  END IF;

  -- And never retire one that owns cash history.
  SELECT count(*) INTO v_refs FROM public.cash_handover_verifiers WHERE user_id = ANY(v_ids);
  IF v_refs > 0 THEN
    RAISE EXCEPTION 'ABORT: % roster row(s) belong to these accounts', v_refs;
  END IF;
  SELECT count(*) INTO v_refs FROM public.cash_handovers
   WHERE from_user_id = ANY(v_ids) OR to_user_id = ANY(v_ids);
  IF v_refs > 0 THEN
    RAISE EXCEPTION 'ABORT: % handover(s) belong to these accounts', v_refs;
  END IF;

  UPDATE public."User"
     SET is_active = false
   WHERE id = ANY(v_ids);
END
$change$;

DO $verify$
DECLARE
  v_n INT;
BEGIN
  SELECT count(*) INTO v_n FROM public."User"
   WHERE lower(btrim(email)) IN ('arti@gmail.com', 'reception@gmail.com') AND is_active;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'ABORT: % of them is still active', v_n;
  END IF;

  -- They must no longer be able to sign in. lookup_user_by_email still finds
  -- the row, so test what actually gates the login: is_active.
  SELECT count(*) INTO v_n FROM public."User"
   WHERE lower(btrim(email)) IN ('arti@gmail.com', 'reception@gmail.com');
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'ABORT: % row(s) remain, expected both kept and deactivated', v_n;
  END IF;

  -- The two receptionists still working must be untouched and still active.
  SELECT count(*) INTO v_n FROM public."User"
   WHERE lower(btrim(email)) IN ('tulsidas@gmail.com', 'ashvini@gmail.com') AND is_active;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'ABORT: % of the two working receptionists remain active, expected 2', v_n;
  END IF;

  -- Nisha and Diksha, the receptionists who hold cash, must still reach it.
  SELECT count(*) INTO v_n FROM public."User" u
   WHERE lower(btrim(u.email)) IN ('im.nishasharma@gmail.com', 'sakharediksha54@gmail.com')
     AND u.is_active AND public.can_use_cash_handover(u.id);
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'ABORT: only % of the two cash-holding receptionists can still open the cash tiles', v_n;
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
