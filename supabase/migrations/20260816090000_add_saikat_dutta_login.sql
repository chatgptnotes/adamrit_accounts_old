-- Saikat Dutta — sign-in access, and nothing beyond it.
--
-- Asked for as "allow saikat.dutta@gmail.com to login to application". Only the
-- address was given, so the two things not stated are chosen conservatively and
-- said out loud here rather than guessed at quietly:
--
--   role      'user' -- the least this system grants. It lets him in and gives
--                       him no administrative powers, no accounting screens and
--                       no cash rights. Widening it later is one edit in User
--                       Management; narrowing it after someone has used it is
--                       not, so the small grant is the safe direction to be
--                       wrong in.
--   hospital  'hope' -- the default the other accounts use. It is only his
--                       starting context.
--
-- The full name is read off the address. A nameless account is the thing that
-- makes a cash trail or an audit log unreadable later, and "Saikat Dutta" is
-- what saikat.dutta@ says. Correct it in User Management if the spelling is
-- wrong.
--
-- Nothing exists under Saikat or Dutta, by either email column, so this creates
-- no second identity.
--
-- His login email is his real Gmail, so Google sign-in resolves him directly
-- and he needs no separate google_email. The password is 32 random bytes hashed
-- and discarded unread, generated inside the database so the value never exists
-- anywhere else: a Google-only account by construction, which nobody -- not
-- even whoever created it -- can sign in as with a password. Use Reset password
-- in User Management if he ever needs one, and must_change_password makes that
-- route end in him choosing his own.

DO $create$
DECLARE v_id UUID; v_clash INT;
BEGIN
  SELECT count(*) INTO v_clash FROM public."User"
   WHERE lower(email) = 'saikat.dutta@gmail.com'
      OR lower(google_email) = 'saikat.dutta@gmail.com';
  IF v_clash > 0 THEN
    RAISE EXCEPTION 'ABORT: saikat.dutta@gmail.com is already in use';
  END IF;

  INSERT INTO public."User" (
    full_name, email, role, hospital_type, is_active,
    password, must_change_password
  ) VALUES (
    'Saikat Dutta', 'saikat.dutta@gmail.com', 'user', 'hope', true,
    extensions.crypt(encode(extensions.gen_random_bytes(32), 'hex'), extensions.gen_salt('bf', 12)),
    true
  ) RETURNING id INTO v_id;

  RAISE NOTICE 'Created Saikat Dutta (%) as user at hope', v_id;
END
$create$;

DO $verify$
DECLARE v_id UUID; v_role TEXT; v_active BOOLEAN; v_pw TEXT; v_n INT;
BEGIN
  SELECT id, role, is_active, password INTO v_id, v_role, v_active, v_pw
    FROM public."User" WHERE lower(email) = 'saikat.dutta@gmail.com';

  IF v_id IS NULL THEN RAISE EXCEPTION 'ABORT: the account was not created'; END IF;
  IF COALESCE(v_active, true) = false THEN
    RAISE EXCEPTION 'ABORT: the account was created deactivated, so he cannot sign in';
  END IF;
  IF v_role <> 'user' THEN
    RAISE EXCEPTION 'ABORT: role is %, expected the least-privilege user', v_role;
  END IF;
  -- A plain-text password would be compared literally by the login path and
  -- accepted, so this must be a real bcrypt hash.
  IF v_pw IS NULL OR left(v_pw, 2) <> '$2' THEN
    RAISE EXCEPTION 'ABORT: the password is not a bcrypt hash';
  END IF;
  -- Exactly one account may answer to the address, or sign-in is ambiguous and
  -- the newest row wins by accident.
  SELECT count(*) INTO v_n FROM lookup_user_by_email('saikat.dutta@gmail.com');
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'ABORT: % account(s) resolve for the address, expected 1', v_n;
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
