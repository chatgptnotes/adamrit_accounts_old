-- Dr Javed appears twice in the RMO list. Leave one.
--
-- THE COMPLAINT (17 Aug, Dr M): "why is Dr Javed repeated twice? RMO javed
-- should have only one ledger".
--
-- WHAT IS ACTUALLY DOUBLED. Not the ledger -- the RMO master. hope_rmos holds
-- two rows for the same man:
--
--   "Dr Javed"       created 2-Apr, a bare stub: no emp id, no qualification,
--                    no designation, no registration number, no shift rates
--   "Dr. Javed Khan" created 2-Aug, the real record: emp id H008, B.H.M.S,
--                    designation RMO, registration 61356, Non-Allopathic
--
-- BOTH ALREADY POINT AT THE SAME LEDGER (20956942..., DRMFRESH_000456 in DRM
-- Hope Hospital Private Limited), so there is nothing to merge and no balance
-- moves. He is picked twice in the RMO search, which is what Dr M is seeing.
--
-- WHICH ONE SURVIVES. The full one. Every RMO duty bill raised for him names
-- "DR JAVED KHAN" -- four duty bills on the Javed roster, 10 to 13 Aug. The
-- stub has been used once, for an OT payable on 12-Aug.
--
-- DEACTIVATED, NOT DELETED. approval_queue records the party by NAME as free
-- text, so the one bill raised against the stub keeps its name and its history
-- either way. Deactivating takes the duplicate out of the picker while leaving
-- it recoverable if it turns out to be somebody else after all; a DELETE would
-- not be. Nothing about the surviving row is edited.
--
-- THE OTHER "Dr. Javed Khan" LEDGERS ARE NOT TOUCHED. The chart of accounts
-- carries an RMO Salary ledger for him in three companies -- Ayushman
-- (opening 7,11,900), Hope Hospitals (5,19,400) and DRM Hope (50,000). That is
-- the multi-company structure working as designed, the same way cash and bank
-- ledger names legitimately repeat across companies, and those openings came
-- from the Tally restatement. Merging them would move lakhs between companies'
-- books and is emphatically not what "one ledger" means here.

DO $change$
DECLARE
  v_stub UUID := 'dae27b3c-5c0f-4b7b-9a2e-7676bc4df79f';
  v_real UUID := '3e303927-4410-4cd2-925f-a1302e9ba14a';
  v_stub_ledger UUID;
  v_real_ledger UUID;
BEGIN
  SELECT ledger_account_id INTO v_stub_ledger FROM public.hope_rmos WHERE id = v_stub;
  SELECT ledger_account_id INTO v_real_ledger FROM public.hope_rmos WHERE id = v_real;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ABORT: the surviving Javed record (%) is not there', v_real;
  END IF;

  -- If the two ever pointed at DIFFERENT ledgers, retiring one would silently
  -- change which ledger his duty posts to. Refuse rather than guess.
  IF v_stub_ledger IS DISTINCT FROM v_real_ledger THEN
    RAISE EXCEPTION
      'ABORT: the two Javed rows point at different ledgers (% vs %) -- this needs a decision, not a migration',
      v_stub_ledger, v_real_ledger;
  END IF;

  UPDATE public.hope_rmos
     SET is_active = false, updated_at = now()
   WHERE id = v_stub;
END
$change$;

DO $verify$
DECLARE
  v_active INT;
  v_name TEXT;
  v_emp TEXT;
  v_ledger UUID;
BEGIN
  SELECT count(*) INTO v_active
    FROM public.hope_rmos
   WHERE is_active AND lower(name) LIKE '%javed%';
  IF v_active <> 1 THEN
    RAISE EXCEPTION 'ABORT: % active Javed record(s), expected exactly 1', v_active;
  END IF;

  SELECT name, emp_id, ledger_account_id INTO v_name, v_emp, v_ledger
    FROM public.hope_rmos
   WHERE is_active AND lower(name) LIKE '%javed%';

  -- The one left standing must be the complete record, not the stub.
  IF v_emp IS DISTINCT FROM 'H008' THEN
    RAISE EXCEPTION 'ABORT: the surviving record is "%" with emp_id % -- the stub was kept', v_name, v_emp;
  END IF;

  -- And he must still have his ledger, or his duty cannot post at all.
  IF v_ledger IS NULL THEN
    RAISE EXCEPTION 'ABORT: the surviving Javed record has no ledger';
  END IF;

  -- No duty history may have been removed by this.
  SELECT count(*) INTO v_active
    FROM public.approval_queue
   WHERE party_name ILIKE '%javed%' AND status <> 'REJECTED';
  IF v_active < 4 THEN
    RAISE EXCEPTION 'ABORT: only % of his bills remain, expected at least 4', v_active;
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
