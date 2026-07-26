-- Make the obligation voucher look like every other voucher in the ledger.
--
-- The function now posts, but its voucher does not match the house style, and
-- a ledger where one stream reads differently is harder to audit than one that
-- is uniformly plain.
--
-- Against post_one_payment_voucher, which is the closest analogue - also a
-- Payment voucher, also Dr expense / Cr cash - three things differed:
--
--   reference_number  was the bare schedule id. Every other stream prefixes
--                     it: PV-, YOJNA-, IMPLANT-, PHYSIO-, DSALE-. Without one
--                     an obligation payment cannot be told from anything else
--                     by its reference alone. Now OBL-.
--
--   narration         was 'Payment to X for category (Schedule: date)'.
--                     Elsewhere it opens with what the voucher is and its
--                     number, so a Day Book line is self-describing. Now
--                     'Obligation payment PAY-000123 - NephroPlus (dialysis)
--                     for 2026-07-26'.
--
--   entry narration   the legs carried a short phrase rather than the
--                     voucher's own narration. Tally shows the leg narration
--                     in a ledger view, so a ledger opened on Rent should read
--                     the same story the Day Book does. Both legs now carry
--                     it, the credit prefixed 'Paid from Cash in Hand', which
--                     is what the petty cash path does.
--
-- entry_order on the credit leg moves to 9999, again matching petty cash, so
-- the money-out line sorts last however many debit lines precede it.
--
-- Nothing about the accounting changes: same amounts, same two ledgers, same
-- direction, same write-back to daily_payment_schedule, same return value.

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
  v_narration          TEXT;
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

  v_narration := 'Obligation payment ' || v_voucher_number
                 || ' - ' || v_schedule.party_name
                 || COALESCE(' (' || NULLIF(btrim(v_schedule.category), '') || ')', '')
                 || ' for ' || v_schedule.schedule_date;

  INSERT INTO vouchers (
    voucher_number, voucher_type_id, voucher_date, total_amount, narration,
    company_id, status, created_by, reference_number
  )
  VALUES (
    v_voucher_number, v_type_id, v_schedule.schedule_date, p_amount,
    v_narration,
    v_company_id, 'AUTHORISED',
    COALESCE(NULLIF(btrim(p_user_id), ''), 'obligation-payment'),
    'OBL-' || p_schedule_id::TEXT
  )
  RETURNING id INTO v_voucher_id;

  IF v_expense_account_id IS NOT NULL THEN
    INSERT INTO voucher_entries
      (voucher_id, account_id, debit_amount, credit_amount, narration, entry_order)
    VALUES
      (v_voucher_id, v_expense_account_id, p_amount, 0,
       v_schedule.party_name || ' - ' || v_narration, 1);
  END IF;

  IF v_cash_account_id IS NOT NULL THEN
    INSERT INTO voucher_entries
      (voucher_id, account_id, debit_amount, credit_amount, narration, entry_order)
    VALUES
      (v_voucher_id, v_cash_account_id, 0, p_amount,
       'Paid from Cash in Hand - ' || v_narration, 9999);
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
