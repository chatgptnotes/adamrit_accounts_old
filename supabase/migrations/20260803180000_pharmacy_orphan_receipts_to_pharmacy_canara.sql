-- The five pharmacy vouchers the bank merge could not route.
--
-- 20260803170000 moved post-cutover receipts off the orphan bank ledgers by
-- each voucher's company. Five pharmacy vouchers (credit settlements and
-- medicine-return credit notes: REC1476, REC-012725, REC-012726, CN-000003,
-- CN-000005) carry no company at all - the flows that wrote them never stamp
-- one - so their bank legs stayed on the retired 'Canara Bank HOPE PHARMACY'
-- stub. They are Hope Pharmacy's business: stamp them so, and move the bank
-- leg to Hope Pharmacy's own 'Canara Bank'.

DO $fix$
DECLARE
  v_stamped INTEGER := 0;
  v_moved   INTEGER := 0;
BEGIN
  WITH pharmacy_vouchers AS (
    SELECT DISTINCT v.id
      FROM vouchers v
      JOIN voucher_entries e ON e.voucher_id = v.id
     WHERE e.account_id = 'ace5c97d-0c45-4c61-a7d3-6dc728f40739'  -- retired pharmacy Canara stub
       AND v.company_id IS NULL
       AND v.status <> 'CANCELLED'
       AND v.voucher_date >= DATE '2026-07-25'
  )
  UPDATE vouchers v
     SET company_id = '05513224-58c5-4f6d-974d-78b9ff0de0d5',      -- Hope Pharmacy
         updated_at = NOW()
    FROM pharmacy_vouchers pv
   WHERE v.id = pv.id;
  GET DIAGNOSTICS v_stamped = ROW_COUNT;

  UPDATE voucher_entries e
     SET account_id = '16987e4a-eb68-4775-a497-12b6c57bcb51'       -- Hope Pharmacy's Canara Bank
    FROM vouchers v
   WHERE v.id = e.voucher_id
     AND e.account_id = 'ace5c97d-0c45-4c61-a7d3-6dc728f40739'
     AND v.company_id = '05513224-58c5-4f6d-974d-78b9ff0de0d5'
     AND v.status <> 'CANCELLED'
     AND v.voucher_date >= DATE '2026-07-25';
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  RAISE NOTICE 'Stamped % vouchers as Hope Pharmacy; moved % bank legs to Canara Bank.', v_stamped, v_moved;
END $fix$;
