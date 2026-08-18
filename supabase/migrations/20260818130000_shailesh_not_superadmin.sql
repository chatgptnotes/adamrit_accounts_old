-- Shailesh is an accountant, not a superadmin.
--
-- THE INSTRUCTION (18 Aug, Dr M): remove superadmin role for Shailesh.
--
-- WHICH ACCOUNT IS ACTUALLY HIS. He has two, and it is the SUPERADMIN one he
-- uses. shailesh@gmail.com last signed in this morning; Accountant@adamrit.com
-- has NEVER been signed into, not once. So this migration corrects yesterday's
-- assumption as well: the Google address and the cash roster row were put on
-- the dormant account, which would have sent him to a login he has never used.
-- Both move to the account he actually works from.
--
-- WHAT HE KEEPS. Everything he needs, because none of it came from superadmin:
--   * vouchers  — the accountant role is in ACCOUNTING_ROLES
--                 (src/lib/accounting-access.ts:1)
--   * Accounts / Expense Bills tiles — shailesh@gmail.com is named directly in
--                 OFFICE_TILE_EMAILS (src/lib/officeTileAccess.ts:43), by
--                 email, so the role change cannot touch it
--   * cash screens — the roster row moves with him
--
-- WHAT HE LOSES, which is the point: the admin API (api/admin-users guards on
-- auth: 'admin'), so he can no longer create users, reset passwords or change
-- anybody's role; and isSuperAdmin in the app.
--
-- NO LOCKOUT RISK. There are 13 superadmin accounts; this leaves 12, including
-- cmd@hopehospital.com, ruby@gmail.com and drmurali@gmail.com.
--
-- THE DORMANT ACCOUNT IS LEFT ACTIVE. Removing a login was not asked for, and
-- it costs nothing to leave it. It is stripped of the Google address and the
-- roster row so it can no longer be signed into by mistake or claim cash
-- rights. Recommended to Dr M for deactivation, not decided here.
--
-- NEITHER ACCOUNT HAS ANY HANDOVER HISTORY (checked: zero rows on
-- cash_handovers for both ids), so moving the roster row moves nothing else.

DO $change$
DECLARE
  v_live UUID := '8ee5788d-eb91-4764-8a9d-edc21b0cd647'; -- shailesh@gmail.com
  v_dorm UUID := '8e03be25-906e-4293-8bf5-59f6b6618cdd'; -- Accountant@adamrit.com
  v_supers INT;
  v_hist INT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public."User" WHERE id = v_live) THEN
    RAISE EXCEPTION 'ABORT: his live account (%) is not there', v_live;
  END IF;

  -- Never leave the hospital without administrators.
  SELECT count(*) INTO v_supers FROM public."User"
   WHERE lower(role) IN ('superadmin', 'super_admin') AND is_active AND id <> v_live;
  IF v_supers < 3 THEN
    RAISE EXCEPTION 'ABORT: only % other active superadmin(s) would remain', v_supers;
  END IF;

  -- Moving the roster row must not orphan a real handover.
  SELECT count(*) INTO v_hist FROM public.cash_handovers
   WHERE from_user_id = v_dorm OR to_user_id = v_dorm;
  IF v_hist > 0 THEN
    RAISE EXCEPTION 'ABORT: the dormant account has % handover(s) — moving its roster row would orphan them', v_hist;
  END IF;

  -- 1. The role.
  UPDATE public."User" SET role = 'accountant' WHERE id = v_live;

  -- 2. The Google address moves to the account he signs in with.
  UPDATE public."User" SET google_email = NULL WHERE id = v_dorm;
  UPDATE public."User" SET google_email = 'shaileshninave37@gmail.com' WHERE id = v_live;

  -- 3. The cash roster row follows him. He verifies handovers; he does not
  --    hold a drawer, and must not, while he can verify.
  IF EXISTS (SELECT 1 FROM public.cash_handover_verifiers WHERE user_id = v_live) THEN
    UPDATE public.cash_handover_verifiers
       SET can_verify = true, is_active = true, updated_at = now()
     WHERE user_id = v_live;
    DELETE FROM public.cash_handover_verifiers WHERE user_id = v_dorm;
  ELSE
    UPDATE public.cash_handover_verifiers
       SET user_id = v_live,
           display_name = COALESCE((SELECT full_name FROM public."User" WHERE id = v_live), display_name),
           updated_at = now()
     WHERE user_id = v_dorm;
  END IF;
END
$change$;

DO $verify$
DECLARE
  v_live UUID := '8ee5788d-eb91-4764-8a9d-edc21b0cd647';
  v_dorm UUID := '8e03be25-906e-4293-8bf5-59f6b6618cdd';
  v_role TEXT; v_google TEXT; v_n INT;
BEGIN
  SELECT lower(btrim(role)), lower(btrim(COALESCE(google_email, '')))
    INTO v_role, v_google FROM public."User" WHERE id = v_live;

  -- The instruction itself.
  IF v_role IN ('superadmin', 'super_admin') THEN
    RAISE EXCEPTION 'ABORT: he is still a superadmin';
  END IF;
  IF v_role <> 'accountant' THEN
    RAISE EXCEPTION 'ABORT: his role is %, expected accountant', v_role;
  END IF;

  -- He must still be able to sign in every way he could before, plus the new one.
  SELECT count(*) INTO v_n FROM public.lookup_user_by_email('shailesh@gmail.com');
  IF v_n <> 1 THEN RAISE EXCEPTION 'ABORT: shailesh@gmail.com no longer resolves'; END IF;
  IF v_google <> 'shaileshninave37@gmail.com' THEN
    RAISE EXCEPTION 'ABORT: his google address is "%"', v_google;
  END IF;
  SELECT count(*) INTO v_n FROM public.lookup_user_by_email('shaileshninave37@gmail.com');
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'ABORT: the new address resolves to % accounts, expected exactly 1', v_n;
  END IF;

  -- Cash screens must open for the account he actually uses.
  IF NOT public.can_use_cash_handover(v_live) THEN
    RAISE EXCEPTION 'ABORT: Shailesh cannot open the cash tiles from his own login';
  END IF;

  -- One roster row for one person, and he must not be able to hand over.
  SELECT count(*) INTO v_n FROM public.cash_handover_verifiers WHERE user_id IN (v_live, v_dorm);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'ABORT: he has % roster rows across his accounts, expected 1', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.cash_handover_verifiers
   WHERE user_id = v_live AND can_hand_over;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'ABORT: he can hand over as well as verify';
  END IF;

  -- The dormant login must no longer carry his Google address.
  SELECT count(*) INTO v_n FROM public."User"
   WHERE id = v_dorm AND COALESCE(google_email, '') <> '';
  IF v_n > 0 THEN
    RAISE EXCEPTION 'ABORT: the dormant account still holds a google address';
  END IF;

  -- And the hospital still has administrators.
  SELECT count(*) INTO v_n FROM public."User"
   WHERE lower(role) IN ('superadmin', 'super_admin') AND is_active;
  IF v_n < 3 THEN
    RAISE EXCEPTION 'ABORT: only % active superadmin(s) remain', v_n;
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
