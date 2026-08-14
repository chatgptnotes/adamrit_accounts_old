-- Let staff sign in with Google without changing how they sign in today.
--
-- Google sign-in resolves the Google account's email against public."User".
-- Everyone named below already HAS an account, under a work address or a short
-- login -- so creating rows from their Gmail addresses would have given each of
-- them a second identity, splitting their history, their role and their cash
-- attribution. Worse, /api/auth-session takes the newest row by created_at, so
-- the fresh account would have quietly outranked the real one.
--
-- So the Gmail goes alongside the existing address rather than replacing it.
-- Nobody's user ID or password changes: Ruby still types "ruby", and can now
-- also arrive through Google as mgmt@hopehospital.com.

ALTER TABLE public."User"
  ADD COLUMN IF NOT EXISTS google_email TEXT;

COMMENT ON COLUMN public."User".google_email IS
  'Optional second address accepted by Google sign-in only. The primary email '
  'remains the login ID for password and staff-PIN sign-in.';

-- Two accounts must never claim the same Google identity, and a Google address
-- must not collide with somebody else''s primary email either -- both would
-- make sign-in ambiguous, and the caller would get whichever row sorted first.
CREATE UNIQUE INDEX IF NOT EXISTS user_google_email_unique_idx
  ON public."User" (lower(google_email)) WHERE google_email IS NOT NULL;

-- Match either address. Still refuses a deactivated account, exactly as before:
-- a leaver must not get back in through the Google door.
CREATE OR REPLACE FUNCTION public.lookup_user_by_email(lookup_email text)
RETURNS TABLE (
  id uuid,
  email text,
  role text,
  hospital_type varchar
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT u.id, u.email, u.role, u.hospital_type
  FROM public."User" u
  WHERE (lower(u.email) = lower(lookup_email)
         OR lower(u.google_email) = lower(lookup_email))
    AND COALESCE(u.is_active, true) <> false
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.lookup_user_by_email(text) TO anon;
GRANT EXECUTE ON FUNCTION public.lookup_user_by_email(text) TO authenticated;

-- The eight addresses supplied. cmd@hopehospital.com is already the primary
-- email on Dr Murali's account, so Google sign-in resolves it without help and
-- it is not repeated here.
DO $attach$
DECLARE
  v_pairs TEXT[][] := ARRAY[
    ['ruby@gmail.com',          'mgmt@hopehospital.com'],
    ['viji@hopehospital.com',   'vijilakshmi9827@gmail.com'],
    ['tilak@hope.com',          'ysonu2101@gmail.com'],
    ['arpit@gmail.com',         'arpitkinarkar12345@gmail.com'],
    ['abhishek@gmail.com',      'dannarabhishek@gmail.com'],
    ['oshin@gmail.com',         'oshintembhurne4@gmail.com'],
    ['chetna@hopehospital.com', 'kurvanshichetna@gmail.com']
  ];
  v_row TEXT[]; v_hit INT; v_clash INT;
BEGIN
  FOREACH v_row SLICE 1 IN ARRAY v_pairs LOOP
    -- The Google address must not already be somebody else's primary email.
    SELECT count(*) INTO v_clash FROM public."User"
     WHERE lower(email) = v_row[2] AND lower(email) <> v_row[1];
    IF v_clash > 0 THEN
      RAISE EXCEPTION 'ABORT: % is already the primary email of another account', v_row[2];
    END IF;

    UPDATE public."User" SET google_email = v_row[2]
     WHERE lower(email) = v_row[1];
    GET DIAGNOSTICS v_hit = ROW_COUNT;
    IF v_hit <> 1 THEN
      RAISE EXCEPTION 'ABORT: expected exactly one account for %, found %', v_row[1], v_hit;
    END IF;
  END LOOP;
END
$attach$;

DO $verify$
DECLARE v_n INT; v_bad INT;
BEGIN
  SELECT count(*) INTO v_n FROM public."User" WHERE google_email IS NOT NULL;
  IF v_n <> 7 THEN
    RAISE EXCEPTION 'ABORT: % account(s) carry a Google address, expected 7', v_n;
  END IF;

  -- Each supplied address must now resolve, and resolve to exactly one person.
  IF (SELECT count(*) FROM lookup_user_by_email('mgmt@hopehospital.com')) <> 1 THEN
    RAISE EXCEPTION 'ABORT: mgmt@hopehospital.com does not resolve';
  END IF;
  IF (SELECT count(*) FROM lookup_user_by_email('kurvanshichetna@gmail.com')) <> 1 THEN
    RAISE EXCEPTION 'ABORT: kurvanshichetna@gmail.com does not resolve';
  END IF;
  -- The existing addresses must keep working, or everyone is locked out.
  IF (SELECT count(*) FROM lookup_user_by_email('cmd@hopehospital.com')) <> 1 THEN
    RAISE EXCEPTION 'ABORT: an existing primary email stopped resolving';
  END IF;
  IF (SELECT count(*) FROM lookup_user_by_email('ruby@gmail.com')) <> 1 THEN
    RAISE EXCEPTION 'ABORT: a primary email stopped resolving once a Google address was added';
  END IF;

  -- A deactivated account must still be refused through the Google door.
  SELECT count(*) INTO v_bad FROM lookup_user_by_email('superadmin@hospital.com');
  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'ABORT: a retired login resolves again';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
