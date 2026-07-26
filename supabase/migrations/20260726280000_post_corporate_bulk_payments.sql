-- Post the receipt when a panel settles its claims.
--
-- This is the other half of the receivables built earlier: bill approval moves
-- the amount owed onto the panel's ledger, and this clears it when the panel
-- pays. Without it you can see what ESIC owes but nothing ever settles it.
--
-- A panel remittance is not a plain receipt. The panel claims one figure,
-- disallows part of it, withholds tax, and pays the rest - so all four legs
-- have to be posted or the receivable never clears in full:
--
--     Dr  Bank or cash            what actually arrived
--     Dr  TDS Receivable          tax withheld, recoverable later
--     Dr  Claim Deductions        what the panel disallowed, a real cost
--         Cr  the panel               the whole claim, now settled
--
-- The credit is derived as the sum of the three debits rather than read from
-- bill_amount, so the voucher cannot be knocked out of balance by a missing or
-- inconsistent claim figure.
--
-- The trigger sits on the allocations rather than the header because
-- useCorporateBulkPayments.ts inserts the header first and the allocations
-- after, so a header trigger would see nothing to post. Editing a payment
-- deletes and re-inserts its allocations, so any change cancels the old
-- voucher and reposts from current state.

INSERT INTO public.chart_of_accounts
  (account_code, account_name, account_type, account_group,
   opening_balance, opening_balance_type, is_active)
VALUES
  ('1460', 'TDS Receivable',   'CURRENT_ASSETS',     'Loans & Advances (Asset)', 0, 'DR', true),
  ('5310', 'Claim Deductions', 'INDIRECT_EXPENSES',  'Indirect Expenses',        0, 'DR', true)
ON CONFLICT (account_code) DO NOTHING;

CREATE OR REPLACE FUNCTION public.post_corporate_bulk_payment(p_bulk_payment_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  h            RECORD;
  v_received   NUMERIC(15,2);
  v_tds        NUMERIC(15,2);
  v_deduction  NUMERIC(15,2);
  v_claim      NUMERIC(15,2);
  v_bank_id    UUID;
  v_panel_id   UUID;
  v_tds_id     UUID;
  v_ded_id     UUID;
  v_company_id UUID;
  v_type_id    UUID;
  v_type_code  TEXT;
  v_voucher_id UUID;
  v_voucher_no TEXT;
  v_reference  TEXT;
  v_narration  TEXT;
  v_order      INTEGER := 0;
BEGIN
  v_reference := p_bulk_payment_id::TEXT;

  -- Any change reposts from scratch, so retire whatever was there before.
  UPDATE vouchers
     SET status = 'CANCELLED', last_modified_by = 'bulk-payment-repost', updated_at = now()
   WHERE reference_number = v_reference AND status <> 'CANCELLED';

  SELECT * INTO h FROM corporate_bulk_payments WHERE id = p_bulk_payment_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT COALESCE(sum(amount), 0),
         COALESCE(sum(tds_amount), 0),
         COALESCE(sum(deduction_amount), 0)
    INTO v_received, v_tds, v_deduction
    FROM corporate_bulk_payment_allocations
   WHERE bulk_payment_id = p_bulk_payment_id;

  -- Derived, never read from bill_amount: the credit is exactly what the
  -- debits add up to, so the voucher always balances.
  v_claim := v_received + v_tds + v_deduction;

  IF v_claim <= 0 THEN
    RETURN;
  END IF;

  -- The panel being settled. Falls back to Other Debtors so the money is still
  -- recorded if the panel cannot be identified; a growing balance there is a
  -- visible prompt rather than a silent loss.
  SELECT c.ledger_account_id, c.company_id
    INTO v_panel_id, v_company_id
    FROM corporate c
   WHERE c.id = h.corporate_id
      OR lower(btrim(c.name)) = lower(btrim(h.corporate_name))
   ORDER BY (c.id = h.corporate_id) DESC
   LIMIT 1;

  IF v_panel_id IS NULL THEN
    SELECT id INTO v_panel_id FROM chart_of_accounts WHERE account_code = '1500';
    RAISE WARNING 'Bulk payment %: panel % not mapped, posted to Other Debtors',
      COALESCE(h.receipt_number, v_reference), h.corporate_name;
  END IF;

  -- Where the money landed. Named bank first, then the mode, then cash.
  IF COALESCE(btrim(h.bank_name), '') <> '' THEN
    SELECT id INTO v_bank_id FROM chart_of_accounts
     WHERE lower(btrim(account_name)) = lower(btrim(h.bank_name)) AND is_active
     LIMIT 1;
  END IF;

  IF v_bank_id IS NULL AND upper(COALESCE(h.payment_mode, '')) NOT IN ('CASH', '') THEN
    SELECT id INTO v_bank_id FROM chart_of_accounts
     WHERE lower(btrim(account_group)) IN ('bank', 'bank accounts') AND is_active
     ORDER BY account_code LIMIT 1;
  END IF;

  IF v_bank_id IS NULL THEN
    SELECT id INTO v_bank_id FROM chart_of_accounts WHERE account_code = '1110';
  END IF;

  SELECT id INTO v_tds_id FROM chart_of_accounts WHERE account_code = '1460';
  SELECT id INTO v_ded_id FROM chart_of_accounts WHERE account_code = '5310';

  SELECT id, voucher_type_code INTO v_type_id, v_type_code
    FROM voucher_types
   WHERE voucher_category = 'RECEIPT' AND is_active = true
   ORDER BY CASE voucher_type_code WHEN 'REC' THEN 1 WHEN 'RV' THEN 2 ELSE 3 END
   LIMIT 1;

  IF v_type_id IS NULL OR v_panel_id IS NULL OR v_bank_id IS NULL THEN
    RAISE WARNING 'Bulk payment %: accounts or voucher type missing, nothing posted',
      COALESCE(h.receipt_number, v_reference);
    RETURN;
  END IF;

  v_voucher_id := gen_random_uuid();
  v_voucher_no := generate_voucher_number(v_type_code);
  v_narration  := 'Claim settlement from ' || COALESCE(h.corporate_name, 'panel')
                  || COALESCE(' - receipt ' || NULLIF(btrim(h.receipt_number), ''), '');

  INSERT INTO vouchers (
    id, voucher_number, voucher_type_id, voucher_date, reference_number,
    narration, total_amount, company_id, status, created_by, created_at, updated_at
  ) VALUES (
    v_voucher_id, v_voucher_no, v_type_id,
    COALESCE(NULLIF(h.payment_date::TEXT, '')::DATE, CURRENT_DATE),
    v_reference, v_narration, v_claim, v_company_id, 'AUTHORISED',
    COALESCE(h.created_by, 'bulk-payment'), NOW(), NOW()
  );

  v_order := v_order + 1;
  INSERT INTO voucher_entries (id, voucher_id, account_id, narration,
                               debit_amount, credit_amount, entry_order, created_at)
  VALUES (gen_random_uuid(), v_voucher_id, v_bank_id, v_narration,
          v_received, 0, v_order, NOW());

  IF v_tds > 0 AND v_tds_id IS NOT NULL THEN
    v_order := v_order + 1;
    INSERT INTO voucher_entries (id, voucher_id, account_id, narration,
                                 debit_amount, credit_amount, entry_order, created_at)
    VALUES (gen_random_uuid(), v_voucher_id, v_tds_id,
            'TDS withheld - ' || v_narration, v_tds, 0, v_order, NOW());
  END IF;

  IF v_deduction > 0 AND v_ded_id IS NOT NULL THEN
    v_order := v_order + 1;
    INSERT INTO voucher_entries (id, voucher_id, account_id, narration,
                                 debit_amount, credit_amount, entry_order, created_at)
    VALUES (gen_random_uuid(), v_voucher_id, v_ded_id,
            'Claim disallowed - ' || v_narration, v_deduction, 0, v_order, NOW());
  END IF;

  -- If TDS or deductions could not be posted for want of a ledger, the credit
  -- must still equal what was actually debited or the voucher will not balance.
  v_claim := v_received
             + CASE WHEN v_tds_id IS NOT NULL THEN v_tds ELSE 0 END
             + CASE WHEN v_ded_id IS NOT NULL THEN v_deduction ELSE 0 END;

  v_order := v_order + 1;
  INSERT INTO voucher_entries (id, voucher_id, account_id, narration,
                               debit_amount, credit_amount, entry_order, created_at)
  VALUES (gen_random_uuid(), v_voucher_id, v_panel_id, v_narration,
          0, v_claim, v_order, NOW());

  UPDATE vouchers SET total_amount = v_claim WHERE id = v_voucher_id;

  RAISE NOTICE 'Bulk payment %: received %, tds %, deducted %, cleared %',
    COALESCE(h.receipt_number, v_reference), v_received, v_tds, v_deduction, v_claim;
END;
$$;

-- Statement level with a transition table, so a batch of allocations reposts
-- once rather than once per row.
CREATE OR REPLACE FUNCTION public.repost_bulk_payment_from_allocations()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT DISTINCT bulk_payment_id FROM changed_rows WHERE bulk_payment_id IS NOT NULL
  LOOP
    PERFORM public.post_corporate_bulk_payment(r.bulk_payment_id);
  END LOOP;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_bulk_alloc_inserted ON public.corporate_bulk_payment_allocations;
CREATE TRIGGER trg_bulk_alloc_inserted
AFTER INSERT ON public.corporate_bulk_payment_allocations
REFERENCING NEW TABLE AS changed_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.repost_bulk_payment_from_allocations();

DROP TRIGGER IF EXISTS trg_bulk_alloc_removed ON public.corporate_bulk_payment_allocations;
CREATE TRIGGER trg_bulk_alloc_removed
AFTER DELETE ON public.corporate_bulk_payment_allocations
REFERENCING OLD TABLE AS changed_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.repost_bulk_payment_from_allocations();

CREATE INDEX IF NOT EXISTS idx_bulk_alloc_payment
  ON public.corporate_bulk_payment_allocations(bulk_payment_id);
