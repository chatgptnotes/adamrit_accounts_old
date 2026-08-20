-- Cancel MLE-1470, the duplicate spot on visit IH26H20052.
--
-- Dr M authorised cancelling the duplicates. Only ONE of the two visits I
-- reported is actually a duplicate: IH26G27044 carries MLE-1420 for Baba Khan
-- and MLE-1421 for Arpit Kinarkar — two different referees, which is a real
-- thing and not a mistake. IH26H20052 carries MLE-1469 and MLE-1470 for the SAME
-- referee eighteen minutes apart, and that is the duplicate.
--
-- The later one goes. Its journals go with it: leaving an AUTHORISED JV behind a
-- cancelled bill would keep Rs 5,000 of expense in the books for an invoice that
-- does not exist.
DO $cancel$
DECLARE v_bill UUID; v_no TEXT := 'MLE-1470'; v_jv INT; v_paid NUMERIC;
BEGIN
  SELECT id INTO v_bill FROM expense_bills WHERE bill_number = v_no;
  IF v_bill IS NULL THEN
    RAISE NOTICE '% is not there — nothing to cancel', v_no; RETURN;
  END IF;

  -- Never cancel something that has been paid.
  IF EXISTS (SELECT 1 FROM expense_bills WHERE id = v_bill AND date_of_payment IS NOT NULL) THEN
    RAISE EXCEPTION 'ABORT: % has been paid and must be reversed, not cancelled', v_no;
  END IF;

  UPDATE vouchers SET status = 'CANCELLED', updated_at = now()
   WHERE reference_number = v_no AND status <> 'CANCELLED';
  GET DIAGNOSTICS v_jv = ROW_COUNT;

  UPDATE expense_bills SET status = 'CANCELLED', updated_at = now() WHERE id = v_bill;

  -- And the spot record, so the approval history matches the invoices.
  DELETE FROM spot_payment_approvals WHERE ml_invoice_number = v_no;

  RAISE NOTICE '% cancelled with % journal voucher(s)', v_no, v_jv;
END $cancel$;

DO $verify$
DECLARE v_status TEXT; v_live INT; v_spots INT;
BEGIN
  SELECT status INTO v_status FROM expense_bills WHERE bill_number = 'MLE-1470';
  IF v_status <> 'CANCELLED' THEN RAISE EXCEPTION 'ABORT: MLE-1470 is %', v_status; END IF;

  SELECT count(*) INTO v_live FROM vouchers
   WHERE reference_number = 'MLE-1470' AND status <> 'CANCELLED';
  IF v_live > 0 THEN RAISE EXCEPTION 'ABORT: % journal(s) still live behind it', v_live; END IF;

  -- MLE-1469 must be untouched and still payable.
  IF (SELECT status FROM expense_bills WHERE bill_number = 'MLE-1469') = 'CANCELLED' THEN
    RAISE EXCEPTION 'ABORT: the wrong invoice was cancelled';
  END IF;

  -- And the other visit keeps BOTH its spots: different referees, not a duplicate.
  SELECT count(*) INTO v_spots FROM spot_payment_approvals WHERE visit_id = 'IH26G27044';
  IF v_spots <> 2 THEN
    RAISE EXCEPTION 'ABORT: IH26G27044 should still have its two genuine spots, has %', v_spots;
  END IF;
END $verify$;
