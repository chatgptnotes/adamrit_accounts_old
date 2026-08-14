-- The remaining three from Dr M's list, each decided by him rather than guessed.
--
--   ANVI CHANDANI  -- new account, role accountant.
--   FARHAN         -- Gmail attached AND dropped from superadmin to pharmacist,
--                     so the account matches the job.
--   SNEHAL TIMANDE -- the address was written @gamil.com; Dr M confirmed the
--                     typo, so it is set as @gmail.com.
--
-- FARHAN IS THE ONE TO READ TWICE. He is losing superadmin, which is a
-- reduction, not a grant, and it has consequences worth stating:
--
--   * he stops receiving director notifications -- bank deposits, cash
--     shortage reports, the missing-handover watchdog. Those go to
--     superadmins, and he will no longer be one. That is the point of the
--     change, but it is a real change to who gets told what.
--   * he KEEPS Cash Handover. His access comes from the cash roster
--     (can_hand_over at hope), not from his role, and the verify block below
--     proves it rather than assuming it.
--
-- ANVI'S PASSWORD. She signs in with Google, and the password column has no
-- nulls anywhere in this table, so one is set to a value nobody holds --
-- random, and never printed. That makes the account Google-only by
-- construction rather than by policy. If she ever needs to sign in with a
-- password, a director sets one in User Management; nothing here needs undoing
-- for that.
--
-- Her hospital is 'hope', which is where both existing accountants (Shailesh,
-- Tilak) sit. If she belongs to Ayushman it is a one-field change.
--
-- Roles carry weight here: 'accountant' is in ACCOUNTING_ROLES, so it grants
-- voucher create and alter on the Accounting screen. Dr M chose it knowing
-- that; it is recorded here so nobody later reads it as an accident.

DO $apply$
DECLARE
  v_id UUID; v_n INT; v_clash TEXT; v_pw TEXT;
BEGIN
  -- pgcrypto gives a bcrypt hash the app's bcryptjs can read. Without it there
  -- is no way to set a password here, and a half-made account is worse than
  -- none.
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') THEN
    RAISE EXCEPTION 'ABORT: pgcrypto is not installed, so no password can be set';
  END IF;

  -- ---------------------------------------------------------------- ANVI
  SELECT count(*) INTO v_n FROM public."User"
   WHERE lower(btrim(email)) = 'anvitekchandani3@gmail.com'
      OR lower(btrim(COALESCE(google_email, ''))) = 'anvitekchandani3@gmail.com';
  IF v_n > 1 THEN
    RAISE EXCEPTION 'ABORT: anvitekchandani3@gmail.com already matches % accounts', v_n;
  END IF;

  IF v_n = 0 THEN
    -- Random, and deliberately never returned or logged. Google is the way in.
    -- pgcrypto lives in the extensions schema on Supabase, not on the
    -- search_path, so every call to it here is schema-qualified.
    v_pw := encode(extensions.gen_random_bytes(24), 'hex');
    INSERT INTO public."User" (full_name, email, google_email, role, hospital_type,
                               is_active, password)
    VALUES ('anvi chandani', 'anvitekchandani3@gmail.com', 'anvitekchandani3@gmail.com',
            'accountant', 'hope', true, extensions.crypt(v_pw, extensions.gen_salt('bf', 12)));
  END IF;

  -- -------------------------------------------------------------- FARHAN
  SELECT count(*) INTO v_n FROM public."User" WHERE lower(btrim(email)) = 'farhan@hope.com';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'ABORT: farhan@hope.com matches % accounts, not 1', v_n;
  END IF;
  SELECT id INTO v_id FROM public."User" WHERE lower(btrim(email)) = 'farhan@hope.com';

  SELECT COALESCE(full_name, email) INTO v_clash FROM public."User"
   WHERE id <> v_id
     AND (lower(btrim(email)) = 'farhanibrani42@gmail.com'
          OR lower(btrim(COALESCE(google_email, ''))) = 'farhanibrani42@gmail.com')
   LIMIT 1;
  IF v_clash IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: % already uses farhanibrani42@gmail.com', v_clash;
  END IF;

  UPDATE public."User"
     SET google_email = 'farhanibrani42@gmail.com',
         role = 'pharmacist',
         -- Follows the role down. A superadmin sees every employee's HR
         -- record; a pharmacist should not, and leaving this true would keep
         -- the most sensitive part of the old role behind.
         hr_pulse_can_view_all = false,
         is_active = true
   WHERE id = v_id;

  -- -------------------------------------------------------------- SNEHAL
  SELECT count(*) INTO v_n FROM public."User" WHERE lower(btrim(email)) = 'snehal@gmail.com';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'ABORT: snehal@gmail.com matches % accounts, not 1', v_n;
  END IF;
  SELECT id INTO v_id FROM public."User" WHERE lower(btrim(email)) = 'snehal@gmail.com';

  SELECT COALESCE(full_name, email) INTO v_clash FROM public."User"
   WHERE id <> v_id
     AND (lower(btrim(email)) = 'snehaltimande782@gmail.com'
          OR lower(btrim(COALESCE(google_email, ''))) = 'snehaltimande782@gmail.com')
   LIMIT 1;
  IF v_clash IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: % already uses snehaltimande782@gmail.com', v_clash;
  END IF;

  UPDATE public."User"
     SET google_email = 'snehaltimande782@gmail.com', is_active = true
   WHERE id = v_id;
END
$apply$;

DO $verify$
DECLARE
  v_addr TEXT; v_id UUID; v_role TEXT; v_hits INT; v_hr BOOLEAN;
  v_all CONSTANT TEXT[] := ARRAY['anvitekchandani3@gmail.com',
                                 'farhanibrani42@gmail.com',
                                 'snehaltimande782@gmail.com'];
BEGIN
  -- (a) each address signs in to exactly one account. One row is the
  --     difference between signing in and signing in as somebody else.
  FOREACH v_addr IN ARRAY v_all LOOP
    SELECT count(*) INTO v_hits FROM public."User"
     WHERE COALESCE(is_active, true)
       AND (lower(btrim(email)) = v_addr
            OR lower(btrim(COALESCE(google_email, ''))) = v_addr);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'ABORT: % matches % active accounts, not 1', v_addr, v_hits;
    END IF;
  END LOOP;

  -- (b) Anvi exists, as an accountant, and can actually be signed in to
  SELECT id, role INTO v_id, v_role FROM public."User"
   WHERE lower(btrim(email)) = 'anvitekchandani3@gmail.com';
  IF v_id IS NULL THEN RAISE EXCEPTION 'ABORT: Anvi was not created'; END IF;
  IF v_role <> 'accountant' THEN
    RAISE EXCEPTION 'ABORT: Anvi was created as % rather than accountant', v_role;
  END IF;
  IF (SELECT password FROM public."User" WHERE id = v_id) IS NULL THEN
    RAISE EXCEPTION 'ABORT: Anvi has no password, and every other row has one';
  END IF;

  -- (c) Farhan is a pharmacist now, and no longer a director for alerts
  SELECT id, role, hr_pulse_can_view_all INTO v_id, v_role, v_hr
    FROM public."User" WHERE lower(btrim(email)) = 'farhan@hope.com';
  IF v_role <> 'pharmacist' THEN
    RAISE EXCEPTION 'ABORT: Farhan is still %', v_role;
  END IF;
  IF COALESCE(v_hr, false) THEN
    RAISE EXCEPTION 'ABORT: Farhan kept see-every-HR-record from his old role';
  END IF;

  -- (d) and he KEEPS the cash handover tile, because that comes from the
  --     roster and not from the role. Proven, not assumed.
  IF NOT can_use_cash_handover(v_id) THEN
    RAISE EXCEPTION 'ABORT: dropping Farhan to pharmacist cost him Cash Handover';
  END IF;

  -- (e) there is still someone left to receive director alerts
  SELECT count(*) INTO v_hits FROM public."User"
   WHERE role IN ('superadmin', 'super_admin') AND COALESCE(is_active, true);
  IF v_hits < 1 THEN
    RAISE EXCEPTION 'ABORT: no active directors remain to be notified';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
