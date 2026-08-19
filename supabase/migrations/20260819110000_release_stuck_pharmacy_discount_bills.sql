-- Release the six pharmacy bills stranded behind discount approval.
--
-- THE INSTRUCTION (19 Aug, Dr M): pharmacists cannot issue bills to patients;
-- auto-approve pharmacy discounts. The code half shipped as 0cb1709c — a
-- discount no longer parks a sale as PENDING_DISCOUNT_APPROVAL. This is the
-- other half: six sales were already stuck in that status and the code change
-- does not reach backwards.
--
-- WHAT IS STUCK, and it is not much:
--   7706  BILL1787040377150  18 Aug  CASH  discount    0.00  total 1848.84
--   7707  BILL1787043247099  18 Aug  CASH  discount   85.00  total  400.00
--   7708  BILL1787044050481  18 Aug  UPI   discount   49.00  total  500.00
--   7709  BILL1787048151544  18 Aug  UPI   discount    0.00  total 3201.00
--   7710  BILL1787055757648  18 Aug  UPI   discount   81.00  total 1200.00
--   7774  BILL1787114322656  19 Aug  CASH  discount   20.00  total   40.00
-- Rs 235 of discount in total, and TWO OF THE SIX CARRY NO DISCOUNT AT ALL —
-- the gate was not even holding what it was meant to hold.
--
-- WHAT THIS WILL POST. trg_pharmacy_sale_posts_vouchers_upd fires on exactly
-- this column, so the update runs pharmacy_sale_posts_vouchers(). Checked
-- against the live functions before writing this, not against a migration file:
--
--   * The invoice JV is ALREADY posted for all six (JV1547, JV1548, JV1550,
--     JV1558, JV1582, JV1695). post_pharmacy_voucher is idempotent — "one live
--     voucher per reference, ever", keyed on vouchers.reference_number — so it
--     will return already=true and post nothing a second time.
--   * NO receipt exists for any of the six. Each will get one. None is CREDIT,
--     so none is skipped.
--
-- WHICH DAY THE MONEY LANDS ON. post_pharmacy_sale_receipt dates the voucher
-- COALESCE(sale_date::DATE, CURRENT_DATE), so five receipts land on 18 Aug and
-- one on 19 Aug — the days the cash was actually taken. Today's figures are not
-- inflated by yesterday's takings, and yesterday's reconciliation gains the
-- receipts it should always have had. That is the point: this cash was
-- collected and had no receipt behind it.
--
-- SAFE TO RE-RUN. The WHERE clause only matches rows still in the pending
-- status, so a second run updates nothing, and the voucher poster refuses
-- duplicates regardless.

DO $release$
DECLARE v_rows INT;
BEGIN
  UPDATE public.pharmacy_sales
     SET payment_status = 'COMPLETED',
         updated_at = now()
   WHERE payment_status = 'PENDING_DISCOUNT_APPROVAL'
     AND COALESCE(status, 'active') <> 'cancelled';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RAISE NOTICE 'Released % bill(s).', v_rows;
END
$release$;

DO $verify$
DECLARE
  v_left INT;
  v_missing INT;
  v_sale RECORD;
BEGIN
  -- 1. Nothing may still be waiting on an approval that no longer exists.
  SELECT count(*) INTO v_left
    FROM public.pharmacy_sales
   WHERE payment_status = 'PENDING_DISCOUNT_APPROVAL'
     AND COALESCE(status, 'active') <> 'cancelled';
  IF v_left > 0 THEN
    RAISE EXCEPTION 'ABORT: % bill(s) still held for discount approval', v_left;
  END IF;

  -- 2. Every one of the six must now carry a live receipt. A released bill
  --    with no receipt is money collected that the books cannot see, which is
  --    the fault this is meant to end, not repeat.
  v_missing := 0;
  FOR v_sale IN
    SELECT sale_id FROM public.pharmacy_sales WHERE sale_id IN (7706,7707,7708,7709,7710,7774)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.vouchers
       WHERE reference_number = 'PHARMACY-REC-' || v_sale.sale_id::TEXT
         AND status <> 'CANCELLED'
    ) THEN
      v_missing := v_missing + 1;
      RAISE WARNING 'No receipt posted for sale %', v_sale.sale_id;
    END IF;
  END LOOP;
  IF v_missing > 0 THEN
    RAISE EXCEPTION 'ABORT: % released bill(s) have no receipt voucher', v_missing;
  END IF;

  -- 3. And the invoices must not have been duplicated by the same trigger.
  SELECT count(*) INTO v_missing
    FROM (
      SELECT reference_number
        FROM public.vouchers
       WHERE reference_number LIKE 'PHARMACY-INV-%'
         AND status <> 'CANCELLED'
       GROUP BY reference_number
      HAVING count(*) > 1
    ) dupes;
  IF v_missing > 0 THEN
    RAISE EXCEPTION 'ABORT: % pharmacy invoice reference(s) now have more than one live voucher', v_missing;
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
