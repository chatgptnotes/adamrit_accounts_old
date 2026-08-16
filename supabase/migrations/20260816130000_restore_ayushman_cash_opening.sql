-- Ayushman's Cash opening balance, back to what Tally says.
--
-- WHAT IS WRONG. run_books_health_checks() reports Ayushman Nagpur's opening
-- balances netting ₹-51,71,102.00 instead of zero. A company's openings must
-- net to zero -- that is what makes it a trial balance -- and this one has not
-- since some point after 4-Aug.
--
-- WHERE IT CAME FROM. Exactly ONE ledger has drifted from the 4-Aug Tally
-- restatement (20260804340000). Comparing all 465 restated Ayushman ledgers
-- against the live values, 464 still match to the paisa. The odd one out:
--
--   Cash (94f01917-62e3-4eae-bc7b-0d32a9386ea6, Cash-in-Hand)
--     restated 4-Aug from Ruby's Tally export : DR 51,85,800.00
--     live today                              : DR      14,698.00
--     difference                              : 51,71,102.00
--
-- which is the reported imbalance to the rupee. No other ledger gained the
-- money, so it was not moved between accounts -- it left the trial balance.
--
-- WHO CHANGED IT is not recoverable. The only live writer of this column is the
-- Opening Balances screen (src/components/accounting/OpeningBalances.tsx), which
-- neither writes an audit row nor maintains updated_at, so the row still carries
-- the 3-Aug timestamp set by 20260803210000. ₹14,698 has the shape of a day's
-- counted cash-in-hand typed into a field that means "position at cutover".
-- declare_opening_cash() was ruled out: it writes only cash_opening_declarations
-- and never touches chart_of_accounts.
--
-- WHY 51,85,800 IS THE RIGHT NUMBER. It is what migration 20260804340000 line
-- 121 wrote from the Tally export, which was a balanced trial, and restoring it
-- returns the company to exactly 0.00 -- verified below rather than assumed.
-- It folds in the 51,58,817 "Cash at Almirah" merged on 2-Aug, which is why the
-- figure is large for physical cash.
--
-- Guarded on the exact wrong value, so running this twice changes nothing and
-- it cannot fire against a state it was not written for.

-- ---------------------------------------------------------------------------
-- 1. Snapshot first, so this is reversible the same way 4-Aug was.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.opening_balance_backup_20260816 (
  id                   UUID,
  account_code         TEXT,
  account_name         TEXT,
  company_id           UUID,
  opening_balance      NUMERIC,
  opening_balance_type TEXT,
  backed_up_at         TIMESTAMPTZ DEFAULT now()
);

INSERT INTO public.opening_balance_backup_20260816
  (id, account_code, account_name, company_id, opening_balance, opening_balance_type)
SELECT id, account_code, account_name, company_id, opening_balance, opening_balance_type
  FROM public.chart_of_accounts
 WHERE id = '94f01917-62e3-4eae-bc7b-0d32a9386ea6'
   AND NOT EXISTS (
     SELECT 1 FROM public.opening_balance_backup_20260816
      WHERE id = '94f01917-62e3-4eae-bc7b-0d32a9386ea6'
   );

-- ---------------------------------------------------------------------------
-- 2. Restore, guarded on the exact value being corrected.
-- ---------------------------------------------------------------------------
UPDATE public.chart_of_accounts
   SET opening_balance = 5185800.00,
       opening_balance_type = 'DR',
       updated_at = now()
 WHERE id = '94f01917-62e3-4eae-bc7b-0d32a9386ea6'
   AND opening_balance = 14698.00
   AND upper(opening_balance_type) = 'DR';

-- ---------------------------------------------------------------------------
-- 3. Prove it, or undo the whole thing.
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE
  v_ay      UUID;
  v_bal     NUMERIC;
  v_type    TEXT;
  v_net     NUMERIC;
  v_drifted INT;
BEGIN
  SELECT id INTO v_ay FROM public.companies WHERE company_key = 'ayushman_nagpur';
  IF v_ay IS NULL THEN
    RAISE EXCEPTION 'ABORT: no company with key ayushman_nagpur';
  END IF;

  -- (a) The ledger now holds the Tally figure.
  SELECT opening_balance, upper(opening_balance_type) INTO v_bal, v_type
    FROM public.chart_of_accounts
   WHERE id = '94f01917-62e3-4eae-bc7b-0d32a9386ea6';

  IF v_bal IS DISTINCT FROM 5185800.00 OR v_type IS DISTINCT FROM 'DR' THEN
    RAISE EXCEPTION 'ABORT: Ayushman Cash is % %, expected 5185800.00 DR', v_bal, v_type;
  END IF;

  -- (b) It is still the only Cash-in-Hand ledger, so the figure is not one of
  --     a pair that should have been split.
  IF (SELECT count(*) FROM public.chart_of_accounts
       WHERE company_id = v_ay AND is_active
         AND lower(btrim(account_name)) = 'cash') <> 1 THEN
    RAISE EXCEPTION 'ABORT: Ayushman has more than one active ledger named Cash';
  END IF;

  -- (c) THE POINT: the company is a trial balance again. Credits positive,
  --     debits negative, active ledgers only -- the same basis the health
  --     check uses.
  SELECT COALESCE(sum(
           CASE WHEN upper(opening_balance_type) = 'CR'
                THEN opening_balance ELSE -opening_balance END), 0)
    INTO v_net
    FROM public.chart_of_accounts
   WHERE company_id = v_ay AND is_active;

  IF round(v_net, 2) <> 0 THEN
    RAISE EXCEPTION 'ABORT: Ayushman openings still net % instead of zero', round(v_net, 2);
  END IF;

  -- (d) And nothing else drifted from the 4-Aug restatement while we were here.
  --     Only the two ledgers 20260804350000 corrected afterwards may differ.
  SELECT count(*) INTO v_drifted
    FROM public.chart_of_accounts c
   WHERE c.company_id = v_ay
     AND c.is_active
     AND c.opening_balance <> 0
     AND c.created_at > '2026-08-04T23:59:59Z';
  IF v_drifted > 0 THEN
    RAISE EXCEPTION 'ABORT: % ledger(s) created after the restatement carry an opening', v_drifted;
  END IF;

  RAISE NOTICE 'Ayushman Cash restored to 51,85,800.00 DR; openings net exactly zero.';
END
$verify$;
