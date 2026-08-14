-- Google sign-in for Siddhanth, Ajay and Sonali.
--
-- Same join as Santoshi (20260814290000): staff keep their existing login ID
-- for password sign-in and arrive through Google on their own Gmail, and
-- auth-session.ts matches an incoming address against either column.
--
-- Three of the seven names Dr M sent. The other four are NOT here, each for a
-- reason that a migration must not guess its way past:
--
--   * anvi chandani  -- has no account at all. Creating a user needs a role, a
--     hospital and a login, none of which is a detail to invent for an
--     accountant.
--   * farhan -- the only Farhan on the system is a SUPERADMIN. Dr M's list
--     says pharmacy. Attaching a personal Gmail to a superadmin account hands
--     whoever holds that address the run of the hospital, and a role mismatch
--     is exactly the wrong moment to assume.
--   * komal nagrare -- has TWO accounts, and the second one already uses
--     kamalnagrare@gmail.com as its LOGIN address. Setting it as a Google
--     address on the first would leave the sign-in lookup matching two rows
--     and picking whichever sorted first.
--   * snehal timande -- the address given ends @gamil.com, not @gmail.com.
--     Applied as typed she could never sign in, and it would look like the
--     system was broken rather than the address being wrong.
--
-- Roles are untouched throughout. This is about getting in, not about what
-- anyone can see once they are there.

DO $apply$
DECLARE
  v_people CONSTANT TEXT[][] := ARRAY[
    ['siddhanth@hope.com', 'bhowatesiddhant@gmail.com'],
    ['ajay@gmail.com',     'ajaymeshram724@gmail.com'],
    ['sonali@gmail.com',   'sonalikakde3070@gmail.com']
  ];
  v_login TEXT; v_gmail TEXT; v_id UUID; v_n INT; v_clash TEXT;
BEGIN
  FOR i IN 1 .. array_length(v_people, 1) LOOP
    v_login := v_people[i][1];
    v_gmail := v_people[i][2];

    SELECT count(*) INTO v_n FROM public."User" WHERE lower(btrim(email)) = v_login;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'ABORT: % matches % accounts, not 1', v_login, v_n;
    END IF;
    SELECT id INTO v_id FROM public."User" WHERE lower(btrim(email)) = v_login;

    -- The same guard api/admin-users.ts applies. A migration that bypasses the
    -- screen must not bypass its rules.
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
           is_active = true
     WHERE id = v_id;
  END LOOP;
END
$apply$;

DO $verify$
DECLARE
  v_pairs CONSTANT TEXT[][] := ARRAY[
    ['siddhanth@hope.com', 'bhowatesiddhant@gmail.com', 'pharmacist'],
    ['ajay@gmail.com',     'ajaymeshram724@gmail.com',  'nurse'],
    ['sonali@gmail.com',   'sonalikakde3070@gmail.com', 'nurse']
  ];
  v_g TEXT; v_role TEXT; v_active BOOLEAN; v_hits INT;
BEGIN
  FOR i IN 1 .. array_length(v_pairs, 1) LOOP
    SELECT google_email, role, is_active INTO v_g, v_role, v_active
      FROM public."User" WHERE lower(btrim(email)) = v_pairs[i][1];

    IF v_g IS DISTINCT FROM v_pairs[i][2] THEN
      RAISE EXCEPTION 'ABORT: % did not get % (got %)',
        v_pairs[i][1], v_pairs[i][2], COALESCE(v_g, 'NULL');
    END IF;
    IF NOT v_active THEN
      RAISE EXCEPTION 'ABORT: % is inactive and still cannot sign in', v_pairs[i][1];
    END IF;
    IF v_role IS DISTINCT FROM v_pairs[i][3] THEN
      RAISE EXCEPTION 'ABORT: %s role changed to % — this must not touch roles',
        v_pairs[i][1], v_role;
    END IF;

    -- The lookup auth-session.ts runs must find exactly one row. One row is
    -- the difference between signing in, and signing in as somebody else.
    SELECT count(*) INTO v_hits FROM public."User"
     WHERE lower(btrim(email)) = v_pairs[i][2]
        OR lower(btrim(COALESCE(google_email, ''))) = v_pairs[i][2];
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'ABORT: % matches % accounts, not 1', v_pairs[i][2], v_hits;
    END IF;
  END LOOP;
END
$verify$;

NOTIFY pgrst, 'reload schema';
