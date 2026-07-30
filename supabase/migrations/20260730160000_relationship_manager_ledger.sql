-- Every relationship manager points at the ledger they are paid through.
--
-- The RM's cut on a referral or implant is a real payable, and until now the
-- ledger behind it was chosen by hand each time an entry was raised - or not
-- chosen at all. Holding the mapping on the master means the name and the
-- ledger can never drift apart, and nothing downstream has to ask which
-- creditor an RM is.
--
-- The name column stays. It is not redundant: daily_revenue_entries.rm_name and
-- patients.relationship_manager both match relationship managers by name text,
-- so removing it would break the Daily Revenue Report and the Referral
-- Register. The master page now fills the name from the ledger that is picked,
-- which keeps the two identical without anyone typing either.

ALTER TABLE public.relationship_managers
  ADD COLUMN IF NOT EXISTS ledger_account_id UUID REFERENCES public.chart_of_accounts(id),
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id);

COMMENT ON COLUMN public.relationship_managers.ledger_account_id IS
  'Ledger the RM''s referral and implant commission is credited to. Unmapped '
  'managers are blocked from approval rather than posted to a generic creditor, '
  'because naming the party is the point of the mapping.';

-- Seed from the creditor ledgers the Tally import brought across, by exact
-- name. Anything unmatched stays NULL and is listed at the bottom.
UPDATE public.relationship_managers m
   SET ledger_account_id = a.id,
       company_id        = COALESCE(m.company_id, a.company_id),
       updated_at        = now()
  FROM public.chart_of_accounts a
 WHERE m.ledger_account_id IS NULL
   AND a.is_active = true
   AND lower(btrim(a.account_group)) = 'sundry creditors'
   AND lower(btrim(a.account_name))  = lower(btrim(m.name));

-- Then any remaining exact name match outside Sundry Creditors, for managers
-- whose ledger was filed under a different group.
UPDATE public.relationship_managers m
   SET ledger_account_id = a.id,
       company_id        = COALESCE(m.company_id, a.company_id),
       updated_at        = now()
  FROM public.chart_of_accounts a
 WHERE m.ledger_account_id IS NULL
   AND a.is_active = true
   AND lower(btrim(a.account_name)) = lower(btrim(m.name));

CREATE INDEX IF NOT EXISTS idx_relationship_managers_ledger
  ON public.relationship_managers(ledger_account_id);

-- Who still needs a ledger. These managers cannot be approved for payment
-- until one is picked on the Relationship Manager master page.
SELECT CASE WHEN ledger_account_id IS NULL THEN 'needs a ledger' ELSE 'mapped' END AS state,
       count(*) AS managers
  FROM public.relationship_managers
 WHERE COALESCE(is_hidden, false) = false
 GROUP BY 1
 ORDER BY 1;
