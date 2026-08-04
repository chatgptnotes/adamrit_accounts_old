-- Merge every exact-duplicate ledger, in every company.
--
-- The audit found 41 active groups where one company holds two ledgers with
-- the same name (ignoring case, spacing and punctuation) — 80 of the 82 are
-- DRM patient debtors that exist once from the Tally import (DRMFRESH_…)
-- and once as the app's own patient ledger (PTUH…).
--
-- Survivor policy, in order:
--   1. the app-generated patient ledger (code PT…) — triggers derive it from
--      the visit code, so deactivating it would just recreate the duplicate;
--   2. the ledger with more transactions;
--   3. the ledger with an opening balance (the Tally book of record);
--   4. the older row.
-- The loser's entries, references and opening balance fold into the survivor
-- via the audited merge_ledger(), and the loser remains as an inactive
-- "(merged …)" stub. Nothing is deleted.
--
-- Different SPELLINGS of one party (Dr Murali / Dr Murali sir) are not
-- touched here — those need a human to say they are the same person.
--
-- Run in the Supabase dashboard SQL Editor. Safe to run twice.

BEGIN;

-- merge_ledger, extended with the reference columns added since 3-Aug.
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
  UPDATE public.payment_obligations SET chart_of_accounts_id = p_survivor WHERE chart_of_accounts_id = p_loser;
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
  -- References added on 4-Aug.
  BEGIN
    UPDATE public.expense_bills SET party_ledger_id = p_survivor WHERE party_ledger_id = p_loser;
    UPDATE public.expense_bills SET expense_ledger_id = p_survivor WHERE expense_ledger_id = p_loser;
  EXCEPTION WHEN undefined_table THEN NULL; END;
  BEGIN
    UPDATE public.relationship_managers SET ledger_account_id = p_survivor WHERE ledger_account_id = p_loser;
  EXCEPTION WHEN undefined_column THEN NULL; END;
  BEGIN
    UPDATE public.daily_payment_schedule SET debit_account_id = p_survivor WHERE debit_account_id = p_loser;
    UPDATE public.daily_payment_schedule SET credit_account_id = p_survivor WHERE credit_account_id = p_loser;
  EXCEPTION WHEN undefined_column THEN NULL; END;
  BEGIN
    UPDATE public.cathlab_technicians SET party_account_id = p_survivor WHERE party_account_id = p_loser;
  EXCEPTION WHEN undefined_table THEN NULL; WHEN undefined_column THEN NULL; END;

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

-- ------------------------------------------------------------------
-- Merge every same-company, same-normalized-name group of active ledgers.
-- ------------------------------------------------------------------
DO $$
DECLARE
  grp    RECORD;
  member RECORD;
  v_survivor UUID;
  v_merged   INTEGER := 0;
  v_groups   INTEGER := 0;
BEGIN
  FOR grp IN
    SELECT company_id,
           lower(btrim(regexp_replace(account_name, '[^a-zA-Z0-9]+', ' ', 'g'))) AS norm_name
      FROM public.chart_of_accounts
     WHERE is_active
       AND btrim(regexp_replace(account_name, '[^a-zA-Z0-9]+', ' ', 'g')) <> ''
     GROUP BY 1, 2
    HAVING count(*) > 1
  LOOP
    SELECT a.id INTO v_survivor
      FROM public.chart_of_accounts a
      LEFT JOIN LATERAL (
        SELECT count(*) AS entries FROM public.voucher_entries e WHERE e.account_id = a.id
      ) tx ON true
     WHERE a.is_active
       AND a.company_id IS NOT DISTINCT FROM grp.company_id
       AND lower(btrim(regexp_replace(a.account_name, '[^a-zA-Z0-9]+', ' ', 'g'))) = grp.norm_name
     ORDER BY (a.account_code LIKE 'PT%') DESC,
              tx.entries DESC,
              (COALESCE(a.opening_balance, 0) <> 0) DESC,
              a.created_at ASC NULLS LAST,
              a.account_code ASC
     LIMIT 1;

    v_groups := v_groups + 1;
    FOR member IN
      SELECT a.id
        FROM public.chart_of_accounts a
       WHERE a.is_active
         AND a.id <> v_survivor
         AND a.company_id IS NOT DISTINCT FROM grp.company_id
         AND lower(btrim(regexp_replace(a.account_name, '[^a-zA-Z0-9]+', ' ', 'g'))) = grp.norm_name
    LOOP
      PERFORM public.merge_ledger(member.id, v_survivor);
      v_merged := v_merged + 1;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Merged % duplicate ledger(s) across % group(s)', v_merged, v_groups;
END $$;

-- What is left: expect zero rows.
SELECT company_id,
       lower(btrim(regexp_replace(account_name, '[^a-zA-Z0-9]+', ' ', 'g'))) AS name,
       count(*)
  FROM public.chart_of_accounts
 WHERE is_active
 GROUP BY 1, 2
HAVING count(*) > 1
 ORDER BY 3 DESC;

COMMIT;
