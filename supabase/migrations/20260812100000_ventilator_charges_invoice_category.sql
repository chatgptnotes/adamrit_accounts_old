-- Ventilator Charges as an invoice category.
--
-- The Expense Bill "Invoice category" dropdown lists the groups filed under
-- Sundry Creditors (migration 20260807160000), so adding the group here is
-- what puts the option on the form — same route the other eleven took in
-- 20260807190000.
--
-- A group carries no balance of its own — ledgers are filed under it — so
-- nothing in the books moves. Nature follows the parent: Sundry Creditors is
-- a liability, credit by nature.
--
-- Applied through apply_migration(): one transaction, rolls back on failure.
-- Idempotent — re-running adds nothing.

INSERT INTO public.ledger_groups (name, group_type, nature, parent_group_id, is_predefined)
SELECT 'Ventilator Charges', parent.group_type, parent.nature, parent.id, false
  FROM public.ledger_groups parent
 WHERE lower(btrim(parent.name)) = 'sundry creditors'
   AND NOT EXISTS (
     SELECT 1 FROM public.ledger_groups g
      WHERE g.parent_group_id = parent.id
        AND lower(btrim(g.name)) = 'ventilator charges'
   );

NOTIFY pgrst, 'reload schema';

DO $$
DECLARE
  v_parent UUID;
  v_total INTEGER;
BEGIN
  SELECT id INTO v_parent FROM public.ledger_groups
   WHERE lower(btrim(name)) = 'sundry creditors' LIMIT 1;
  IF v_parent IS NULL THEN
    RAISE EXCEPTION 'ABORT: no Sundry Creditors group to file this under';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.ledger_groups
     WHERE parent_group_id = v_parent AND lower(btrim(name)) = 'ventilator charges'
  ) THEN
    RAISE EXCEPTION 'ABORT — Ventilator Charges was not created';
  END IF;

  SELECT COUNT(*) INTO v_total FROM public.ledger_groups WHERE parent_group_id = v_parent;
  RAISE NOTICE 'OK — Ventilator Charges added; % groups now appear as invoice categories', v_total;
END $$;
