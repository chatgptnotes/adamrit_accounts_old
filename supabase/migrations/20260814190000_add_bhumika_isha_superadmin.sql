-- Bhumika Hajare and Isha Dupare, application administrators.
--
-- Asked for as "admins ... allowed to create users and change roles". The role
-- named 'admin' does NOT do that: api/admin-users.ts refuses every
-- user-management action unless the actor is in {superadmin, super_admin, ca},
-- so an 'admin' account would sign in and then be refused at the first attempt.
-- The capability described is the super-admin one, so that is what they get.
--
-- This is the highest level in the system: they can create accounts, change
-- anybody's role, deactivate accounts, and see both hospitals. Recorded plainly
-- here because a privilege grant should never be quiet.
--
-- Both are genuinely new -- nothing exists under Bhumika, Hajare, bhazarey,
-- Dupare, or their addresses -- so there is no second identity being created.
--
-- Their login email is their real Gmail, so Google sign-in resolves them
-- directly and they are ready for the move to Google-only sign-in.
--
-- The password is 32 random bytes hashed and discarded unread, generated inside
-- the database so the value never exists anywhere else. They are Google-only
-- accounts by construction; nobody can sign in as them with a password. Use
-- Reset password in User Management if either ever needs one, and
-- must_change_password makes that end in them choosing their own.

DO $create$
DECLARE
  v_people TEXT[][] := ARRAY[
    ['Bhumika Hajare', 'bhazarey@gmail.com'],
    ['Isha Dupare',    'ishadupare96@gmail.com']
  ];
  v_row TEXT[]; v_clash INT; v_id UUID;
BEGIN
  FOREACH v_row SLICE 1 IN ARRAY v_people LOOP
    SELECT count(*) INTO v_clash FROM public."User"
     WHERE lower(email) = v_row[2] OR lower(google_email) = v_row[2];
    IF v_clash > 0 THEN
      RAISE EXCEPTION 'ABORT: % is already in use', v_row[2];
    END IF;

    INSERT INTO public."User" (
      full_name, email, role, hospital_type, is_active,
      password, must_change_password, hr_pulse_can_view_all
    ) VALUES (
      v_row[1], v_row[2], 'superadmin', 'hope', true,
      extensions.crypt(encode(extensions.gen_random_bytes(32), 'hex'), extensions.gen_salt('bf', 12)),
      true, true
    ) RETURNING id INTO v_id;

    RAISE NOTICE 'Created % (%) as superadmin at hope', v_row[1], v_id;
  END LOOP;
END
$create$;

DO $verify$
DECLARE v_email TEXT; v_id UUID; v_role TEXT; v_pw TEXT; v_n INT; v_admins INT;
BEGIN
  FOREACH v_email IN ARRAY ARRAY['bhazarey@gmail.com', 'ishadupare96@gmail.com'] LOOP
    SELECT id, role, password INTO v_id, v_role, v_pw
      FROM public."User" WHERE lower(email) = v_email;

    IF v_id IS NULL THEN RAISE EXCEPTION 'ABORT: % was not created', v_email; END IF;
    IF v_role <> 'superadmin' THEN
      RAISE EXCEPTION 'ABORT: % is %, expected superadmin', v_email, v_role;
    END IF;
    -- A plain-text password would be compared literally by the login path and
    -- accepted, so this must be a real bcrypt hash.
    IF v_pw IS NULL OR left(v_pw, 2) <> '$2' THEN
      RAISE EXCEPTION 'ABORT: %''s password is not a bcrypt hash', v_email;
    END IF;
    -- Exactly one account may answer to the address, or sign-in is ambiguous.
    SELECT count(*) INTO v_n FROM lookup_user_by_email(v_email);
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'ABORT: % account(s) resolve for %, expected 1', v_n, v_email;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_admins FROM public."User"
   WHERE lower(role) IN ('superadmin', 'super_admin')
     AND COALESCE(is_active, true) <> false;
  RAISE NOTICE 'Active super-admins now: %', v_admins;
END
$verify$;

NOTIFY pgrst, 'reload schema';
