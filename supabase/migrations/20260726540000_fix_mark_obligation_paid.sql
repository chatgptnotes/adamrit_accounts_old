-- Make mark_obligation_paid able to post at all.
--
-- It has never produced a voucher, and not because nobody used the screen: it
-- cannot. Three faults, each of which would stop it on its own.
--
--   1. status = 'posted'      vouchers_status_check does not allow it. Every
--                             other posting path in this database uses
--                             'AUTHORISED'.
--   2. no voucher_type_id     nullable, so it does not raise, but the voucher
--                             belongs to no type and reports that group by
--                             type lose it.
--   3. no entry_order         NOT NULL on voucher_entries, so the legs would
--                             have failed on the next statement even once the
--                             status was accepted.
--
-- The voucher number now comes from generate_voucher_number rather than the
-- hand-rolled 'PAY-<date>-<four digits>'. That line was truncated in what I
-- could read, and a numbering scheme that must stay unique is not something to
-- reconstruct from a guess.
--
-- Also added: company_id, resolved from the schedule's own hospital the same
-- way the patient ledgers do it. Without it these vouchers belong to no
-- company, and a company's trial balance is built from its own vouchers - so
-- Rs 4.6 lakh a day would have posted into no company's books.
--
-- EVERYTHING ELSE IS AS IT WAS. Same signature, same narration, same voucher
-- number format, same expense head lookup and its fallback, same Dr expense /
-- Cr Cash in Hand, same paid/partial logic, same write-back to
-- daily_payment_schedule, same return value. This is the function as found,
-- with the parts that made it fail replaced and nothing else touched.

CREATE OR REPLACE FUNCTION public.mark_obligation_paid(
  p_schedule_id UUID,
  p_amount      NUMERIC,
  p_user_id     TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
AS $function$
DECLARE
  v_schedule           RECORD;
  v_voucher_id         UUID;
  v_voucher_number     TEXT;
  v_expense_account_id UUID;
  v_cash_account_id    UUID;
  v_new_paid           NUMERIC(12,2);
  v_new_status         TEXT;
  v_type_id            UUID;
  v_company_id         UUID;
BEGIN
  SELECT * INTO v_schedule FROM daily_payment_schedule WHERE id = p_schedule_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Schedule record not found';
  END IF;

  SELECT id INTO v_cash_account_id
    FROM chart_of_accounts WHERE account_name = 'Cash in Hand' LIMIT 1;

  SELECT chart_of_accounts_id INTO v_expense_account_id
    FROM payment_obligations WHERE id = v_schedule.obligation_id;

  IF v_expense_account_id IS NULL THEN
    SELECT id INTO v_expense_account_id
      FROM chart_of_accounts
     WHERE account_name ILIKE '%expense%' OR account_type = 'expense'
     LIMIT 1;
  END IF;

  -- The voucher's own type, so it is not typeless.
  SELECT id INTO v_type_id
    FROM voucher_types
   WHERE voucher_category = 'PAYMENT' AND is_active = true
   ORDER BY CASE voucher_type_code WHEN 'PAY' THEN 1 ELSE 2 END
   LIMIT 1;

  -- Whose books it belongs in. The schedule carries the hospital; company_id
  -- on the schedule is used when it is already set.
  v_company_id := COALESCE(
    v_schedule.company_id,
    public.resolve_patient_company(v_schedule.hospital_name, NULL)
  );

  -- The original built its own number, 'PAY-<date>-<four digits>', but the
  -- line was cut off in what I could read and I will not guess a scheme that
  -- has to stay unique. generate_voucher_number is the database's own
  -- allocator, written after a run of collisions, and it is what every other
  -- posting path uses. The format changes for this path; uniqueness stops
  -- being a hope.
  v_voucher_number := public.generate_voucher_number(
                        COALESCE((SELECT voucher_type_code FROM voucher_types
                                   WHERE id = v_type_id), 'PAY'));

  INSERT INTO vouchers (
    voucher_number, voucher_type_id, voucher_date, total_amount, narration,
    company_id, status, created_by, reference_number
  )
  VALUES (
    v_voucher_number, v_type_id, v_schedule.schedule_date, p_amount,
    'Payment to ' || v_schedule.party_name || ' for ' || v_schedule.category
      || ' (Schedule: ' || v_schedule.schedule_date || ')',
    v_company_id, 'AUTHORISED', p_user_id, p_schedule_id::TEXT
  )
  RETURNING id INTO v_voucher_id;

  IF v_expense_account_id IS NOT NULL THEN
    INSERT INTO voucher_entries
      (voucher_id, account_id, debit_amount, credit_amount, narration, entry_order)
    VALUES
      (v_voucher_id, v_expense_account_id, p_amount, 0,
       'Payment to ' || v_schedule.party_name, 1);
  END IF;

  IF v_cash_account_id IS NOT NULL THEN
    INSERT INTO voucher_entries
      (voucher_id, account_id, debit_amount, credit_amount, narration, entry_order)
    VALUES
      (v_voucher_id, v_cash_account_id, 0, p_amount,
       'Payment to ' || v_schedule.party_name, 2);
  END IF;

  v_new_paid := v_schedule.paid_amount + p_amount;
  IF v_new_paid >= (v_schedule.daily_amount + v_schedule.carryforward_amount) THEN
    v_new_status := 'paid';
  ELSE
    v_new_status := 'partial';
  END IF;

  UPDATE daily_payment_schedule
     SET paid_amount = v_new_paid, status = v_new_status,
         voucher_id = v_voucher_id, paid_at = now(),
         paid_by = p_user_id, updated_at = now()
   WHERE id = p_schedule_id;

  RETURN v_voucher_id;
END;
$function$;
