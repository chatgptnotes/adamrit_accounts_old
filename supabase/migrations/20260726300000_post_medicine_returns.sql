-- Post a medicine return, so a refund reaches the ledger.
--
-- Returns reduce stock and hand money back, but nothing has ever posted. So
-- income stays overstated by every return ever processed, and the cash that
-- went out is unrecorded. Of everything still unautomated this is the only one
-- where the books are actively wrong rather than merely incomplete.
--
-- A return is not a plain reversal. The hospital takes the goods back but keeps
-- a processing fee, so three legs:
--
--     Dr  4150 Medicine Sales        refund_amount    the sale, undone
--         Cr  bank or cash               net_refund       what the patient gets back
--         Cr  4190 Return Processing Fee processing_fee   what the hospital keeps
--
-- refund_amount = net_refund + processing_fee, so it balances by construction.
-- Where no fee is charged the third leg is simply omitted.
--
-- Posted as a Credit Note where that voucher type exists, since that is what a
-- sales return is; falls back to a journal otherwise.
--
-- Hiding or cancelling a return retires its voucher. medicine_returns uses
-- is_hidden as a soft delete, so that counts as cancelling.

INSERT INTO public.chart_of_accounts
  (account_code, account_name, account_type, account_group,
   opening_balance, opening_balance_type, is_active)
VALUES
  ('4190', 'Return Processing Fee', 'DIRECT_INCOME', 'Direct Incomes', 0, 'CR', true)
ON CONFLICT (account_code) DO NOTHING;

CREATE OR REPLACE FUNCTION public.post_medicine_return()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gross      NUMERIC(15,2);
  v_fee        NUMERIC(15,2);
  v_net        NUMERIC(15,2);
  v_sales_id   UUID;
  v_fee_id     UUID;
  v_money_id   UUID;
  v_type_id    UUID;
  v_type_code  TEXT;
  v_voucher_id UUID;
  v_voucher_no TEXT;
  v_reference  TEXT;
  v_narration  TEXT;
  v_order      INTEGER := 0;
BEGIN
  v_reference := COALESCE(NEW.id, OLD.id)::TEXT;

  -- A hidden or cancelled return retires its voucher.
  IF TG_OP = 'UPDATE'
     AND (COALESCE(NEW.is_hidden, false) = true
       OR upper(COALESCE(NEW.status, '')) IN ('CANCELLED', 'REJECTED'))
     AND COALESCE(OLD.is_hidden, false) = false
     AND upper(COALESCE(OLD.status, '')) NOT IN ('CANCELLED', 'REJECTED') THEN
    UPDATE vouchers
       SET status = 'CANCELLED', last_modified_by = 'medicine-return-cancelled', updated_at = now()
     WHERE reference_number = v_reference AND status <> 'CANCELLED';
    RETURN NEW;
  END IF;

  IF upper(COALESCE(NEW.status, '')) <> 'PROCESSED' OR COALESCE(NEW.is_hidden, false) THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM vouchers
              WHERE reference_number = v_reference AND status <> 'CANCELLED') THEN
    RETURN NEW;
  END IF;

  v_gross := GREATEST(COALESCE(NEW.refund_amount, 0), 0);
  v_fee   := GREATEST(COALESCE(NEW.processing_fee, 0), 0);
  v_net   := GREATEST(COALESCE(NEW.net_refund, v_gross - v_fee), 0);

  IF v_gross <= 0 THEN
    RETURN NEW;
  END IF;

  -- Trust the two amounts that represent real movements and derive the third,
  -- so a stored net_refund that disagrees cannot unbalance the voucher.
  v_fee := GREATEST(v_gross - v_net, 0);

  SELECT id INTO v_sales_id FROM chart_of_accounts WHERE account_code = '4150';
  SELECT id INTO v_fee_id   FROM chart_of_accounts WHERE account_code = '4190';

  -- Where the refund goes out from. Pharmacy money moves through the Canara
  -- pharmacy account unless it is cash, matching the pharmacy payment path.
  IF upper(COALESCE(NEW.refund_method, '')) IN ('CASH', '') THEN
    SELECT id INTO v_money_id FROM chart_of_accounts WHERE account_code = '1110';
  ELSE
    SELECT id INTO v_money_id FROM chart_of_accounts WHERE account_code = '1124' AND is_active;
    IF v_money_id IS NULL THEN
      SELECT id INTO v_money_id FROM chart_of_accounts WHERE account_code = '1110';
    END IF;
  END IF;

  -- A sales return is a credit note; journal only where that type is absent.
  SELECT id, voucher_type_code INTO v_type_id, v_type_code
    FROM voucher_types
   WHERE voucher_category IN ('CREDIT_NOTE', 'JOURNAL') AND is_active = true
   ORDER BY CASE voucher_category WHEN 'CREDIT_NOTE' THEN 1 ELSE 2 END,
            CASE voucher_type_code WHEN 'CN' THEN 1 WHEN 'JV' THEN 2 ELSE 3 END
   LIMIT 1;

  IF v_type_id IS NULL OR v_sales_id IS NULL OR v_money_id IS NULL THEN
    RAISE WARNING 'Medicine return %: accounts or voucher type missing, nothing posted',
      NEW.return_number;
    RETURN NEW;
  END IF;

  v_voucher_id := gen_random_uuid();
  v_voucher_no := generate_voucher_number(v_type_code);
  v_narration  := 'Medicine return ' || COALESCE(NEW.return_number, v_reference)
                  || COALESCE(' - ' || NULLIF(btrim(NEW.return_reason), ''), '');

  INSERT INTO vouchers (
    id, voucher_number, voucher_type_id, voucher_date, reference_number,
    narration, total_amount, status, created_by, created_at, updated_at
  ) VALUES (
    v_voucher_id, v_voucher_no, v_type_id,
    COALESCE(NULLIF(NEW.return_date::TEXT, '')::DATE, CURRENT_DATE),
    v_reference, v_narration, v_gross, 'AUTHORISED',
    COALESCE(NEW.processed_by::TEXT, 'medicine-return'), NOW(), NOW()
  );

  v_order := v_order + 1;
  INSERT INTO voucher_entries (id, voucher_id, account_id, narration,
                               debit_amount, credit_amount, entry_order, created_at)
  VALUES (gen_random_uuid(), v_voucher_id, v_sales_id, v_narration,
          v_gross, 0, v_order, NOW());

  v_order := v_order + 1;
  INSERT INTO voucher_entries (id, voucher_id, account_id, narration,
                               debit_amount, credit_amount, entry_order, created_at)
  VALUES (gen_random_uuid(), v_voucher_id, v_money_id,
          'Refunded to patient - ' || v_narration, 0, v_net, v_order, NOW());

  IF v_fee > 0 AND v_fee_id IS NOT NULL THEN
    v_order := v_order + 1;
    INSERT INTO voucher_entries (id, voucher_id, account_id, narration,
                                 debit_amount, credit_amount, entry_order, created_at)
    VALUES (gen_random_uuid(), v_voucher_id, v_fee_id,
            'Processing fee retained - ' || v_narration, 0, v_fee, v_order, NOW());
  ELSIF v_fee > 0 THEN
    -- No fee ledger: give the whole amount back to sales rather than leave the
    -- voucher short, and say so.
    UPDATE voucher_entries SET credit_amount = v_gross
     WHERE voucher_id = v_voucher_id AND entry_order = 2;
    RAISE WARNING 'Medicine return %: ledger 4190 missing, fee not separated',
      NEW.return_number;
  END IF;

  RAISE NOTICE 'Medicine return %: reversed % (refunded %, fee %)',
    NEW.return_number, v_gross, v_net, v_fee;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_post_medicine_return ON public.medicine_returns;
CREATE TRIGGER trg_post_medicine_return
AFTER INSERT OR UPDATE OF status, is_hidden ON public.medicine_returns
FOR EACH ROW
EXECUTE FUNCTION public.post_medicine_return();
