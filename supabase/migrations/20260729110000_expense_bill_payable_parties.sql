-- Expense Bills may use any active ledger belonging to the bill's company or
-- an explicitly shared ledger on either voucher side. Keep browsing and
-- contains-search responsive without loading the complete chart into a tablet.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_active_company_name
  ON public.chart_of_accounts(company_id, account_name, id)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_active_name_trgm
  ON public.chart_of_accounts USING gin (account_name gin_trgm_ops)
  WHERE is_active = true;

CREATE OR REPLACE FUNCTION public.validate_expense_bill_accounts()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_party   RECORD;
  v_expense RECORD;
BEGIN
  NEW.bill_number := btrim(NEW.bill_number);

  IF NEW.party_ledger_id = NEW.expense_ledger_id THEN
    RAISE EXCEPTION 'Choose different ledgers for Bill From and What It Is For';
  END IF;

  SELECT id, company_id, is_active
    INTO v_party
    FROM public.chart_of_accounts
   WHERE id = NEW.party_ledger_id;
  IF NOT FOUND OR NOT COALESCE(v_party.is_active, false) THEN
    RAISE EXCEPTION 'Choose an active Bill From ledger';
  END IF;
  IF v_party.company_id IS NOT NULL AND v_party.company_id <> NEW.company_id THEN
    RAISE EXCEPTION 'The Bill From ledger belongs to another accounting company';
  END IF;

  SELECT id, company_id, is_active
    INTO v_expense
    FROM public.chart_of_accounts
   WHERE id = NEW.expense_ledger_id;
  IF NOT FOUND OR NOT COALESCE(v_expense.is_active, false) THEN
    RAISE EXCEPTION 'Choose an active What It Is For ledger';
  END IF;
  IF v_expense.company_id IS NOT NULL AND v_expense.company_id <> NEW.company_id THEN
    RAISE EXCEPTION 'The What It Is For ledger belongs to another accounting company';
  END IF;

  RETURN NEW;
END;
$$;
