-- Accrue a pharmacy sale made on credit, and settle it when the patient pays.
--
-- A cash sale already behaves correctly: trg_pharmacy_sale_record_payment fires
-- for anything not PENDING, and income is recognised the same day the medicine
-- leaves - sale and payment are the same moment, so nothing is misstated.
--
-- A credit sale is the gap. Nothing at all posts when the medicine is handed
-- over, so the amount owed exists nowhere. When the patient eventually pays,
-- create_voucher_for_pharmacy_credit_payment credits 4000 INCOME - a group
-- header rather than an income leaf - and clears no receivable, because none
-- was ever raised.
--
-- So:
--   medicine handed over on credit   Dr patient   Cr 4150 Medicine Sales
--   patient pays later               Dr bank      Cr patient
--
-- Same shape as the patient bill accrual. And as there, the payment leg has to
-- stop crediting income at the same time, or every credit sale would be
-- counted twice - once when accrued and again when collected.

INSERT INTO public.chart_of_accounts
  (account_code, account_name, account_type, account_group,
   opening_balance, opening_balance_type, is_active)
VALUES
  ('1470', 'Pharmacy Debtors', 'CURRENT_ASSETS', 'Sundry Debtors', 0, 'DR', true)
ON CONFLICT (account_code) DO NOTHING;

-- ------------------------------------------------------------------
-- Which ledger carries the debt. The patient's own where we can find it,
-- otherwise a pharmacy debtors account so the receivable still exists.
-- pharmacy_sales.patient_id is text that may or may not hold a uuid, so it is
-- checked before casting - the same guard the existing pharmacy trigger uses.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pharmacy_debtor_ledger(p_patient_id TEXT)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uuid UUID;
  v_id   UUID;
BEGIN
  IF COALESCE(btrim(p_patient_id), '') ~
     '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_uuid := p_patient_id::UUID;

    SELECT pl.account_id INTO v_id FROM patient_ledgers pl WHERE pl.patient_id = v_uuid;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;

    SELECT a.id INTO v_id
      FROM chart_of_accounts a
      JOIN patients p ON a.account_code = 'PT' || p.patients_id
     WHERE p.id = v_uuid;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;

  SELECT id INTO v_id FROM chart_of_accounts WHERE account_code = '1470';
  RETURN v_id;
END;
$$;

-- ------------------------------------------------------------------
-- Accrue the sale.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accrue_pharmacy_credit_sale()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_amount     NUMERIC(15,2);
  v_debtor_id  UUID;
  v_income_id  UUID;
  v_type_id    UUID;
  v_type_code  TEXT;
  v_voucher_id UUID;
  v_voucher_no TEXT;
  v_reference  TEXT;
  v_narration  TEXT;
BEGIN
  v_reference := 'PHARM-CR-' || COALESCE(NEW.sale_id, OLD.sale_id)::TEXT;

  -- A cancelled or refunded credit sale retires its accrual.
  IF TG_OP = 'UPDATE'
     AND upper(COALESCE(NEW.payment_status, '')) IN ('CANCELLED', 'REFUNDED')
     AND upper(COALESCE(OLD.payment_status, '')) = 'PENDING' THEN
    UPDATE vouchers
       SET status = 'CANCELLED', last_modified_by = 'pharmacy-sale-cancelled', updated_at = now()
     WHERE reference_number = v_reference AND status <> 'CANCELLED';
    RETURN NEW;
  END IF;

  -- Only credit sales accrue. Anything already paid is handled by the existing
  -- receipt path and recognising it here as well would double the income.
  IF upper(COALESCE(NEW.payment_status, '')) <> 'PENDING' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM vouchers
              WHERE reference_number = v_reference AND status <> 'CANCELLED') THEN
    RETURN NEW;
  END IF;

  v_amount := GREATEST(COALESCE(NEW.total_amount, 0), 0);
  IF v_amount <= 0 THEN
    RETURN NEW;
  END IF;

  v_debtor_id := public.pharmacy_debtor_ledger(NEW.patient_id::TEXT);
  SELECT id INTO v_income_id FROM chart_of_accounts WHERE account_code = '4150';

  SELECT id, voucher_type_code INTO v_type_id, v_type_code
    FROM voucher_types
   WHERE voucher_category = 'SALES' AND is_active = true
   ORDER BY CASE voucher_type_code WHEN 'SV' THEN 1 WHEN 'SAL' THEN 2 ELSE 3 END
   LIMIT 1;

  IF v_type_id IS NULL OR v_debtor_id IS NULL OR v_income_id IS NULL THEN
    RAISE WARNING 'Pharmacy sale %: accounts or voucher type missing, nothing accrued',
      NEW.bill_number;
    RETURN NEW;
  END IF;

  v_voucher_id := gen_random_uuid();
  v_voucher_no := generate_voucher_number(v_type_code);
  v_narration  := 'Pharmacy credit sale ' || COALESCE(NEW.bill_number, v_reference)
                  || COALESCE(' - ' || NULLIF(btrim(NEW.patient_name), ''), '');

  INSERT INTO vouchers (
    id, voucher_number, voucher_type_id, voucher_date, reference_number,
    narration, total_amount, status, created_by, created_at, updated_at
  ) VALUES (
    v_voucher_id, v_voucher_no, v_type_id,
    COALESCE(NULLIF(NEW.sale_date::TEXT, '')::DATE, CURRENT_DATE),
    v_reference, v_narration, v_amount, 'AUTHORISED',
    COALESCE(NEW.created_by::TEXT, 'pharmacy-accrual'), NOW(), NOW()
  );

  INSERT INTO voucher_entries (
    id, voucher_id, account_id, narration, debit_amount, credit_amount,
    entry_order, created_at
  ) VALUES
    (gen_random_uuid(), v_voucher_id, v_debtor_id, v_narration, v_amount, 0, 1, NOW()),
    (gen_random_uuid(), v_voucher_id, v_income_id, v_narration, 0, v_amount, 2, NOW());

  RAISE NOTICE 'Pharmacy sale %: accrued %', NEW.bill_number, v_amount;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_accrue_pharmacy_credit_sale ON public.pharmacy_sales;
CREATE TRIGGER trg_accrue_pharmacy_credit_sale
AFTER INSERT OR UPDATE OF payment_status ON public.pharmacy_sales
FOR EACH ROW
EXECUTE FUNCTION public.accrue_pharmacy_credit_sale();

-- ------------------------------------------------------------------
-- The payment now settles the debt instead of booking income again.
-- Only the credit leg changes; the bank routing is left as it was.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.settle_pharmacy_credit_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_debtor_id  UUID;
  v_bank_id    UUID;
  v_type_id    UUID;
  v_type_code  TEXT;
  v_voucher_id UUID;
  v_voucher_no TEXT;
  v_amount     NUMERIC(15,2);
  v_narration  TEXT;
BEGIN
  v_amount := GREATEST(COALESCE(NEW.amount, 0), 0);
  IF v_amount <= 0 THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM vouchers
              WHERE reference_number = NEW.id::TEXT AND status <> 'CANCELLED') THEN
    RETURN NEW;
  END IF;

  -- Pharmacy money lands in the Canara pharmacy account unless it is cash.
  IF upper(COALESCE(NEW.payment_method, '')) IN ('CASH', '') THEN
    SELECT id INTO v_bank_id FROM chart_of_accounts WHERE account_code = '1110';
  ELSE
    SELECT id INTO v_bank_id FROM chart_of_accounts
     WHERE account_code = '1124' AND is_active;
    IF v_bank_id IS NULL THEN
      SELECT id INTO v_bank_id FROM chart_of_accounts WHERE account_code = '1110';
    END IF;
  END IF;

  v_debtor_id := public.pharmacy_debtor_ledger(
                   COALESCE(NEW.patient_uuid::TEXT, NEW.patient_id::TEXT));

  SELECT id, voucher_type_code INTO v_type_id, v_type_code
    FROM voucher_types
   WHERE voucher_category = 'RECEIPT' AND is_active = true
   ORDER BY CASE voucher_type_code WHEN 'REC' THEN 1 WHEN 'RV' THEN 2 ELSE 3 END
   LIMIT 1;

  IF v_type_id IS NULL OR v_bank_id IS NULL OR v_debtor_id IS NULL THEN
    RAISE WARNING 'Pharmacy credit payment %: accounts missing, nothing posted', NEW.id;
    RETURN NEW;
  END IF;

  v_voucher_id := gen_random_uuid();
  v_voucher_no := generate_voucher_number(v_type_code);
  v_narration  := 'Pharmacy credit settled'
                  || COALESCE(' - ' || NULLIF(btrim(NEW.patient_name), ''), '');

  INSERT INTO vouchers (
    id, voucher_number, voucher_type_id, voucher_date, reference_number,
    narration, total_amount, status, created_by, created_at, updated_at
  ) VALUES (
    v_voucher_id, v_voucher_no, v_type_id,
    COALESCE(NULLIF(NEW.payment_date::TEXT, '')::DATE, CURRENT_DATE),
    NEW.id::TEXT, v_narration, v_amount, 'AUTHORISED',
    COALESCE(NEW.received_by::TEXT, 'pharmacy-credit'), NOW(), NOW()
  );

  INSERT INTO voucher_entries (
    id, voucher_id, account_id, narration, debit_amount, credit_amount,
    entry_order, created_at
  ) VALUES
    (gen_random_uuid(), v_voucher_id, v_bank_id,   v_narration, v_amount, 0, 1, NOW()),
    (gen_random_uuid(), v_voucher_id, v_debtor_id, v_narration, 0, v_amount, 2, NOW());

  RETURN NEW;
END;
$$;

-- Replace the old trigger, which credited the 4000 group header and settled
-- nothing. Only this one trigger is re-pointed; nothing else is touched.
DROP TRIGGER IF EXISTS trigger_pharmacy_credit_payment_voucher ON public.pharmacy_credit_payments;
DROP TRIGGER IF EXISTS trg_settle_pharmacy_credit_payment ON public.pharmacy_credit_payments;
CREATE TRIGGER trg_settle_pharmacy_credit_payment
AFTER INSERT ON public.pharmacy_credit_payments
FOR EACH ROW
EXECUTE FUNCTION public.settle_pharmacy_credit_payment();
