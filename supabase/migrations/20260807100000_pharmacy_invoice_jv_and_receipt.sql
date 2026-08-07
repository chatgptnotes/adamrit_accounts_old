-- Pharmacy sales: invoice JV first, receipt voucher only when the money arrives.
--
-- WHAT WAS WRONG
-- Every completed pharmacy sale posted one receipt voucher — Dr Cash/Canara
-- Bank, Cr Medicine Sales — through patient_payment_transactions. A CREDIT
-- sale is written with payment_status = 'COMPLETED' even though nothing was
-- paid, so 357 vouchers worth Rs 2,42,835 debited cash and bank for money the
-- pharmacy never received, and unpaid pharmacy bills existed nowhere as a
-- receivable.
--
-- WHAT THIS DOES
--   1. Adds a 'Pharmacy Debtors' control ledger to Hope Pharmacy.
--   2. post_pharmacy_sale_invoice()  — JV: Dr Pharmacy Debtors, Cr Medicine
--      Sales. Raised for every sale, paid or not, when the bill is made.
--   3. post_pharmacy_sale_receipt()  — REC: Dr Cash/Canara Bank, Cr Pharmacy
--      Debtors. Only once the bill is actually paid.
--   4. Credit settlements (pharmacy_credit_payments) post their own receipt,
--      so the debtor ledger clears as patients pay.
--   5. Stops the old rail: the patient_payment_transactions receipt trigger no
--      longer fires for PHARMACY / DIRECT_SALE rows. Income is now recognised
--      once, by the invoice JV.
--   6. Restates the 357 historical CREDIT receipts: each is cancelled and
--      reposted as an invoice JV on its own original date.
--
-- Income totals for paid sales are unchanged — Medicine Sales (4150) is still
-- the credit. What changes is the counterpart: a debtor until the cash lands.
--
-- Applied through apply_migration(), which wraps the whole file in one
-- transaction: any failure below rolls back every change. Idempotent, and it
-- verifies itself before that transaction is allowed to commit.

-- ---------------------------------------------------------------------------
-- STEP 0 — the ledgers this depends on must already exist
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_company UUID;
  v_missing TEXT := '';
BEGIN
  SELECT id INTO v_company FROM public.companies WHERE company_key = 'hope_pharmacy';
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Hope Pharmacy company not found — cannot post pharmacy vouchers';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.chart_of_accounts
                  WHERE company_id = v_company AND account_name = 'Cash' AND is_active) THEN
    v_missing := v_missing || ' Cash;';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.chart_of_accounts
                  WHERE company_id = v_company AND account_name = 'Canara Bank' AND is_active) THEN
    v_missing := v_missing || ' Canara Bank;';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.chart_of_accounts
                  WHERE account_code = '4150' AND is_active) THEN
    v_missing := v_missing || ' Medicine Sales (4150);';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.voucher_types WHERE voucher_category = 'JOURNAL' AND is_active) THEN
    v_missing := v_missing || ' JOURNAL voucher type;';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.voucher_types WHERE voucher_category = 'RECEIPT' AND is_active) THEN
    v_missing := v_missing || ' RECEIPT voucher type;';
  END IF;

  IF v_missing <> '' THEN
    RAISE EXCEPTION 'Missing prerequisites:%', v_missing;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- STEP 1 — the control ledger every unpaid pharmacy bill sits in
-- ---------------------------------------------------------------------------
INSERT INTO public.chart_of_accounts (
  account_code, account_name, account_type, account_group,
  company_id, is_active, opening_balance, opening_balance_type
)
SELECT
  'PHARMDEBTORS', 'Pharmacy Debtors', 'CURRENT_ASSETS', 'Sundry Debtors',
  c.id, true, 0, 'DR'
FROM public.companies c
WHERE c.company_key = 'hope_pharmacy'
  AND NOT EXISTS (
    SELECT 1 FROM public.chart_of_accounts a
     WHERE a.company_id = c.id AND a.account_name = 'Pharmacy Debtors'
  );

-- ---------------------------------------------------------------------------
-- STEP 2 — shared helper: write one balanced two-line voucher
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_pharmacy_voucher(
  p_category   TEXT,   -- JOURNAL | RECEIPT
  p_date       DATE,
  p_amount     NUMERIC,
  p_debit      UUID,
  p_credit     UUID,
  p_narration  TEXT,
  p_reference  TEXT,
  p_created_by TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_company UUID;
  v_type_id UUID;
  v_type_code TEXT;
  v_number TEXT;
  v_voucher_id UUID;
  v_existing TEXT;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('posted', false, 'reason', 'Amount must be greater than zero');
  END IF;
  IF p_debit IS NULL OR p_credit IS NULL THEN
    RETURN jsonb_build_object('posted', false, 'reason', 'Ledger accounts not resolved');
  END IF;

  -- Idempotent: one live voucher per reference, ever.
  SELECT voucher_number INTO v_existing
    FROM public.vouchers
   WHERE reference_number = p_reference AND status <> 'CANCELLED'
   LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('posted', false, 'already', true, 'voucher_number', v_existing);
  END IF;

  SELECT id INTO v_company FROM public.companies WHERE company_key = 'hope_pharmacy';
  SELECT id, voucher_type_code INTO v_type_id, v_type_code
    FROM public.voucher_types
   WHERE voucher_category = p_category AND is_active = true
   ORDER BY voucher_type_code
   LIMIT 1;
  IF v_type_id IS NULL THEN
    RETURN jsonb_build_object('posted', false, 'reason', 'No active ' || p_category || ' voucher type');
  END IF;

  v_number := public.generate_voucher_number(v_type_code);
  v_voucher_id := gen_random_uuid();

  INSERT INTO public.vouchers (
    id, voucher_number, voucher_type_id, voucher_date, reference_number,
    narration, total_amount, company_id, status, is_optional,
    created_by, last_modified_by
  ) VALUES (
    v_voucher_id, v_number, v_type_id, p_date, p_reference,
    p_narration, ROUND(p_amount, 2), v_company, 'AUTHORISED', false,
    COALESCE(p_created_by, 'pharmacy'), COALESCE(p_created_by, 'pharmacy')
  );

  INSERT INTO public.voucher_entries (voucher_id, account_id, debit_amount, credit_amount, narration, entry_order)
  VALUES (v_voucher_id, p_debit,  ROUND(p_amount, 2), 0, p_narration, 1),
         (v_voucher_id, p_credit, 0, ROUND(p_amount, 2), p_narration, 2);

  RETURN jsonb_build_object('posted', true, 'voucher_number', v_number, 'voucher_id', v_voucher_id);
END;
$function$;

-- ---------------------------------------------------------------------------
-- STEP 3 — the invoice JV: Dr Pharmacy Debtors, Cr Medicine Sales
--
-- created_by is cast to TEXT before the COALESCE: pharmacy_sales.created_by is
-- a uuid column while vouchers.created_by is text, and COALESCE(uuid, 'pharmacy')
-- makes Postgres read 'pharmacy' as a uuid. Same trap as the GRN cast fix.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_pharmacy_sale_invoice(p_sale_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_sale RECORD;
  v_debtor UUID;
  v_income UUID;
  v_company UUID;
BEGIN
  SELECT * INTO v_sale FROM public.pharmacy_sales WHERE sale_id = p_sale_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('posted', false, 'reason', 'Sale not found');
  END IF;
  IF COALESCE(v_sale.status, 'active') = 'cancelled' THEN
    RETURN jsonb_build_object('posted', false, 'reason', 'Sale is cancelled');
  END IF;
  IF COALESCE(v_sale.total_amount, 0) <= 0 THEN
    RETURN jsonb_build_object('posted', false, 'reason', 'Bill has no value');
  END IF;

  SELECT id INTO v_company FROM public.companies WHERE company_key = 'hope_pharmacy';
  SELECT id INTO v_debtor FROM public.chart_of_accounts
   WHERE company_id = v_company AND account_name = 'Pharmacy Debtors' AND is_active;
  SELECT id INTO v_income FROM public.chart_of_accounts
   WHERE account_code = '4150' AND is_active LIMIT 1;

  RETURN public.post_pharmacy_voucher(
    'JOURNAL',
    COALESCE(v_sale.sale_date::DATE, CURRENT_DATE),
    v_sale.total_amount,
    v_debtor,
    v_income,
    'Pharmacy invoice ' || COALESCE(v_sale.bill_number, v_sale.sale_id::TEXT)
      || ' - ' || COALESCE(NULLIF(btrim(v_sale.patient_name), ''), 'Walk-in'),
    'PHARMACY-INV-' || p_sale_id::TEXT,
    COALESCE(v_sale.created_by::TEXT, 'pharmacy')
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- STEP 4 — the receipt: Dr Cash/Canara Bank, Cr Pharmacy Debtors
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_pharmacy_sale_receipt(p_sale_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_sale RECORD;
  v_debtor UUID;
  v_bank UUID;
  v_company UUID;
  v_mode TEXT;
  v_invoice JSONB;
BEGIN
  SELECT * INTO v_sale FROM public.pharmacy_sales WHERE sale_id = p_sale_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('posted', false, 'reason', 'Sale not found');
  END IF;

  -- The invoice always exists first, whether or not anyone pressed the button.
  v_invoice := public.post_pharmacy_sale_invoice(p_sale_id);

  v_mode := upper(COALESCE(v_sale.payment_method, ''));
  IF v_mode = 'CREDIT' THEN
    RETURN jsonb_build_object('posted', false, 'invoice', v_invoice,
      'reason', 'Credit bill — the receipt posts when the patient pays');
  END IF;
  IF COALESCE(v_sale.payment_status, '') NOT IN ('COMPLETED', 'REFUNDED') THEN
    RETURN jsonb_build_object('posted', false, 'invoice', v_invoice,
      'reason', 'Bill is not settled yet (' || COALESCE(v_sale.payment_status, 'unknown') || ')');
  END IF;
  IF COALESCE(v_sale.status, 'active') = 'cancelled' THEN
    RETURN jsonb_build_object('posted', false, 'invoice', v_invoice, 'reason', 'Sale is cancelled');
  END IF;

  SELECT id INTO v_company FROM public.companies WHERE company_key = 'hope_pharmacy';
  SELECT id INTO v_debtor FROM public.chart_of_accounts
   WHERE company_id = v_company AND account_name = 'Pharmacy Debtors' AND is_active;
  -- Cash over the counter stays in the pharmacy cash box; every other mode
  -- settles into the pharmacy's Canara Bank account.
  SELECT id INTO v_bank FROM public.chart_of_accounts
   WHERE company_id = v_company AND is_active
     AND account_name = CASE WHEN v_mode = 'CASH' THEN 'Cash' ELSE 'Canara Bank' END;

  RETURN jsonb_build_object(
    'invoice', v_invoice,
    'receipt', public.post_pharmacy_voucher(
      'RECEIPT',
      COALESCE(v_sale.sale_date::DATE, CURRENT_DATE),
      v_sale.total_amount,
      v_bank,
      v_debtor,
      'Pharmacy bill ' || COALESCE(v_sale.bill_number, v_sale.sale_id::TEXT)
        || ' paid by ' || COALESCE(NULLIF(btrim(v_sale.patient_name), ''), 'Walk-in')
        || ' via ' || v_mode,
      'PHARMACY-REC-' || p_sale_id::TEXT,
      COALESCE(v_sale.created_by::TEXT, 'pharmacy')
    )
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- STEP 5 — a credit bill settled later clears the debtor
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_pharmacy_credit_payment_receipt(p_payment_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_pay RECORD;
  v_debtor UUID;
  v_bank UUID;
  v_company UUID;
  v_mode TEXT;
BEGIN
  SELECT * INTO v_pay FROM public.pharmacy_credit_payments WHERE id = p_payment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('posted', false, 'reason', 'Credit payment not found');
  END IF;

  v_mode := upper(COALESCE(v_pay.payment_method, 'CASH'));
  SELECT id INTO v_company FROM public.companies WHERE company_key = 'hope_pharmacy';
  SELECT id INTO v_debtor FROM public.chart_of_accounts
   WHERE company_id = v_company AND account_name = 'Pharmacy Debtors' AND is_active;
  SELECT id INTO v_bank FROM public.chart_of_accounts
   WHERE company_id = v_company AND is_active
     AND account_name = CASE WHEN v_mode = 'CASH' THEN 'Cash' ELSE 'Canara Bank' END;

  RETURN public.post_pharmacy_voucher(
    'RECEIPT',
    COALESCE(v_pay.payment_date::DATE, CURRENT_DATE),
    v_pay.amount,
    v_bank,
    v_debtor,
    'Pharmacy credit settled by ' || COALESCE(NULLIF(btrim(v_pay.patient_name), ''), 'Walk-in')
      || ' via ' || v_mode,
    'PHARMACY-CREDIT-REC-' || p_payment_id::TEXT,
    COALESCE(v_pay.received_by::TEXT, 'pharmacy')
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- STEP 6 — post automatically, so the books never depend on a button press
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pharmacy_sale_posts_vouchers()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
BEGIN
  IF COALESCE(NEW.status, 'active') = 'cancelled' THEN
    RETURN NEW;
  END IF;
  -- Invoice on arrival; receipt as soon as the bill is settled and not credit.
  PERFORM public.post_pharmacy_sale_invoice(NEW.sale_id);
  IF upper(COALESCE(NEW.payment_method, '')) <> 'CREDIT'
     AND COALESCE(NEW.payment_status, '') = 'COMPLETED' THEN
    PERFORM public.post_pharmacy_sale_receipt(NEW.sale_id);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_pharmacy_sale_posts_vouchers_ins ON public.pharmacy_sales;
CREATE TRIGGER trg_pharmacy_sale_posts_vouchers_ins
  AFTER INSERT ON public.pharmacy_sales
  FOR EACH ROW
  EXECUTE FUNCTION public.pharmacy_sale_posts_vouchers();

DROP TRIGGER IF EXISTS trg_pharmacy_sale_posts_vouchers_upd ON public.pharmacy_sales;
CREATE TRIGGER trg_pharmacy_sale_posts_vouchers_upd
  AFTER UPDATE OF payment_status, payment_method, total_amount ON public.pharmacy_sales
  FOR EACH ROW
  EXECUTE FUNCTION public.pharmacy_sale_posts_vouchers();

CREATE OR REPLACE FUNCTION public.pharmacy_credit_payment_posts_receipt()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
BEGIN
  PERFORM public.post_pharmacy_credit_payment_receipt(NEW.id);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_pharmacy_credit_payment_posts_receipt ON public.pharmacy_credit_payments;
CREATE TRIGGER trg_pharmacy_credit_payment_posts_receipt
  AFTER INSERT ON public.pharmacy_credit_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.pharmacy_credit_payment_posts_receipt();

-- ---------------------------------------------------------------------------
-- STEP 7 — retire the old rail for pharmacy only
--
-- Same shared trigger function as every other payment source; only the WHEN
-- clause changes, so advances, final-bill payments and OPD are untouched.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_patient_payment_create_voucher ON public.patient_payment_transactions;
CREATE TRIGGER trg_patient_payment_create_voucher
  AFTER INSERT ON public.patient_payment_transactions
  FOR EACH ROW
  WHEN (COALESCE(NEW.payment_source, '') NOT IN ('PHARMACY', 'DIRECT_SALE'))
  EXECUTE FUNCTION create_receipt_voucher_for_payment();

-- ---------------------------------------------------------------------------
-- STEP 8 — restate the 357 historical CREDIT receipts
--
-- Each one debited cash or bank for money that never arrived. Cancel it and
-- post the invoice JV it should have been, on its own original date.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_row RECORD;
  v_cancelled INTEGER := 0;
  v_reposted INTEGER := 0;
  v_value NUMERIC := 0;
  v_result JSONB;
BEGIN
  FOR v_row IN
    SELECT v.id AS voucher_id, v.voucher_number, v.total_amount,
           t.source_reference_id::BIGINT AS sale_id
      FROM public.vouchers v
      JOIN public.patient_payment_transactions t ON t.id::TEXT = v.reference_number
     WHERE v.status <> 'CANCELLED'
       AND t.source_table_name = 'pharmacy_sales'
       AND upper(COALESCE(t.payment_mode, '')) = 'CREDIT'
       AND t.source_reference_id ~ '^[0-9]+$'
  LOOP
    UPDATE public.vouchers
       SET status = 'CANCELLED',
           last_modified_by = 'pharmacy-credit-restatement',
           narration = narration || ' [cancelled: credit bill, no money received — restated as an invoice JV]',
           updated_at = NOW()
     WHERE id = v_row.voucher_id;
    v_cancelled := v_cancelled + 1;
    v_value := v_value + COALESCE(v_row.total_amount, 0);

    v_result := public.post_pharmacy_sale_invoice(v_row.sale_id);
    IF COALESCE((v_result ->> 'posted')::BOOLEAN, false) THEN
      v_reposted := v_reposted + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'Restated % credit receipts worth Rs %; % invoice JVs posted (the rest already had one)',
    v_cancelled, ROUND(v_value, 2), v_reposted;
END $$;

-- ---------------------------------------------------------------------------
-- STEP 9 — verify before committing
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_unbalanced INTEGER;
  v_stragglers INTEGER;
  v_debtor_dr NUMERIC;
  v_debtor_cr NUMERIC;
BEGIN
  SELECT COUNT(*) INTO v_unbalanced
    FROM (
      SELECT e.voucher_id
        FROM public.voucher_entries e
        JOIN public.vouchers v ON v.id = e.voucher_id
       WHERE v.status = 'AUTHORISED'
       GROUP BY e.voucher_id
      HAVING ABS(COALESCE(SUM(e.debit_amount), 0) - COALESCE(SUM(e.credit_amount), 0)) > 0.01
    ) unbalanced;
  IF v_unbalanced > 0 THEN
    RAISE EXCEPTION 'ABORT: % authorised vouchers have debits <> credits', v_unbalanced;
  END IF;

  SELECT COUNT(*) INTO v_stragglers
    FROM public.vouchers v
    JOIN public.patient_payment_transactions t ON t.id::TEXT = v.reference_number
   WHERE v.status <> 'CANCELLED'
     AND t.source_table_name = 'pharmacy_sales'
     AND upper(COALESCE(t.payment_mode, '')) = 'CREDIT';
  IF v_stragglers > 0 THEN
    RAISE EXCEPTION 'ABORT: % credit-sale receipts are still live', v_stragglers;
  END IF;

  SELECT COALESCE(SUM(e.debit_amount), 0), COALESCE(SUM(e.credit_amount), 0)
    INTO v_debtor_dr, v_debtor_cr
    FROM public.voucher_entries e
    JOIN public.vouchers v ON v.id = e.voucher_id AND v.status = 'AUTHORISED'
    JOIN public.chart_of_accounts a ON a.id = e.account_id
    JOIN public.companies c ON c.id = a.company_id AND c.company_key = 'hope_pharmacy'
   WHERE a.account_name = 'Pharmacy Debtors';

  RAISE NOTICE 'Pharmacy Debtors after restatement: Dr % / Cr % — outstanding Rs %',
    ROUND(v_debtor_dr, 2), ROUND(v_debtor_cr, 2), ROUND(v_debtor_dr - v_debtor_cr, 2);
END $$;

