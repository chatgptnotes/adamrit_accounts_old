-- Retire the Suspense A/c that was imported into Hope Hospitals as well as
-- Ayushman, and restate the parked difference at what it really is.
--
-- WHAT WAS FOUND. Every suspense row is exactly its company's balancing figure:
--
--   Ayushman      openings without suspense  +44,56,449.57, suspense -44,56,449.57
--   DRM Hope      openings without suspense   -9,97,074.79, suspense  +9,97,074.79
--   Hope Hospitals openings without suspense -19,85,089.01, suspense +64,41,538.58
--                                                        and       -44,56,449.57
--
-- None has ever been posted to - they are opening balances only.
--
-- Hope Hospitals carries TWO. One is SUSPENSE-HOPE, which I created on
-- 2026-07-25 to park the difference; the other came in with the Tally import.
-- tally_ledgers holds Suspenses A/c under Ayushman Nagpur only, with no Hope
-- Hospitals row, yet the chart of accounts has one for each, identical to the
-- paisa. That is the same per-company duplication the import produced
-- elsewhere, applied to an account that should exist once.
--
-- Because the duplicate was already there, my script computed the residual
-- after it and had to be 44,56,449.57 larger to compensate. So the 64.4 lakh I
-- have been quoting is not one gap: it is 19,85,089.01 of genuinely missing
-- ledgers plus an offset against a suspense that is not Hope Hospitals'.
--
-- THE ASSUMPTION. That Hope Hospitals has no suspense account in Tally. The
-- evidence is tally_ledgers, not Tally itself. If that turns out to be wrong,
-- undo below - the company balances either way, because the two changes cancel.
--
-- Nothing is deleted. The row is deactivated, so it can be brought back.
--
-- TO UNDO:
--   UPDATE chart_of_accounts SET is_active = true
--    WHERE id IN (SELECT id FROM retired_suspense);
--   then re-run the recompute at the bottom.

CREATE TEMP TABLE retired_suspense AS
SELECT a.id, a.account_code, a.account_name,
       CASE WHEN upper(COALESCE(a.opening_balance_type,'DR')) = 'CR'
            THEN -COALESCE(a.opening_balance,0)
            ELSE  COALESCE(a.opening_balance,0) END AS was_carrying
  FROM public.chart_of_accounts a
  JOIN public.companies c ON c.id = a.company_id
 WHERE a.is_active
   AND c.company_key = 'hope_partnership'
   AND a.account_code LIKE 'TL%'
   AND lower(a.account_name) LIKE '%suspense%'
   AND COALESCE(a.opening_balance, 0) <> 0;

UPDATE public.chart_of_accounts
   SET is_active = false, updated_at = now()
 WHERE id IN (SELECT id FROM retired_suspense);

-- Restate the parked difference as whatever Hope Hospitals is now out by.
-- Computed, not typed, so this is correct whether or not the row above was
-- the right one to retire.
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
     WHERE a.is_active
       AND c.company_key = 'hope_partnership'
       AND a.account_code <> 'SUSPENSE-HOPE'
  ) gap
 WHERE s.account_code = 'SUSPENSE-HOPE';

COMMENT ON TABLE public.chart_of_accounts IS
  'Ledger master. SUSPENSE-HOPE holds Hope Hospitals opening difference from '
  'the 2026-07-25 Tally import - remove it once the missing ledgers are found.';
