-- Google sign-in for Shoib Sheikh.
--
-- He was added as a cashier at Ayushman yesterday (20260814150000) with the
-- login shoibsheikh@gmail.com, and no way to arrive through Google. The
-- address he actually holds is shaikhshohib491@gmail.com -- a different
-- spelling of his own name, which is exactly why nothing joined the two.
--
-- Same join as the rest: staff keep their login ID for password sign-in and
-- arrive through Google on their personal Gmail, and auth-session.ts matches
-- an incoming address against either column.
--
-- His role is untouched. Worth knowing rather than discovering: 'cashier' on
-- its own already opens Cash Handover -- can_use_cash_handover admits the role
-- without a roster entry -- so this changes how he gets in, not what he
-- reaches once inside.

DO $apply$
DECLARE
  v_login TEXT := 'shoibsheikh@gmail.com';
  v_gmail TEXT := 'shaikhshohib491@gmail.com';
  v_id UUID; v_n INT; v_clash TEXT;
BEGIN
  SELECT count(*) INTO v_n FROM public."User" WHERE lower(btrim(email)) = v_login;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'ABORT: % matches % accounts, not 1', v_login, v_n;
  END IF;
  SELECT id INTO v_id FROM public."User" WHERE lower(btrim(email)) = v_login;

  -- The guard api/admin-users.ts applies. A migration that goes round the
  -- screen must not go round its rules.
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
END
$apply$;

DO $verify$
DECLARE v_g TEXT; v_role TEXT; v_active BOOLEAN; v_id UUID; v_hits INT;
BEGIN
  SELECT id, google_email, role, is_active INTO v_id, v_g, v_role, v_active
    FROM public."User" WHERE lower(btrim(email)) = 'shoibsheikh@gmail.com';

  IF v_g IS DISTINCT FROM 'shaikhshohib491@gmail.com' THEN
    RAISE EXCEPTION 'ABORT: the Gmail did not attach (got %)', COALESCE(v_g, 'NULL');
  END IF;
  IF NOT v_active THEN
    RAISE EXCEPTION 'ABORT: the account is inactive and still cannot sign in';
  END IF;
  IF v_role IS DISTINCT FROM 'cashier' THEN
    RAISE EXCEPTION 'ABORT: his role changed to % — this must not touch roles', v_role;
  END IF;

  -- The lookup auth-session.ts runs must find exactly him. One row is the
  -- difference between signing in and signing in as somebody else.
  SELECT count(*) INTO v_hits FROM public."User"
   WHERE COALESCE(is_active, true)
     AND (lower(btrim(email)) = 'shaikhshohib491@gmail.com'
          OR lower(btrim(COALESCE(google_email, ''))) = 'shaikhshohib491@gmail.com');
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'ABORT: the address matches % active accounts, not 1', v_hits;
  END IF;

  -- He could already open Cash Handover on the cashier role alone; signing in
  -- differently must not have cost him that.
  IF NOT can_use_cash_handover(v_id) THEN
    RAISE EXCEPTION 'ABORT: Shoib lost Cash Handover access';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
