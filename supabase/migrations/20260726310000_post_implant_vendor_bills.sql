-- Post the vendor's implant bill, so what the hospital owes for an implant is
-- recorded when the implant is billed.
--
-- IMPLANT BILLS ARE A COST, NOT REVENUE. implant_bills holds the vendor's
-- invoice for implants used in a surgery - vendor_name, vendor_address, the
-- items and what they cost. The patient side is already accrued at bill
-- approval, where financial_summary's implant columns credit 4180 Implants &
-- Consumables. So the income exists in the books and the cost of earning it
-- does not, which overstates the margin on every implant surgery.
--
--     Dr  5120 Implant Purchase       the invoice amount
--         Cr  <the vendor>                same amount
--
-- Paying the vendor later is an ordinary Payment voucher, Dr vendor / Cr bank.
-- Same shape as the pharmacy GRN accrual, and for the same reason: the liability
-- arises when the goods are consumed and invoiced, not when they are paid for.
--
-- REPOSTING. Unlike a GRN there is no status here. saveImplantBill
-- (src/lib/implantBillDb.ts:76) upserts on visit_id, so a bill can be edited
-- after it has posted. When an amount, vendor or date actually changes the old
-- voucher is cancelled and a fresh one posted, which leaves the correction
-- visible in voucher_edit_log rather than quietly rewriting history. A save
-- that changes none of those three does nothing.

-- ------------------------------------------------------------------
-- Accounts the posting needs, created only if missing.
-- ------------------------------------------------------------------
INSERT INTO public.chart_of_accounts
  (account_code, account_name, account_type, account_group,
   opening_balance, opening_balance_type, is_active)
VALUES
  ('5120', 'Implant Purchase', 'DIRECT_EXPENSES',     'Purchase Accounts', 0, 'DR', true),
  ('2120', 'Other Creditors',  'CURRENT_LIABILITIES', 'Sundry Creditors',  0, 'CR', true)
ON CONFLICT (account_code) DO NOTHING;

-- ------------------------------------------------------------------
-- Which creditor ledger a vendor name refers to. implant_bills stores the
-- vendor as free text typed on the bill page, so there is no id to follow -
-- only the name, matched against the creditor ledgers the Tally import brought
-- across. Anything unrecognised falls back to Other Creditors, which records
-- the expense while making it obvious the party is unidentified.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.implant_vendor_ledger(p_vendor_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NULLIF(btrim(COALESCE(p_vendor_name, '')), '') IS NOT NULL THEN
    SELECT a.id INTO v_id
      FROM chart_of_accounts a
     WHERE a.is_active = true
       AND lower(btrim(a.account_group)) = 'sundry creditors'
       AND lower(btrim(a.account_name))  = lower(btrim(p_vendor_name))
     LIMIT 1;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;

  SELECT id INTO v_id FROM chart_of_accounts WHERE account_code = '2120';
  RETURN v_id;
END;
$$;

-- ------------------------------------------------------------------
-- The posting itself.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_implant_vendor_bill()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_amount     NUMERIC(15,2);
  v_debit_id   UUID;
  v_credit_id  UUID;
  v_company_id UUID;
  v_patient    RECORD;
  v_type_id    UUID;
  v_type_code  TEXT;
  v_voucher_id UUID;
  v_voucher_no TEXT;
  v_reference  TEXT;
  v_narration  TEXT;
BEGIN
  v_reference := 'IMPLANT-' || NEW.id::TEXT;

  -- A save that touches nothing the ledger cares about is not a correction.
  IF TG_OP = 'UPDATE'
     AND COALESCE(NEW.total_amount, 0) = COALESCE(OLD.total_amount, 0)
     AND lower(btrim(COALESCE(NEW.vendor_name, ''))) = lower(btrim(COALESCE(OLD.vendor_name, '')))
     AND NEW.bill_date IS NOT DISTINCT FROM OLD.bill_date THEN
    RETURN NEW;
  END IF;

  -- Anything that does change retires the earlier posting before reposting, so
  -- an edited bill never leaves two live vouchers behind.
  IF TG_OP = 'UPDATE' THEN
    UPDATE vouchers
       SET status = 'CANCELLED',
           last_modified_by = 'implant-bill-edited',
           updated_at = now()
     WHERE reference_number = v_reference AND status <> 'CANCELLED';
  END IF;

  IF EXISTS (SELECT 1 FROM vouchers
              WHERE reference_number = v_reference AND status <> 'CANCELLED') THEN
    RETURN NEW;
  END IF;

  -- A bill saved before the amounts are filled in is a draft, not a liability.
  v_amount := GREATEST(COALESCE(NEW.total_amount, 0), 0);
  IF v_amount <= 0 THEN
    RETURN NEW;
  END IF;

  -- visit_id is text that holds either the visit uuid or the human visit
  -- reference, depending on which route saved the bill (CorporateBill.tsx:35),
  -- so both are tried. The company follows the patient, since implants are
  -- consumed in the hospital that performed the surgery.
  SELECT p.hospital_name, COALESCE(v.corporate, p.corporate) AS corporate,
         p.name AS patient_name
    INTO v_patient
    FROM visits v
    JOIN patients p ON p.id = v.patient_id
   WHERE v.visit_id = NEW.visit_id
      OR (NEW.visit_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          AND v.id = NEW.visit_id::UUID)
   LIMIT 1;

  v_company_id := public.resolve_patient_company(v_patient.hospital_name, v_patient.corporate);

  v_credit_id := public.implant_vendor_ledger(NEW.vendor_name);
  SELECT id INTO v_debit_id FROM chart_of_accounts WHERE account_code = '5120';

  SELECT id, voucher_type_code INTO v_type_id, v_type_code
    FROM voucher_types
   WHERE voucher_category = 'PURCHASE' AND is_active = true
   ORDER BY CASE voucher_type_code WHEN 'PUR' THEN 1 ELSE 2 END
   LIMIT 1;

  IF v_type_id IS NULL OR v_debit_id IS NULL OR v_credit_id IS NULL THEN
    RAISE WARNING 'Implant bill %: purchase type or accounts missing, nothing accrued',
      NEW.bill_no;
    RETURN NEW;
  END IF;

  v_voucher_id := gen_random_uuid();
  v_voucher_no := generate_voucher_number(v_type_code);

  v_narration := 'Implant purchase from '
                 || COALESCE(NULLIF(btrim(NEW.vendor_name), ''), 'vendor')
                 || ' - implant bill ' || COALESCE(NEW.bill_no::TEXT, '?')
                 || COALESCE(' for ' || NULLIF(btrim(v_patient.patient_name), ''), '');

  INSERT INTO vouchers (
    id, voucher_number, voucher_type_id, voucher_date, reference_number,
    narration, total_amount, company_id, status, created_by, created_at, updated_at
  ) VALUES (
    v_voucher_id, v_voucher_no, v_type_id,
    COALESCE(NULLIF(NEW.bill_date::TEXT, '')::DATE, CURRENT_DATE),
    v_reference, v_narration, v_amount, v_company_id, 'AUTHORISED',
    'implant-bill', NOW(), NOW()
  );

  INSERT INTO voucher_entries (
    id, voucher_id, account_id, narration, debit_amount, credit_amount,
    entry_order, created_at
  ) VALUES
    (gen_random_uuid(), v_voucher_id, v_debit_id,  v_narration, v_amount, 0, 1, NOW()),
    (gen_random_uuid(), v_voucher_id, v_credit_id, v_narration, 0, v_amount, 2, NOW());

  RAISE NOTICE 'Implant bill %: accrued Rs % to %',
    NEW.bill_no, v_amount, COALESCE(NULLIF(btrim(NEW.vendor_name), ''), 'Other Creditors');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_post_implant_vendor_bill ON public.implant_bills;
CREATE TRIGGER trg_post_implant_vendor_bill
AFTER INSERT OR UPDATE OF total_amount, vendor_name, bill_date ON public.implant_bills
FOR EACH ROW
EXECUTE FUNCTION public.post_implant_vendor_bill();
