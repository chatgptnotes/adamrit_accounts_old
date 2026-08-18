-- The auto-generated reception login goes too.
--
-- THE INSTRUCTION (18 Aug, Dr M): remove reception_4e989d83@hospital.local.
--
-- One of five machine-generated accounts on the @hospital.local domain, made
-- 2-Jul, never signed into. Same reasoning as 20260818160000: a desk login
-- nobody owns means work that is attributable to nobody.
--
-- IT CARRIES ONE DANGLING TILE ASSIGNMENT. Unlike arti@ and reception@, this
-- account was given the Expense Bills tile on 17-Aug during the tile
-- configuration pass — a money tile mapped to an account no person holds. The
-- row goes with the account; leaving it would keep a live grant pointing at a
-- disabled login, which is exactly the sort of thing that reads as deliberate
-- six months from now.
--
-- DEACTIVATED, NOT DELETED, for the same reason as before: "User" is
-- referenced by id from a dozen tables, so a hard DELETE turns any reference
-- into a dangling id rather than an error. After this the account holds no
-- reference at all, so a physical delete is a safe follow-up if Dr M wants one.
--
-- THE OTHER FOUR GENERATED LOGINS ARE LEFT ALONE — finance_51910f0c,
-- billing_cb773d5d, pharmacy_e3945276 and marketing_eeb130d4, all never signed
-- into. Only the reception one was asked for. They are reported to Dr M rather
-- than swept up, because removing a login nobody asked about is how somebody
-- discovers at 3 a.m. that they cannot get in.

DO $change$
DECLARE
  v_id UUID := 'f86d7559-4ae7-4cfe-94be-f184938f3ac9';
  v_used INT;
  v_refs INT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public."User" WHERE id = v_id) THEN
    RAISE EXCEPTION 'ABORT: the account (%) is not there', v_id;
  END IF;

  -- Never retire an account somebody is working from.
  SELECT count(*) INTO v_used FROM public."User"
   WHERE id = v_id AND last_login_at IS NOT NULL;
  IF v_used > 0 THEN
    RAISE EXCEPTION 'ABORT: this account has been signed into — it is in use';
  END IF;

  -- Never retire one that owns cash history.
  SELECT count(*) INTO v_refs FROM public.cash_handover_verifiers WHERE user_id = v_id;
  IF v_refs > 0 THEN RAISE EXCEPTION 'ABORT: it holds % cash roster row(s)', v_refs; END IF;
  SELECT count(*) INTO v_refs FROM public.cash_handovers
   WHERE from_user_id = v_id OR to_user_id = v_id;
  IF v_refs > 0 THEN RAISE EXCEPTION 'ABORT: it owns % handover(s)', v_refs; END IF;

  -- The tile grant goes with the account.
  DELETE FROM public.tile_assignments WHERE user_id = v_id;

  UPDATE public."User" SET is_active = false WHERE id = v_id;
END
$change$;

DO $verify$
DECLARE
  v_id UUID := 'f86d7559-4ae7-4cfe-94be-f184938f3ac9';
  v_n INT;
BEGIN
  SELECT count(*) INTO v_n FROM public."User" WHERE id = v_id AND is_active;
  IF v_n > 0 THEN RAISE EXCEPTION 'ABORT: it is still active'; END IF;

  SELECT count(*) INTO v_n FROM public.tile_assignments WHERE user_id = v_id;
  IF v_n > 0 THEN RAISE EXCEPTION 'ABORT: % tile grant(s) still point at it', v_n; END IF;

  -- No tile grant anywhere may point at a disabled account.
  SELECT count(*) INTO v_n
    FROM public.tile_assignments t
    JOIN public."User" u ON u.id = t.user_id
   WHERE t.user_id IS NOT NULL AND u.is_active = false;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'ABORT: % tile grant(s) point at a disabled account', v_n;
  END IF;

  -- The receptionists who actually work must be untouched.
  SELECT count(*) INTO v_n FROM public."User"
   WHERE is_active AND lower(btrim(email)) IN
     ('tulsidas@gmail.com', 'ashvini@gmail.com', 'im.nishasharma@gmail.com', 'sakharediksha54@gmail.com');
  IF v_n <> 4 THEN
    RAISE EXCEPTION 'ABORT: only % of the four working receptionists remain active', v_n;
  END IF;

  -- The other four generated logins must NOT have been swept up.
  SELECT count(*) INTO v_n FROM public."User"
   WHERE is_active AND email LIKE '%@hospital.local';
  IF v_n <> 4 THEN
    RAISE EXCEPTION 'ABORT: % generated logins remain active, expected the other 4 left alone', v_n;
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
