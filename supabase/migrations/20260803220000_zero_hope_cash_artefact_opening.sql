-- Hope Hospitals' Cash opening: an import artefact, zeroed.
--
-- Hope Hospitals' (partnership) Cash ledger carried 51,82,806 CR - the exact
-- figure of Ayushman's two Tally cash ledgers combined (Cash 23,989 Dr +
-- Cash at Almirah 51,58,817 Dr), duplicated into the wrong company's books
-- by the opening-balance import. Both Hope partnership Tally companies have
-- zero ledgers in the tally_ledgers mirror (never synced), so no true figure
-- exists to load; the ledger also has zero voucher entries, so nothing rides
-- on the opening. Zeroed until Hope's Tally openings are actually loaded -
-- same treatment as Hope's Saraswat Bank in 20260803210000.

UPDATE chart_of_accounts
   SET opening_balance = 0,
       opening_balance_type = 'DR',
       updated_at = NOW()
 WHERE id = '49794722-6793-4b73-be9f-64ebab50ade4'  -- Cash, Hope Hospitals
   AND opening_balance = 5182806.0
   AND opening_balance_type = 'CR';

DO $report$
DECLARE r RECORD;
BEGIN
  SELECT account_name, opening_balance, opening_balance_type INTO r
    FROM chart_of_accounts
   WHERE id = '49794722-6793-4b73-be9f-64ebab50ade4';
  RAISE NOTICE 'Hope Hospitals %: % %', r.account_name, r.opening_balance, r.opening_balance_type;
END $report$;
