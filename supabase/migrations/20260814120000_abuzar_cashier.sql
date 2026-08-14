-- Abuzar becomes a cashier.
--
-- He was "billing" in Ayushman, which is where he already sat, so this only
-- names what he actually does: he holds a drawer. It matters for traceability
-- rather than for access -- the cash moved off the retired shared login
-- superadmin@hospital.com onto his account (20260813400000, Rs 76,600 across
-- 11 receipts) is the reason his name has to mean one person.
--
-- Lateral and low-risk: no hospital change, and billing was not an
-- administrative role, so nothing is being taken away that he was using.

DO $change$
DECLARE v_id UUID; v_before TEXT; v_hosp TEXT; v_hit INT;
BEGIN
  SELECT id, role, hospital_type INTO v_id, v_before, v_hosp
    FROM public."User" WHERE lower(email) = 'abuzar@adamrit.com';
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'ABORT: no account for abuzar@adamrit.com';
  END IF;
  IF v_hosp IS DISTINCT FROM 'ayushman' THEN
    RAISE EXCEPTION 'ABORT: expected Abuzar in ayushman, found %', v_hosp;
  END IF;

  UPDATE public."User" SET role = 'cashier' WHERE id = v_id;
  GET DIAGNOSTICS v_hit = ROW_COUNT;
  IF v_hit <> 1 THEN
    RAISE EXCEPTION 'ABORT: updated % row(s), expected 1', v_hit;
  END IF;

  RAISE NOTICE 'Abuzar: % -> cashier (ayushman)', v_before;
END
$change$;

DO $verify$
DECLARE v_role TEXT; v_hosp TEXT; v_active BOOLEAN;
BEGIN
  SELECT role, hospital_type, is_active INTO v_role, v_hosp, v_active
    FROM public."User" WHERE lower(email) = 'abuzar@adamrit.com';
  IF v_role <> 'cashier' OR v_hosp <> 'ayushman' THEN
    RAISE EXCEPTION 'ABORT: Abuzar is % in %, expected cashier in ayushman', v_role, v_hosp;
  END IF;
  IF COALESCE(v_active, true) = false THEN
    RAISE EXCEPTION 'ABORT: Abuzar was left deactivated';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
