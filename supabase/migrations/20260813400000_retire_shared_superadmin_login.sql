-- Retire the second shared login, and don't strand its cash.
--
-- superadmin@hospital.com is being used as two different people: the
-- shared-login report found "Abuzar" and "Diksha" both typed at the till under
-- it, 11 receipts and Rs 76,600 between them. Cash collected there cannot be
-- traced to a person, which is the same fault that stopped the first handovers
-- reconciling.
--
-- Switching it off first strands its cash on an account nobody can sign into,
-- exactly as retiring hope@gmail.com did. So the cash moves first, then the
-- account goes. Every cash row under it names Abuzar, and that name is the
-- evidence -- the same basis the owner approved for the earlier Rs 11,000.
--
-- Eight other active superadmin logins remain, CMD among them, so nobody is
-- locked out of administering the hospital.

DO $move$
DECLARE
  v_shared UUID; v_abuzar UUID; v_moved INT; v_amount NUMERIC;
BEGIN
  SELECT id INTO v_shared FROM public."User" WHERE lower(email) = 'superadmin@hospital.com';
  SELECT id INTO v_abuzar FROM public."User" WHERE lower(email) = 'abuzar@adamrit.com';
  IF v_shared IS NULL OR v_abuzar IS NULL THEN
    RAISE EXCEPTION 'ABORT: the shared login or Abuzar is missing';
  END IF;

  SELECT COALESCE(sum(advance_amount), 0) INTO v_amount
    FROM public.advance_payment
   WHERE collected_by_user_id = v_shared
     AND cash_handover_id IS NULL
     AND upper(btrim(COALESCE(payment_mode, ''))) = 'CASH'
     AND lower(btrim(COALESCE(billing_executive, ''))) = 'abuzar';

  UPDATE public.advance_payment
     SET collected_by_user_id = v_abuzar
   WHERE collected_by_user_id = v_shared
     AND cash_handover_id IS NULL
     AND upper(btrim(COALESCE(payment_mode, ''))) = 'CASH'
     AND lower(btrim(COALESCE(billing_executive, ''))) = 'abuzar';
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  RAISE NOTICE 'moved % cash receipt(s), Rs %, to Abuzar', v_moved, v_amount;

  -- Diksha's rows under this login are all ONLINE, so there is no drawer to
  -- strand; they are left as they are rather than moved on a guess.

  UPDATE public."User" SET is_active = false WHERE id = v_shared;
END
$move$;

DO $verify$
DECLARE v_shared UUID; v_left NUMERIC; v_active BOOLEAN; v_admins INT;
BEGIN
  SELECT id, is_active INTO v_shared, v_active
    FROM public."User" WHERE lower(email) = 'superadmin@hospital.com';

  IF v_active IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'ABORT: the shared login is still active';
  END IF;

  SELECT COALESCE(sum(advance_amount), 0) INTO v_left
    FROM public.advance_payment
   WHERE collected_by_user_id = v_shared
     AND cash_handover_id IS NULL
     AND upper(btrim(COALESCE(payment_mode, ''))) = 'CASH';
  IF v_left <> 0 THEN
    RAISE EXCEPTION 'ABORT: Rs % of cash is stranded on the retired login', v_left;
  END IF;

  -- Never leave the hospital without an administrator.
  SELECT count(*) INTO v_admins
    FROM public."User"
   WHERE lower(role) IN ('superadmin', 'super_admin')
     AND COALESCE(is_active, true) <> false;
  IF v_admins < 2 THEN
    RAISE EXCEPTION 'ABORT: only % active superadmin(s) would remain', v_admins;
  END IF;

  -- And it must no longer be able to sign in.
  IF EXISTS (SELECT 1 FROM lookup_user_by_email('superadmin@hospital.com')) THEN
    RAISE EXCEPTION 'ABORT: the retired login can still sign in';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
