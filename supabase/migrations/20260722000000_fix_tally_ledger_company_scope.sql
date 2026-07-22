-- Keep Tally ledger identity scoped to its configured company.
-- The original table created UNIQUE(name), which caused a full batch to fail
-- whenever another company already had a ledger with the same name.
ALTER TABLE public.tally_ledgers
  DROP CONSTRAINT IF EXISTS tally_ledgers_name_unique;

ALTER TABLE public.tally_ledgers
  DROP CONSTRAINT IF EXISTS tally_ledgers_tally_guid_key;

ALTER TABLE public.tally_ledgers
  DROP CONSTRAINT IF EXISTS tally_ledgers_company_id_name_key;

ALTER TABLE public.tally_ledgers
  ADD CONSTRAINT tally_ledgers_company_id_name_key
  UNIQUE (company_id, name);

CREATE INDEX IF NOT EXISTS idx_tally_ledgers_company_id
  ON public.tally_ledgers(company_id);
