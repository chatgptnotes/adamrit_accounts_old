-- Leave Diksha Sakhare one address: sakharediksha54@gmail.com.
--
-- 20260816250000 set her email to the correct address but deliberately left
-- google_email holding dikshasakhare722@gmail.com, because she was blocked at
-- the counter and a wrong guess would have locked her out twice. Dr M has now
-- confirmed sakharediksha54@gmail.com is the one she uses, so the other goes.
--
-- Cleared to NULL rather than set to match. Sign-in matches
--   email OR google_email          (api/auth-session.ts)
-- so the email alone admits her, and a second copy of the same address is one
-- more place for the two to drift apart later.
--
-- SHE MAY HAVE TO PICK THE RIGHT GOOGLE ACCOUNT. If her browser is signed into
-- dikshasakhare722@gmail.com, that address no longer matches anything and the
-- sign-in will be refused -- she chooses sakharediksha54@gmail.com at the
-- Google prompt and it works. That is the intended outcome, not a fault.

DO $change$
DECLARE
  v_id UUID := '42da42fc-c815-4cd0-96ee-8e09169f7882';
  v_email TEXT;
BEGIN
  SELECT lower(email) INTO v_email FROM public."User" WHERE id = v_id;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'ABORT: Diksha Sakhare (%) is not there', v_id;
  END IF;

  -- Never strip the alternate address unless the surviving one is already
  -- correct, or she would be left with no way in at all.
  IF v_email <> 'sakharediksha54@gmail.com' THEN
    RAISE EXCEPTION 'ABORT: her email is %, not sakharediksha54@gmail.com -- refusing to clear the other', v_email;
  END IF;

  UPDATE public."User" SET google_email = NULL WHERE id = v_id;
END
$change$;

DO $verify$
DECLARE
  v_id UUID := '42da42fc-c815-4cd0-96ee-8e09169f7882';
  v_email TEXT; v_google TEXT; v_n INT;
BEGIN
  SELECT lower(email), google_email INTO v_email, v_google
    FROM public."User" WHERE id = v_id;

  IF v_email <> 'sakharediksha54@gmail.com' THEN
    RAISE EXCEPTION 'ABORT: her address is now %', v_email;
  END IF;
  IF v_google IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: google_email is still %', v_google;
  END IF;

  -- Neither retired address may survive anywhere.
  SELECT count(*) INTO v_n FROM public."User"
   WHERE lower(email) IN ('diksha@gmail.com', 'dikshasakhare722@gmail.com')
      OR lower(COALESCE(google_email, '')) IN ('diksha@gmail.com', 'dikshasakhare722@gmail.com');
  IF v_n > 0 THEN
    RAISE EXCEPTION 'ABORT: a retired address is still on % account(s)', v_n;
  END IF;

  -- Exactly one account answers to the address she will sign in with.
  SELECT count(*) INTO v_n FROM public."User"
   WHERE lower(email) = 'sakharediksha54@gmail.com'
      OR lower(COALESCE(google_email, '')) = 'sakharediksha54@gmail.com';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'ABORT: % accounts answer to sakharediksha54@gmail.com', v_n;
  END IF;

  -- And she can still open the cash tiles.
  IF NOT public.can_use_cash_handover(v_id) THEN
    RAISE EXCEPTION 'ABORT: Diksha can no longer open the cash tiles';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
