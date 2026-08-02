-- FIXED merge_ledger (Tally-mirror uniqueness) + the HOPE/Almirah fold.
CREATE OR REPLACE FUNCTION public.merge_ledger(p_loser UUID, p_survivor UUID)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_loser RECORD;
BEGIN
  IF p_loser = p_survivor THEN RETURN; END IF;
  SELECT * INTO v_loser FROM public.chart_of_accounts WHERE id = p_loser;
  IF NOT FOUND THEN RETURN; END IF;

  -- Every transaction moves to the survivor.
  UPDATE public.voucher_entries SET account_id = p_survivor WHERE account_id = p_loser;

  -- Every known reference follows.
  UPDATE public.approval_queue SET party_account_id = p_survivor WHERE party_account_id = p_loser;
  UPDATE public.approval_queue SET expense_account_id = p_survivor WHERE expense_account_id = p_loser;
  UPDATE public.chart_of_accounts SET beneficiary_of_bank_account_id = p_survivor WHERE beneficiary_of_bank_account_id = p_loser;
  UPDATE public.payment_obligations SET ledger_account_id = p_survivor WHERE ledger_account_id = p_loser;
  UPDATE public.hope_rmos SET ledger_account_id = p_survivor WHERE ledger_account_id = p_loser;
  UPDATE public.ayushman_rmos SET ledger_account_id = p_survivor WHERE ledger_account_id = p_loser;
  -- The Tally mirror is unique per (company, accounting account): repoint
  -- only where the survivor has no mirror there, drop the redundant rest.
  UPDATE public.tally_ledgers tl SET accounting_account_id = p_survivor
   WHERE tl.accounting_account_id = p_loser
     AND NOT EXISTS (SELECT 1 FROM public.tally_ledgers x
                      WHERE x.company_id = tl.company_id
                        AND x.accounting_account_id = p_survivor);
  DELETE FROM public.tally_ledgers WHERE accounting_account_id = p_loser;
  BEGIN
    UPDATE public.daily_revenue_entries SET rm_ledger_account_id = p_survivor WHERE rm_ledger_account_id = p_loser;
  EXCEPTION WHEN undefined_column THEN NULL; END;
  BEGIN
    UPDATE public.doctor_ledger_map SET party_account_id = p_survivor WHERE party_account_id = p_loser;
    UPDATE public.doctor_ledger_map SET expense_account_id = p_survivor WHERE expense_account_id = p_loser;
  EXCEPTION WHEN undefined_table THEN NULL; END;

  -- Fold the opening balance in, sign-aware (Dr positive).
  UPDATE public.chart_of_accounts s
     SET opening_balance = ABS(
           (COALESCE(s.opening_balance,0) * CASE WHEN UPPER(COALESCE(s.opening_balance_type,'DR'))='CR' THEN -1 ELSE 1 END)
         + (COALESCE(v_loser.opening_balance,0) * CASE WHEN UPPER(COALESCE(v_loser.opening_balance_type,'DR'))='CR' THEN -1 ELSE 1 END)
         ),
         opening_balance_type = CASE WHEN
           (COALESCE(s.opening_balance,0) * CASE WHEN UPPER(COALESCE(s.opening_balance_type,'DR'))='CR' THEN -1 ELSE 1 END)
         + (COALESCE(v_loser.opening_balance,0) * CASE WHEN UPPER(COALESCE(v_loser.opening_balance_type,'DR'))='CR' THEN -1 ELSE 1 END)
           < 0 THEN 'CR' ELSE 'DR' END
   WHERE s.id = p_survivor;

  -- The loser survives only as an inactive audit stub.
  UPDATE public.chart_of_accounts
     SET is_active = false,
         opening_balance = 0,
         account_name = account_name || ' (merged ' || to_char(now(),'DD Mon YY') || ')'
   WHERE id = p_loser;
END $$;

-- Per the owner's decision: "Cash (HOPE)" and "Cash at Almirah" are the same
-- cash as each company's "Cash". Fold both in with the audited merge.
DO $$
DECLARE company RECORD; survivor UUID; loser RECORD;
BEGIN
  FOR company IN SELECT DISTINCT company_id FROM public.chart_of_accounts
                  WHERE company_id IS NOT NULL LOOP
    SELECT id INTO survivor FROM public.chart_of_accounts
     WHERE company_id = company.company_id AND is_active
       AND lower(btrim(account_name)) = 'cash'
     ORDER BY created_at LIMIT 1;
    IF survivor IS NULL THEN CONTINUE; END IF;
    FOR loser IN
      SELECT id FROM public.chart_of_accounts
       WHERE company_id = company.company_id AND is_active AND id <> survivor
         AND regexp_replace(lower(btrim(account_name)), '[^a-z]', '', 'g')
             IN ('cashhope', 'cashatalmirah')
    LOOP
      PERFORM public.merge_ledger(loser.id, survivor);
    END LOOP;
  END LOOP;
END $$;
NOTIFY pgrst, 'reload schema';
