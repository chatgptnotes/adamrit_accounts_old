-- Invoice category becomes a real ledger group, not a hardcoded list.
--
-- The form offered five fixed categories (Rent, Implant, Salary, Consultant,
-- Other) which existed only in the page's source and were never saved. The
-- categories that matter are the groups the accounts team maintains under
-- Masters -> Group -> Sundry Creditors, and they change: a new vendor group
-- created there must appear in the form without a deploy.
--
-- So the chosen group is now stored with the invoice, by id and by name — the
-- id so a rename follows automatically, the name so a deleted group still
-- reads correctly on old bills.
--
-- Applied through apply_migration(): one transaction, rolls back on failure.
-- Idempotent, and it verifies itself before committing.

ALTER TABLE public.expense_bills
  ADD COLUMN IF NOT EXISTS category_group_id   UUID REFERENCES public.ledger_groups(id),
  ADD COLUMN IF NOT EXISTS category_group_name TEXT;

COMMENT ON COLUMN public.expense_bills.category_group_name IS
  'Name of the Sundry Creditors sub-group chosen as the invoice category, '
  'kept alongside the id so historical bills survive a group being removed.';

NOTIFY pgrst, 'reload schema';

DO $$
DECLARE
  v_parent UUID;
  v_children INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'expense_bills'
       AND column_name = 'category_group_id'
  ) THEN
    RAISE EXCEPTION 'ABORT: category_group_id was not added';
  END IF;

  SELECT id INTO v_parent FROM public.ledger_groups
   WHERE lower(btrim(name)) = 'sundry creditors' LIMIT 1;
  IF v_parent IS NULL THEN
    RAISE EXCEPTION 'ABORT: there is no Sundry Creditors group to read categories from';
  END IF;

  SELECT COUNT(*) INTO v_children FROM public.ledger_groups WHERE parent_group_id = v_parent;
  RAISE NOTICE 'OK — invoice categories now come from the % group(s) under Sundry Creditors', v_children;
END $$;
