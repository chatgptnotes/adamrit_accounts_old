-- Keep the native accounting ledger master and the legacy Tally workflow
-- backed by the same company-scoped ledger records.

ALTER TABLE public.tally_config
  ADD COLUMN IF NOT EXISTS accounting_company_id UUID REFERENCES public.companies(id);

ALTER TABLE public.tally_ledgers
  ADD COLUMN IF NOT EXISTS accounting_company_id UUID REFERENCES public.companies(id),
  ADD COLUMN IF NOT EXISTS accounting_account_id UUID REFERENCES public.chart_of_accounts(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS tally_ledgers_accounting_account_uniq
  ON public.tally_ledgers (company_id, accounting_account_id)
  WHERE accounting_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS tally_ledgers_accounting_company_idx
  ON public.tally_ledgers (accounting_company_id);

-- Link known Tally configurations to their native accounting company.
UPDATE public.tally_config tc
   SET accounting_company_id = c.id
  FROM public.companies c
 WHERE lower(tc.company_name) LIKE '%drm%'
   AND lower(tc.company_name) LIKE '%hope%'
   AND lower(c.company_name) LIKE '%drm%'
   AND lower(c.company_name) LIKE '%hope%';

-- Keep the Tally workspace available for the manual ledger workflow while
-- permanently disabling incoming Tally synchronization for this fresh master.
UPDATE public.tally_config tc
   SET is_active = true,
       auto_sync_enabled = false
 WHERE tc.accounting_company_id IS NOT NULL
   AND lower(tc.company_name) LIKE '%drm%'
   AND lower(tc.company_name) LIKE '%hope%';

-- The Excel import is the canonical DRM master. Mirror it into the Tally
-- ledger table so all existing Tally pages, mappings, and legacy vouchers see
-- the same 1,873 names and groups.
WITH drm_config AS (
  SELECT tc.id AS tally_config_id, tc.accounting_company_id
    FROM public.tally_config tc
   WHERE tc.accounting_company_id IS NOT NULL
     AND lower(tc.company_name) LIKE '%drm%'
     AND lower(tc.company_name) LIKE '%hope%'
   ORDER BY tc.id
   LIMIT 1
)
INSERT INTO public.tally_ledgers (
  company_id,
  accounting_company_id,
  accounting_account_id,
  name,
  parent_group,
  opening_balance,
  closing_balance,
  is_hidden,
  is_mapped,
  last_synced_at
)
SELECT
  dc.tally_config_id,
  coa.company_id,
  coa.id,
  coa.account_name,
  coa.account_group,
  coa.opening_balance,
  coa.opening_balance,
  false,
  false,
  NULL
FROM public.chart_of_accounts coa
JOIN drm_config dc ON dc.accounting_company_id = coa.company_id
WHERE coa.is_active = true
ON CONFLICT (company_id, name) DO UPDATE
  SET accounting_company_id = EXCLUDED.accounting_company_id,
      accounting_account_id = EXCLUDED.accounting_account_id,
      parent_group = EXCLUDED.parent_group,
      opening_balance = EXCLUDED.opening_balance,
      closing_balance = EXCLUDED.closing_balance,
      is_hidden = false;

CREATE OR REPLACE FUNCTION public.sync_chart_account_to_tally_ledger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.tally_ledgers
     WHERE accounting_account_id = OLD.id;
    RETURN OLD;
  END IF;

  IF NEW.company_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.tally_ledgers (
    company_id,
    accounting_company_id,
    accounting_account_id,
    name,
    parent_group,
    opening_balance,
    closing_balance,
    is_hidden,
    is_mapped,
    last_synced_at
  )
  SELECT
    tc.id,
    NEW.company_id,
    NEW.id,
    NEW.account_name,
    NEW.account_group,
    COALESCE(NEW.opening_balance, 0),
    COALESCE(NEW.opening_balance, 0),
    NOT COALESCE(NEW.is_active, true),
    false,
    NULL
  FROM public.tally_config tc
  WHERE tc.accounting_company_id = NEW.company_id
  ON CONFLICT (company_id, name) DO UPDATE
    SET accounting_company_id = EXCLUDED.accounting_company_id,
        accounting_account_id = EXCLUDED.accounting_account_id,
        parent_group = EXCLUDED.parent_group,
        opening_balance = EXCLUDED.opening_balance,
        closing_balance = EXCLUDED.closing_balance,
        is_hidden = EXCLUDED.is_hidden;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_chart_account_to_tally_ledger
  ON public.chart_of_accounts;

CREATE TRIGGER sync_chart_account_to_tally_ledger
  AFTER INSERT OR UPDATE OF account_name, account_group, opening_balance,
    is_active, company_id OR DELETE
  ON public.chart_of_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_chart_account_to_tally_ledger();

NOTIFY pgrst, 'reload schema';
