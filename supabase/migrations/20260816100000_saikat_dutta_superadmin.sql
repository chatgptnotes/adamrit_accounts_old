-- Saikat Dutta becomes a super-admin.
--
-- Created two hours ago as 'user', the least this system grants, because only
-- his address had been given. Now asked for explicitly, so he gets the top
-- level: create accounts, change anybody's role including the other
-- super-admins', deactivate accounts, and see both hospitals.
--
-- hr_pulse_can_view_all is set alongside the role, not left behind. The admin
-- API derives that flag from the role on every create and update
-- (isSuperAdminRole), so a super-admin made in SQL without it would be the odd
-- one out -- top of the tree everywhere except HR Pulse, and nobody would think
-- to look for the difference.

DO $promote$
DECLARE v_id UUID; v_before TEXT;
BEGIN
  SELECT id, role INTO v_id, v_before
    FROM public."User" WHERE lower(email) = 'saikat.dutta@gmail.com';
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'ABORT: no account for saikat.dutta@gmail.com';
  END IF;

  UPDATE public."User"
     SET role = 'superadmin', hr_pulse_can_view_all = true
   WHERE id = v_id;

  RAISE NOTICE 'Saikat Dutta: % -> superadmin', v_before;
END
$promote$;

DO $verify$
DECLARE v_role TEXT; v_hr BOOLEAN; v_active BOOLEAN; v_admins INT;
BEGIN
  SELECT role, hr_pulse_can_view_all, is_active INTO v_role, v_hr, v_active
    FROM public."User" WHERE lower(email) = 'saikat.dutta@gmail.com';

  IF v_role <> 'superadmin' THEN
    RAISE EXCEPTION 'ABORT: role is %, expected superadmin', v_role;
  END IF;
  IF v_hr IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'ABORT: hr_pulse_can_view_all was not set, so this super-admin differs from every other';
  END IF;
  IF COALESCE(v_active, true) = false THEN
    RAISE EXCEPTION 'ABORT: the account is deactivated, so the role grants nothing';
  END IF;

  SELECT count(*) INTO v_admins FROM public."User"
   WHERE lower(role) IN ('superadmin', 'super_admin')
     AND COALESCE(is_active, true) <> false;
  RAISE NOTICE 'Active super-admins now: %', v_admins;
END
$verify$;

NOTIFY pgrst, 'reload schema';
