-- Fix: pharmacy bills fail with
--   duplicate key value violates unique constraint "vouchers_voucher_number_key"
--
-- voucher_types.current_number for 'REC' was reset during the accounting rebuild
-- and walked back up to 23, but REC-000024 .. REC-012211 were already issued by
-- earlier backfills. generate_voucher_number() therefore re-emits an existing
-- number, the INSERT INTO vouchers fails, and because the counter increment sits
-- in the same (now rolled back) transaction the counter never advances -- so every
-- pharmacy sale, advance payment and final payment fails identically.
--
-- 1. generate_voucher_number() now self-heals: if the number it produced is
--    already taken it jumps the counter past the highest number in use.
-- 2. One-time resync of every voucher type's counter to the numbers actually issued.
--
-- Run this in the Supabase dashboard SQL Editor (project xvkxccqaopbnkvwgyfjv).
-- Safe to run twice.

-- 1. Self-healing voucher number generator ------------------------------------
-- Format is CODE + '-' + 6-digit zero pad (REC-000023), matching what production
-- has been issuing.
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

  new_number := p_voucher_type_code || '-' || LPAD(current_num::TEXT, 6, '0');

  -- Fast path: the counter is in step with reality and we are done.
  IF NOT EXISTS (SELECT 1 FROM vouchers WHERE voucher_number = new_number) THEN
    RETURN new_number;
  END IF;

  -- Collision: the counter is behind the numbers actually issued. Jump it past
  -- the highest CODE-<digits> voucher in the table.
  SELECT MAX(SUBSTRING(v.voucher_number FROM '[0-9]+$')::BIGINT)
  INTO max_used
  FROM vouchers v
  WHERE v.voucher_number ~ ('^' || p_voucher_type_code || '-[0-9]+$');

  current_num := GREATEST(current_num, COALESCE(max_used, 0)::INTEGER + 1);

  -- Padding has varied over time (REC-9001 alongside REC-009001), so step
  -- forward until the number is genuinely free.
  LOOP
    new_number := p_voucher_type_code || '-' || LPAD(current_num::TEXT, 6, '0');
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
  'Generates sequential voucher numbers (CODE-000001). Self-heals if voucher_types.current_number falls behind the numbers already issued.';

-- 2. One-time counter resync --------------------------------------------------
UPDATE voucher_types vt
SET current_number = GREATEST(
  COALESCE(vt.current_number, 0),
  COALESCE((
    SELECT MAX(SUBSTRING(v.voucher_number FROM '[0-9]+$')::BIGINT)
    FROM vouchers v
    WHERE v.voucher_number ~ ('^' || vt.voucher_type_code || '-[0-9]+$')
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
             WHERE v.voucher_number ~ ('^' || vt.voucher_type_code || '-[0-9]+$')
           ), 0) AS max_issued
    FROM voucher_types vt
    ORDER BY vt.voucher_type_code
  LOOP
    RAISE NOTICE '  % -> current_number=%, highest issued=%',
      rec.voucher_type_code, rec.current_number, rec.max_issued;
  END LOOP;
END $$;
