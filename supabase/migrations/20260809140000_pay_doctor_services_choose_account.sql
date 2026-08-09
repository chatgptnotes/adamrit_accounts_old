-- Let the caller choose the cash/bank ledger a doctor payout leaves from.
--
-- pay_doctor_services picked the account itself: the company's first "Cash"
-- ledger for a cash payout, its first bank-group ledger for a QR one. That is
-- fine on the Akshay tablet tile, where whoever pays is standing at the one
-- counter, but the Expense Bill page pays from whichever account accounting
-- decides, and had no way to say so.
--
-- p_credit_account_id is optional and defaults to NULL, so every existing
-- caller keeps the old auto-pick behaviour untouched.
--
-- The old 3-argument function is dropped rather than left alongside: adding a
-- parameter with a default creates an OVERLOAD, and a 3-argument call would
-- then be ambiguous ("function is not unique") instead of resolving.
--
-- Safe to run twice. Applied through apply_migration(), which supplies the
-- transaction, so this file carries no BEGIN/COMMIT of its own.

DROP FUNCTION IF EXISTS public.pay_doctor_services(UUID[], TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.pay_doctor_services(
  p_log_ids           UUID[],
  p_payment_mode      TEXT,           -- 'QR' or 'CASH'
  p_paid_by           TEXT DEFAULT NULL,
  -- The cash/bank ledger to credit. NULL keeps the original auto-pick.
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
  IF v_mode NOT IN ('QR', 'CASH') THEN
    RAISE EXCEPTION 'Payment mode must be QR or CASH';
  END IF;
  IF p_log_ids IS NULL OR array_length(p_log_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Select at least one service to pay';
  END IF;

  -- Lock the rows and validate them as a set.
  PERFORM 1 FROM public.rupali_visit_logs WHERE id = ANY (p_log_ids) FOR UPDATE;

  SELECT count(*) INTO v_count FROM public.rupali_visit_logs WHERE id = ANY (p_log_ids);
  IF v_count <> array_length(p_log_ids, 1) THEN
    RAISE EXCEPTION 'One of the selected services no longer exists';
  END IF;
  IF EXISTS (SELECT 1 FROM public.rupali_visit_logs
              WHERE id = ANY (p_log_ids) AND paid_voucher_id IS NOT NULL) THEN
    RAISE EXCEPTION 'One of the selected services is already paid';
  END IF;
  IF EXISTS (SELECT 1 FROM public.rupali_visit_logs
              WHERE id = ANY (p_log_ids) AND voucher_id IS NULL) THEN
    RAISE EXCEPTION 'One of the selected services has no journal — it cannot be paid';
  END IF;
  SELECT count(DISTINCT lower(btrim(doctor_name))) INTO v_count
    FROM public.rupali_visit_logs WHERE id = ANY (p_log_ids);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Pay one doctor at a time';
  END IF;
  SELECT max(doctor_name) INTO v_doctor
    FROM public.rupali_visit_logs WHERE id = ANY (p_log_ids);

  -- A chosen account belongs to exactly one company's books, so it cannot
  -- cover a selection whose journals span two.
  IF p_credit_account_id IS NOT NULL THEN
    SELECT count(DISTINCT v.company_id) INTO v_count
      FROM public.rupali_visit_logs l
      JOIN public.vouchers v ON v.id = l.voucher_id
     WHERE l.id = ANY (p_log_ids);
    IF v_count <> 1 THEN
      RAISE EXCEPTION 'These services belong to more than one company — pay one company at a time when choosing the account';
    END IF;
  END IF;

  SELECT id, voucher_type_code INTO v_type_id, v_type_code
    FROM public.voucher_types
   WHERE voucher_category = 'PAYMENT' AND is_active = true
   ORDER BY CASE voucher_type_code WHEN 'PV' THEN 1 ELSE 2 END
   LIMIT 1;
  IF v_type_id IS NULL THEN
    RAISE EXCEPTION 'No active Payment voucher type is configured';
  END IF;

  -- One payment voucher per company the services were booked in.
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

    -- The exact ledger the JVs credited — the doctor's own.
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
      -- QR: scanned with the hospital mobile, paid from the company's bank.
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
           || CASE WHEN v_mode = 'QR' THEN 'QR' ELSE 'cash' END
           || ', against ' || v_jv_list;

    INSERT INTO public.vouchers (
      id, voucher_number, voucher_type_id, voucher_date, narration, total_amount,
      company_id, status, is_auto, pay_to, created_by, created_at, updated_at
    ) VALUES (
      v_voucher_id, v_voucher_no, v_type_id, current_date, v_narr, v_amount,
      v_company.company_id, 'AUTHORISED', true, v_doctor, v_user, now(), now()
    );
    INSERT INTO public.voucher_entries (
      id, voucher_id, account_id, narration, debit_amount, credit_amount, entry_order, created_at
    ) VALUES
      (gen_random_uuid(), v_voucher_id, v_party,  v_narr, v_amount, 0, 1, now()),
      (gen_random_uuid(), v_voucher_id, v_credit, v_narr, 0, v_amount, 2, now());

    UPDATE public.rupali_visit_logs l
       SET paid_voucher_id = v_voucher_id,
           paid_at = now(),
           paid_by = v_user
     WHERE l.id = ANY (p_log_ids)
       AND EXISTS (SELECT 1 FROM public.vouchers v
                    WHERE v.id = l.voucher_id AND v.company_id = v_company.company_id);

    v_results := v_results || jsonb_build_object(
      'companyKey',    v_company.company_key,
      'companyName',   v_company.company_name,
      'voucherId',     v_voucher_id,
      'voucherNumber', v_voucher_no,
      'amount',        v_amount
    );
  END LOOP;

  RETURN jsonb_build_object('doctor', v_doctor, 'payments', v_results);
END;
$function$;

REVOKE ALL ON FUNCTION public.pay_doctor_services(UUID[], TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pay_doctor_services(UUID[], TEXT, TEXT, UUID) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ------------------------------------------------------------------
-- Proof
-- ------------------------------------------------------------------
DO $verify$
DECLARE
  v_overloads INT;
BEGIN
  -- Exactly one pay_doctor_services, so a 3-argument call is never ambiguous.
  SELECT count(*) INTO v_overloads
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'pay_doctor_services';
  IF v_overloads <> 1 THEN
    RAISE EXCEPTION 'expected 1 pay_doctor_services, found %', v_overloads;
  END IF;

  -- The mode guard still fires, and still fires before anything is written.
  BEGIN
    PERFORM public.pay_doctor_services(ARRAY['00000000-0000-0000-0000-000000000001'::uuid], 'UPI', 'verify');
    RAISE EXCEPTION 'verification did not reach the expected guard';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      IF SQLERRM NOT LIKE '%QR or CASH%' THEN
        RAISE EXCEPTION 'unexpected guard: %', SQLERRM;
      END IF;
  END;

  -- A chosen account that is not a real ledger must be refused, not ignored.
  BEGIN
    PERFORM public.pay_doctor_services(
      ARRAY['00000000-0000-0000-0000-000000000001'::uuid], 'CASH', 'verify',
      '00000000-0000-0000-0000-000000000002'::uuid);
    RAISE EXCEPTION 'verification did not reach the expected guard';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      IF SQLERRM NOT LIKE '%no longer exists%' THEN
        RAISE EXCEPTION 'unexpected guard: %', SQLERRM;
      END IF;
  END;

  RAISE NOTICE 'OK — pay_doctor_services accepts a chosen account and its guards hold';
END;
$verify$;
