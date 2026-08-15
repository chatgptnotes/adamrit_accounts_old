-- Undo this morning's crossed counters: re-file the pharmacy count, cancel the
-- handover that swallowed it, and put Farhan on the till he actually works.
--
-- WHAT HAPPENED, IN ORDER
--
--   09:47  Farhan counts the PHARMACY till, Rs 3,220. The Opening Cash tile
--          took the counter from his staff record, which says "hope", so it
--          was filed against Hope Hospital.
--   09:51  Diksha is refused -- "this counter already has an opening balance"
--          -- because Farhan's, four minutes old, was sitting on her counter.
--   10:47  Nisha hands over Hope's drawer. A handover claims every unclaimed
--          opening at its counter, so it swallowed the pharmacy's Rs 3,220.
--          CH-260815-0016: expected MINUS Rs 6,349 against Rs 1,720 counted,
--          a variance of Rs 9,789 on a Rs 1,720 drawer.
--   10:48  The Rs 1,720 goes in again, under Nisha's name rather than Diksha's.
--
-- The tile now asks which counter (commit 527cc87). This unpicks the damage.
--
-- THE ORDER OF THE THREE STEPS IS NOT ARBITRARY
--
-- cancel_cash_handover calls release_handover_sources, which un-claims the
-- opening. Cancel first and Farhan's Rs 3,220 lands back on "hope" beside
-- Nisha's live Rs 1,720 -- two live openings on one counter, which the unique
-- index cash_opening_one_live_per_counter forbids. The cancel would fail on a
-- constraint violation.
--
-- So the opening is re-filed to "pharmacy" FIRST, while it is still claimed and
-- the partial index (WHERE cash_handover_id IS NULL) does not apply to it. The
-- cancel then releases it onto the pharmacy, which has no live opening, and
-- Hope keeps Nisha's.
--
-- The end state is what should have been recorded this morning:
--   Hope      Rs 1,720 live (Nisha)
--   Pharmacy  Rs 3,220 live (Farhan)  -- his actual till count, on his till
--   CH-260815-0016 cancelled, its receipts released back into Hope's drawer
--
-- Cancelling is done through the RPC rather than by writing the row, so the
-- receipts and the opening are released by the same code a cashier's cancel
-- uses. The RPC only lets the submitter cancel; Nisha's id is passed because
-- it is her handover, on Dr M's instruction, and the reason recorded on the
-- row says so.

DO $apply$
DECLARE
  v_ho UUID; v_open UUID; v_nisha UUID; v_farhan UUID; v_res JSONB; v_n INT;
BEGIN
  SELECT id, from_user_id INTO v_ho, v_nisha
    FROM cash_handovers WHERE handover_no = 'CH-260815-0016';
  IF v_ho IS NULL THEN
    RAISE EXCEPTION 'ABORT: CH-260815-0016 not found';
  END IF;

  SELECT id INTO v_farhan FROM public."User" WHERE lower(btrim(email)) = 'farhan@hope.com';
  IF v_farhan IS NULL THEN RAISE EXCEPTION 'ABORT: Farhan not found'; END IF;

  -- 1. The pharmacy count, re-filed onto the pharmacy. Identified by the
  --    handover that claimed it plus the person who counted it, not by amount.
  SELECT id INTO v_open FROM cash_opening_declarations
   WHERE cash_handover_id = v_ho
     AND lower(btrim(hospital_type)) = 'hope'
     AND declared_by = v_farhan;
  IF v_open IS NULL THEN
    RAISE EXCEPTION 'ABORT: no Farhan opening claimed by this handover — the picture has changed';
  END IF;

  UPDATE cash_opening_declarations
     SET hospital_type = 'pharmacy',
         note = COALESCE(note, '') ||
                ' [re-filed from hope to pharmacy 15 Aug: counted at the pharmacy till,'
                || ' recorded against Hope because the tile took the counter from the staff record]'
   WHERE id = v_open;

  -- 2. Cancel, which now releases that opening onto the pharmacy.
  v_res := cancel_cash_handover(
    v_ho, v_nisha,
    'Cancelled on Dr M''s instruction: the Hope drawer had swallowed Hope Pharmacy''s '
    || 'opening cash of Rs 3,220, giving expected minus Rs 6,349 against Rs 1,720 counted. '
    || 'The pharmacy count has been re-filed to its own counter; hand Hope over again.');
  IF v_res->>'status' <> 'CANCELLED' THEN
    RAISE EXCEPTION 'ABORT: the handover did not cancel (%)', v_res;
  END IF;

  -- 3. Farhan works the pharmacy. His record said hope, which is what caused
  --    all of the above and would default him wrong again tomorrow.
  UPDATE public."User" SET hospital_type = 'pharmacy' WHERE id = v_farhan;
END
$apply$;

DO $verify$
DECLARE v_st TEXT; v_n INT; v_hope JSONB; v_ph JSONB; v_role TEXT; v_hosp TEXT;
BEGIN
  SELECT status INTO v_st FROM cash_handovers WHERE handover_no = 'CH-260815-0016';
  IF v_st <> 'CANCELLED' THEN
    RAISE EXCEPTION 'ABORT: the handover is still %', v_st;
  END IF;

  -- Each counter must end with exactly one live opening, its own.
  v_hope := cash_opening_state('hope');
  v_ph   := cash_opening_state('pharmacy');

  IF NOT (v_hope->>'declared')::boolean THEN
    RAISE EXCEPTION 'ABORT: Hope lost its opening entirely';
  END IF;
  IF round((v_hope->>'amount')::numeric, 2) <> 1720.00 THEN
    RAISE EXCEPTION 'ABORT: Hope reads % rather than 1,720 — the pharmacy money is still in it',
      v_hope->>'amount';
  END IF;
  IF NOT (v_ph->>'declared')::boolean THEN
    RAISE EXCEPTION 'ABORT: the pharmacy still has no opening';
  END IF;
  IF round((v_ph->>'amount')::numeric, 2) <> 3220.00 THEN
    RAISE EXCEPTION 'ABORT: the pharmacy reads % rather than 3,220', v_ph->>'amount';
  END IF;

  -- One live row per counter, which is the rule the whole tangle broke.
  SELECT count(*) INTO v_n FROM cash_opening_declarations
   WHERE cash_handover_id IS NULL AND lower(btrim(hospital_type)) = 'hope';
  IF v_n <> 1 THEN RAISE EXCEPTION 'ABORT: Hope has % live openings', v_n; END IF;
  SELECT count(*) INTO v_n FROM cash_opening_declarations
   WHERE cash_handover_id IS NULL AND lower(btrim(hospital_type)) = 'pharmacy';
  IF v_n <> 1 THEN RAISE EXCEPTION 'ABORT: the pharmacy has % live openings', v_n; END IF;

  -- Farhan is on his own till, and nothing else about him moved.
  SELECT role, hospital_type INTO v_role, v_hosp
    FROM public."User" WHERE lower(btrim(email)) = 'farhan@hope.com';
  IF v_hosp <> 'pharmacy' THEN
    RAISE EXCEPTION 'ABORT: Farhan is still on %', v_hosp;
  END IF;
  IF v_role <> 'pharmacist' THEN
    RAISE EXCEPTION 'ABORT: Farhan''s role changed to % — this must not touch it', v_role;
  END IF;
  IF NOT can_use_cash_handover((SELECT id FROM public."User" WHERE lower(btrim(email))='farhan@hope.com')) THEN
    RAISE EXCEPTION 'ABORT: Farhan lost Cash Handover access';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
