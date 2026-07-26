-- Accrue the supplier's bill when goods are received.
--
-- A GRN moves DRAFT -> POSTED through postGRN() (src/lib/grn-service.ts:377),
-- which is when stock actually lands and the hospital owes the supplier. That
-- is the moment the liability arises, so it is the moment to post:
--
--     Dr  5110 Medicine Purchase        the invoice amount
--         Cr  <the supplier>                 same amount
--
-- Paying it later is an ordinary Payment voucher, Dr supplier / Cr bank, which
-- staff already know how to enter. Nobody has to think in debits and credits:
-- receiving the goods is the only action, and the accounting follows.
--
-- Scope is deliberately the pharmacy GRN only. department_store_grn has the
-- same shape but is not referenced anywhere in the application, so there is no
-- live flow to hook.
--
-- Pharmacy transactions belong to Hope Pharmacy, per how the group is
-- organised, so these vouchers post under that company rather than DRM Hope.

-- ------------------------------------------------------------------
-- Accounts the posting needs, created only if missing.
-- ------------------------------------------------------------------
INSERT INTO public.chart_of_accounts
  (account_code, account_name, account_type, account_group,
   opening_balance, opening_balance_type, is_active)
VALUES
  ('5110', 'Medicine Purchase', 'DIRECT_EXPENSES',      'Purchase Accounts',   0, 'DR', true),
  ('2120', 'Other Creditors',   'CURRENT_LIABILITIES',  'Sundry Creditors',    0, 'CR', true)
ON CONFLICT (account_code) DO NOTHING;

-- ------------------------------------------------------------------
-- Which ledger each supplier is. Same shape as corporate.ledger_account_id.
-- ------------------------------------------------------------------
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS ledger_account_id UUID REFERENCES public.chart_of_accounts(id);

COMMENT ON COLUMN public.suppliers.ledger_account_id IS
  'Creditor ledger this supplier posts to. Unmapped suppliers fall back to '
  '2120 Other Creditors, which is a signal to map them rather than a resting place.';

-- Seed by exact name match against the creditor ledgers the Tally import
-- brought across. Anything unmatched stays NULL and is reported by the
-- summary at the bottom.
UPDATE public.suppliers s
   SET ledger_account_id = a.id
  FROM public.chart_of_accounts a
 WHERE s.ledger_account_id IS NULL
   AND a.is_active = true
   AND lower(btrim(a.account_group)) = 'sundry creditors'
   AND lower(btrim(a.account_name))  = lower(btrim(s.supplier_name));

-- ------------------------------------------------------------------
-- The posting itself.
-- ------------------------------------------------------------------
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
    COALESCE(NEW.verified_by, NEW.created_by, 'grn-accrual'), NOW(), NOW()
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

DROP TRIGGER IF EXISTS trg_grn_supplier_bill ON public.goods_received_notes;
CREATE TRIGGER trg_grn_supplier_bill
AFTER INSERT OR UPDATE OF status ON public.goods_received_notes
FOR EACH ROW
EXECUTE FUNCTION public.post_grn_supplier_bill();

CREATE INDEX IF NOT EXISTS idx_suppliers_ledger_account
  ON public.suppliers(ledger_account_id);


-- How many suppliers still need a ledger. Those post to Other Creditors until
-- mapped, which records the expense but not who is owed.
SELECT CASE WHEN ledger_account_id IS NULL THEN 'needs a ledger' ELSE 'mapped' END AS state,
       count(*) AS suppliers
  FROM public.suppliers
 GROUP BY 1
 ORDER BY 1;
