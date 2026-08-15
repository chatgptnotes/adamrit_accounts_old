-- Shoib keeps one address: shaikhshohib6556@gmail.com. The others go.
--
-- He was created yesterday with the login shoibsheikh@gmail.com, and this
-- morning I attached shaikhshohib491@gmail.com as his Google address on Dr M's
-- list. That address was wrong. The right one is shaikhshohib6556@gmail.com,
-- and Dr M wants the others gone rather than left lying about as alternative
-- ways into a cashier's account.
--
-- BOTH columns are set to the new address, which is what "remove other email
-- ids" means here -- the login shoibsheikh@gmail.com disappears too, not just
-- the wrong Gmail. Two things make that safe rather than reckless:
--
--   * He has NEVER signed in. user_activity_log has no row for him, so no
--     working login is being taken away from anybody.
--   * Nothing in the application keys off shoibsheikh@gmail.com. It appears
--     only in the two migrations that created and amended him; none of the
--     access lists (accounting-access, officeTileAccess, the cash roster)
--     names it. Checked before writing this, because an address buried in an
--     allowlist would have silently removed his rights along with his email.
--
-- Setting email and google_email to the same value is deliberate and harmless:
-- auth-session.ts matches an incoming Google address against either column, so
-- one row still answers, and there is exactly one address to know.
--
-- He is ALREADY a cashier -- created as one yesterday. The role is asserted
-- here rather than set, so if it has drifted this migration says so instead of
-- quietly papering over it. Being a cashier is also what gives him Cash
-- Handover, without a roster entry, and that is asserted too.

DO $apply$
DECLARE
  v_new  TEXT := 'shaikhshohib6556@gmail.com';
  v_id UUID; v_n INT; v_clash TEXT;
BEGIN
  SELECT count(*) INTO v_n FROM public."User"
   WHERE lower(btrim(email)) IN ('shoibsheikh@gmail.com', 'shaikhshohib6556@gmail.com')
      OR lower(btrim(COALESCE(google_email, ''))) IN ('shaikhshohib491@gmail.com', 'shaikhshohib6556@gmail.com');
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'ABORT: % accounts involve these addresses, expected exactly 1', v_n;
  END IF;

  SELECT id INTO v_id FROM public."User"
   WHERE lower(btrim(email)) = 'shoibsheikh@gmail.com'
      OR lower(btrim(email)) = v_new;
  IF v_id IS NULL THEN RAISE EXCEPTION 'ABORT: Shoib not found'; END IF;

  -- Nobody else may already hold the new address, or the sign-in lookup would
  -- match two rows and pick whichever sorted first.
  SELECT COALESCE(full_name, email) INTO v_clash FROM public."User"
   WHERE id <> v_id
     AND (lower(btrim(email)) = v_new OR lower(btrim(COALESCE(google_email, ''))) = v_new)
   LIMIT 1;
  IF v_clash IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: % already uses %', v_clash, v_new;
  END IF;

  UPDATE public."User"
     SET email = v_new,
         google_email = v_new,
         is_active = true
   WHERE id = v_id;
END
$apply$;

DO $verify$
DECLARE v_id UUID; v_email TEXT; v_g TEXT; v_role TEXT; v_hosp TEXT; v_n INT;
BEGIN
  SELECT id, email, google_email, role, hospital_type
    INTO v_id, v_email, v_g, v_role, v_hosp
    FROM public."User" WHERE lower(btrim(email)) = 'shaikhshohib6556@gmail.com';

  IF v_id IS NULL THEN RAISE EXCEPTION 'ABORT: the new address is on no account'; END IF;
  IF v_g IS DISTINCT FROM 'shaikhshohib6556@gmail.com' THEN
    RAISE EXCEPTION 'ABORT: google_email is % rather than the new address', COALESCE(v_g, 'NULL');
  END IF;

  -- (a) the old addresses are gone from every account, not merely from his.
  SELECT count(*) INTO v_n FROM public."User"
   WHERE lower(btrim(email)) IN ('shoibsheikh@gmail.com', 'shaikhshohib491@gmail.com')
      OR lower(btrim(COALESCE(google_email, ''))) IN ('shoibsheikh@gmail.com', 'shaikhshohib491@gmail.com');
  IF v_n > 0 THEN
    RAISE EXCEPTION 'ABORT: an old address still resolves on % account(s)', v_n;
  END IF;

  -- (b) the new one resolves to exactly one active account
  SELECT count(*) INTO v_n FROM public."User"
   WHERE COALESCE(is_active, true)
     AND (lower(btrim(email)) = 'shaikhshohib6556@gmail.com'
          OR lower(btrim(COALESCE(google_email, ''))) = 'shaikhshohib6556@gmail.com');
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'ABORT: the new address matches % active accounts, not 1', v_n;
  END IF;

  -- (c) he is a cashier at Ayushman, asserted rather than assumed
  IF v_role <> 'cashier' THEN
    RAISE EXCEPTION 'ABORT: his role is % rather than cashier', v_role;
  END IF;
  IF v_hosp <> 'ayushman' THEN
    RAISE EXCEPTION 'ABORT: his counter is % rather than ayushman', v_hosp;
  END IF;

  -- (d) and the cashier role still opens Cash Handover for him
  IF NOT can_use_cash_handover(v_id) THEN
    RAISE EXCEPTION 'ABORT: Shoib cannot open Cash Handover';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
