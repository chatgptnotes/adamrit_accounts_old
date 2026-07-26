-- Record the over-the-counter pharmacy sale, so a walk-in bill reaches the
-- ledger. The last stream that records money and posts nothing.
--
-- /direct-sale rings up a walk-in customer. The only trigger on the table keeps
-- updated_at fresh, so the sale exists as a printed bill and nowhere else.
--
--     Dr  cash or the pharmacy bank      the bill total
--         Cr  4150 Medicine Sales             same amount
--
-- Sale and payment are the same moment at a counter, so there is no receivable
-- and nothing to settle later. One voucher finishes it.
--
-- ONE ROW PER MEDICINE LINE. DirectSaleBill.tsx:495-526 inserts a row for every
-- item on the bill, all sharing bill_number, and repeats the WHOLE bill's total
-- on each one. The line's own value is in `amount`. Summing total_amount across
-- rows therefore multiplies each bill by its line count: 105 real bills read as
-- Rs 34,748.53 that way against a true Rs 16,164.01, more than double. So this
-- groups by bill_number and takes the total once.
--
-- The rows arrive in a single multi-row insert, so this is a statement-level
-- trigger reading the transition table - the same shape as the petty cash
-- lines. It re-reads each bill from the table rather than the transition table,
-- so a bill split across two statements still posts once and posts whole.
--
-- NO BACKFILL. All 105 existing bills predate 2026-07-25 and are inside the
-- Tally opening balances. There has been no direct sale since the cutover, so
-- there is nothing to catch up - this is for the next one.

CREATE OR REPLACE FUNCTION public.post_one_direct_sale(p_bill_number TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b            RECORD;
  v_amount     NUMERIC(15,2);
  v_money_id   UUID;
  v_income_id  UUID;
  v_company_id UUID;
  v_type_id    UUID;
  v_type_code  TEXT;
  v_voucher_id UUID;
  v_voucher_no TEXT;
  v_reference  TEXT;
  v_narration  TEXT;
BEGIN
  v_reference := 'DSALE-' || p_bill_number;

  IF EXISTS (SELECT 1 FROM vouchers
              WHERE reference_number = v_reference AND status <> 'CANCELLED') THEN
    RETURN NULL;
  END IF;

  -- The bill's own total, taken once rather than summed across its lines.
  -- sum(amount) is the fallback, since the lines are what the total is made of.
  SELECT max(COALESCE(d.net_amount, d.total_amount, 0)) AS stated,
         COALESCE(sum(d.amount), 0)                     AS from_lines,
         max(d.payment_mode)                            AS payment_mode,
         max(d.bill_date::DATE)                         AS bill_date,
         max(d.patient_name)                            AS customer,
         max(d.created_by)                              AS created_by
    INTO b
    FROM direct_sale_bills d
   WHERE d.bill_number = p_bill_number;

  v_amount := GREATEST(COALESCE(NULLIF(b.stated, 0), b.from_lines, 0), 0);
  IF v_amount <= 0 THEN
    RETURN NULL;
  END IF;

  -- Cash at the counter, otherwise the pharmacy's own bank account, which is
  -- where card and UPI settle. Same routing the pharmacy receipt path uses.
  IF upper(COALESCE(b.payment_mode, '')) IN ('CASH', '') THEN
    SELECT id INTO v_money_id FROM chart_of_accounts WHERE account_code = '1110';
  ELSE
    SELECT id INTO v_money_id FROM chart_of_accounts
     WHERE account_code = '1124' AND is_active;
    IF v_money_id IS NULL THEN
      SELECT id INTO v_money_id FROM chart_of_accounts WHERE account_code = '1110';
    END IF;
  END IF;

  SELECT id INTO v_income_id FROM chart_of_accounts WHERE account_code = '4150';
  SELECT id INTO v_company_id FROM companies WHERE company_key = 'hope_pharmacy';

  SELECT id, voucher_type_code INTO v_type_id, v_type_code
    FROM voucher_types
   WHERE voucher_category = 'SALES' AND is_active = true
   ORDER BY CASE voucher_type_code WHEN 'SV' THEN 1 WHEN 'SAL' THEN 2 ELSE 3 END
   LIMIT 1;

  IF v_type_id IS NULL OR v_money_id IS NULL OR v_income_id IS NULL THEN
    RAISE WARNING 'Direct sale %: accounts or voucher type missing, nothing posted',
      p_bill_number;
    RETURN NULL;
  END IF;

  v_voucher_id := gen_random_uuid();
  v_voucher_no := generate_voucher_number(v_type_code);
  v_narration  := 'Direct sale ' || p_bill_number
                  || COALESCE(' - ' || NULLIF(btrim(b.customer), ''), '');

  INSERT INTO vouchers (
    id, voucher_number, voucher_type_id, voucher_date, reference_number,
    narration, total_amount, company_id, status, created_by, created_at, updated_at
  ) VALUES (
    v_voucher_id, v_voucher_no, v_type_id,
    COALESCE(b.bill_date, CURRENT_DATE),
    v_reference, v_narration, v_amount, v_company_id, 'AUTHORISED',
    COALESCE(NULLIF(btrim(b.created_by), ''), 'direct-sale'), NOW(), NOW()
  );

  INSERT INTO voucher_entries (
    id, voucher_id, account_id, narration, debit_amount, credit_amount,
    entry_order, created_at
  ) VALUES
    (gen_random_uuid(), v_voucher_id, v_money_id,  v_narration, v_amount, 0, 1, NOW()),
    (gen_random_uuid(), v_voucher_id, v_income_id, v_narration, 0, v_amount, 2, NOW());

  IF abs(COALESCE(b.stated, 0) - COALESCE(b.from_lines, 0)) > 0.005 THEN
    RAISE WARNING 'Direct sale %: bill total % differs from its lines %, posted the total',
      p_bill_number, b.stated, b.from_lines;
  END IF;

  RETURN v_voucher_no;
END;
$$;

CREATE OR REPLACE FUNCTION public.post_direct_sale_bills()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bill TEXT;
BEGIN
  FOR v_bill IN
    SELECT DISTINCT bill_number FROM new_rows WHERE bill_number IS NOT NULL
  LOOP
    PERFORM public.post_one_direct_sale(v_bill);
  END LOOP;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_post_direct_sale_bills ON public.direct_sale_bills;
CREATE TRIGGER trg_post_direct_sale_bills
AFTER INSERT ON public.direct_sale_bills
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.post_direct_sale_bills();
