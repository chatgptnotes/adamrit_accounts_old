-- Adding a relationship manager fails when relationship_manager_code_seq is
-- behind the highest code in the table: the BEFORE INSERT trigger hands out a
-- number that is already taken and the unique index rejects the row. That
-- happens whenever a row arrives with an explicit code (a data restore, or
-- 20260802090000_resolve_unmapped_rm_cuts.sql, which used MAX(code)+1).

-- 1. Catch the sequence up to reality.
SELECT setval(
  'public.relationship_manager_code_seq',
  GREATEST(
    (SELECT COALESCE(MAX(NULLIF(regexp_replace(code, '\D', '', 'g'), '')::BIGINT), 1000)
       FROM public.relationship_managers),
    1000
  )
);

-- 2. Stop it happening again: step over codes already in use rather than
--    failing the insert. Normally exits on the first pass.
CREATE OR REPLACE FUNCTION public.set_relationship_manager_code()
RETURNS TRIGGER AS $$
DECLARE
  candidate TEXT;
BEGIN
  IF NEW.code IS NULL OR NEW.code = '' THEN
    LOOP
      candidate := nextval('public.relationship_manager_code_seq')::text;
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.relationship_managers WHERE code = candidate
      );
    END LOOP;
    NEW.code := candidate;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
