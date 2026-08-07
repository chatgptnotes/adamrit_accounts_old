-- Two supplier names spelled wrong in the pharmacy master.
--
--   SHRI SAI MEDICICAL STORES -> SHRI SAI MEDICAL STORES
--   JAY BABA MEDICAL STORS    -> JAY BABA MEDICAL STORES
--
-- Each exists twice: as the supplier row goods are received against, and as
-- the creditor ledger created for it in 20260807180000. Both move together,
-- or the name-matched pairing between them breaks. The ledger keeps its id,
-- so the accruals already posted against it follow the corrected name and no
-- balance moves.
--
-- The narration on the 12 vouchers already posted still reads as it did on
-- the day it was posted — that is the record of what was entered, and it is
-- deliberately left alone.
--
-- Applied through apply_migration(): one transaction, rolls back on failure.
-- Idempotent, and it verifies itself before committing.

-- The chart -> Tally mirror trigger collides on rename when a mirror row has
-- drifted from its ledger; clear any for these two first and let the trigger
-- rebuild them under the corrected name.
DELETE FROM public.tally_ledgers tl
 USING public.chart_of_accounts a
 WHERE tl.accounting_account_id = a.id
   AND lower(btrim(a.account_name)) IN ('shri sai medicical stores', 'jay baba medical stors');

DELETE FROM public.tally_ledgers
 WHERE lower(btrim(name)) IN ('shri sai medicical stores', 'jay baba medical stors');

UPDATE public.chart_of_accounts
   SET account_name = 'SHRI SAI MEDICAL STORES', updated_at = NOW()
 WHERE lower(btrim(account_name)) = 'shri sai medicical stores';

UPDATE public.chart_of_accounts
   SET account_name = 'JAY BABA MEDICAL STORES', updated_at = NOW()
 WHERE lower(btrim(account_name)) = 'jay baba medical stors';

UPDATE public.suppliers
   SET supplier_name = 'SHRI SAI MEDICAL STORES', updated_at = NOW()
 WHERE lower(btrim(supplier_name)) = 'shri sai medicical stores';

UPDATE public.suppliers
   SET supplier_name = 'JAY BABA MEDICAL STORES', updated_at = NOW()
 WHERE lower(btrim(supplier_name)) = 'jay baba medical stors';

DO $$
DECLARE
  v_old INTEGER;
  v_pairs INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_old
    FROM (
      SELECT supplier_name AS n FROM public.suppliers
      UNION ALL SELECT account_name FROM public.chart_of_accounts
      UNION ALL SELECT name FROM public.tally_ledgers
    ) x
   WHERE lower(btrim(n)) IN ('shri sai medicical stores', 'jay baba medical stors');
  IF v_old > 0 THEN
    RAISE EXCEPTION 'ABORT: % rows still carry the old spelling', v_old;
  END IF;

  -- Both suppliers must still point at a ledger whose name now matches.
  SELECT COUNT(*) INTO v_pairs
    FROM public.suppliers s
    JOIN public.chart_of_accounts a ON a.id = s.ledger_account_id
   WHERE lower(btrim(s.supplier_name)) IN ('shri sai medical stores', 'jay baba medical stores')
     AND lower(btrim(a.account_name)) = lower(btrim(s.supplier_name));
  IF v_pairs <> 2 THEN
    RAISE EXCEPTION 'ABORT: expected 2 supplier/ledger pairs to line up, found %', v_pairs;
  END IF;

  RAISE NOTICE 'OK — both names corrected in the supplier master and the ledger';
END $$;
