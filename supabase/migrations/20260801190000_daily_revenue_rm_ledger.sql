-- The ledger a relationship manager's cut is actually paid to.
--
-- daily_revenue_entries has only ever held rm_name, a piece of text, and every
-- consumer re-derives the ledger by matching that text against
-- relationship_managers.name (see useImplantReferral.ts). That works for the
-- managers on the master and fails silently for everyone else: a manually added
-- row naming someone who is not on the master, or named with a different
-- spacing, resolves to no ledger at all and cannot be paid.
--
-- The Daily Revenue Report now picks the manager as a ledger rather than typing
-- a name, so the choice is recorded here as the id it really is. rm_name stays
-- as it is - it is what the report prints, and every existing row still has
-- only that - so the ledger is resolved as: this column first, then the old
-- name match as the fallback.

ALTER TABLE public.daily_revenue_entries
  ADD COLUMN IF NOT EXISTS rm_ledger_account_id UUID REFERENCES public.chart_of_accounts(id);

COMMENT ON COLUMN public.daily_revenue_entries.rm_ledger_account_id IS
  'Creditor ledger this cut is payable to, chosen on the Daily Revenue Report. '
  'NULL on older rows, which fall back to matching rm_name against '
  'relationship_managers.name.';

-- Every read is "the cuts for this date", so the column is only ever used
-- alongside rows already fetched. No index: it is a payload, not a filter.

-- Backfill what the name match would have found anyway, so existing rows carry
-- their ledger explicitly from here on and the fallback is only needed for rows
-- whose manager genuinely has none.
UPDATE public.daily_revenue_entries e
   SET rm_ledger_account_id = m.ledger_account_id
  FROM public.relationship_managers m
 WHERE e.rm_ledger_account_id IS NULL
   AND m.ledger_account_id IS NOT NULL
   AND m.is_hidden = false
   AND lower(regexp_replace(trim(e.rm_name), '\s+', ' ', 'g'))
     = lower(regexp_replace(trim(m.name), '\s+', ' ', 'g'));

-- The report writes this column the moment it loads, so PostgREST must know
-- about it straight away rather than on its next cache cycle.
NOTIFY pgrst, 'reload schema';

-- How many cuts can now be paid without guessing, and how many still cannot.
SELECT CASE
         WHEN rm_ledger_account_id IS NOT NULL THEN 'ledger on file'
         WHEN rm_name IS NULL OR lower(trim(rm_name)) IN ('', 'direct') THEN 'direct, nothing payable'
         ELSE 'needs a ledger'
       END AS state,
       COUNT(*) AS entries
  FROM public.daily_revenue_entries
 GROUP BY 1
 ORDER BY 2 DESC;
