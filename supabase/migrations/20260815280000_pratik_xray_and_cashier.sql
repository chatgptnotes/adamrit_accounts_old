-- Pratik Vyankat: X-ray, and the cash drawer as well.
--
-- CORRECTION TO WHAT WAS SAID EARLIER. I told Dr M that Pratik could not see
-- Radiology because his role is 'receptionist'. That was wrong, and the reason
-- is worth writing down: the list ['radiology', 'radiology_tech'] in
-- useMenuItems.ts is BADGE_ROLE_MAP, which decides who sees the little count
-- number on the tab -- not who may open it. The /radiology route has no guard,
-- the page has no role check, and the sidebar entry is gated on the hospital
-- having radiology enabled, not on the person's role. He could open X-ray all
-- along.
--
-- So the role change does less than it sounds like, and that is fine. What it
-- actually does:
--
--   GAINS  his landing page after sign-in becomes /radiology instead of
--          /patient-dashboard, and the Radiology count badge appears
--   LOSES  the count badges on Patient Dashboard and Patients
--          (useCounts.ts canSeePatients lists receptionist, not radiology_tech)
--
-- The screens themselves are unchanged either way. Nothing gates on
-- 'receptionist' anywhere except those badges and the landing route.
--
-- THE CASHIER HALF IS THE PART THAT WAS ACTUALLY MISSING. Pratik has no row in
-- cash_handover_verifiers at all -- can_use_cash_handover() returns false, so
-- he cannot open the tile today. Dr M's "in addition to being a cashier" reads
-- as a statement of fact, but the system does not agree, so this adds him.
--
-- Access is by NAME, not by role, exactly so this pair can coexist: a person
-- holds one role and Pratik's has to be the one his day job needs. Making him
-- 'cashier' would have given him the drawer and taken away X-ray. The roster
-- is what makes "X-ray AND cashier" possible at all.
--
-- Flags copied from the other counter cashiers -- Diksha, Nisha, Farhan and
-- Siddhant all carry hand_over=true and nothing else. He hands cash over; he
-- does not receive or verify anybody else's.

DO $apply$
DECLARE
  v_id UUID; v_n INT; v_name TEXT;
BEGIN
  SELECT count(*) INTO v_n FROM public."User" WHERE lower(btrim(email)) = 'pratik@gmail.com';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'ABORT: pratik@gmail.com matches % accounts, not 1', v_n;
  END IF;
  SELECT id, COALESCE(full_name, email) INTO v_id, v_name
    FROM public."User" WHERE lower(btrim(email)) = 'pratik@gmail.com';

  -- The Google address attached on 15 August must still be his, or this is a
  -- different Pratik than the one Dr M named.
  IF NOT EXISTS (SELECT 1 FROM public."User"
                  WHERE id = v_id
                    AND lower(btrim(COALESCE(google_email, ''))) = 'guruvyankat@gmail.com') THEN
    RAISE EXCEPTION 'ABORT: guruvyankat@gmail.com is not on this account';
  END IF;

  UPDATE public."User" SET role = 'radiology_tech' WHERE id = v_id;

  IF NOT EXISTS (SELECT 1 FROM public.cash_handover_verifiers WHERE user_id = v_id) THEN
    INSERT INTO public.cash_handover_verifiers
      (user_id, display_name, can_receive, can_verify, can_hand_over, is_active, hospital_type)
    VALUES (v_id, v_name, false, false, true, true, '*');
  ELSE
    UPDATE public.cash_handover_verifiers
       SET can_hand_over = true, is_active = true
     WHERE user_id = v_id;
  END IF;
END
$apply$;

DO $verify$
DECLARE
  v_id UUID; v_role TEXT; v_ok BOOLEAN;
BEGIN
  SELECT id, role INTO v_id, v_role FROM public."User"
   WHERE lower(btrim(email)) = 'pratik@gmail.com';

  IF v_role <> 'radiology_tech' THEN
    RAISE EXCEPTION 'ABORT: role is %, not radiology_tech', v_role;
  END IF;

  -- The point of the whole migration: both halves at once.
  SELECT can_use_cash_handover(v_id) INTO v_ok;
  IF v_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'ABORT: he has X-ray but still cannot open Cash Handover';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.cash_handover_verifiers
                  WHERE user_id = v_id AND can_hand_over AND is_active) THEN
    RAISE EXCEPTION 'ABORT: he is on the roster but cannot hand cash over';
  END IF;

  -- He hands over; he does not receive or verify. A cashier who can verify
  -- their own handover is the one arrangement this roster exists to prevent.
  IF EXISTS (SELECT 1 FROM public.cash_handover_verifiers
              WHERE user_id = v_id AND (can_receive OR can_verify)) THEN
    RAISE EXCEPTION 'ABORT: he was given receive or verify rights as well';
  END IF;
END
$verify$;
