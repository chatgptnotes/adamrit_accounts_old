-- Opening balances back on the side Tally has them.
--
-- The Tally opening-balance import flipped debit balances to CR: the
-- tally_ledgers mirror exports debits as negative (Ayushman's Cash is
-- -23,989 and Cash at Almirah -51,58,817 - cash cannot be in credit), and
-- the importer stamped the absolute value CR. Genuine credit balances
-- (Canara Jaripatka / Itwari, positive in the mirror) came through right,
-- which is why only some ledgers look wrong.
--
--   1. Ayushman Saraswat Bank: Tally says 2,01,059.66 Dr; Adamrit had CR.
--   2. Ayushman Cash: Tally has Cash 23,989 Dr + Cash at Almirah
--      51,58,817 Dr; Almirah folded into Cash on 02-Aug, so the merged
--      ledger's 51,82,806 stays - it just becomes DR.
--   3. Hope Hospitals Saraswat Bank: exists in NO Tally company (Tally has
--      Saraswat only in Ayushman, plus DRM at zero), so its 2,51,059.66 CR
--      opening is an import artefact. Zeroed, per the owner (2026-08-03).
--
-- Guarded on the current wrong values, so re-running changes nothing.

-- 1. Ayushman Saraswat Bank: CR -> DR
UPDATE chart_of_accounts
   SET opening_balance_type = 'DR',
       updated_at = NOW()
 WHERE id = 'f7bd244a-b8f6-4663-bf6b-761e1b6a71ff'
   AND opening_balance = 201059.66
   AND opening_balance_type = 'CR';

-- 2. Ayushman Cash (holds the 02-Aug Almirah fold): CR -> DR
UPDATE chart_of_accounts
   SET opening_balance_type = 'DR',
       updated_at = NOW()
 WHERE id = '94f01917-62e3-4eae-bc7b-0d32a9386ea6'
   AND opening_balance = 5182806.0
   AND opening_balance_type = 'CR';

-- 3. Hope Hospitals Saraswat Bank: no such opening in any Tally company
UPDATE chart_of_accounts
   SET opening_balance = 0,
       opening_balance_type = 'DR',
       updated_at = NOW()
 WHERE id = 'fbc08333-ef5b-49c7-9e19-1d84a99f43b5'
   AND opening_balance = 251059.66
   AND opening_balance_type = 'CR';

DO $report$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT account_name, company_id, opening_balance, opening_balance_type
      FROM chart_of_accounts
     WHERE id IN ('f7bd244a-b8f6-4663-bf6b-761e1b6a71ff',
                  '94f01917-62e3-4eae-bc7b-0d32a9386ea6',
                  'fbc08333-ef5b-49c7-9e19-1d84a99f43b5')
  LOOP
    RAISE NOTICE '% (company %): % %', r.account_name, r.company_id, r.opening_balance, r.opening_balance_type;
  END LOOP;
END $report$;
