-- Cancel the two Arpit Kinarkar spot invoices Dr M named.
--
-- Dr M, 20 Aug: Arpit Kinarkar is a hospital employee and is not paid cuts;
-- cancel MLE-1421 and MLE-1469, which name him as the referee.
--
-- ONLY THESE TWO. Two more exist on the same footing — MLE-1467 and MLE-1468,
-- Rs 8,000 each, also Arpit, both unpaid — and they are reported rather than
-- cancelled, because he named two and Rs 16,000 is not mine to decide.
--
-- Neither of these has been paid. The journals go with the bills: an AUTHORISED
-- JV behind a cancelled invoice keeps the expense in the books for something
-- that no longer exists.
DO $cancel$
DECLARE v_no TEXT; v_bill UUID; v_jv INT; v_total INT := 0;
BEGIN
  FOREACH v_no IN ARRAY ARRAY['MLE-1421', 'MLE-1469'] LOOP
    SELECT id INTO v_bill FROM expense_bills WHERE bill_number = v_no;
    IF v_bill IS NULL THEN
      RAISE NOTICE '% is not there', v_no; CONTINUE;
    END IF;

    IF EXISTS (SELECT 1 FROM expense_bills
                WHERE id = v_bill AND date_of_payment IS NOT NULL) THEN
      RAISE EXCEPTION 'ABORT: % has been paid and must be reversed, not cancelled', v_no;
    END IF;

    UPDATE vouchers SET status = 'CANCELLED', updated_at = now()
     WHERE reference_number = v_no AND status <> 'CANCELLED';
    GET DIAGNOSTICS v_jv = ROW_COUNT;

    UPDATE expense_bills SET status = 'CANCELLED', updated_at = now() WHERE id = v_bill;
    DELETE FROM spot_payment_approvals WHERE ml_invoice_number = v_no;

    RAISE NOTICE '% cancelled with % journal(s)', v_no, v_jv;
    v_total := v_total + 1;
  END LOOP;
  RAISE NOTICE '% invoice(s) cancelled', v_total;
END $cancel$;

DO $verify$
DECLARE v_bad TEXT; v_live INT; v_left INT;
BEGIN
  SELECT string_agg(bill_number, ', ') INTO v_bad
    FROM expense_bills
   WHERE bill_number IN ('MLE-1421','MLE-1469') AND COALESCE(status,'') <> 'CANCELLED';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: still live: %', v_bad;
  END IF;

  SELECT count(*) INTO v_live FROM vouchers
   WHERE reference_number IN ('MLE-1421','MLE-1469') AND status <> 'CANCELLED';
  IF v_live > 0 THEN
    RAISE EXCEPTION 'ABORT: % journal(s) still live behind cancelled invoices', v_live;
  END IF;

  -- The two NOT authorised for cancellation must be untouched.
  SELECT count(*) INTO v_left FROM expense_bills
   WHERE bill_number IN ('MLE-1467','MLE-1468') AND COALESCE(status,'') <> 'CANCELLED';
  IF v_left <> 2 THEN
    RAISE EXCEPTION 'ABORT: MLE-1467/1468 were touched — only % remain live', v_left;
  END IF;

  -- And Baba Khan's genuine spot on the same visit as MLE-1421 must survive.
  IF NOT EXISTS (SELECT 1 FROM spot_payment_approvals WHERE ml_invoice_number = 'MLE-1420') THEN
    RAISE EXCEPTION 'ABORT: Baba Khan''s spot was removed with Arpit''s';
  END IF;
END $verify$;
