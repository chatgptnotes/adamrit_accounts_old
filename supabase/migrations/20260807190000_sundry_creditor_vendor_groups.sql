-- The vendor groups under Sundry Creditors.
--
-- These are the invoice categories the Expense Bill form now reads live
-- (migration 20260807160000), so creating them here is what fills that
-- dropdown. Only CA existed; the other ten are added, keeping the two that
-- were already there (Consultant, Rmo Salary) untouched.
--
-- A group carries no balance of its own — ledgers are filed under it — so
-- nothing in the books moves. Nature follows the parent: Sundry Creditors is
-- a liability, credit by nature.
--
-- Applied through apply_migration(): one transaction, rolls back on failure.
-- Idempotent — re-running adds nothing.

INSERT INTO public.ledger_groups (name, group_type, nature, parent_group_id, is_predefined)
SELECT v.name, parent.group_type, parent.nature, parent.id, false
  FROM public.ledger_groups parent
  CROSS JOIN (VALUES
    ('CA'),
    ('CS'),
    ('Advocate'),
    ('Repair and Maintenance Vendors'),
    ('Hospital Renovation Vendor'),
    ('Vendors Other Than Pharmacy'),
    ('Oxygen Cylinder Vendor'),
    ('Orthopedic Implant Vendor'),
    ('Stent Vendor'),
    ('Maxillofacial Implant Vendor'),
    ('UROsurgeon Implant Vendor')
  ) AS v(name)
 WHERE lower(btrim(parent.name)) = 'sundry creditors'
   AND NOT EXISTS (
     SELECT 1 FROM public.ledger_groups g
      WHERE g.parent_group_id = parent.id
        AND lower(btrim(g.name)) = lower(btrim(v.name))
   );

NOTIFY pgrst, 'reload schema';

DO $$
DECLARE
  v_parent UUID;
  v_missing TEXT := '';
  v_name TEXT;
  v_total INTEGER;
BEGIN
  SELECT id INTO v_parent FROM public.ledger_groups
   WHERE lower(btrim(name)) = 'sundry creditors' LIMIT 1;
  IF v_parent IS NULL THEN
    RAISE EXCEPTION 'ABORT: no Sundry Creditors group to file these under';
  END IF;

  FOREACH v_name IN ARRAY ARRAY[
    'CA', 'CS', 'Advocate', 'Repair and Maintenance Vendors',
    'Hospital Renovation Vendor', 'Vendors Other Than Pharmacy',
    'Oxygen Cylinder Vendor', 'Orthopedic Implant Vendor', 'Stent Vendor',
    'Maxillofacial Implant Vendor', 'UROsurgeon Implant Vendor']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.ledger_groups
       WHERE parent_group_id = v_parent AND lower(btrim(name)) = lower(v_name)
    ) THEN
      v_missing := v_missing || ' ' || v_name || ';';
    END IF;
  END LOOP;
  IF v_missing <> '' THEN
    RAISE EXCEPTION 'ABORT — groups not created:%', v_missing;
  END IF;

  SELECT COUNT(*) INTO v_total FROM public.ledger_groups WHERE parent_group_id = v_parent;
  RAISE NOTICE 'OK — % groups now sit under Sundry Creditors and appear as invoice categories', v_total;
END $$;
