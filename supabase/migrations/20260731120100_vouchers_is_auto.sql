-- Mark which vouchers a person typed and which the system posted.
--
-- Now that hand-entered and automatic vouchers share one number series
-- (20260731120000_one_voucher_number_series.sql), the number no longer tells you
-- where a voucher came from. This flag does.
--
-- TRUE is the default because every trigger and posting routine inserts without
-- naming the column -- they are automatic without a single one of them changing.
-- The Voucher Entry screen, the only place a person types a voucher, sends FALSE.
--
-- Run this in the Supabase dashboard SQL Editor (project xvkxccqaopbnkvwgyfjv).
-- Safe to run twice.

ALTER TABLE vouchers
  ADD COLUMN IF NOT EXISTS is_auto BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN vouchers.is_auto IS
  'TRUE when a trigger or posting routine created this voucher, FALSE when someone typed it on the Voucher Entry screen.';

-- Backfill -------------------------------------------------------------------
-- Voucher Entry has always stamped last_modified_by with the signed-in username at
-- creation, while every automatic writer leaves it NULL or literally 'system'. That
-- snapshot is preserved in the CREATED row of voucher_edit_log, so it identifies the
-- hand-typed vouchers without having to enumerate service names.
--
-- Vouchers created before the edit log existed keep is_auto = TRUE. The overwhelming
-- majority of those are advance / receipt / pharmacy trigger postings, but a handful of
-- old hand-typed ones will be mislabelled -- there is no record left to tell them apart.
UPDATE vouchers v
SET is_auto = FALSE
FROM voucher_edit_log l
WHERE l.voucher_id = v.id
  AND l.action = 'CREATED'
  AND l.new_data ->> 'last_modified_by' IS NOT NULL
  AND l.new_data ->> 'last_modified_by' <> 'system'
  AND v.is_auto IS TRUE;

DO $$
DECLARE
  manual_count INTEGER;
  total_count  INTEGER;
BEGIN
  SELECT COUNT(*) INTO manual_count FROM vouchers WHERE is_auto IS FALSE;
  SELECT COUNT(*) INTO total_count FROM vouchers;
  RAISE NOTICE 'vouchers: % hand-typed of % total', manual_count, total_count;
END $$;
