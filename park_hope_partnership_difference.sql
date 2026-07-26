-- Park the Hope Hospitals opening difference in Suspense, so the entity
-- balances and the unknown stays visible.
--
-- Hope Hospitals (the legacy partnership) carries opening balances that are
-- 64,41,538.58 credit-heavy. The other three companies balance exactly, and
-- every Adamrit voucher nets to zero, so this came in with the Tally import on
-- 25 July and was masked until the Tally merge was switched off.
--
-- IT IS NOT A SIGN ERROR. Flipping every marker that contradicts its account
-- type was tested and moves the total to -9,69,13,943.26 - fifteen times worse.
-- The markers are broadly right; something simply did not come across.
--
-- Identifying what is missing needs Tally's own trial balance for Hope
-- Hospitals as at 24 July 2026. Without it, any correction is a guess.
--
-- So this does the thing an accountant would do with an unexplained difference:
-- puts it in Suspense A/c. That is not a solution - it is the difference made
-- honest. The entity balances, the amount is named, and it sits in the one
-- account whose whole purpose is to say "we do not yet know".
--
-- mergedLedgerBalances already treats Suspense A/c as its home for anything
-- unclassified, so it reports under its own head rather than distorting a
-- real one.
--
-- REMOVE THIS ENTRY once the missing balances are found and imported properly.
-- To undo:
--   UPDATE chart_of_accounts SET opening_balance = 0, opening_balance_type = 'DR'
--    WHERE account_code = 'SUSPENSE-HOPE-PARTNERSHIP';

INSERT INTO public.chart_of_accounts (
  account_code, account_name, account_type, account_group,
  opening_balance, opening_balance_type, is_active, company_id
)
SELECT 'SUSPENSE-HOPE-PARTNERSHIP',
       'Suspense A/c - opening difference from the 2026-07-25 Tally import',
       'CURRENT_ASSETS',
       'Suspense A/c',
       0, 'DR', true,
       c.id
  FROM public.companies c
 WHERE c.company_key = 'hope_partnership'
ON CONFLICT (account_code) DO NOTHING;

-- Set it to exactly whatever the entity is out by, computed rather than typed,
-- so re-running after a partial correction leaves the right residue.
UPDATE public.chart_of_accounts s
   SET opening_balance = abs(gap.net),
       opening_balance_type = CASE WHEN gap.net < 0 THEN 'DR' ELSE 'CR' END,
       updated_at = now()
  FROM (
    SELECT round(sum(CASE WHEN upper(COALESCE(a.opening_balance_type,'DR')) = 'CR'
                          THEN -COALESCE(a.opening_balance,0)
                          ELSE  COALESCE(a.opening_balance,0) END), 2) AS net
      FROM public.chart_of_accounts a
      JOIN public.companies c ON c.id = a.company_id
     WHERE c.company_key = 'hope_partnership'
       AND a.account_code <> 'SUSPENSE-HOPE-PARTNERSHIP'
  ) gap
 WHERE s.account_code = 'SUSPENSE-HOPE-PARTNERSHIP';


-- Every entity should now read balanced, with the unknown named.
SELECT c.company_name AS company,
       round(sum(CASE WHEN upper(COALESCE(a.opening_balance_type,'DR')) = 'CR'
                      THEN -COALESCE(a.opening_balance,0)
                      ELSE  COALESCE(a.opening_balance,0) END), 2) AS net_opening,
       CASE WHEN abs(sum(CASE WHEN upper(COALESCE(a.opening_balance_type,'DR')) = 'CR'
                              THEN -COALESCE(a.opening_balance,0)
                              ELSE  COALESCE(a.opening_balance,0) END)) < 0.005
            THEN 'balanced' ELSE 'OUT OF BALANCE' END AS state
  FROM public.companies c
  JOIN public.chart_of_accounts a
    ON (a.company_id = c.id OR a.company_id IS NULL)
   AND a.is_active
 GROUP BY c.company_name
 ORDER BY 1;
