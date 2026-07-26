-- Square the cutover: remove Adamrit's pre-cutover ledger activity.
--
-- Adamrit's accounting module went live 25 Jul 2026 with opening balances
-- imported from Tally's closing position as at 24 Jul. But the vouchers table
-- also holds roughly 5,650 entries reaching back to Sep 2025, produced by the
-- receipt triggers while the module was being built. The Tally opening balance
-- already accounts for that entire period, so it is currently counted twice.
--
-- Verified safe before writing this: Tally's opening balances sit on
-- DRMFRESH_* / TL* accounts (a full trial balance - loans, capital, fixed
-- assets, creditors), while Adamrit's triggers post to the numeric accounts
-- (1110, 2110, 4160). Ledger activity against the Tally-imported groups is
-- zero. Cancelling Adamrit's vouchers therefore cannot disturb the import.
--
-- Also cancels the correction batches from the 25 Jul session. Those reshape
-- pre-cutover data and are superseded by the same reasoning, even where the
-- voucher itself carries a July date.
--
-- Soft cancel: numbers are kept, the audit trail survives via
-- log_voucher_changes(), and reports exclude CANCELLED.
--
-- To undo:
--   UPDATE vouchers SET status = 'AUTHORISED'
--    WHERE last_modified_by = 'cutover-cleanup';

UPDATE vouchers
   SET status           = 'CANCELLED',
       last_modified_by = 'cutover-cleanup',
       updated_at       = NOW()
 WHERE status = 'AUTHORISED'
   AND (voucher_date < DATE '2026-07-25'
     OR reference_number LIKE 'ADV-CORR-%'
     OR reference_number LIKE 'REFUND-CORR-%'
     OR reference_number LIKE 'MISSING-RCT-%');


-- Outcome. What remains AUTHORISED should be post-cutover activity only.
SELECT ord, item, detail, amount FROM (
  SELECT 1 AS ord, 'Cancelled by this cleanup' AS item,
         count(*)::text || ' vouchers'          AS detail,
         round(sum(total_amount), 2)            AS amount
    FROM vouchers
   WHERE last_modified_by = 'cutover-cleanup' AND status = 'CANCELLED'

  UNION ALL
  SELECT 2, 'Still live (should be 25 Jul onward)',
         count(*)::text || ' vouchers', round(sum(total_amount), 2)
    FROM vouchers
   WHERE status = 'AUTHORISED'

  UNION ALL
  SELECT 3, 'Earliest live voucher',
         COALESCE(min(voucher_date)::text, 'none'), NULL
    FROM vouchers
   WHERE status = 'AUTHORISED'

  UNION ALL
  SELECT 4, '2110 Patient Advance', 'balance after cleanup',
         round(COALESCE(sum(e.credit_amount) - sum(e.debit_amount), 0), 2)
    FROM voucher_entries e
    JOIN chart_of_accounts a ON a.id = e.account_id
    JOIN vouchers v          ON v.id = e.voucher_id
   WHERE a.account_code = '2110' AND v.status = 'AUTHORISED'

  UNION ALL
  SELECT 5, '4160 Hospital Services Income', 'balance after cleanup',
         round(COALESCE(sum(e.credit_amount) - sum(e.debit_amount), 0), 2)
    FROM voucher_entries e
    JOIN chart_of_accounts a ON a.id = e.account_id
    JOIN vouchers v          ON v.id = e.voucher_id
   WHERE a.account_code = '4160' AND v.status = 'AUTHORISED'
) x
ORDER BY ord;
