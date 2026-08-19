-- A QR payout can only auto-pick a real bank account.
--
-- FOUND WHILE LISTING THE QR PAYOUTS Dr M asked for (19 Aug). Of 27, three in
-- DRM Hope Hospital Private Limited credited "Bank Charges" — an INDIRECT
-- EXPENSES ledger. PV0866, PV0862 and PV0736, Rs 1,000 each, Rs 3,000 in total.
-- No bank was reduced and an expense account was credited instead.
--
-- WHY. The auto-pick reads
--
--     AND (lower(COALESCE(account_group, '')) LIKE '%bank%'
--          OR lower(account_name) LIKE '%bank%')
--     ORDER BY created_at LIMIT 1
--
-- and the second half of that OR matches on the NAME. In DRM Hope the ledgers
-- matching are Canara (Itwari), Canara Jaripatka, Pusad Urban, Saraswat,
-- Shikshak Sahakari — and also "Bank Charges" (Indirect Expenses), "Shilpa
-- Bankar" (Hope Salary Exp) and "Dr. Badal Bankar" (Consultant). Every one of
-- them was created on 23-Jul-26, so ORDER BY created_at is not a ranking at all;
-- it returned whichever row the planner reached first. It could as easily have
-- credited a consultant's own ledger as an expense one.
--
-- THE GROUP IS THE ONLY HONEST TEST. A ledger is a bank account because it is
-- filed under one, not because its name contains four letters. The name clause
-- goes. Cash keeps its own exact-name match, which was never ambiguous.
--
-- THE THREE VOUCHERS ARE NOT REPAIRED HERE. Which bank DRM Hope's QR settles
-- into is Dr M's to say, and moving Rs 3,000 to a bank of my choosing would be
-- the same mistake in the other direction. They are listed at the end so they
-- can be corrected deliberately.

CREATE OR REPLACE FUNCTION public.qr_payout_bank_ledger(p_company_id UUID)
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.chart_of_accounts
   WHERE company_id = p_company_id
     AND is_active
     -- Filed as a bank. NOT matched on the name: "Bank Charges" is an expense
     -- and "Dr. Badal Bankar" is a consultant, and both contain "bank".
     AND lower(COALESCE(account_group, '')) LIKE '%bank%'
   ORDER BY created_at, account_name
   LIMIT 1;
$$;

COMMENT ON FUNCTION public.qr_payout_bank_ledger(UUID) IS
  'The bank a QR payout credits when the caller names no account. Group-based: '
  'a name containing "bank" is not a bank account.';

REVOKE ALL ON FUNCTION public.qr_payout_bank_ledger(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.qr_payout_bank_ledger(UUID) TO anon, authenticated;

-- Patch the live body rather than restating 200 lines of it (rule 3).
DO $patch$
DECLARE
  v_src TEXT; v_new TEXT; v_n INT;
  -- NOTE ON QUOTING. pg_get_functiondef returns the body VERBATIM, so
  -- LIKE '%bank%' has ONE quote each side and COALESCE(account_group, '') has
  -- two (an empty-string literal). Inside this single-quoted pattern they must
  -- therefore be written '' and '''' respectively. Getting that wrong is what
  -- made the first attempt match nothing and abort (19 Aug) -- which is the
  -- guard doing its job, but it is worth writing down.
  v_pat TEXT := 'SELECT id INTO v_credit\s+FROM public\.chart_of_accounts\s+WHERE company_id = v_company\.company_id AND is_active\s+AND \(lower\(COALESCE\(account_group, ''''\)\) LIKE ''%bank%''\s+OR lower\(account_name\) LIKE ''%bank%''\)\s+ORDER BY created_at\s+LIMIT 1;';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'pay_doctor_services';
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'ABORT: pay_doctor_services is not in this database';
  END IF;

  IF v_src LIKE '%qr_payout_bank_ledger%' THEN
    RAISE NOTICE 'pay_doctor_services already uses the group-based picker';
    RETURN;
  END IF;

  SELECT count(*) INTO v_n FROM regexp_matches(v_src, v_pat, 'g');
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'ABORT: the QR auto-pick matched % times, expected 1', v_n;
  END IF;

  v_new := regexp_replace(v_src, v_pat, 'v_credit := public.qr_payout_bank_ledger(v_company.company_id);');
  EXECUTE v_new;
  RAISE NOTICE 'QR payouts now auto-pick a ledger filed as a bank, never one merely named like one';
END
$patch$;

-- ------------------------------------------------------------------ verify

DO $verify$
DECLARE v_drm UUID; v_ayu UUID; v_pick UUID; v_grp TEXT; v_src TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'pay_doctor_services';
  IF v_src NOT LIKE '%qr_payout_bank_ledger%' THEN
    RAISE EXCEPTION 'ABORT: the payout function still picks by name';
  END IF;
  -- The BANK mode added earlier today must survive this patch.
  IF v_src NOT LIKE '%bank account the transfer was made from%' THEN
    RAISE EXCEPTION 'ABORT: the bank-transfer mode has been lost';
  END IF;

  SELECT id INTO v_drm FROM public.companies WHERE company_key = 'drm_pvt_ltd';
  SELECT id INTO v_ayu FROM public.companies WHERE company_key = 'ayushman_nagpur';

  -- Whatever it picks must be filed as a bank, in both companies.
  FOREACH v_pick IN ARRAY ARRAY[public.qr_payout_bank_ledger(v_drm), public.qr_payout_bank_ledger(v_ayu)]
  LOOP
    IF v_pick IS NULL THEN
      RAISE EXCEPTION 'ABORT: a company has no bank-group ledger to fall back on';
    END IF;
    SELECT account_group INTO v_grp FROM public.chart_of_accounts WHERE id = v_pick;
    IF lower(COALESCE(v_grp, '')) NOT LIKE '%bank%' THEN
      RAISE EXCEPTION 'ABORT: the picker chose a % ledger', v_grp;
    END IF;
  END LOOP;
END
$verify$;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------- read it
-- The payouts that credited something that is not a bank. These need a
-- deliberate correction once Dr M says which account they were paid from.

SELECT v.voucher_number, v.voucher_date, c.company_name, v.total_amount,
       a.account_name AS credited, a.account_group AS filed_under
  FROM public.vouchers v
  JOIN public.companies c ON c.id = v.company_id
  JOIN public.voucher_entries e ON e.voucher_id = v.id AND e.credit_amount > 0
  JOIN public.chart_of_accounts a ON a.id = e.account_id
 WHERE v.narration LIKE 'Doctor payout%'
   AND lower(COALESCE(a.account_group, '')) NOT LIKE '%bank%'
   AND lower(COALESCE(a.account_group, '')) NOT LIKE '%cash%'
 ORDER BY v.voucher_date DESC;
