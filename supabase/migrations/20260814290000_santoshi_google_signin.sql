-- Let Santoshi sign in to Adamrit with her own Gmail.
--
-- She already has an account -- santoshi@gmail.com, nurse, active -- so this
-- is not a new user. What she has no way to do is get in through Google,
-- because the address she actually holds is santoshipatlea14@gmail.com and
-- nothing connected the two.
--
-- google_email is the join (20260814110000): staff keep their existing login
-- ID for password sign-in and arrive through Google on their personal Gmail.
-- auth-session.ts matches an incoming Google address against EITHER column, so
-- filling this one in is the whole of the change.
--
-- Her role is untouched. This is about being able to get in, not about what
-- she can see once she is there -- a nurse she was and a nurse she remains.
--
-- Two things are checked before the write rather than after, because the API
-- that normally does this (api/admin-users.ts) enforces them and a migration
-- that bypasses the screen must not bypass its rules:
--
--   * exactly one Santoshi, so the address cannot land on the wrong row;
--   * the address is not already somebody's login or somebody's Gmail, which
--     would make the sign-in lookup ambiguous and hand her their account.

DO $apply$
DECLARE
  v_email TEXT := 'santoshipatlea14@gmail.com';
  v_id UUID; v_n INT; v_clash TEXT;
BEGIN
  SELECT count(*) INTO v_n FROM public."User" WHERE lower(btrim(email)) = 'santoshi@gmail.com';
  IF v_n = 0 THEN
    RAISE EXCEPTION 'ABORT: no account for santoshi@gmail.com to attach the Gmail to';
  END IF;
  IF v_n > 1 THEN
    RAISE EXCEPTION 'ABORT: % accounts share santoshi@gmail.com; pick one by hand', v_n;
  END IF;

  SELECT id INTO v_id FROM public."User" WHERE lower(btrim(email)) = 'santoshi@gmail.com';

  SELECT COALESCE(full_name, email) INTO v_clash
    FROM public."User"
   WHERE id <> v_id
     AND (lower(btrim(email)) = v_email OR lower(btrim(COALESCE(google_email, ''))) = v_email)
   LIMIT 1;
  IF v_clash IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: % already uses %, so the sign-in lookup would be ambiguous', v_clash, v_email;
  END IF;

  UPDATE public."User"
     SET google_email = v_email,
         -- A deactivated account cannot sign in however good the address is.
         is_active = true
   WHERE id = v_id;
END
$apply$;

DO $verify$
DECLARE v_g TEXT; v_active BOOLEAN; v_role TEXT; v_hits INT;
BEGIN
  SELECT google_email, is_active, role INTO v_g, v_active, v_role
    FROM public."User" WHERE lower(btrim(email)) = 'santoshi@gmail.com';

  IF v_g IS DISTINCT FROM 'santoshipatlea14@gmail.com' THEN
    RAISE EXCEPTION 'ABORT: the Gmail did not attach (got %)', COALESCE(v_g, 'NULL');
  END IF;
  IF NOT v_active THEN
    RAISE EXCEPTION 'ABORT: the account is inactive and still cannot sign in';
  END IF;
  IF v_role IS DISTINCT FROM 'nurse' THEN
    RAISE EXCEPTION 'ABORT: her role changed to % — this migration must not touch it', v_role;
  END IF;

  -- The sign-in lookup must find exactly her. This is the query auth-session.ts
  -- runs, and one row is the difference between logging in and logging in as
  -- somebody else.
  SELECT count(*) INTO v_hits FROM public."User"
   WHERE lower(btrim(email)) = 'santoshipatlea14@gmail.com'
      OR lower(btrim(COALESCE(google_email, ''))) = 'santoshipatlea14@gmail.com';
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'ABORT: the Google address matches % accounts, not 1', v_hits;
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
