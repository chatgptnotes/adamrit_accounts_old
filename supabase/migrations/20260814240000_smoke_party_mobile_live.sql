-- Live confirmation that enforcement is really refusing, and really allowing.
-- Cleans up after itself; raises only if the behaviour is wrong.
DO $t$
DECLARE v_pay UUID; v_bare UUID; v_num UUID; v_id UUID; v_ok BOOLEAN := false;
BEGIN
  IF NOT (SELECT enforced FROM voucher_party_mobile_settings WHERE id) THEN
    RAISE EXCEPTION 'ABORT: enforcement is not on';
  END IF;
  SELECT id INTO v_pay FROM voucher_types WHERE voucher_category='PAYMENT' AND is_active LIMIT 1;
  SELECT id INTO v_bare FROM chart_of_accounts WHERE mobile IS NULL AND is_active LIMIT 1;
  SELECT id INTO v_num  FROM chart_of_accounts WHERE mobile IS NOT NULL AND is_active LIMIT 1;

  BEGIN
    INSERT INTO vouchers (voucher_number, voucher_type_id, voucher_date, total_amount, is_auto, status)
    VALUES ('SMOKE-PM-1', v_pay, CURRENT_DATE, 1, true, 'PENDING') RETURNING id INTO v_id;
    INSERT INTO voucher_entries (voucher_id, account_id, debit_amount, credit_amount, entry_order)
    VALUES (v_id, v_bare, 1, 0, 1);
    SET CONSTRAINTS ALL IMMEDIATE;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_ok := (SQLERRM LIKE '%no mobile number for the other party%');
  END;
  SET CONSTRAINTS ALL DEFERRED;
  IF NOT v_ok THEN RAISE EXCEPTION 'ABORT: a numberless automatic payment was ACCEPTED while enforcement is on'; END IF;

  INSERT INTO vouchers (voucher_number, voucher_type_id, voucher_date, total_amount, is_auto, status)
  VALUES ('SMOKE-PM-2', v_pay, CURRENT_DATE, 1, true, 'PENDING') RETURNING id INTO v_id;
  INSERT INTO voucher_entries (voucher_id, account_id, debit_amount, credit_amount, entry_order)
  VALUES (v_id, v_num, 1, 0, 1);
  SET CONSTRAINTS ALL IMMEDIATE;
  IF (SELECT party_mobile FROM vouchers WHERE id=v_id) IS NULL THEN
    RAISE EXCEPTION 'ABORT: a good posting was let through with no number on it';
  END IF;
  DELETE FROM voucher_entries WHERE voucher_id=v_id;
  DELETE FROM vouchers WHERE id=v_id;
  SET CONSTRAINTS ALL DEFERRED;

  IF EXISTS (SELECT 1 FROM vouchers WHERE voucher_number LIKE 'SMOKE-PM-%') THEN
    RAISE EXCEPTION 'ABORT: smoke-test vouchers left behind';
  END IF;
END $t$;
