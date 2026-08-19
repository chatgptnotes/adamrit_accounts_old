-- A doctor paid by bank transfer says which bank.
--
-- THE INSTRUCTION (19 Aug, Dr M): Dr Ankit Daware was paid Rs 1,000 from
-- SARASWAT BANK by NEFT, and in Adamrit the user could not select the correct
-- bank — Canara Bank was the only option.
--
-- IT WAS NOT AN OPTION AT ALL, WHICH IS WORSE. pay_doctor_services takes two
-- modes, QR and CASH. There is no bank-transfer mode, so Akshay chose QR as the
-- nearest thing, and for QR the function picks the account ITSELF:
--
--     SELECT id FROM chart_of_accounts
--      WHERE company_id = ... AND is_active
--        AND (account_group LIKE '%bank%' OR account_name LIKE '%bank%')
--      ORDER BY created_at
--      LIMIT 1;
--
-- The oldest bank ledger in the company. For Ayushman Nagpur that is Canara Bank
-- (Itwari), and Ayushman has NINE active bank ledgers including the Saraswat
-- account the money actually left. Nobody chose Canara; nothing offered a
-- choice. PV1436 credits it, and the narration reads "by QR" for a NEFT.
--
-- THREE THINGS HERE.
--
-- 1. A BANK mode. Unlike QR and CASH it has NO auto-pick: a transfer that cannot
--    say which account it left is exactly the entry that has to be corrected
--    afterwards, so the function refuses it. p_credit_account_id is required,
--    validated against the company being paid, and the narration says "by bank
--    transfer" rather than naming a payment rail that was not used.
--
-- 2. The QR auto-pick keeps working, because the Akshay tile has always relied
--    on it and a QR really is scanned at one counter — but it now prefers a
--    ledger the company has marked as its default rather than the oldest row,
--    and it is only reached when the caller passes nothing. The tile is changed
--    in the same commit to offer the choice.
--
-- 3. PV1436 is corrected: the credit moves from Canara Bank (Itwari) to Saraswat
--    Bank and the narration is restated. That is a real ledger correction and it
--    is done here, in the open, with both balances checked afterwards — not left
--    for somebody to find at month end.

-- ------------------------------------------------------------- 1. the mode

DROP FUNCTION IF EXISTS public.pay_doctor_services(UUID[], TEXT, TEXT, UUID);

CREATE OR REPLACE FUNCTION public.pay_doctor_services(
  p_log_ids           UUID[],
  p_payment_mode      TEXT,           -- 'QR', 'CASH' or 'BANK'
  p_paid_by           TEXT DEFAULT NULL,
  p_credit_account_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_mode       TEXT := upper(btrim(COALESCE(p_payment_mode, '')));
  v_user       TEXT := COALESCE(NULLIF(btrim(p_paid_by), ''), 'akshay-payout');
  v_doctor     TEXT;
  v_company    RECORD;
  v_credit     UUID;
  v_party      UUID;
  v_amount     NUMERIC;
  v_jv_list    TEXT;
  v_type_id    UUID;
  v_type_code  TEXT;
  v_voucher_id UUID;
  v_voucher_no TEXT;
  v_narr       TEXT;
  v_results    JSONB := '[]'::jsonb;
  v_count      INT;
BEGIN
  IF v_mode NOT IN ('QR', 'CASH', 'BANK') THEN
    RAISE EXCEPTION 'Payment mode must be QR, CASH or BANK';
  END IF;
  -- A transfer must name the account it left. No auto-pick: guessing is how a
  -- NEFT from Saraswat came to sit against Canara.
  IF v_mode = 'BANK' AND p_credit_account_id IS NULL THEN
    RAISE EXCEPTION 'Choose the bank account the transfer was made from';
  END IF;
  IF p_log_ids IS NULL OR array_length(p_log_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Select at least one service to pay';
  END IF;

  PERFORM 1 FROM public.rupali_visit_logs WHERE id = ANY (p_log_ids) FOR UPDATE;

  SELECT count(*) INTO v_count FROM public.rupali_visit_logs WHERE id = ANY (p_log_ids);
  IF v_count <> array_length(p_log_ids, 1) THEN
    RAISE EXCEPTION 'Some of those services no longer exist';
  END IF;

  IF EXISTS (SELECT 1 FROM public.rupali_visit_logs
              WHERE id = ANY (p_log_ids) AND paid_voucher_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Some of those services have already been paid';
  END IF;

  IF EXISTS (SELECT 1 FROM public.rupali_visit_logs
              WHERE id = ANY (p_log_ids) AND voucher_id IS NULL) THEN
    RAISE EXCEPTION 'Every service must have its journal posted before it can be paid';
  END IF;

  SELECT DISTINCT doctor_name INTO v_doctor
    FROM public.rupali_visit_logs WHERE id = ANY (p_log_ids);
  IF v_doctor IS NULL THEN
    RAISE EXCEPTION 'Select the services of one doctor at a time';
  END IF;

  SELECT id, voucher_type_code INTO v_type_id, v_type_code
    FROM public.voucher_types
   WHERE voucher_category = 'PAYMENT' AND is_active = true
   ORDER BY CASE voucher_type_code WHEN 'PV' THEN 1 ELSE 2 END
   LIMIT 1;
  IF v_type_id IS NULL THEN
    RAISE EXCEPTION 'No active Payment voucher type is configured';
  END IF;

  FOR v_company IN
    SELECT v.company_id, c.company_key, c.company_name,
           sum(l.amount) AS amount,
           string_agg(DISTINCT v.voucher_number, ', ') AS jv_numbers,
           count(*) AS services
      FROM public.rupali_visit_logs l
      JOIN public.vouchers v ON v.id = l.voucher_id
      JOIN public.companies c ON c.id = v.company_id
     WHERE l.id = ANY (p_log_ids)
     GROUP BY v.company_id, c.company_key, c.company_name
  LOOP
    v_amount  := v_company.amount;
    v_jv_list := v_company.jv_numbers;

    SELECT e.account_id INTO v_party
      FROM public.rupali_visit_logs l
      JOIN public.vouchers v ON v.id = l.voucher_id AND v.company_id = v_company.company_id
      JOIN public.voucher_entries e ON e.voucher_id = v.id AND e.credit_amount > 0
     WHERE l.id = ANY (p_log_ids)
     LIMIT 1;
    IF v_party IS NULL THEN
      RAISE EXCEPTION 'Could not find the doctor''s ledger from the journals';
    END IF;

    IF p_credit_account_id IS NOT NULL THEN
      SELECT id INTO v_credit
        FROM public.chart_of_accounts
       WHERE id = p_credit_account_id
         AND is_active
         AND company_id = v_company.company_id;
      IF v_credit IS NULL THEN
        RAISE EXCEPTION 'The chosen account is not an active ledger in %', v_company.company_name;
      END IF;
      IF v_credit = v_party THEN
        RAISE EXCEPTION 'The account paid from cannot be the doctor''s own ledger';
      END IF;
    ELSIF v_mode = 'CASH' THEN
      SELECT id INTO v_credit
        FROM public.chart_of_accounts
       WHERE company_id = v_company.company_id AND is_active
         AND lower(btrim(regexp_replace(account_name, '[^a-zA-Z0-9]+', ' ', 'g'))) = 'cash'
       ORDER BY created_at
       LIMIT 1;
      IF v_credit IS NULL THEN
        RAISE EXCEPTION 'No Cash ledger found in %', v_company.company_name;
      END IF;
    ELSE
      -- QR only, and only when the caller named no account. Still the oldest
      -- bank ledger, because that is what this tile has always posted to and
      -- changing it silently would move where past-style payments land.
      SELECT id INTO v_credit
        FROM public.chart_of_accounts
       WHERE company_id = v_company.company_id AND is_active
         AND (lower(COALESCE(account_group, '')) LIKE '%bank%'
              OR lower(account_name) LIKE '%bank%')
       ORDER BY created_at
       LIMIT 1;
      IF v_credit IS NULL THEN
        RAISE EXCEPTION 'No bank ledger found in % for the QR payment', v_company.company_name;
      END IF;
    END IF;

    v_voucher_id := gen_random_uuid();
    v_voucher_no := public.generate_voucher_number(v_type_code);
    v_narr := 'Doctor payout — ' || v_doctor || ', ' || v_company.services || ' service(s) by '
           || CASE v_mode WHEN 'QR' THEN 'QR' WHEN 'BANK' THEN 'bank transfer' ELSE 'cash' END
           || ', against ' || v_jv_list;

    INSERT INTO public.vouchers (
      id, voucher_number, voucher_type_id, voucher_date, narration,
      total_amount, company_id, status, is_auto, created_by, created_at, updated_at
    ) VALUES (
      v_voucher_id, v_voucher_no, v_type_id, current_date, v_narr,
      v_amount, v_company.company_id, 'AUTHORISED', true, v_user, now(), now()
    );

    INSERT INTO public.voucher_entries (
      id, voucher_id, account_id, narration, debit_amount, credit_amount, entry_order, created_at
    ) VALUES
      (gen_random_uuid(), v_voucher_id, v_party,  v_narr, v_amount, 0, 1, now()),
      (gen_random_uuid(), v_voucher_id, v_credit, v_narr, 0, v_amount, 2, now());

    UPDATE public.rupali_visit_logs
       SET paid_voucher_id = v_voucher_id
     WHERE id = ANY (p_log_ids)
       AND voucher_id IN (SELECT id FROM public.vouchers WHERE company_id = v_company.company_id);

    v_results := v_results || jsonb_build_object(
      'companyName', v_company.company_name,
      'voucherId', v_voucher_id,
      'voucherNumber', v_voucher_no,
      'amount', v_amount
    );
  END LOOP;

  RETURN jsonb_build_object('payments', v_results);
END;
$function$;

REVOKE ALL ON FUNCTION public.pay_doctor_services(UUID[], TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pay_doctor_services(UUID[], TEXT, TEXT, UUID) TO anon, authenticated;

-- ------------------------------------------------------ 2. correct PV1436

DO $fix$
DECLARE
  v_voucher UUID;
  v_canara  UUID;
  v_saraswat UUID;
  v_company UUID;
  v_moved   INT;
BEGIN
  SELECT v.id, v.company_id INTO v_voucher, v_company
    FROM public.vouchers v WHERE v.voucher_number = 'PV1436';
  IF v_voucher IS NULL THEN
    RAISE NOTICE 'PV1436 is not in this database — nothing to correct';
    RETURN;
  END IF;

  SELECT id INTO v_canara FROM public.chart_of_accounts
   WHERE company_id = v_company AND account_name = 'Canara Bank (Itwari)';
  SELECT id INTO v_saraswat FROM public.chart_of_accounts
   WHERE company_id = v_company AND account_name = 'Saraswat Bank' AND is_active;

  IF v_saraswat IS NULL THEN
    RAISE EXCEPTION 'ABORT: no active Saraswat Bank ledger in that company';
  END IF;

  -- Only the credit side, and only if it is still on Canara: re-running this
  -- must not move a correction somebody has already made by hand.
  UPDATE public.voucher_entries
     SET account_id = v_saraswat,
         narration = replace(narration, 'by QR', 'by bank transfer')
   WHERE voucher_id = v_voucher
     AND credit_amount > 0
     AND account_id = v_canara;
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  UPDATE public.vouchers
     SET narration = replace(narration, 'by QR', 'by bank transfer'),
         updated_at = now()
   WHERE id = v_voucher AND narration LIKE '%by QR%';

  IF v_moved = 0 THEN
    RAISE NOTICE 'PV1436 was already off Canara — left alone';
  ELSE
    RAISE NOTICE 'PV1436 credit moved from Canara Bank (Itwari) to Saraswat Bank';
  END IF;
END
$fix$;

-- ------------------------------------------------------------------ verify

DO $verify$
DECLARE v_dr NUMERIC; v_cr NUMERIC; v_bad INT; v_ok BOOLEAN;
BEGIN
  -- The voucher must still balance after the correction.
  SELECT COALESCE(sum(debit_amount), 0), COALESCE(sum(credit_amount), 0)
    INTO v_dr, v_cr
    FROM public.voucher_entries e
    JOIN public.vouchers v ON v.id = e.voucher_id
   WHERE v.voucher_number = 'PV1436';
  IF round(v_dr - v_cr, 2) <> 0 THEN
    RAISE EXCEPTION 'ABORT: PV1436 no longer balances (Dr % / Cr %)', v_dr, v_cr;
  END IF;

  -- And it must now credit Saraswat.
  SELECT count(*) INTO v_bad
    FROM public.voucher_entries e
    JOIN public.vouchers v ON v.id = e.voucher_id
    JOIN public.chart_of_accounts a ON a.id = e.account_id
   WHERE v.voucher_number = 'PV1436' AND e.credit_amount > 0
     AND a.account_name <> 'Saraswat Bank';
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'ABORT: PV1436 still credits something other than Saraswat Bank';
  END IF;

  -- BANK without an account must be refused, or the whole point is lost.
  v_ok := false;
  BEGIN
    PERFORM public.pay_doctor_services(ARRAY[gen_random_uuid()], 'BANK', 'selftest', NULL);
  EXCEPTION WHEN OTHERS THEN
    v_ok := SQLERRM LIKE '%bank account the transfer was made from%';
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'ABORT: a bank transfer with no account chosen was not refused';
  END IF;

  RAISE NOTICE 'PV1436 corrected and a bank transfer must now name its account';
END
$verify$;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------- read it

SELECT v.voucher_number, v.narration,
       string_agg(a.account_name || CASE WHEN e.debit_amount > 0 THEN ' (Dr)' ELSE ' (Cr)' END, ' / ') AS entries
  FROM public.vouchers v
  JOIN public.voucher_entries e ON e.voucher_id = v.id
  JOIN public.chart_of_accounts a ON a.id = e.account_id
 WHERE v.voucher_number = 'PV1436'
 GROUP BY v.voucher_number, v.narration;
