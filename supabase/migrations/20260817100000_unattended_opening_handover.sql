-- Let the next shift start when the last one walked out without handing over.
--
-- THE COMPLAINT (17 Aug, from the owner). A cashier stands at a counter that
-- still carries the previous cashier's opening balance. declare_opening_cash
-- refuses -- "hand the drawer over first" -- but the person who must hand it
-- over is not there. The next shift is blocked by the absence of the last one.
--
-- WHY THE GUARD CANNOT SIMPLY GO. One live opening per counter is the rule the
-- whole module rests on: cash_opening_for SUMS live rows into expectedCash,
-- and claim_handover_sources claims EVERY live opening at the handover's
-- counter. Two live openings means the next handover swallows both -- which is
-- mechanically CH-260815-0016, the Rs 9,789 variance on a Rs 1,720 drawer
-- (20260815130000). The guard also closes a fraud door: without it, a short
-- drawer can be papered over by declaring a fresh, bigger baseline on top of
-- it, and the shortfall vanishes with no handover and no variance recorded.
--
-- WHAT THIS DOES INSTEAD. The next cashier's count of the drawer IS a handover
-- count -- the previous cashier just is not present for it. So: close the
-- absent cashier's session first, with a handover FROM them TO the person now
-- counting, counted at what was actually found; any shortfall lands as
-- variance on the absent cashier's own handover, where blind verification and
-- the directors' watchdog already look. Then, with the old opening claimed,
-- record the new cashier's opening exactly as before. One live opening per
-- counter stays true at every instant.
--
-- NOTHING LIVE IS REDEFINED. declare_opening_cash and submit_cash_handover
-- are CALLED, not rebuilt, so the rebuild-from-a-migration-file trap
-- (20260816240000's header, CLAUDE.md money rule 3) does not apply. The verify
-- block still asserts both live signatures first and aborts on any surprise.

-- CREATE OR REPLACE, not CREATE: this function was applied to the live
-- database on 17 Aug outside apply_migration and never recorded in
-- applied_migrations. The body below is byte-identical to what is already
-- there (md5 d89e7bec6dc0899a21695f00b3475e3a), so replacing it changes no
-- behaviour -- it re-runs the verify block through the proper path and puts
-- the file in the ledger where the next person will find it.
CREATE OR REPLACE FUNCTION public.declare_opening_cash_unattended(
  p_hospital_type TEXT, p_drawer NUMERIC, p_locker NUMERIC, p_user_id UUID,
  p_note TEXT DEFAULT NULL,
  p_locker_withdrawn NUMERIC DEFAULT 0, p_locker_deposited NUMERIC DEFAULT 0
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_hosp TEXT; v_me TEXT;
  v_prev_id UUID; v_prev_by UUID; v_prev_name TEXT; v_prev_amount NUMERIC;
  v_drawer NUMERIC := GREATEST(COALESCE(p_drawer, 0), 0);
  v_locker NUMERIC := GREATEST(COALESCE(p_locker, 0), 0);
  v_handover JSONB; v_decl JSONB;
BEGIN
  v_hosp := lower(btrim(COALESCE(p_hospital_type, '')));
  IF v_hosp = '' THEN RAISE EXCEPTION 'Which counter is this for?'; END IF;
  IF p_drawer IS NULL OR p_drawer < 0 THEN RAISE EXCEPTION 'Enter the cash counted'; END IF;

  SELECT COALESCE(full_name, email) INTO v_me FROM "User" WHERE id = p_user_id;
  IF v_me IS NULL THEN RAISE EXCEPTION 'Unknown user'; END IF;

  -- At most one row can match: cash_opening_one_live_per_counter guarantees it.
  SELECT id, declared_by, declared_by_name, amount
    INTO v_prev_id, v_prev_by, v_prev_name, v_prev_amount
    FROM cash_opening_declarations
   WHERE lower(btrim(hospital_type)) = v_hosp AND cash_handover_id IS NULL;

  -- No pending balance after all (it was handed over between the screen's
  -- check and this call): fall through to the ordinary declaration, so the
  -- caller never has to care which state it raced into.
  IF v_prev_id IS NULL THEN
    v_decl := declare_opening_cash(v_hosp, v_drawer + v_locker, p_user_id,
                                   p_note, p_locker_withdrawn, p_locker_deposited);
    RETURN v_decl || jsonb_build_object('unattended', false);
  END IF;

  -- Your own balance is not "unattended" -- the baseline already stands in
  -- your name, and a handover from you to you would record nothing real.
  IF v_prev_by = p_user_id THEN
    RAISE EXCEPTION 'This counter already holds your own opening balance. Hand the drawer over first.';
  END IF;

  -- Close the absent cashier's session at what was actually found. The
  -- denominations list is a single synthetic Rs 1 line so counted_cash equals
  -- the drawer figure exactly; a real note-by-note count did not happen and
  -- pretending otherwise would be invention. The variance reason is always
  -- given, because whatever the difference is, the one person who could
  -- explain it is not here.
  v_handover := submit_cash_handover(
    v_prev_by, p_user_id,
    jsonb_build_array(jsonb_build_object('denomination', 1, 'qty', v_drawer)),
    v_hosp,
    'Unattended handover: drawer counted by ' || v_me || ' at shift opening; '
      || COALESCE(v_prev_name, 'the previous cashier') || ' was not present.',
    true,
    'Recorded automatically when ' || v_me || ' declared opening cash over a pending balance.',
    NULL,        -- declared online: nobody present to declare it
    v_locker, 0, -- what was found in the locker; nothing banked here
    0, 0);       -- no locker movements in an unattended count

  -- The old opening is now claimed by that handover, so this passes the same
  -- guard every ordinary declaration passes. One live opening per counter,
  -- before and after.
  v_decl := declare_opening_cash(v_hosp, v_drawer + v_locker, p_user_id,
                                 p_note, p_locker_withdrawn, p_locker_deposited);

  RETURN v_decl || jsonb_build_object(
    'unattended', true,
    'handoverNo', v_handover->>'handoverNo',
    'previousBy', v_prev_name,
    'previousAmount', v_prev_amount,
    'variance', (v_handover->>'variance')::NUMERIC
  );
END $$;

REVOKE ALL ON FUNCTION public.declare_opening_cash_unattended(TEXT, NUMERIC, NUMERIC, UUID, TEXT, NUMERIC, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.declare_opening_cash_unattended(TEXT, NUMERIC, NUMERIC, UUID, TEXT, NUMERIC, NUMERIC) TO anon, authenticated;

DO $verify$
DECLARE
  v_sig TEXT; v_n INT;
  v_a UUID; v_b UUID;
  v_res JSONB; v_prev UUID; v_handover UUID;
  v_var NUMERIC; v_live INT; v_claimed INT;
BEGIN
  -- The two functions this one calls must be exactly the live signatures it
  -- was written against. Anything else means the database has moved since
  -- this migration was written: stop, look at pg_get_functiondef, rewrite.
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'declare_opening_cash';
  IF v_n <> 1 THEN RAISE EXCEPTION 'ABORT: % declare_opening_cash overloads, expected 1', v_n; END IF;
  SELECT pg_get_function_identity_arguments(p.oid) INTO v_sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'declare_opening_cash';
  IF v_sig <> 'p_hospital_type text, p_amount numeric, p_user_id uuid, p_note text, p_locker_withdrawn numeric, p_locker_deposited numeric' THEN
    RAISE EXCEPTION 'ABORT: declare_opening_cash signature drifted: %', v_sig;
  END IF;

  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'submit_cash_handover';
  IF v_n <> 1 THEN RAISE EXCEPTION 'ABORT: % submit_cash_handover overloads, expected 1', v_n; END IF;
  SELECT pg_get_function_identity_arguments(p.oid) INTO v_sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'submit_cash_handover';
  IF v_sig <> 'p_from_user_id uuid, p_to_user_id uuid, p_denominations jsonb, p_hospital_type text, p_variance_reason text, p_include_unattributed boolean, p_notes text, p_declared_online numeric, p_locker_cash numeric, p_bank_deposit numeric, p_locker_withdrawn numeric, p_locker_deposited numeric' THEN
    RAISE EXCEPTION 'ABORT: submit_cash_handover signature drifted: %', v_sig;
  END IF;

  -- Live rehearsal on a counter name no real drawer uses, torn down at the
  -- end. Scoped to the rows this block creates, nothing else.
  -- Both counterparts are PINNED. "WHERE id <> v_a LIMIT 1" would hand the
  -- rehearsal handover to whoever the planner returned first -- a real person,
  -- told to acknowledge cash that is about to be deleted.
  SELECT id INTO v_a FROM "User" WHERE lower(email) = 'cmd@hopehospital.com';
  SELECT id INTO v_b FROM "User" WHERE lower(email) = 'avni@gmail.com';
  IF v_a IS NULL OR v_b IS NULL OR v_a = v_b THEN
    RAISE EXCEPTION 'ABORT: need two distinct known users for the rehearsal';
  END IF;

  INSERT INTO cash_opening_declarations (hospital_type, amount, declared_by, declared_by_name)
  VALUES ('selftest-unatt', 500, v_a, 'Selftest Previous') RETURNING id INTO v_prev;

  -- The next cashier finds 450 in the drawer, nothing in the locker.
  v_res := declare_opening_cash_unattended('selftest-unatt', 450, 0, v_b, 'selftest');

  IF NOT (v_res->>'unattended')::boolean THEN
    RAISE EXCEPTION 'ABORT: pending balance was not treated as unattended';
  END IF;

  SELECT cash_handover_id INTO v_handover FROM cash_opening_declarations WHERE id = v_prev;
  IF v_handover IS NULL THEN
    RAISE EXCEPTION 'ABORT: the previous opening was not claimed by the unattended handover';
  END IF;

  SELECT variance INTO v_var FROM cash_handovers WHERE id = v_handover;
  IF round(v_var + 50, 2) <> 0 THEN
    RAISE EXCEPTION 'ABORT: variance %, expected -50 (450 found against 500 expected)', v_var;
  END IF;
  IF (SELECT from_user_id FROM cash_handovers WHERE id = v_handover) <> v_a
     OR (SELECT to_user_id FROM cash_handovers WHERE id = v_handover) <> v_b THEN
    RAISE EXCEPTION 'ABORT: the unattended handover is not from the absent cashier to the counter';
  END IF;

  SELECT count(*) INTO v_live FROM cash_opening_declarations
   WHERE hospital_type = 'selftest-unatt' AND cash_handover_id IS NULL;
  IF v_live <> 1 THEN
    RAISE EXCEPTION 'ABORT: % live opening(s) on the counter afterwards, expected exactly 1', v_live;
  END IF;

  -- A second unattended call by the SAME person over their own fresh balance
  -- must still be refused -- the fraud door stays shut.
  BEGIN
    PERFORM declare_opening_cash_unattended('selftest-unatt', 999, 0, v_b, 'selftest again');
    RAISE EXCEPTION 'ABORT: a cashier re-opened their own drawer at a bigger number';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%your own opening balance%' AND SQLERRM NOT LIKE '%ABORT%' THEN
      RAISE EXCEPTION 'ABORT: wrong refusal for a self re-open: %', SQLERRM;
    END IF;
    IF SQLERRM LIKE '%ABORT%' THEN RAISE; END IF;
  END;

  -- Tear-down, scoped to the rehearsal rows.
  --
  -- The notification FIRST, and it is not optional. Inserting a handover fires
  -- trg_notify_cash_handover (20260813350000), which tells the receiver to
  -- acknowledge the cash. Deleting the handover without it would leave a real
  -- person holding an alert for Rs 450 that never existed, pointing at a
  -- source_id that is gone.
  DELETE FROM notifications
   WHERE source_table = 'cash_handovers' AND source_id = v_handover::TEXT;
  DELETE FROM cash_handover_denominations WHERE handover_id = v_handover;
  DELETE FROM cash_handover_sources WHERE handover_id = v_handover;
  DELETE FROM cash_opening_declarations WHERE hospital_type = 'selftest-unatt';
  DELETE FROM cash_handovers WHERE id = v_handover;
  SELECT count(*) INTO v_n FROM cash_opening_declarations WHERE hospital_type = 'selftest-unatt';
  IF v_n > 0 THEN RAISE EXCEPTION 'ABORT: % rehearsal row(s) left behind', v_n; END IF;
  SELECT count(*) INTO v_n FROM notifications
   WHERE source_table = 'cash_handovers' AND source_id = v_handover::TEXT;
  IF v_n > 0 THEN RAISE EXCEPTION 'ABORT: % rehearsal notification(s) left behind', v_n; END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
