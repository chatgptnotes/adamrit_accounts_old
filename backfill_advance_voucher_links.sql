-- Link historical advance payments to the vouchers they produced.
--
-- 20260726170000 made edits and deletions reach the ledger, but it can only
-- find a voucher via vouchers.reference_number, which the trigger has only
-- been writing since that migration. Rows recorded before it have no link, so
-- editing one still leaves the ledger untouched (with a warning).
--
-- This backfills the link for historical rows.
--
-- SAFETY: a wrong link is worse than no link - a future edit would cancel
-- someone else's voucher. So a pair is linked ONLY when the match is
-- unambiguous in both directions: exactly one payment row AND exactly one
-- unlinked voucher for that patient, date and amount. Every group with two or
-- more on either side is skipped and left as it is. Tonight's analysis found
-- 195 such ambiguous groups in Apr-Jul alone (patients genuinely paying the
-- same amount twice in a day), which is precisely why this rule is strict.
--
-- Linked vouchers are stamped last_modified_by = 'voucher-link-backfill'.
-- To undo:
--   UPDATE vouchers SET reference_number = NULL
--    WHERE last_modified_by = 'voucher-link-backfill';
--
-- The summary at the bottom runs after the backfill and is what you will see
-- in the results pane.

DO $$
DECLARE
  -- ==================== SETTINGS ====================
  v_confirm BOOLEAN := true;
  -- =================================================
  v_linked INTEGER := 0;
BEGIN
  IF NOT v_confirm THEN
    RAISE NOTICE 'Nothing linked. Set v_confirm := true to proceed.';
    RETURN;
  END IF;

  WITH ap AS (
    SELECT id, patient_id, payment_date::date AS d, advance_amount AS amt
      FROM advance_payment
     WHERE COALESCE(status,'ACTIVE') <> 'CANCELLED'
       AND patient_id IS NOT NULL
       AND advance_amount IS NOT NULL
  ),
  ap_groups AS (
    -- array_agg rather than min(): there is no min() for uuid, and the group
    -- only matters when it holds exactly one row anyway.
    SELECT patient_id, d, amt, count(*) AS n, (array_agg(id))[1] AS ap_id
      FROM ap
     GROUP BY 1, 2, 3
  ),
  v AS (
    SELECT DISTINCT v.id, v.patient_id, v.voucher_date AS d, v.total_amount AS amt
      FROM vouchers v
      JOIN voucher_entries e   ON e.voucher_id = v.id
      JOIN chart_of_accounts a ON a.id = e.account_id
     WHERE a.account_code = '2110'
       AND v.status = 'AUTHORISED'
       AND v.reference_number IS NULL
       AND v.patient_id IS NOT NULL
  ),
  v_groups AS (
    SELECT patient_id, d, amt, count(*) AS n, (array_agg(id))[1] AS voucher_id
      FROM v
     GROUP BY 1, 2, 3
  ),
  pairs AS (
    SELECT g.ap_id, w.voucher_id
      FROM ap_groups g
      JOIN v_groups w
        ON w.patient_id = g.patient_id
       AND w.d          = g.d
       AND w.amt        = g.amt
     WHERE g.n = 1               -- exactly one payment row
       AND w.n = 1               -- exactly one unlinked voucher
       AND NOT EXISTS (          -- and that payment is not already linked
             SELECT 1 FROM vouchers x
              WHERE x.reference_number = g.ap_id::TEXT)
  )
  UPDATE vouchers v
     SET reference_number = p.ap_id::TEXT,
         last_modified_by = 'voucher-link-backfill',
         updated_at       = NOW()
    FROM pairs p
   WHERE v.id = p.voucher_id;

  GET DIAGNOSTICS v_linked = ROW_COUNT;
  RAISE NOTICE 'Linked % vouchers to their advance payments.', v_linked;
END;
$$;

-- Outcome. unlinked_remaining are vouchers whose match was ambiguous; editing
-- those payments will still warn rather than update the ledger.
SELECT 'linked by this backfill'                       AS item,
       count(*)                                        AS vouchers,
       round(sum(v.total_amount), 2)                   AS amount
  FROM vouchers v
 WHERE v.last_modified_by = 'voucher-link-backfill'

UNION ALL
SELECT 'linked in total (incl. new postings)', count(*), round(sum(total_amount), 2)
  FROM (
    SELECT DISTINCT v.id, v.total_amount
      FROM vouchers v
      JOIN voucher_entries e   ON e.voucher_id = v.id
      JOIN chart_of_accounts a ON a.id = e.account_id
     WHERE a.account_code = '2110'
       AND v.status = 'AUTHORISED'
       AND v.reference_number IS NOT NULL
  ) linked

UNION ALL
SELECT 'unlinked remaining (ambiguous)', count(*), round(sum(total_amount), 2)
  FROM (
    SELECT DISTINCT v.id, v.total_amount
      FROM vouchers v
      JOIN voucher_entries e   ON e.voucher_id = v.id
      JOIN chart_of_accounts a ON a.id = e.account_id
     WHERE a.account_code = '2110'
       AND v.status = 'AUTHORISED'
       AND v.reference_number IS NULL
  ) unlinked;
