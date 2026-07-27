-- Let a goods receipt say whether it was paid on the spot or is owed.
--
-- Every GRN has been treated as credit: Dr 5110 Medicine Purchase, Cr the
-- supplier. That is right for a purchase on account, and it is what most of
-- them are. But there has been no way to say a purchase was paid at the
-- counter, so cash purchases raised a supplier balance that was never owed and
-- had to be settled by hand afterwards - or was not, and the creditor stayed
-- overstated.
--
-- payment_terms defaults to CREDIT, which is both the common case and exactly
-- what happens today, so nothing changes for a GRN that does not set it.
--
-- A CASH purchase raises the supplier and settles it in the same voucher:
--
--     Dr  5110 Medicine Purchase      the invoice
--         Cr  <the supplier>              the invoice
--     Dr  <the supplier>              the invoice
--         Cr  1110 Cash in Hand           the invoice
--
-- rather than the shorter Dr Purchase / Cr Cash. The supplier nets to zero
-- either way, but this keeps the purchase in their ledger, so their trading
-- history stays complete and Tally shows it the same way. Both legs carry the
-- invoice number as bill_ref, so the raise and the settlement are linked.

ALTER TABLE public.goods_received_notes
  ADD COLUMN IF NOT EXISTS payment_terms TEXT NOT NULL DEFAULT 'CREDIT';

ALTER TABLE public.goods_received_notes
  DROP CONSTRAINT IF EXISTS goods_received_notes_payment_terms_check;
ALTER TABLE public.goods_received_notes
  ADD CONSTRAINT goods_received_notes_payment_terms_check
  CHECK (upper(payment_terms) IN ('CREDIT', 'CASH'));

COMMENT ON COLUMN public.goods_received_notes.payment_terms IS
  'CREDIT leaves the supplier owed. CASH settles them in the same voucher, '
  'out of Cash in Hand. Defaults to CREDIT, which is what every GRN did before '
  'this column existed.';

CREATE OR REPLACE FUNCTION public.post_grn_supplier_bill()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_amount        NUMERIC(15,2);
  v_supplier      RECORD;
  v_credit_id     UUID;
  v_debit_id      UUID;
  v_cash_id       UUID;
  v_company_id    UUID;
  v_type_id       UUID;
  v_type_code     TEXT;
  v_voucher_id    UUID;
  v_voucher_no    TEXT;
  v_reference     TEXT;
  v_narration     TEXT;
  v_bill_ref      TEXT;
  v_is_cash       BOOLEAN;
BEGIN
  IF upper(COALESCE(NEW.status, '')) <> 'POSTED' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND upper(COALESCE(OLD.status, '')) = 'POSTED' THEN
    RETURN NEW;
  END IF;

  v_reference := NEW.id::TEXT;

  IF EXISTS (SELECT 1 FROM vouchers
              WHERE reference_number = v_reference AND status <> 'CANCELLED') THEN
    RETURN NEW;
  END IF;

  v_amount := GREATEST(COALESCE(NULLIF(NEW.invoice_amount, 0), NEW.total_amount, 0), 0);
  IF v_amount <= 0 THEN
    RAISE WARNING 'GRN %: no invoice amount, nothing accrued', NEW.grn_number;
    RETURN NEW;
  END IF;

  v_is_cash := upper(COALESCE(NEW.payment_terms, 'CREDIT')) = 'CASH';

  SELECT supplier_name, ledger_account_id
    INTO v_supplier
    FROM suppliers
   WHERE id = NEW.supplier_id;

  v_credit_id := v_supplier.ledger_account_id;
  IF v_credit_id IS NULL THEN
    SELECT id INTO v_credit_id FROM chart_of_accounts WHERE account_code = '2120';
    RAISE WARNING 'GRN %: supplier % has no ledger, posted to Other Creditors',
      NEW.grn_number, COALESCE(v_supplier.supplier_name, NEW.supplier_id::TEXT);
  END IF;

  SELECT id INTO v_debit_id FROM chart_of_accounts WHERE account_code = '5110';
  SELECT id INTO v_cash_id  FROM chart_of_accounts WHERE account_code = '1110';
  SELECT id INTO v_company_id FROM companies WHERE company_key = 'hope_pharmacy';

  SELECT id, voucher_type_code INTO v_type_id, v_type_code
    FROM voucher_types
   WHERE voucher_category = 'PURCHASE' AND is_active = true
   ORDER BY CASE voucher_type_code WHEN 'PUR' THEN 1 ELSE 2 END
   LIMIT 1;

  IF v_type_id IS NULL OR v_debit_id IS NULL OR v_credit_id IS NULL THEN
    RAISE WARNING 'GRN %: purchase type or accounts missing, nothing accrued', NEW.grn_number;
    RETURN NEW;
  END IF;

  IF v_is_cash AND v_cash_id IS NULL THEN
    RAISE WARNING 'GRN %: no Cash in Hand ledger, left as credit', NEW.grn_number;
    v_is_cash := false;
  END IF;

  v_voucher_id := gen_random_uuid();
  v_voucher_no := generate_voucher_number(v_type_code);
  v_bill_ref   := COALESCE(NULLIF(btrim(NEW.invoice_number), ''), NEW.grn_number);

  v_narration := 'Purchase from ' || COALESCE(v_supplier.supplier_name, 'supplier')
                 || ' - GRN ' || COALESCE(NEW.grn_number, '?')
                 || COALESCE(' , invoice ' || NULLIF(btrim(NEW.invoice_number), ''), '')
                 || CASE WHEN v_is_cash THEN ' (paid in cash)' ELSE '' END;

  INSERT INTO vouchers (
    id, voucher_number, voucher_type_id, voucher_date, reference_number,
    narration, total_amount, company_id, status, created_by, created_at, updated_at
  ) VALUES (
    v_voucher_id, v_voucher_no, v_type_id,
    COALESCE(NULLIF(NEW.invoice_date::TEXT,'')::DATE,
             NULLIF(NEW.grn_date::TEXT,'')::DATE,
             CURRENT_DATE),
    v_reference, v_narration, v_amount, v_company_id, 'AUTHORISED',
    COALESCE(NEW.verified_by::TEXT, NEW.created_by::TEXT, 'grn-accrual'), NOW(), NOW()
  );

  -- The purchase, and what is owed for it.
  INSERT INTO voucher_entries (
    id, voucher_id, account_id, narration, debit_amount, credit_amount,
    entry_order, bill_ref, created_at
  ) VALUES
    (gen_random_uuid(), v_voucher_id, v_debit_id,  v_narration, v_amount, 0, 1, v_bill_ref, NOW()),
    (gen_random_uuid(), v_voucher_id, v_credit_id, v_narration, 0, v_amount, 2, v_bill_ref, NOW());

  -- Paid at the counter: settle the supplier in the same breath, so their
  -- ledger carries the purchase but nothing is left outstanding.
  IF v_is_cash THEN
    INSERT INTO voucher_entries (
      id, voucher_id, account_id, narration, debit_amount, credit_amount,
      entry_order, bill_ref, created_at
    ) VALUES
      (gen_random_uuid(), v_voucher_id, v_credit_id,
       'Paid at the counter - ' || v_narration, v_amount, 0, 3, v_bill_ref, NOW()),
      (gen_random_uuid(), v_voucher_id, v_cash_id,
       'Paid at the counter - ' || v_narration, 0, v_amount, 4, v_bill_ref, NOW());
  END IF;

  RAISE NOTICE 'GRN %: % Rs % to %',
    NEW.grn_number,
    CASE WHEN v_is_cash THEN 'purchased and paid' ELSE 'accrued' END,
    v_amount, COALESCE(v_supplier.supplier_name, 'Other Creditors');

  RETURN NEW;
END;
$$;
