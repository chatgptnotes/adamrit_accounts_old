-- Reverse the FY 2025-26 advance recognition.
--
-- correct_patient_advance_liability.sql was extended back to Sep 2025 and
-- recognised Rs 2.17 crore of advances as income. That figure is computed from
-- the advance_payment table, but the debits land on ledger credits - and the
-- ledger credits for Sep 2025 - Mar 2026 do not cover it, even after
-- post_missing_fy2025_receipts.sql restored what it could. The result drove
-- 2110 Patient Advance negative, which a liability cannot be.
--
-- The Apr-Jul 2026 recognition is left in place: those months were verified to
-- have ledger credits exceeding the amount debited before they were posted.
--
-- The restored receipts (MISSING-RCT-%) are also left in place. They are
-- independently correct - that cash really was collected and really was
-- missing from the books.
--
-- To undo this reversal:
--   UPDATE vouchers SET status = 'AUTHORISED'
--    WHERE last_modified_by = 'fy2025-recognition-reverted';

UPDATE vouchers
   SET status           = 'CANCELLED',
       last_modified_by = 'fy2025-recognition-reverted',
       updated_at       = NOW()
 WHERE reference_number IN (
         'ADV-CORR-2025-09', 'ADV-CORR-2025-10', 'ADV-CORR-2025-11',
         'ADV-CORR-2025-12', 'ADV-CORR-2026-01', 'ADV-CORR-2026-02',
         'ADV-CORR-2026-03')
   AND status <> 'CANCELLED';

-- Outcome: the recognition batch, and 2110 back above zero.
SELECT ord, item, detail, amount FROM (
  SELECT 1 AS ord, 'ADV-CORR still live' AS item,
         count(*)::text || ' vouchers'   AS detail,
         round(sum(total_amount), 2)     AS amount
    FROM vouchers
   WHERE reference_number LIKE 'ADV-CORR-%' AND status <> 'CANCELLED'

  UNION ALL
  SELECT 2, 'ADV-CORR reverted',
         count(*)::text || ' vouchers', round(sum(total_amount), 2)
    FROM vouchers
   WHERE last_modified_by = 'fy2025-recognition-reverted'

  UNION ALL
  SELECT 3, '2110 Patient Advance', 'closing balance',
         round(sum(e.credit_amount) - sum(e.debit_amount), 2)
    FROM voucher_entries e
    JOIN chart_of_accounts a ON a.id = e.account_id
    JOIN vouchers v          ON v.id = e.voucher_id
   WHERE a.account_code = '2110' AND v.status = 'AUTHORISED'

  UNION ALL
  SELECT 4, '4160 Hospital Services Income', 'closing balance',
         round(sum(e.credit_amount) - sum(e.debit_amount), 2)
    FROM voucher_entries e
    JOIN chart_of_accounts a ON a.id = e.account_id
    JOIN vouchers v          ON v.id = e.voucher_id
   WHERE a.account_code = '4160' AND v.status = 'AUTHORISED'
) x
ORDER BY ord;
