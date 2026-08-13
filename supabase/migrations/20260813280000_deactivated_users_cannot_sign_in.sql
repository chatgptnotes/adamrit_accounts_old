-- Deactivating an account did nothing.
--
-- Sonam has resigned, and switching her off was supposed to be the end of her
-- access. It was not: no login path checked is_active. The password and
-- staff-PIN routes never read the column, and lookup_user_by_email -- the
-- SECURITY DEFINER function the Google sign-in uses, granted to anon --
-- returned any matching row regardless. A leaver kept their password and their
-- Google account, and the switch in User Management was decoration.
--
-- is_active is nullable and every screen in the app reads NULL as active, so
-- only an explicit false is refused. Anything else would lock out the staff
-- whose flag was never set.

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
  WHERE lower(u.email) = lower(lookup_email)
    AND COALESCE(u.is_active, true) <> false
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.lookup_user_by_email(text) TO anon;
GRANT EXECUTE ON FUNCTION public.lookup_user_by_email(text) TO authenticated;

-- Sonam Masih, resigned. Left in place rather than deleted so the audit log
-- and anything she ever touched still resolves to a name.
UPDATE public."User" SET is_active = false WHERE lower(email) = 'sonam@gmail.com';

DO $verify$
DECLARE v_found INT; v_active BOOLEAN; v_other INT;
BEGIN
  SELECT is_active INTO v_active FROM public."User" WHERE lower(email) = 'sonam@gmail.com';
  IF v_active IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'ABORT: Sonam is still active';
  END IF;

  -- She must no longer be findable by the Google sign-in path.
  SELECT count(*) INTO v_found FROM lookup_user_by_email('sonam@gmail.com');
  IF v_found <> 0 THEN
    RAISE EXCEPTION 'ABORT: a deactivated account is still returned to the sign-in lookup';
  END IF;

  -- And everybody else must still be able to get in, including the many whose
  -- is_active was never set at all.
  SELECT count(*) INTO v_other FROM lookup_user_by_email('cmd@hopehospital.com');
  IF v_other <> 1 THEN
    RAISE EXCEPTION 'ABORT: an active account can no longer sign in';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
