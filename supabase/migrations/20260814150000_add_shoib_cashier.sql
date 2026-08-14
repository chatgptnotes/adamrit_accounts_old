-- Shoib Sheikh, cashier at Ayushman.
--
-- A genuinely new person: no account existed under Shoib, Shoaib, Shoeb,
-- Sohib, Sheikh or Shaikh, so there is nothing here to merge with and no risk
-- of handing him a second identity.
--
-- His login email is his real Gmail, which means Google sign-in resolves him
-- directly and he needs no separate google_email. That also makes him ready
-- for the switch to Google-only sign-in rather than something to fix
-- afterwards.
--
-- The password is 32 random bytes that are hashed and then discarded unread --
-- generated inside the database so the value never exists anywhere else. pgcrypto
-- lives in the extensions schema on Supabase, so its functions are qualified. He is
-- therefore a Google-only account by construction: nobody, including whoever
-- created it, can sign in as him with a password. If he ever needs one, use
-- Reset password in User Management, which is the only path that shows the new
-- password to an administrator. must_change_password is set so that route ends
-- in him choosing his own.
--
-- No cash roster row is needed: can_use_cash_handover() admits the cashier role
-- on its own, so the Cash Handover tile is available to him from day one.

DO $create$
DECLARE v_id UUID; v_clash INT;
BEGIN
  SELECT count(*) INTO v_clash FROM public."User"
   WHERE lower(email) = 'shoibsheikh@gmail.com'
      OR lower(google_email) = 'shoibsheikh@gmail.com';
  IF v_clash > 0 THEN
    RAISE EXCEPTION 'ABORT: shoibsheikh@gmail.com is already in use';
  END IF;

  INSERT INTO public."User" (
    full_name, email, role, hospital_type, is_active,
    password, must_change_password
  ) VALUES (
    'Shoib Sheikh', 'shoibsheikh@gmail.com', 'cashier', 'ayushman', true,
    extensions.crypt(encode(extensions.gen_random_bytes(32), 'hex'), extensions.gen_salt('bf', 12)), true
  ) RETURNING id INTO v_id;

  RAISE NOTICE 'Created Shoib Sheikh (%) as cashier at ayushman', v_id;
END
$create$;

DO $verify$
DECLARE v_id UUID; v_role TEXT; v_hosp TEXT; v_active BOOLEAN; v_pw TEXT; v_n INT;
BEGIN
  SELECT id, role, hospital_type, is_active, password
    INTO v_id, v_role, v_hosp, v_active, v_pw
    FROM public."User" WHERE lower(email) = 'shoibsheikh@gmail.com';

  IF v_id IS NULL THEN RAISE EXCEPTION 'ABORT: Shoib was not created'; END IF;
  IF v_role <> 'cashier' OR v_hosp <> 'ayushman' THEN
    RAISE EXCEPTION 'ABORT: Shoib is % at %, expected cashier at ayushman', v_role, v_hosp;
  END IF;
  IF COALESCE(v_active, true) = false THEN
    RAISE EXCEPTION 'ABORT: Shoib was created deactivated';
  END IF;

  -- The password must be a real bcrypt hash, not a plain-text value that the
  -- password-login path would compare literally and accept.
  IF v_pw IS NULL OR left(v_pw, 2) <> '$2' THEN
    RAISE EXCEPTION 'ABORT: Shoib''s password is not a bcrypt hash';
  END IF;

  -- Exactly one account must answer to that address, or sign-in is ambiguous.
  SELECT count(*) INTO v_n FROM lookup_user_by_email('shoibsheikh@gmail.com');
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'ABORT: % account(s) resolve for shoibsheikh@gmail.com, expected 1', v_n;
  END IF;

  -- And he must be able to open the screen he was hired to use.
  IF NOT public.can_use_cash_handover(v_id) THEN
    RAISE EXCEPTION 'ABORT: the new cashier cannot open Cash Handover';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
