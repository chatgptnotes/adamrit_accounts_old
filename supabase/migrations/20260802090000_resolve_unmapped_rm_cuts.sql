-- Give the last six unpayable commissions somewhere to go.
--
-- Six cuts from 22 May 2026 name a manager who is on nobody's master, so the
-- Daily Revenue Report can compute what is owed but cannot pay it. Checked
-- against the 114 managers already on file, four of those names turn out to be
-- three existing people written loosely and one genuinely new referrer:
--
--   VBR Munna    -> Munna (1039)            3 cuts, Rs 2,150
--   Ganesh       -> Ganesh Sharnagat (1003) 1 cut,  Rs 250
--   Sunaj        -> Suraj Rajput            1 cut,  Rs 1,375
--   Firoz Salman -> new manager             1 cut,  Rs 250
--
-- The first three are corrected rather than created. Creating them would have
-- split one referrer's commission across two creditor ledgers, which is close
-- to impossible to unpick once both have been paid from.
--
-- Only unpaid rows are touched (approval_id IS NULL). A cut that has already
-- been posted is history and keeps the name it was posted under.

-- ── 1. The one genuinely new manager ────────────────────────────────────────
-- Same shape as the RM_ ledger series in 20260730170000: a manager owed
-- commission is a Sundry Creditor under DRM Hope, named exactly as the manager.
WITH base AS (
  SELECT COALESCE(MAX(NULLIF(regexp_replace(account_code, '^RM_', ''), '')::INTEGER), 0) AS last_number
    FROM public.chart_of_accounts
   WHERE account_code ~ '^RM_[0-9]+$'
),
new_ledger AS (
  INSERT INTO public.chart_of_accounts
    (account_code, account_name, account_type, account_group,
     company_id, opening_balance, opening_balance_type, is_active)
  SELECT 'RM_' || lpad((base.last_number + 1)::TEXT, 6, '0'),
         'Firoz Salman',
         'CURRENT_LIABILITIES',
         'Sundry Creditors',
         (SELECT id FROM public.companies WHERE company_key = 'drm_pvt_ltd'),
         0, 'CR', true
    FROM base
   -- Someone may already hold this name; reuse rather than duplicate.
   WHERE NOT EXISTS (
     SELECT 1 FROM public.chart_of_accounts a
      WHERE a.is_active = true
        AND lower(btrim(a.account_name)) = 'firoz salman')
  RETURNING id
)
INSERT INTO public.relationship_managers (name, code, commission_percent, is_hidden, ledger_account_id, company_id)
SELECT 'Firoz Salman',
       -- Next in the master's own numeric series, which currently tops out at 1169.
       (SELECT (COALESCE(MAX(NULLIF(regexp_replace(code, '\D', '', 'g'), '')::INTEGER), 1000) + 1)::TEXT
          FROM public.relationship_managers),
       25,                                    -- the rate all but one manager is on
       false,
       COALESCE((SELECT id FROM new_ledger),
                (SELECT id FROM public.chart_of_accounts
                  WHERE is_active = true AND lower(btrim(account_name)) = 'firoz salman' LIMIT 1)),
       (SELECT id FROM public.companies WHERE company_key = 'drm_pvt_ltd')
 WHERE NOT EXISTS (
   SELECT 1 FROM public.relationship_managers
    WHERE lower(btrim(name)) = 'firoz salman');

-- ── 2. Point the six cuts at the right manager ──────────────────────────────
-- The name on the row is corrected too, so the report prints who was actually
-- paid rather than the loose spelling it was entered under.
UPDATE public.daily_revenue_entries e
   SET rm_name = m.name,
       rm_ledger_account_id = m.ledger_account_id,
       updated_at = now()
  FROM public.relationship_managers m
 WHERE e.approval_id IS NULL
   AND e.rm_ledger_account_id IS NULL
   AND m.ledger_account_id IS NOT NULL
   AND (
     (lower(btrim(e.rm_name)) = 'vbr munna'    AND lower(btrim(m.name)) = 'munna')
  OR (lower(btrim(e.rm_name)) = 'ganesh'       AND lower(btrim(m.name)) = 'ganesh sharnagat')
  OR (lower(btrim(e.rm_name)) = 'sunaj'        AND lower(btrim(m.name)) = 'suraj rajput')
  OR (lower(btrim(e.rm_name)) = 'firoz salman' AND lower(btrim(m.name)) = 'firoz salman')
   );

NOTIFY pgrst, 'reload schema';

-- ── 3. What is left ─────────────────────────────────────────────────────────
-- "needs a ledger" should now be zero.
SELECT CASE
         WHEN rm_ledger_account_id IS NOT NULL THEN 'ledger on file'
         WHEN rm_name IS NULL OR lower(btrim(rm_name)) IN ('', 'direct') THEN 'direct, nothing payable'
         ELSE 'needs a ledger'
       END AS state,
       COUNT(*) AS entries,
       string_agg(DISTINCT rm_name, ', ') FILTER (
         WHERE rm_ledger_account_id IS NULL
           AND rm_name IS NOT NULL
           AND lower(btrim(rm_name)) NOT IN ('', 'direct')) AS still_unmapped
  FROM public.daily_revenue_entries
 GROUP BY 1
 ORDER BY 2 DESC;
