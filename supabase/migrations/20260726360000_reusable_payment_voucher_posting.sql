-- Make the payment voucher posting callable, so a backfill and the trigger
-- cannot drift apart.
--
-- post_payment_voucher_lines is a statement trigger reading a transition
-- table, which means it can only ever run when lines are inserted. The
-- vouchers written before it existed already have their lines, so nothing will
-- ever fire for them.
--
-- The tempting fix is a backfill script that repeats the posting logic in SQL.
-- That is the mistake that has cost the most today: reconstructing behaviour
-- instead of calling it. Two copies of the same rule drift, and the drift
-- shows up as a ledger that disagrees with itself.
--
-- So the body moves into post_one_payment_voucher(id) and the trigger becomes
-- a loop over it. Behaviour is unchanged - the same voucher, the same legs,
-- the same guards - and a backfill is now one call per voucher.

CREATE OR REPLACE FUNCTION public.post_one_payment_voucher(p_voucher_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pv         RECORD;
  v_credit_id  UUID;
  v_company_id UUID;
  v_type_id    UUID;
  v_type_code  TEXT;
  v_voucher_id UUID;
  v_voucher_no TEXT;
  v_reference  TEXT;
  v_narration  TEXT;
  v_total      NUMERIC(15,2);
BEGIN
  SELECT * INTO v_pv FROM payment_vouchers WHERE id = p_voucher_id;
  IF v_pv.id IS NULL THEN
    RETURN NULL;
  END IF;

  v_reference := 'PV-' || v_pv.id::TEXT;

  IF EXISTS (SELECT 1 FROM vouchers
              WHERE reference_number = v_reference AND status <> 'CANCELLED') THEN
    RETURN NULL;
  END IF;

  SELECT id, voucher_type_code INTO v_type_id, v_type_code
    FROM voucher_types
   WHERE voucher_category = 'PAYMENT' AND is_active = true
   ORDER BY CASE voucher_type_code WHEN 'PAY' THEN 1 ELSE 2 END
   LIMIT 1;

  IF v_type_id IS NULL THEN
    RAISE WARNING 'Payment voucher %: no PAYMENT voucher type, nothing posted', v_pv.voucher_no;
    RETURN NULL;
  END IF;

  -- Where the money left from. Petty cash unless the Account ledger names
  -- something else that exists in the chart of accounts.
  v_credit_id := public.adamrit_ledger_by_name(v_pv.account_ledger_name, '1110');

  -- hospital_type is the same 'ayushman' / anything-else distinction the
  -- patient ledgers use, so the same resolver decides the company.
  v_company_id := public.resolve_patient_company(v_pv.hospital_type, NULL);

  v_narration := 'Payment voucher ' || COALESCE(v_pv.voucher_no, v_reference)
                 || COALESCE(' - ' || NULLIF(btrim(v_pv.narration), ''),
                      COALESCE(' - ' || NULLIF(btrim(v_pv.purpose), ''), ''));

  v_voucher_id := gen_random_uuid();
  v_voucher_no := generate_voucher_number(v_type_code);

  INSERT INTO vouchers (
    id, voucher_number, voucher_type_id, voucher_date, reference_number,
    narration, total_amount, company_id, status, created_by, created_at, updated_at
  ) VALUES (
    v_voucher_id, v_voucher_no, v_type_id,
    COALESCE(v_pv.voucher_date, CURRENT_DATE),
    v_reference, v_narration, 0, v_company_id, 'AUTHORISED',
    COALESCE(NULLIF(btrim(v_pv.paid_by), ''), 'payment-voucher'), NOW(), NOW()
  );

  -- One debit per particulars line, and the credit derived from what was
  -- actually posted rather than from the header total, so a header that
  -- disagrees with its own lines cannot unbalance the voucher.
  WITH posted AS (
    INSERT INTO voucher_entries (
      id, voucher_id, account_id, narration, debit_amount, credit_amount,
      entry_order, created_at
    )
    SELECT gen_random_uuid(), v_voucher_id,
           public.adamrit_ledger_by_name(l.ledger_name, '5900'),
           COALESCE(NULLIF(btrim(l.ledger_name), ''), 'Petty cash') || ' - ' || v_narration,
           ROUND(COALESCE(l.amount, 0), 2), 0,
           COALESCE(l.line_order, 0) + 1, NOW()
      FROM payment_voucher_lines l
     WHERE l.voucher_id = v_pv.id
       AND COALESCE(l.amount, 0) > 0
    RETURNING debit_amount
  )
  SELECT COALESCE(SUM(debit_amount), 0) INTO v_total FROM posted;

  -- A voucher with no usable lines is not an entry.
  IF v_total <= 0 THEN
    DELETE FROM vouchers WHERE id = v_voucher_id;
    RETURN NULL;
  END IF;

  INSERT INTO voucher_entries (
    id, voucher_id, account_id, narration, debit_amount, credit_amount,
    entry_order, created_at
  ) VALUES (
    gen_random_uuid(), v_voucher_id, v_credit_id,
    'Paid from ' || COALESCE(NULLIF(btrim(v_pv.account_ledger_name), ''), 'Cash in Hand')
    || ' - ' || v_narration,
    0, v_total, 9999, NOW()
  );

  UPDATE vouchers SET total_amount = v_total WHERE id = v_voucher_id;

  RETURN v_voucher_no;
END;
$$;

-- The trigger is now only a loop. Same entry point, same trigger definition.
CREATE OR REPLACE FUNCTION public.post_payment_voucher_lines()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  FOR v_id IN SELECT DISTINCT voucher_id FROM new_lines LOOP
    PERFORM public.post_one_payment_voucher(v_id);
  END LOOP;
  RETURN NULL;
END;
$$;
