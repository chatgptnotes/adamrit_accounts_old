-- A receipt from a patient credits that patient, and says whose money it was.
--
-- REC-012712, DRM Hope, 29 July: Rs 50 taken online from a patient. The voucher
-- reads
--
--   Dr  Canara Bank [A/C120023677813] JARIPATHKA      50
--   Cr  Patient Advance                               50
--   Narration: Advance payment received via ONLINE - Canara Bank [...]
--
-- Nowhere on it is the patient. Their own ledger never moved, so the person who
-- handed over the money has no record of having done so, and the narration
-- names a bank and a payment mode but not a human being.
--
-- WHY IT WAS LIKE THAT. An advance is money held before it is earned, so it was
-- booked to 2110 Patient Advance, one pooled liability head for every patient in
-- the hospital. That is defensible as a balance sheet position and useless as a
-- record: the pool tells you the hospital is holding advances, never whose.
--
-- Final bill payments already credit the patient's own ledger - 20260726140000
-- moved them there so revenue was not booked twice, once by the bill accrual and
-- once by the receipt. Advances stayed behind. So the same patient's two
-- payments landed in two different places, and only one of them was on their
-- ledger.
--
-- WHAT CHANGES. An advance now credits the patient's own ledger, the same way a
-- final payment does, and carries patient_ledger_id so the ledger views and the
-- voucher screen can name it. 2110 remains only as the parking head for an
-- advance whose patient has no ledger at all, so nothing ever fails to post.
--
-- THE TRADE, STATED PLAINLY. An unbilled advance now sits as a credit balance
-- inside Sundry Debtors instead of on its own liability line. The money is in
-- the same place on the balance sheet either way; what moves is which head
-- carries it. Per patient visibility is worth more here than the separate line,
-- and it is how the receipt reads in Tally.
--
-- Also: the narration gains ' #<patient name>', in the same # tag syntax the
-- narration box's own patient autocomplete writes, so a receipt says who paid
-- whether you are reading the voucher, the Day Book or a search result.
--
-- And SECURITY DEFINER goes back on. It was there in 20251106000009 and
-- 20251115000000 and was dropped by 20260704200000, which rewrote the body and
-- ended it with a plain LANGUAGE plpgsql. This function inserts into vouchers
-- and voucher_entries, both RLS enabled, from a trigger on patient facing
-- tables. Every version since has been running as the caller.
--
-- The rest of the function is exactly as it was.

CREATE OR REPLACE FUNCTION create_receipt_voucher_for_payment()
RETURNS TRIGGER AS $$
DECLARE
  v_voucher_id UUID;
  v_voucher_number TEXT;
  v_voucher_type_id UUID;
  v_voucher_type_code TEXT;
  v_debit_account_id UUID;
  v_revenue_account_id UUID;
  v_patient_id UUID;
  v_payment_amount DECIMAL(15,2);
  v_payment_mode TEXT;
  v_payment_date DATE;
  v_remarks TEXT;
  v_account_name TEXT;
  v_narration TEXT;
  v_bank_account_id UUID;
  v_bank_account_name TEXT;
  v_patient_ledger_id UUID;
  v_patient_name TEXT;
  v_credit_narration TEXT;
  v_is_refund BOOLEAN := false;
  v_cancelled INTEGER := 0;
  v_company_id UUID;
BEGIN
  -- ========================================================================
  -- Edits and deletions: retire the voucher this row previously produced.
  -- ========================================================================
  IF TG_TABLE_NAME = 'advance_payment' AND TG_OP IN ('UPDATE', 'DELETE') THEN
    UPDATE vouchers
       SET status           = 'CANCELLED',
           last_modified_by = 'advance-payment-sync',
           updated_at       = NOW()
     WHERE reference_number = OLD.id::TEXT
       AND status <> 'CANCELLED';
    GET DIAGNOSTICS v_cancelled = ROW_COUNT;

    IF TG_OP = 'DELETE' THEN
      IF v_cancelled = 0 THEN
        RAISE WARNING 'Deleted advance % had no linked voucher; if it was posted before this migration its voucher is now orphaned.', OLD.id;
      END IF;
      RETURN OLD;
    END IF;

    -- Safety: a row recorded before this migration carries no link, so nothing
    -- was cancelled above and its original voucher is still live. Posting a
    -- fresh one would double-count the payment, so do neither and say so.
    IF v_cancelled = 0 THEN
      RAISE WARNING 'Advance % edited but has no linked voucher (pre-dates the link); ledger not updated.', NEW.id;
      RETURN NEW;
    END IF;

    -- A row cancelled by the user should not come back as a new voucher.
    IF COALESCE(NEW.status, 'ACTIVE') = 'CANCELLED' THEN
      RETURN NEW;
    END IF;
  END IF;

  -- ========================================================================
  -- Extract payment details based on which table triggered this
  -- ========================================================================
  IF TG_TABLE_NAME = 'final_payments' THEN
    v_payment_amount := NEW.amount;
    v_payment_mode := NEW.mode_of_payment;
    v_payment_date := CURRENT_DATE;
    v_remarks := NEW.payment_remark;
    v_bank_account_id := NEW.bank_account_id;
    v_bank_account_name := NEW.bank_account_name;

    SELECT patient_id INTO v_patient_id
    FROM visits
    WHERE visit_id = NEW.visit_id;

    v_narration := 'Payment received on final bill';

  ELSIF TG_TABLE_NAME = 'advance_payment' THEN
    v_payment_amount := NEW.advance_amount;
    v_payment_mode := NEW.payment_mode;
    v_payment_date := NEW.payment_date::DATE;
    v_patient_id := NEW.patient_id;
    v_remarks := NEW.remarks;
    v_bank_account_id := NEW.bank_account_id;
    v_bank_account_name := NEW.bank_account_name;
    v_is_refund := COALESCE(NEW.is_refund, false);

    v_narration := CASE WHEN v_is_refund
                        THEN 'Advance refunded to patient'
                        ELSE 'Advance payment received' END;

  ELSIF TG_TABLE_NAME = 'patient_payment_transactions' THEN
    v_payment_amount := NEW.amount;
    v_payment_mode := NEW.payment_mode;
    v_payment_date := NEW.payment_date;
    v_patient_id := NEW.patient_id;
    v_remarks := NEW.narration;
    v_bank_account_id := NULL;
    v_bank_account_name := NULL;

    v_narration := COALESCE(
      NEW.narration,
      CASE NEW.payment_source
        WHEN 'OPD_SERVICE' THEN 'OPD service payment received'
        WHEN 'PHARMACY' THEN 'Pharmacy bill payment received'
        WHEN 'PHYSIOTHERAPY' THEN 'Physiotherapy payment received'
        WHEN 'DIRECT_SALE' THEN 'Direct pharmacy sale payment received'
        ELSE 'Payment received'
      END
    );
  END IF;

  -- Skip zero/negative amounts: they created junk 0.00 vouchers
  IF v_payment_amount IS NULL OR v_payment_amount <= 0 THEN
    RETURN NEW;
  END IF;

  -- ========================================================================
  -- Determine which account holds the cash
  -- ========================================================================
  v_account_name := 'Cash in Hand';
  v_debit_account_id := NULL;

  IF v_payment_mode IN ('CASH', 'Cash', 'cash') THEN
    IF v_remarks IS NOT NULL AND v_remarks != '' THEN
      IF v_remarks ILIKE '%sbi%' OR v_remarks ILIKE '%state bank%' OR v_remarks ILIKE '%drm%' THEN
        v_account_name := 'STATE BANK OF INDIA (DRM)';
      ELSIF v_remarks ILIKE '%saraswat%' THEN
        v_account_name := 'SARASWAT BANK';
      END IF;
    END IF;

  ELSIF v_payment_mode IN ('ONLINE', 'Online', 'online', 'Bank Transfer', 'BANK TRANSFER') THEN
    IF v_bank_account_id IS NOT NULL THEN
      SELECT id, account_name INTO v_debit_account_id, v_account_name
      FROM chart_of_accounts
      WHERE id = v_bank_account_id
        AND is_active = true;

      RAISE NOTICE 'ONLINE payment: Using bank_account_id % (%)', v_bank_account_id, v_account_name;

    ELSIF v_bank_account_name IS NOT NULL AND v_bank_account_name != '' THEN
      SELECT id, account_name INTO v_debit_account_id, v_account_name
      FROM chart_of_accounts
      WHERE account_name = v_bank_account_name
        AND is_active = true;

      RAISE NOTICE 'ONLINE payment: Using bank_account_name "%"', v_account_name;

    ELSIF v_remarks IS NOT NULL AND v_remarks != '' THEN
      IF v_remarks ILIKE '%sbi%' OR v_remarks ILIKE '%state bank%' OR v_remarks ILIKE '%drm%' THEN
        v_account_name := 'STATE BANK OF INDIA (DRM)';
      ELSIF v_remarks ILIKE '%saraswat%' THEN
        v_account_name := 'SARASWAT BANK';
      ELSE
        RAISE WARNING 'ONLINE payment: No bank specified, defaulting to Cash in Hand';
      END IF;
    ELSE
      RAISE WARNING 'ONLINE payment: No bank information provided, defaulting to Cash in Hand';
    END IF;

  ELSIF v_payment_mode IN ('UPI', 'NEFT', 'RTGS', 'CARD', 'CHEQUE', 'DD') THEN
    IF v_bank_account_id IS NOT NULL THEN
      SELECT id, account_name INTO v_debit_account_id, v_account_name
      FROM chart_of_accounts
      WHERE id = v_bank_account_id
        AND is_active = true;
    ELSIF v_bank_account_name IS NOT NULL AND v_bank_account_name != '' THEN
      SELECT id, account_name INTO v_debit_account_id, v_account_name
      FROM chart_of_accounts
      WHERE account_name = v_bank_account_name
        AND is_active = true;
    ELSIF v_remarks IS NOT NULL AND v_remarks != '' THEN
      IF v_remarks ILIKE '%sbi%' OR v_remarks ILIKE '%state bank%' OR v_remarks ILIKE '%drm%' THEN
        v_account_name := 'STATE BANK OF INDIA (DRM)';
      ELSIF v_remarks ILIKE '%saraswat%' THEN
        v_account_name := 'SARASWAT BANK';
      END IF;
    END IF;
  END IF;

  -- Pharmacy non-cash payments route to Canara Bank HOPE PHARMACY
  IF v_debit_account_id IS NULL
     AND v_account_name = 'Cash in Hand'
     AND v_payment_mode NOT IN ('CASH', 'Cash', 'cash')
     AND TG_TABLE_NAME = 'patient_payment_transactions'
  THEN
    IF NEW.payment_source IN ('PHARMACY', 'DIRECT_SALE') THEN
      SELECT id, account_name INTO v_debit_account_id, v_account_name
      FROM chart_of_accounts
      WHERE account_code = '1124' AND is_active = true;

      IF v_debit_account_id IS NOT NULL THEN
        RAISE NOTICE 'PHARMACY payment: Routing % to Canara Bank HOPE PHARMACY', v_payment_mode;
      END IF;
    END IF;
  END IF;

  IF v_debit_account_id IS NULL THEN
    SELECT id INTO v_debit_account_id
    FROM chart_of_accounts
    WHERE account_name = v_account_name
      AND is_active = true;
  END IF;

  IF v_debit_account_id IS NULL THEN
    RAISE WARNING 'Account "%" not found or inactive, falling back to Cash in Hand', v_account_name;

    SELECT id INTO v_debit_account_id
    FROM chart_of_accounts
    WHERE account_code = '1110' AND account_name = 'Cash in Hand';

    v_account_name := 'Cash in Hand';
  END IF;

  -- ========================================================================
  -- Voucher type. Money going out is a Payment, not a Receipt.
  -- ========================================================================
  IF v_is_refund THEN
    SELECT id, voucher_type_code INTO v_voucher_type_id, v_voucher_type_code
      FROM voucher_types
     WHERE voucher_category = 'PAYMENT' AND is_active = true
     ORDER BY CASE voucher_type_code WHEN 'PAY' THEN 1 WHEN 'PV' THEN 2 ELSE 3 END
     LIMIT 1;
  END IF;

  IF v_voucher_type_id IS NULL THEN
    SELECT id, voucher_type_code INTO v_voucher_type_id, v_voucher_type_code
    FROM voucher_types
    WHERE voucher_type_code IN ('REC', 'RV')
      AND voucher_category = 'RECEIPT'
      AND is_active = true
    ORDER BY CASE WHEN voucher_type_code = 'REC' THEN 1 ELSE 2 END
    LIMIT 1;
  END IF;

  -- ========================================================================
  -- The non-cash side
  -- ========================================================================
  v_credit_narration := 'Patient payment received';

  IF TG_TABLE_NAME = 'advance_payment' THEN
    -- The patient's own ledger, the same way a final payment finds it. An
    -- advance is that patient's money until the bill takes it, so their ledger
    -- is where it belongs and where anyone looking for it will look.
    SELECT pl.id, pl.account_id INTO v_patient_ledger_id, v_revenue_account_id
    FROM patient_ledgers pl
    WHERE pl.patient_id = v_patient_id;

    IF v_revenue_account_id IS NULL THEN
      SELECT ca.id INTO v_revenue_account_id
      FROM chart_of_accounts ca
      JOIN patients p ON ca.account_code = 'PT' || p.patients_id
      WHERE p.id = v_patient_id;
    END IF;

    -- Only if there is no patient ledger at all. Parking it on the pooled head
    -- loses whose money it is, so it is the last resort, not the default.
    IF v_revenue_account_id IS NULL THEN
      RAISE WARNING 'Advance for patient % has no ledger; parking it on 2110 Patient Advance', v_patient_id;
      SELECT id INTO v_revenue_account_id
      FROM chart_of_accounts
      WHERE account_code = '2110' AND is_active = true;
    END IF;

    IF v_is_refund THEN
      v_credit_narration := 'Advance refunded to patient';
    END IF;

  ELSIF TG_TABLE_NAME = 'final_payments' THEN
    SELECT pl.id, pl.account_id INTO v_patient_ledger_id, v_revenue_account_id
    FROM patient_ledgers pl
    WHERE pl.patient_id = v_patient_id;

    IF v_revenue_account_id IS NULL THEN
      SELECT ca.id INTO v_revenue_account_id
      FROM chart_of_accounts ca
      JOIN patients p ON ca.account_code = 'PT' || p.patients_id
      WHERE p.id = v_patient_id;
    END IF;

    IF v_revenue_account_id IS NULL THEN
      RAISE WARNING 'Patient % has no ledger, crediting income instead', v_patient_id;
      SELECT id INTO v_revenue_account_id
      FROM chart_of_accounts
      WHERE account_code = '4160' AND is_active = true;
    ELSE
      v_credit_narration := 'Settlement of patient dues';
    END IF;

  ELSE
    -- Which income this actually is. Everything used to credit 4160 Hospital
    -- Services Income, so a Rs 20 strip of paracetamol sold over the pharmacy
    -- counter showed up as hospital services revenue. The pharmacy's own sales
    -- were invisible as pharmacy sales, and 4150 Medicine Sales stayed empty
    -- while the purchases piled up against it.
    SELECT id INTO v_revenue_account_id
      FROM chart_of_accounts
     WHERE is_active = true
       AND account_code = CASE
             WHEN COALESCE(NEW.payment_source, '') IN ('PHARMACY', 'DIRECT_SALE')
               THEN '4150'   -- Medicine Sales
             ELSE '4160'     -- Hospital Services Income
           END;

    IF v_revenue_account_id IS NULL THEN
      SELECT id INTO v_revenue_account_id
        FROM chart_of_accounts
       WHERE account_code = '4160' AND is_active = true;
    END IF;
  END IF;

  IF v_revenue_account_id IS NULL THEN
    SELECT id INTO v_revenue_account_id
    FROM chart_of_accounts
    WHERE account_code = '4000' AND account_name = 'INCOME';
  END IF;

  IF v_voucher_type_id IS NULL OR v_debit_account_id IS NULL OR v_revenue_account_id IS NULL THEN
    RAISE WARNING 'Required accounts not found. Voucher not created.';
    RAISE WARNING 'Voucher Type ID: %, Cash Account ID: %, Contra Account ID: %',
                  v_voucher_type_id, v_debit_account_id, v_revenue_account_id;
    RETURN NEW;
  END IF;

  v_voucher_number := generate_voucher_number(v_voucher_type_code);
  v_voucher_id := gen_random_uuid();

  -- reference_number now links an advance to its voucher, so a later edit or
  -- deletion can find and retire it.
  -- Whose books this belongs in. The patient decides where there is one; a
  -- pharmacy transaction with no patient belongs to Hope Pharmacy, which is
  -- where the rest of the pharmacy postings go. The name comes out of the same
  -- read, for the narration.
  SELECT public.resolve_patient_company(p.hospital_name, p.corporate), p.name
    INTO v_company_id, v_patient_name
    FROM patients p WHERE p.id = v_patient_id;

  IF v_company_id IS NULL AND TG_TABLE_NAME = 'patient_payment_transactions' THEN
    SELECT id INTO v_company_id FROM companies WHERE company_key = 'hope_pharmacy';
  END IF;

  INSERT INTO vouchers (
    id, voucher_number, voucher_type_id, voucher_date, reference_number,
    narration, total_amount, patient_id, company_id, status, created_by,
    created_at, updated_at
  ) VALUES (
    v_voucher_id,
    v_voucher_number,
    v_voucher_type_id,
    v_payment_date,
    CASE
      WHEN TG_TABLE_NAME = 'final_payments'                THEN NEW.visit_id
      WHEN TG_TABLE_NAME = 'patient_payment_transactions'  THEN NEW.id::TEXT
      WHEN TG_TABLE_NAME = 'advance_payment'               THEN NEW.id::TEXT
      ELSE NULL
    END,
    -- '#name' is the tag syntax the narration box's own patient autocomplete
    -- writes, so a generated receipt reads like a typed one.
    v_narration || ' via ' || v_payment_mode || ' - ' || v_account_name
      || COALESCE(' #' || NULLIF(btrim(v_patient_name), ''), ''),
    v_payment_amount,
    v_patient_id,
    v_company_id,
    'AUTHORISED',
    CASE WHEN TG_TABLE_NAME = 'patient_payment_transactions' THEN NEW.created_by ELSE NULL END,
    NOW(),
    NOW()
  );

  IF v_is_refund THEN
    INSERT INTO voucher_entries (
      id, voucher_id, account_id, patient_ledger_id, narration,
      debit_amount, credit_amount, created_at
    ) VALUES (
      gen_random_uuid(), v_voucher_id, v_revenue_account_id, v_patient_ledger_id,
      v_credit_narration, v_payment_amount, 0, NOW()
    );

    INSERT INTO voucher_entries (
      id, voucher_id, account_id, narration,
      debit_amount, credit_amount, created_at
    ) VALUES (
      gen_random_uuid(), v_voucher_id, v_debit_account_id,
      'Refund paid to patient via ' || v_payment_mode || ' from ' || v_account_name,
      0, v_payment_amount, NOW()
    );

  ELSE
    INSERT INTO voucher_entries (
      id, voucher_id, account_id, narration,
      debit_amount, credit_amount, created_at
    ) VALUES (
      gen_random_uuid(), v_voucher_id, v_debit_account_id,
      'Payment received from patient via ' || v_payment_mode || ' to ' || v_account_name,
      v_payment_amount, 0, NOW()
    );

    INSERT INTO voucher_entries (
      id, voucher_id, account_id, patient_ledger_id, narration,
      debit_amount, credit_amount, created_at
    ) VALUES (
      gen_random_uuid(), v_voucher_id, v_revenue_account_id, v_patient_ledger_id,
      v_credit_narration, 0, v_payment_amount, NOW()
    );
  END IF;

  RAISE NOTICE 'Voucher % (%) for Rs % on account "%"',
    v_voucher_number, TG_OP, v_payment_amount, v_account_name;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- ==========================================================================
-- The receipts already in the books.
--
-- Only from 2026-07-25, the accounting cutover. Anything before it came in with
-- the Tally opening balances and is not the book of record, so it is left
-- exactly as it is.
--
-- Only vouchers this trigger made: an advance links itself by reference_number,
-- so an entry on 2110 that arrived any other way - a bill accrual, a hand
-- written journal - is not touched. And only where the patient actually has a
-- ledger to move it to.
--
-- One leg moves and no amount changes, so every voucher stays balanced.
-- ==========================================================================

DO $backfill$
DECLARE
  v_2110      UUID;
  v_legs      INTEGER := 0;
  v_narrations INTEGER := 0;
BEGIN
  SELECT id INTO v_2110 FROM chart_of_accounts WHERE account_code = '2110';

  IF v_2110 IS NULL THEN
    RAISE NOTICE 'No 2110 Patient Advance ledger; nothing to move.';
  ELSE
    WITH advance_vouchers AS (
      SELECT v.id AS voucher_id,
             pl.id AS patient_ledger_id,
             COALESCE(pl.account_id, ca.id) AS ledger_account_id
        FROM vouchers v
        JOIN patients p            ON p.id = v.patient_id
        LEFT JOIN patient_ledgers pl ON pl.patient_id = v.patient_id
        LEFT JOIN chart_of_accounts ca
               ON ca.account_code = 'PT' || p.patients_id
       WHERE v.status = 'AUTHORISED'
         AND v.voucher_date >= DATE '2026-07-25'
         AND v.patient_id IS NOT NULL
         -- made by the advance trigger, which stamps the advance's id here
         AND EXISTS (
               SELECT 1 FROM advance_payment ap
                WHERE ap.id::TEXT = v.reference_number
             )
         AND COALESCE(pl.account_id, ca.id) IS NOT NULL
    )
    UPDATE voucher_entries e
       SET account_id        = av.ledger_account_id,
           patient_ledger_id = COALESCE(e.patient_ledger_id, av.patient_ledger_id)
      FROM advance_vouchers av
     WHERE e.voucher_id = av.voucher_id
       AND e.account_id = v_2110;
    GET DIAGNOSTICS v_legs = ROW_COUNT;
  END IF;

  -- The patient's name on the narration. Skips anything already carrying a #
  -- tag, so re-running this changes nothing.
  UPDATE vouchers v
     SET narration  = v.narration || ' #' || btrim(p.name),
         updated_at = NOW()
    FROM patients p, voucher_types vt
   WHERE p.id  = v.patient_id
     AND vt.id = v.voucher_type_id
     AND vt.voucher_category IN ('RECEIPT', 'PAYMENT')
     AND v.status = 'AUTHORISED'
     AND v.voucher_date >= DATE '2026-07-25'
     AND v.patient_id IS NOT NULL
     AND COALESCE(v.narration, '') <> ''
     AND v.narration NOT LIKE '%#%'
     AND btrim(COALESCE(p.name, '')) <> '';
  GET DIAGNOSTICS v_narrations = ROW_COUNT;

  RAISE NOTICE 'Moved % advance leg(s) off 2110 onto the patient; named the patient on % narration(s).',
    v_legs, v_narrations;
END;
$backfill$;
