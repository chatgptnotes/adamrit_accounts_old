-- Google sign-in for the rest of Dr M's roster.
--
-- Fifteen names came through with roles attached. Eight of them ALREADY HAVE
-- ACCOUNTS with no Google address on them, so the fix is to attach the address
-- to the account that exists — not to create a second one. That distinction
-- matters more than it looks:
--
--   * suraj (marketing, ayushman) is one of the four people allowed to approve
--     bills. A fresh account for rajput06@gmail.com would be a Suraj who
--     cannot approve anything, and he would sign in to the wrong one.
--   * Diksha Sakhare is on the cash-handover roster. Same problem.
--   * komal nagrare already had a duplicate deactivated on 14 August. Making
--     another one would undo that.
--
-- Six were done in earlier migrations and are left alone: anvi, farhan,
-- siddhant, ajay, sonali, snehal.
--
-- ROLES ARE NOT TOUCHED. This grants a way in, nothing more. Two mismatches
-- between Dr M's list and the live accounts are deliberately NOT resolved here,
-- because changing a role changes what somebody can see and that is a decision,
-- not a detail:
--
--   * PRATIK VYANKAT is listed under X-RAY DEPARTMENT but his account is
--     role 'receptionist'. Radiology screens are gated on 'radiology' and
--     'radiology_tech', so he will sign in and still not see X-ray. Switching
--     him would take away the reception screens he uses today.
--   * snehal timande is listed as 'software'; her account says 'billing'.
--
-- ONE ADDRESS IN THE LIST IS MISTYPED. snehal timande was given as
-- @gamil.com. Her account already carries the correct @gmail.com spelling from
-- 20260814340000, so this migration ignores the typed version rather than
-- overwriting a working address with a broken one.
--
-- AZHER KHAN is the only genuinely new person: no account under Azher, Azhar
-- or that address. Created as billing/hope, matching Shashank, the other
-- billing name on the list. The password is random and unusable on purpose —
-- he signs in with Google, and nobody should be handed a known password.

DO $apply$
DECLARE
  -- login address on the existing account  ->  personal Gmail to attach
  v_people CONSTANT TEXT[][] := ARRAY[
    ['diksha@gmail.com',        'dikshasakhare722@gmail.com'],
    ['pratik@gmail.com',        'guruvyankat@gmail.com'],
    ['shashank@gmail.com',      '007aryan.upgade@gmail.com'],
    ['roma@gamil.com',          'gehiroma22@gmail.com'],
    ['ayushi@gmail.com',        'ayushinandagawali1@gmail.com'],
    ['nisha@gmail.com',         'im.nishasharma@gmail.com'],
    ['suraj@gmail.com',         'rajput06@gmail.com'],
    ['kamalnagrare@gmail.com',  'kamalnagrare@gmail.com']
  ];
  v_login TEXT; v_gmail TEXT; v_id UUID; v_n INT; v_clash TEXT; v_pw TEXT;
BEGIN
  FOR i IN 1 .. array_length(v_people, 1) LOOP
    v_login := v_people[i][1];
    v_gmail := v_people[i][2];

    -- Exactly one account, or stop. Two Dikshas exist (Sakhare and Chauhan)
    -- and matching the wrong one would hand her colleague's screens over.
    SELECT count(*) INTO v_n FROM public."User" WHERE lower(btrim(email)) = v_login;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'ABORT: % matches % accounts, not 1', v_login, v_n;
    END IF;
    SELECT id INTO v_id FROM public."User" WHERE lower(btrim(email)) = v_login;

    -- The same guard api/admin-users.ts applies. A migration that bypasses the
    -- screen must not bypass its rules: two rows answering to one address makes
    -- the sign-in lookup pick whichever sorts first.
    SELECT COALESCE(full_name, email) INTO v_clash
      FROM public."User"
     WHERE id <> v_id
       AND (lower(btrim(email)) = v_gmail
            OR lower(btrim(COALESCE(google_email, ''))) = v_gmail)
     LIMIT 1;
    IF v_clash IS NOT NULL THEN
      RAISE EXCEPTION 'ABORT: % already uses %, so the sign-in lookup would be ambiguous',
        v_clash, v_gmail;
    END IF;

    UPDATE public."User"
       SET google_email = v_gmail,
           is_active    = true
     WHERE id = v_id;
  END LOOP;

  -- ------------------------------------------------------------ AZHER KHAN
  SELECT count(*) INTO v_n FROM public."User"
   WHERE lower(btrim(email)) = 'azherkhanp@gmail.com'
      OR lower(btrim(COALESCE(google_email, ''))) = 'azherkhanp@gmail.com';
  IF v_n = 0 THEN
    v_pw := encode(extensions.gen_random_bytes(18), 'hex');
    INSERT INTO public."User" (full_name, email, google_email, role, hospital_type,
                               is_active, password)
    VALUES ('Azher Khan', 'azherkhanp@gmail.com', 'azherkhanp@gmail.com',
            'billing', 'hope', true,
            extensions.crypt(v_pw, extensions.gen_salt('bf', 12)));
  END IF;
END
$apply$;

DO $verify$
DECLARE
  v_expect CONSTANT TEXT[][] := ARRAY[
    ['dikshasakhare722@gmail.com',   'Diksha Sakhare'],
    ['guruvyankat@gmail.com',        'Pratik'],
    ['007aryan.upgade@gmail.com',    'Shashank'],
    ['gehiroma22@gmail.com',         'roma'],
    ['ayushinandagawali1@gmail.com', 'ayushi'],
    ['im.nishasharma@gmail.com',     'Nisha Sharma'],
    ['rajput06@gmail.com',           'suraj'],
    ['kamalnagrare@gmail.com',       'komal nagrare'],
    ['azherkhanp@gmail.com',         'Azher Khan'],
    -- the six already done, re-checked so a later change cannot quietly
    -- unpick them
    ['anvitekchandani3@gmail.com',   'anvi chandani'],
    ['farhanibrani42@gmail.com',     'Farhan'],
    ['bhowatesiddhant@gmail.com',    'Siddhant Bhowate'],
    ['ajaymeshram724@gmail.com',     'Ajay'],
    ['sonalikakde3070@gmail.com',    'Sonali'],
    ['snehaltimande782@gmail.com',   'snehal']
  ];
  v_name TEXT; v_active BOOLEAN; v_hits INT;
BEGIN
  FOR i IN 1 .. array_length(v_expect, 1) LOOP
    -- exactly one row answers to the address, the way sign-in will ask
    SELECT count(*) INTO v_hits FROM public."User"
     WHERE lower(btrim(COALESCE(email, ''))) = v_expect[i][1]
        OR lower(btrim(COALESCE(google_email, ''))) = v_expect[i][1];
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'ABORT: % is answered by % accounts, not 1', v_expect[i][1], v_hits;
    END IF;

    SELECT full_name, is_active INTO v_name, v_active FROM public."User"
     WHERE lower(btrim(COALESCE(email, ''))) = v_expect[i][1]
        OR lower(btrim(COALESCE(google_email, ''))) = v_expect[i][1];
    IF v_name <> v_expect[i][2] THEN
      RAISE EXCEPTION 'ABORT: % belongs to %, expected %', v_expect[i][1], v_name, v_expect[i][2];
    END IF;
    IF NOT v_active THEN
      RAISE EXCEPTION 'ABORT: % is not active', v_expect[i][2];
    END IF;
  END LOOP;

  -- The deactivated duplicate Komal stays deactivated.
  IF EXISTS (SELECT 1 FROM public."User"
              WHERE lower(btrim(email)) = 'komal@gmail.com' AND is_active) THEN
    RAISE EXCEPTION 'ABORT: the duplicate Komal account came back to life';
  END IF;
END
$verify$;
