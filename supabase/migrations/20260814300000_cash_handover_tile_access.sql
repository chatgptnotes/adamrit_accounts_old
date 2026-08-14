-- Open the Cash Handover tile to Chetna, Siddhanth and Diksha.
--
-- Access is by NAME, not by role: the people who work a drawer are a
-- receptionist, a pharmacist and an administrator, and no single role covers
-- them. can_use_cash_handover() opens the tile for anyone on the roster with
-- at least one right, or for anyone whose role is cashier.
--
-- WHAT IS GRANTED, AND WHAT IS NOT
--
-- can_hand_over only. That is the Nisha Sharma / Farhan pattern already on the
-- roster: open the tile, count your own drawer and pass it on. It does NOT
-- grant can_receive (taking custody of somebody else's cash) or can_verify
-- (signing off a count), because "access to the tile" is not the same request
-- as "authority over other people's money", and the whole point of this module
-- is that those are different people.
--
-- WHO IS NOT IN THIS SCRIPT, AND WHY
--
--   * Farhan already holds can_hand_over at hope. Nothing to do.
--   * Abuzar the cashier already passes on the cashier role alone. Nothing to
--     do. A second person, abuzar qureshi (superadmin, ayushman), does NOT
--     have access -- which of the two was meant is a question for Dr M, so
--     neither is touched here.
--
-- Diksha is Diksha Sakhare, the receptionist -- the same diksha@gmail.com that
-- accounting-access.ts and officeTileAccess.ts already name as front-office
-- accounting staff. The other Diksha on the system, diksha chauhan, is a nurse
-- at Ayushman and is not front-office.
--
-- Scoped '*' rather than to one hospital. The tile check ignores scope, so
-- this only decides which counter they may hand over AT, and the handover
-- screen already scopes the drawer to the person's own hospital. A specific
-- scope guessed wrong locks someone out of the drawer they are holding;
-- can_hand_over at '*' cannot reach cash they do not have.

DO $apply$
DECLARE
  v_row RECORD;
  v_wanted CONSTANT TEXT[] := ARRAY[
    'chetna@hopehospital.com',
    'siddhanth@hope.com',
    'diksha@gmail.com'
  ];
  v_email TEXT; v_id UUID; v_name TEXT; v_n INT;
BEGIN
  FOREACH v_email IN ARRAY v_wanted LOOP
    SELECT count(*) INTO v_n FROM public."User" WHERE lower(btrim(email)) = v_email;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'ABORT: % matches % accounts, not 1', v_email, v_n;
    END IF;

    SELECT id, COALESCE(full_name, email) INTO v_id, v_name
      FROM public."User" WHERE lower(btrim(email)) = v_email;

    -- Upsert by hand rather than through set_cash_handover_verifier, so that
    -- an existing row's can_receive / can_verify are preserved exactly. This
    -- script must never quietly take a right away from someone who has it.
    IF EXISTS (SELECT 1 FROM public.cash_handover_verifiers
                WHERE user_id = v_id AND hospital_type = '*') THEN
      UPDATE public.cash_handover_verifiers
         SET can_hand_over = true, is_active = true, display_name = v_name
       WHERE user_id = v_id AND hospital_type = '*';
    ELSE
      INSERT INTO public.cash_handover_verifiers
        (user_id, display_name, can_receive, can_verify, can_hand_over, is_active, hospital_type)
      VALUES (v_id, v_name, false, false, true, true, '*');
    END IF;
  END LOOP;
END
$apply$;

DO $verify$
DECLARE
  v_email TEXT; v_id UUID; v_ok BOOLEAN; v_bad INT;
  v_wanted CONSTANT TEXT[] := ARRAY[
    'chetna@hopehospital.com', 'siddhanth@hope.com', 'diksha@gmail.com'
  ];
BEGIN
  -- (a) each of them can now open the tile, asked exactly as the app asks it
  FOREACH v_email IN ARRAY v_wanted LOOP
    SELECT id INTO v_id FROM public."User" WHERE lower(btrim(email)) = v_email;
    IF NOT can_use_cash_handover(v_id) THEN
      RAISE EXCEPTION 'ABORT: % still cannot open the tile', v_email;
    END IF;
  END LOOP;

  -- (b) none of them gained authority over anyone else's cash
  SELECT count(*) INTO v_bad
    FROM public.cash_handover_verifiers v
    JOIN public."User" u ON u.id = v.user_id
   WHERE lower(btrim(u.email)) = ANY (v_wanted)
     AND (v.can_receive OR v.can_verify);
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'ABORT: % of them were given receive or verify rights', v_bad;
  END IF;

  -- (c) the people who already had access still do. Re-running this must not
  --     disturb the roster it is adding to.
  SELECT id INTO v_id FROM public."User" WHERE lower(btrim(email)) = 'farhan@hope.com';
  IF v_id IS NOT NULL AND NOT can_use_cash_handover(v_id) THEN
    RAISE EXCEPTION 'ABORT: Farhan lost the access he already had';
  END IF;

  SELECT count(*) INTO v_bad FROM public.cash_handover_verifiers
   WHERE can_verify AND display_name IN ('CMD', 'Shailesh', 'Ruby', 'Viji');
  IF v_bad < 4 THEN
    RAISE EXCEPTION 'ABORT: only % of the 4 verifiers still hold their right', v_bad;
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
