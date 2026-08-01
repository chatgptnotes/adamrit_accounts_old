-- Which of OUR bank accounts has this ledger's party saved as a beneficiary?
--
-- Vendors, doctors and staff have been added as beneficiaries in one of the
-- company bank portals, but nothing in the system records which one. So when a
-- payment voucher is raised, the person paying has to remember which bank can
-- actually transfer to this party. Recording it on the ledger master means
-- every payment screen can display "pay this from <bank>" the moment the
-- ledger is picked.
--
-- The column points at the bank's own ledger in chart_of_accounts (a Bank
-- Accounts group ledger), not at a free-typed bank name, so the payment form
-- can preselect the credit side directly.

ALTER TABLE public.chart_of_accounts
  ADD COLUMN IF NOT EXISTS beneficiary_of_bank_account_id UUID
    REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.chart_of_accounts.beneficiary_of_bank_account_id IS
  'The company bank-account ledger whose bank portal has this party saved as a beneficiary. Payment screens read it to say which bank the payment should go out from.';

CREATE INDEX IF NOT EXISTS chart_of_accounts_beneficiary_bank_idx
  ON public.chart_of_accounts (beneficiary_of_bank_account_id)
  WHERE beneficiary_of_bank_account_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
