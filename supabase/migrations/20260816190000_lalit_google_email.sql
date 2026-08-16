-- Lalit signs in with Google, on his own Gmail.
--
-- His account is lalit@gmail.com, which is an internal login rather than an
-- address anybody can actually sign into Google with. im9772403@gmail.com is
-- the real one, so it goes in google_email beside the primary rather than
-- replacing it.
--
-- Replacing it would have broken his access rather than extended it. The
-- accounting and voucher permissions are keyed on the address in the session,
-- and /api/auth-session returns the row's PRIMARY email whichever door was
-- used -- so he arrives as lalit@gmail.com either way, and the lists that name
-- him keep matching. Change the primary and every one of those lists silently
-- stops recognising him.

DO $attach$
DECLARE v_id UUID; v_clash INT;
BEGIN
  SELECT count(*) INTO v_clash FROM public."User"
   WHERE (lower(email) = 'im9772403@gmail.com' OR lower(google_email) = 'im9772403@gmail.com')
     AND lower(email) <> 'lalit@gmail.com';
  IF v_clash > 0 THEN
    RAISE EXCEPTION 'ABORT: im9772403@gmail.com already belongs to another account';
  END IF;

  UPDATE public."User"
     SET google_email = 'im9772403@gmail.com'
   WHERE lower(email) = 'lalit@gmail.com'
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'ABORT: no account for lalit@gmail.com';
  END IF;
END
$attach$;

DO $verify$
DECLARE v_n INT; v_email TEXT; v_role TEXT;
BEGIN
  -- Google sign-in must resolve the address to exactly one live account.
  SELECT count(*) INTO v_n FROM lookup_user_by_email('im9772403@gmail.com');
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'ABORT: % account(s) resolve for the Google address, expected 1', v_n;
  END IF;

  -- And it must resolve to Lalit with his primary email intact: that primary
  -- is what the permission lists match on. The function only ever returns live
  -- accounts, so resolving at all is the proof he is active.
  SELECT email, role INTO v_email, v_role
    FROM lookup_user_by_email('im9772403@gmail.com');
  IF lower(v_email) <> 'lalit@gmail.com' THEN
    RAISE EXCEPTION 'ABORT: resolves to %, not lalit@gmail.com', v_email;
  END IF;

  -- His old login must keep working too; this adds a door, it does not move one.
  IF (SELECT count(*) FROM lookup_user_by_email('lalit@gmail.com')) <> 1 THEN
    RAISE EXCEPTION 'ABORT: the original login stopped resolving';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
