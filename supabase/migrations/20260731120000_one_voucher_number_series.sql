-- One voucher number series for the whole system.
--
-- Until now two things numbered vouchers and they disagreed:
--
--   * generate_voucher_number() (this function) issued CODE-000000, e.g. PV-000339.
--     Every trigger and posting routine goes through it.
--   * VoucherEntry.tsx and accounting-voucher-service.ts computed CODE0000 themselves,
--     e.g. PV0337, from a cached voucher_types.current_number.
--
-- Both drew on the same counter row, so the register showed two shapes for one series
-- and the client-side half hard-failed on
--   duplicate key value violates unique constraint "vouchers_voucher_number_key"
-- whenever its cached counter landed on a number already issued.
--
-- From here everything is numbered here, in the short form the typists already read
-- (PV0347, REC12933). Numbers already issued are never rewritten -- they are printed on
-- receipts and referenced in Tally -- so CODE-000000 rows stay as they are and both
-- shapes coexist in history. The collision self-heal therefore has to span both.
--
-- Run this in the Supabase dashboard SQL Editor (project xvkxccqaopbnkvwgyfjv).
-- Safe to run twice.

-- 1. Generator ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION generate_voucher_number(p_voucher_type_code TEXT)
RETURNS TEXT AS $$
DECLARE
  current_num INTEGER;
  new_number  TEXT;
  max_used    BIGINT;
  attempts    INTEGER := 0;
BEGIN
  -- Take and increment the counter. The row lock this UPDATE holds is what
  -- serialises concurrent callers, so keep it as the first statement.
  UPDATE voucher_types
  SET current_number = current_number + 1
  WHERE voucher_types.voucher_type_code = p_voucher_type_code
  RETURNING current_number INTO current_num;

  IF current_num IS NULL THEN
    RAISE EXCEPTION 'Voucher type % not found in voucher_types table', p_voucher_type_code;
  END IF;

  -- LPAD does not truncate, so REC at 12933 stays REC12933.
  new_number := p_voucher_type_code || LPAD(current_num::TEXT, 4, '0');

  -- Fast path: the counter is in step with reality and we are done.
  IF NOT EXISTS (SELECT 1 FROM vouchers WHERE voucher_number = new_number) THEN
    RETURN new_number;
  END IF;

  -- Collision: the counter is behind the numbers actually issued. Jump it past the
  -- highest voucher of this type. The '-?' spans both shapes -- miss the hyphenated
  -- history here and the counter heals to a stale ceiling, which is the failure this
  -- whole migration exists to end.
  SELECT MAX(SUBSTRING(v.voucher_number FROM '[0-9]+$')::BIGINT)
  INTO max_used
  FROM vouchers v
  WHERE v.voucher_number ~ ('^' || p_voucher_type_code || '-?[0-9]+$');

  current_num := GREATEST(current_num, COALESCE(max_used, 0)::INTEGER + 1);

  -- Padding has varied over time (REC-9001 alongside REC-009001 alongside REC12927),
  -- so step forward until the number is genuinely free.
  LOOP
    new_number := p_voucher_type_code || LPAD(current_num::TEXT, 4, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM vouchers WHERE voucher_number = new_number);

    current_num := current_num + 1;
    attempts := attempts + 1;
    IF attempts > 1000 THEN
      RAISE EXCEPTION 'Could not find a free voucher number for % after 1000 attempts', p_voucher_type_code;
    END IF;
  END LOOP;

  UPDATE voucher_types
  SET current_number = current_num
  WHERE voucher_types.voucher_type_code = p_voucher_type_code;

  RETURN new_number;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION generate_voucher_number IS
  'Single source of voucher numbers (CODE0001). Self-heals if voucher_types.current_number falls behind the numbers already issued, across both the current CODE0001 shape and the historical CODE-000001 one.';

-- 2. Counter resync across both shapes ----------------------------------------
UPDATE voucher_types vt
SET current_number = GREATEST(
  COALESCE(vt.current_number, 0),
  COALESCE((
    SELECT MAX(SUBSTRING(v.voucher_number FROM '[0-9]+$')::BIGINT)
    FROM vouchers v
    WHERE v.voucher_number ~ ('^' || vt.voucher_type_code || '-?[0-9]+$')
  ), 0)::INTEGER
);

-- 3. Report -------------------------------------------------------------------
DO $$
DECLARE
  rec RECORD;
BEGIN
  RAISE NOTICE '=== voucher_types counters after resync ===';
  FOR rec IN
    SELECT vt.voucher_type_code,
           vt.current_number,
           COALESCE((
             SELECT MAX(SUBSTRING(v.voucher_number FROM '[0-9]+$')::BIGINT)
             FROM vouchers v
             WHERE v.voucher_number ~ ('^' || vt.voucher_type_code || '-?[0-9]+$')
           ), 0) AS max_issued
    FROM voucher_types vt
    ORDER BY vt.voucher_type_code
  LOOP
    RAISE NOTICE '  % -> current_number=%, highest issued=%',
      rec.voucher_type_code, rec.current_number, rec.max_issued;
  END LOOP;
END $$;
