-- Two names spelled wrong since the Tally import.
--
--   "Nobal Scan Center"  -> "Noble Scan Center"
--   "Amapath Pathalogy"  -> "Empath Pathalogy"
--
-- Both exist as a ledger in each company's chart of accounts and as a row in
-- diagnostic_centres, and the two are matched by name in places, so they must
-- move together. Renaming the ledger keeps its id, so every voucher already
-- posted against it follows the new name — no balances move.
--
-- Applied through apply_migration(): one transaction, rolls back on failure.
-- Idempotent, and it verifies itself before committing.

-- The chart→Tally mirror trigger collides on rename when a ledger's mirror row
-- has drifted (tally_ledgers_accounting_account_uniq). Same fix the Tally
-- cutover used: drop the mirror rows for these ledgers first and let the
-- trigger rebuild them under the corrected name.
DELETE FROM public.tally_ledgers tl
 USING public.chart_of_accounts a
 WHERE tl.accounting_account_id = a.id
   AND lower(btrim(a.account_name)) IN ('nobal scan center', 'amapath pathalogy');

DELETE FROM public.tally_ledgers
 WHERE lower(btrim(name)) IN ('nobal scan center', 'amapath pathalogy');

UPDATE public.chart_of_accounts
   SET account_name = 'Noble Scan Center', updated_at = NOW()
 WHERE lower(btrim(account_name)) = 'nobal scan center';

UPDATE public.chart_of_accounts
   SET account_name = 'Empath Pathalogy', updated_at = NOW()
 WHERE lower(btrim(account_name)) = 'amapath pathalogy';

UPDATE public.diagnostic_centres
   SET name = 'Noble Scan Center'
 WHERE lower(btrim(name)) = 'nobal scan center';

UPDATE public.diagnostic_centres
   SET name = 'Empath Pathalogy'
 WHERE lower(btrim(name)) = 'amapath pathalogy';

DO $$
DECLARE
  v_old INTEGER;
  v_new INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_old
    FROM (
      SELECT account_name AS n FROM public.chart_of_accounts
      UNION ALL SELECT name FROM public.diagnostic_centres
    ) x
   WHERE lower(btrim(n)) IN ('nobal scan center', 'amapath pathalogy');
  IF v_old > 0 THEN
    RAISE EXCEPTION 'ABORT: % rows still carry the old spelling', v_old;
  END IF;

  SELECT COUNT(*) INTO v_new
    FROM (
      SELECT account_name AS n FROM public.chart_of_accounts
      UNION ALL SELECT name FROM public.diagnostic_centres
    ) x
   WHERE lower(btrim(n)) IN ('noble scan center', 'empath pathalogy');
  RAISE NOTICE 'OK — % rows now read Noble Scan Center / Empath Pathalogy', v_new;
END $$;
