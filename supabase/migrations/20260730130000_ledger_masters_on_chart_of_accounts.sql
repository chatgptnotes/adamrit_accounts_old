-- Masters -> Ledger Creation now writes chart_of_accounts, the table every
-- voucher and report already reads. Until now it wrote `ledgers` (11 rows, no
-- reader in the accounting module), so a ledger created in Masters saved
-- successfully and then never appeared in Voucher Entry or any report.
--
-- Three things here:
--   1. the Tally Ledger Creation fields that only `ledgers` had,
--   2. an index behind the duplicate-name check the form now performs,
--   3. a fix for the tally_ledgers mirror trigger, which made renaming any
--      account impossible for a company with a tally_config (DRM Hope).

ALTER TABLE public.chart_of_accounts
  ADD COLUMN IF NOT EXISTS alias               TEXT,
  ADD COLUMN IF NOT EXISTS ledger_group_id     UUID REFERENCES public.ledger_groups(id),
  ADD COLUMN IF NOT EXISTS mailing_name        TEXT,
  ADD COLUMN IF NOT EXISTS address             TEXT,
  ADD COLUMN IF NOT EXISTS state               TEXT,
  ADD COLUMN IF NOT EXISTS country             TEXT,
  ADD COLUMN IF NOT EXISTS pincode             TEXT,
  ADD COLUMN IF NOT EXISTS bank_name           TEXT,
  ADD COLUMN IF NOT EXISTS bank_branch         TEXT,
  -- Deliberately not `account_number`: too easily read as `account_code`.
  ADD COLUMN IF NOT EXISTS bank_account_number TEXT,
  ADD COLUMN IF NOT EXISTS ifsc_code           TEXT,
  ADD COLUMN IF NOT EXISTS pan                 TEXT,
  ADD COLUMN IF NOT EXISTS gstin               TEXT;

-- Two ledgers with one name in one company collapse into a single line in
-- mergedLedgerBalances (which keys by normalized name) and make the Tally
-- masters importer's name lookup ambiguous, so the Masters form refuses a
-- duplicate. An INDEX rather than a UNIQUE constraint: the 9,738 existing rows
-- are not verified duplicate-free and a failing DDL statement here would abort
-- the whole migration. It backs the form's check and TallyApprovals' ilike
-- lookup either way.
CREATE INDEX IF NOT EXISTS chart_of_accounts_company_name_idx
  ON public.chart_of_accounts (company_id, lower(btrim(account_name)));

-- Renaming an account was impossible for any company with a tally_config: the
-- mirror trigger INSERTs (company_id, accounting_account_id, NEW.account_name),
-- whose ON CONFLICT (company_id, name) cannot match once the name has changed,
-- and the insert then violates the partial unique index
-- tally_ledgers_accounting_account_uniq (company_id, accounting_account_id) —
-- aborting the chart_of_accounts UPDATE with a misleading 23505. Update the
-- mirror row in place when one already points at this account.
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

  -- closing_balance is left alone on this path: it is a Tally sync snapshot,
  -- and a rename must not overwrite it with an opening balance.
  UPDATE public.tally_ledgers tl
     SET name                  = NEW.account_name,
         parent_group          = NEW.account_group,
         opening_balance       = COALESCE(NEW.opening_balance, 0),
         is_hidden             = NOT COALESCE(NEW.is_active, true),
         accounting_company_id = NEW.company_id
    FROM public.tally_config tc
   WHERE tc.accounting_company_id = NEW.company_id
     AND tl.company_id = tc.id
     AND tl.accounting_account_id = NEW.id;

  IF FOUND THEN
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

-- The trigger itself is unchanged (AFTER INSERT OR UPDATE OF account_name,
-- account_group, opening_balance, is_active, company_id OR DELETE) — replacing
-- the function is enough. It deliberately does not fire on alias/gstin-only
-- edits, which have no Tally counterpart.

NOTIFY pgrst, 'reload schema';
