-- Fix the GRN accrual: cast the user columns before falling back to text.
--
-- goods_received_notes.verified_by and created_by are uuid, while
-- vouchers.created_by is text. COALESCE(uuid, uuid, 'grn-accrual') therefore
-- tried to cast the fallback string to a uuid and failed, so no voucher could
-- be written. types.ts reports both as `string`, which is how TypeScript
-- represents uuid - it hid the mismatch.
--
-- Body otherwise identical to 20260726240000.

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
  v_company_id    UUID;
  v_type_id       UUID;
  v_type_code     TEXT;
  v_voucher_id    UUID;
  v_voucher_no    TEXT;
  v_reference     TEXT;
  v_narration     TEXT;
BEGIN
  -- Only a GRN that has been posted represents goods actually received.
  IF upper(COALESCE(NEW.status, '')) <> 'POSTED' THEN
    RETURN NEW;
  END IF;

  -- On UPDATE, only act on the transition into POSTED.
  IF TG_OP = 'UPDATE' AND upper(COALESCE(OLD.status, '')) = 'POSTED' THEN
    RETURN NEW;
  END IF;

  v_reference := NEW.id::TEXT;

  IF EXISTS (SELECT 1 FROM vouchers
              WHERE reference_number = v_reference AND status <> 'CANCELLED') THEN
    RETURN NEW;
  END IF;

  -- What the supplier invoiced is what is owed. total_amount is the GRN's own
  -- computed figure and is only a fallback.
  v_amount := GREATEST(COALESCE(NULLIF(NEW.invoice_amount, 0), NEW.total_amount, 0), 0);
  IF v_amount <= 0 THEN
    RAISE WARNING 'GRN %: no invoice amount, nothing accrued', NEW.grn_number;
    RETURN NEW;
  END IF;

  SELECT supplier_name, ledger_account_id
    INTO v_supplier
    FROM suppliers
   WHERE id = NEW.supplier_id;

  -- An unmapped supplier still gets its expense recorded, against the generic
  -- creditor. Losing the party detail is recoverable; losing the expense is
  -- not, and a growing 2120 balance is a visible prompt to map them.
  v_credit_id := v_supplier.ledger_account_id;
  IF v_credit_id IS NULL THEN
    SELECT id INTO v_credit_id FROM chart_of_accounts WHERE account_code = '2120';
    RAISE WARNING 'GRN %: supplier % has no ledger, posted to Other Creditors',
      NEW.grn_number, COALESCE(v_supplier.supplier_name, NEW.supplier_id::TEXT);
  END IF;

  SELECT id INTO v_debit_id FROM chart_of_accounts WHERE account_code = '5110';
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

  v_voucher_id := gen_random_uuid();
  v_voucher_no := generate_voucher_number(v_type_code);

  v_narration := 'Purchase from ' || COALESCE(v_supplier.supplier_name, 'supplier')
                 || ' - GRN ' || COALESCE(NEW.grn_number, '?')
                 || COALESCE(' , invoice ' || NULLIF(btrim(NEW.invoice_number), ''), '');

  INSERT INTO vouchers (
    id, voucher_number, voucher_type_id, voucher_date, reference_number,
    narration, total_amount, company_id, status, created_by, created_at, updated_at
  ) VALUES (
    v_voucher_id, v_voucher_no, v_type_id,
    COALESCE(NULLIF(NEW.invoice_date::TEXT,'')::DATE,
             NULLIF(NEW.grn_date::TEXT,'')::DATE,
             CURRENT_DATE),
    v_reference, v_narration, v_amount, v_company_id, 'AUTHORISED',
    -- These are uuid columns on the GRN while vouchers.created_by is text,
    -- so they must be cast before the fallback string can join them.
    COALESCE(NEW.verified_by::TEXT, NEW.created_by::TEXT, 'grn-accrual'), NOW(), NOW()
  );

  INSERT INTO voucher_entries (
    id, voucher_id, account_id, narration, debit_amount, credit_amount,
    entry_order, created_at
  ) VALUES
    (gen_random_uuid(), v_voucher_id, v_debit_id,  v_narration, v_amount, 0, 1, NOW()),
    (gen_random_uuid(), v_voucher_id, v_credit_id, v_narration, 0, v_amount, 2, NOW());

  RAISE NOTICE 'GRN %: accrued Rs % to %',
    NEW.grn_number, v_amount, COALESCE(v_supplier.supplier_name, 'Other Creditors');

  RETURN NEW;
END;
$$;

