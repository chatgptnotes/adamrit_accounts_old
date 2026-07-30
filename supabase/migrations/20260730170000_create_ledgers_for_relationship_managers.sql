-- Give every remaining relationship manager a ledger.
--
-- Seeding by name matched 6 of 107. The rest are referrers who were never set
-- up in the chart of accounts at all, so there was nothing to match against.
-- A manager we owe commission to is a creditor, so each one gets a Sundry
-- Creditors ledger under DRM Hope, named exactly as the manager.
--
-- The RM_ code series keeps these apart from the Tally import (DRMFRESH_) and
-- the Tally sync (TL), so they are identifiable later as app-created.
--
-- DIRECT is excluded. It is the sentinel for "no relationship manager", used
-- by the Daily Revenue Report, not a person anyone pays.
--
-- Safe to run twice: a manager who already has a ledger, and a name that
-- already exists in the chart of accounts, are both skipped.

WITH needs_ledger AS (
  SELECT m.id,
         btrim(m.name) AS name,
         row_number() OVER (ORDER BY m.code, m.name) AS seq
    FROM public.relationship_managers m
   WHERE m.ledger_account_id IS NULL
     AND COALESCE(m.is_hidden, false) = false
     AND btrim(COALESCE(m.name, '')) <> ''
     AND upper(btrim(m.name)) <> 'DIRECT'
     -- Someone else may already hold this name; reuse rather than duplicate.
     AND NOT EXISTS (
       SELECT 1 FROM public.chart_of_accounts a
        WHERE a.is_active = true
          AND lower(btrim(a.account_name)) = lower(btrim(m.name)))
),
base AS (
  SELECT COALESCE(MAX(NULLIF(regexp_replace(account_code, '^RM_', ''), '')::INTEGER), 0) AS last_number
    FROM public.chart_of_accounts
   WHERE account_code ~ '^RM_[0-9]+$'
),
created AS (
  INSERT INTO public.chart_of_accounts
    (account_code, account_name, account_type, account_group,
     company_id, opening_balance, opening_balance_type, is_active)
  SELECT 'RM_' || lpad((base.last_number + n.seq)::TEXT, 6, '0'),
         n.name,
         'CURRENT_LIABILITIES',
         'Sundry Creditors',
         (SELECT id FROM public.companies WHERE company_key = 'drm_pvt_ltd'),
         0, 'CR', true
    FROM needs_ledger n CROSS JOIN base
  RETURNING id, account_name
)
UPDATE public.relationship_managers m
   SET ledger_account_id = c.id,
       company_id = COALESCE(m.company_id,
                             (SELECT id FROM public.companies WHERE company_key = 'drm_pvt_ltd')),
       updated_at = now()
  FROM created c
 WHERE m.ledger_account_id IS NULL
   AND lower(btrim(m.name)) = lower(btrim(c.account_name));

-- Then pick up managers whose ledger already existed under that name, including
-- any created by a previous run of this script.
UPDATE public.relationship_managers m
   SET ledger_account_id = a.id,
       company_id = COALESCE(m.company_id, a.company_id),
       updated_at = now()
  FROM public.chart_of_accounts a
 WHERE m.ledger_account_id IS NULL
   AND COALESCE(m.is_hidden, false) = false
   AND upper(btrim(m.name)) <> 'DIRECT'
   AND a.is_active = true
   AND lower(btrim(a.account_name)) = lower(btrim(m.name));

-- Who is left. DIRECT should be the only one.
SELECT CASE WHEN ledger_account_id IS NULL THEN 'still needs a ledger' ELSE 'mapped' END AS state,
       count(*) AS managers,
       string_agg(name, ', ' ORDER BY name) FILTER (WHERE ledger_account_id IS NULL) AS unmapped
  FROM public.relationship_managers
 WHERE COALESCE(is_hidden, false) = false
 GROUP BY 1
 ORDER BY 1;
