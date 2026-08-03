-- A receipt lands in the company's own bank ledger, not the orphan copy.
--
-- Tally is the reference: DRM Hope's Cash/Bank Summary shows exactly seven
-- cash/bank ledgers, and each company's books mirror their own Tally. But the
-- accounting chart also carried four company-less bank ledgers left over from
-- before the cutover ('SARASWAT BANK', 'STATE BANK OF INDIA (DRM)',
-- 'Canara Bank [A/C120023677813)JARIPATHKA ]',
-- 'Canara Bank HOPE PHARMACY [A/C120028497823] JARIPATKA', plus 'Cash at
-- Bank'), and this trigger resolved banks by bare name, so every patient
-- receipt since the cutover has been debiting those orphans - 3-Aug entries
-- included - while the company ledgers that Tally's opening balances were
-- loaded onto sat still.
--
-- WHAT CHANGES.
--   1. The company is resolved before the bank, and every bank lookup is
--      scoped to that company's books. Legacy names are first mapped to the
--      Tally ledger they duplicated, so an old dropdown value or a stored
--      bank_account_id pointing at an orphan still routes correctly.
--   2. Post-cutover (>= 2026-07-25) entries sitting on the orphans move to the
--      matching company ledger, keyed by each voucher's company. Pre-cutover
--      rows came with the legacy import, are not the book of record, and stay
--      on the stub.
--   3. The orphans retire the way merged ledgers do: renamed with a
--      '(merged 03 Aug 26)' suffix and made inactive.
--
-- The rest of the function is exactly as 20260730120000 left it.

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
  v_requested_name TEXT;
  v_lookup_name TEXT;
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
  -- Whose books this belongs in. Resolved before the bank, because the same
  -- bank name is a different ledger in each company's books. The patient
  -- decides where there is one; a pharmacy transaction with no patient
  -- belongs to Hope Pharmacy. The name comes out of the same read, for the
  -- narration.
  -- ========================================================================
  SELECT public.resolve_patient_company(p.hospital_name, p.corporate), p.name
    INTO v_company_id, v_patient_name
    FROM patients p WHERE p.id = v_patient_id;

  IF v_company_id IS NULL AND TG_TABLE_NAME = 'patient_payment_transactions' THEN
    SELECT id INTO v_company_id FROM companies WHERE company_key = 'hope_pharmacy';
  END IF;

  -- ========================================================================
  -- Determine which account holds the cash - in this company's books.
  -- ========================================================================
  v_account_name := 'Cash';
  v_debit_account_id := NULL;
  v_requested_name := NULL;

  IF v_payment_mode IN ('CASH', 'Cash', 'cash') THEN
    IF v_remarks IS NOT NULL AND v_remarks != '' THEN
      IF v_remarks ILIKE '%sbi%' OR v_remarks ILIKE '%state bank%' OR v_remarks ILIKE '%drm%' THEN
        v_requested_name := 'State Bank of India';
      ELSIF v_remarks ILIKE '%saraswat%' THEN
        v_requested_name := 'Saraswat Bank';
      END IF;
    END IF;

  ELSIF v_payment_mode IN ('ONLINE', 'Online', 'online', 'Bank Transfer', 'BANK TRANSFER',
                           'UPI', 'NEFT', 'RTGS', 'CARD', 'CHEQUE', 'DD') THEN
    IF v_bank_account_id IS NOT NULL THEN
      -- read the name even off an inactive orphan; the company-scoped lookup
      -- below turns it into the right company's ledger
      SELECT account_name INTO v_requested_name
      FROM chart_of_accounts
      WHERE id = v_bank_account_id;
    END IF;

    IF v_requested_name IS NULL AND v_bank_account_name IS NOT NULL AND v_bank_account_name != '' THEN
      v_requested_name := v_bank_account_name;
    END IF;

    IF v_requested_name IS NULL AND v_remarks IS NOT NULL AND v_remarks != '' THEN
      IF v_remarks ILIKE '%sbi%' OR v_remarks ILIKE '%state bank%' OR v_remarks ILIKE '%drm%' THEN
        v_requested_name := 'State Bank of India';
      ELSIF v_remarks ILIKE '%saraswat%' THEN
        v_requested_name := 'Saraswat Bank';
      END IF;
    END IF;

    IF v_requested_name IS NULL THEN
      RAISE WARNING '% payment: no bank information provided, defaulting to Cash', v_payment_mode;
    END IF;
  END IF;

  -- Legacy orphan names -> the Tally ledger they duplicated
  v_lookup_name := CASE lower(btrim(COALESCE(v_requested_name, '')))
    WHEN 'saraswat bank'             THEN 'Saraswat Bank'
    WHEN 'state bank of india (drm)' THEN 'State Bank of India'
    WHEN 'state bank of india'       THEN 'State Bank of India'
    WHEN 'canara bank [a/c120023677813)jaripathka ]' THEN 'Canara Bank Jaripatka'
    WHEN 'canara bank [a/c120023677813)jaripathka]'  THEN 'Canara Bank Jaripatka'
    WHEN 'canara bank hope pharmacy [a/c120028497823] jaripatka' THEN 'Canara Bank (Hope Pharmacy)'
    WHEN 'shikshak sahakari bank'    THEN 'Shikshak Sahakari Bank Ltd'
    WHEN 'cash at bank'              THEN NULL
    WHEN 'cash in hand'              THEN NULL
    WHEN 'cash'                      THEN NULL
    WHEN ''                          THEN NULL
    ELSE btrim(v_requested_name)
  END;

  IF v_lookup_name IS NOT NULL AND v_company_id IS NOT NULL THEN
    SELECT id, account_name INTO v_debit_account_id, v_account_name
    FROM chart_of_accounts
    WHERE lower(btrim(account_name)) = lower(v_lookup_name)
      AND company_id = v_company_id
      AND is_active = true
    ORDER BY CASE WHEN account_group = 'Bank Accounts' THEN 0 ELSE 1 END
    LIMIT 1;

    -- Hope Pharmacy's own books call their Canara account just 'Canara Bank'
    IF v_debit_account_id IS NULL AND lower(v_lookup_name) = 'canara bank (hope pharmacy)' THEN
      SELECT id, account_name INTO v_debit_account_id, v_account_name
      FROM chart_of_accounts
      WHERE lower(btrim(account_name)) = 'canara bank'
        AND company_id = v_company_id
        AND is_active = true
      LIMIT 1;
    END IF;
  END IF;

  -- Pharmacy non-cash payments route to the pharmacy's Canara account
  IF v_debit_account_id IS NULL
     AND v_payment_mode NOT IN ('CASH', 'Cash', 'cash')
     AND TG_TABLE_NAME = 'patient_payment_transactions'
     AND v_company_id IS NOT NULL
  THEN
    IF NEW.payment_source IN ('PHARMACY', 'DIRECT_SALE') THEN
      SELECT id, account_name INTO v_debit_account_id, v_account_name
      FROM chart_of_accounts
      WHERE company_id = v_company_id
        AND is_active = true
        AND (lower(account_name) LIKE '%(hope pharmacy)%' OR lower(btrim(account_name)) = 'canara bank')
      ORDER BY CASE WHEN lower(account_name) LIKE '%(hope pharmacy)%' THEN 0 ELSE 1 END
      LIMIT 1;

      IF v_debit_account_id IS NOT NULL THEN
        RAISE NOTICE 'PHARMACY payment: Routing % to %', v_payment_mode, v_account_name;
      END IF;
    END IF;
  END IF;

  -- A named bank with no ledger in this company's books: fall back to the
  -- old bare-name match rather than losing the receipt, and say so.
  IF v_debit_account_id IS NULL AND v_lookup_name IS NOT NULL THEN
    SELECT id, account_name INTO v_debit_account_id, v_account_name
    FROM chart_of_accounts
    WHERE lower(btrim(account_name)) IN (lower(v_lookup_name),
                                         lower(btrim(COALESCE(v_requested_name, ''))))
      AND is_active = true
    ORDER BY CASE WHEN company_id = v_company_id THEN 0
                  WHEN company_id IS NOT NULL THEN 1
                  ELSE 2 END,
             CASE WHEN account_group = 'Bank Accounts' THEN 0 ELSE 1 END
    LIMIT 1;

    IF v_debit_account_id IS NOT NULL THEN
      RAISE WARNING 'Bank "%" has no ledger in company %; using "%"', v_lookup_name, v_company_id, v_account_name;
    END IF;
  END IF;

  -- Cash, or nothing better: this company's cash ledger
  IF v_debit_account_id IS NULL AND v_company_id IS NOT NULL THEN
    SELECT id, account_name INTO v_debit_account_id, v_account_name
    FROM chart_of_accounts
    WHERE company_id = v_company_id
      AND is_active = true
      AND (account_group = 'Cash-in-Hand' OR lower(btrim(account_name)) = 'cash')
    ORDER BY CASE WHEN lower(btrim(account_name)) = 'cash' THEN 0 ELSE 1 END,
             CASE WHEN account_group = 'Cash-in-Hand' THEN 0 ELSE 1 END
    LIMIT 1;
  END IF;

  -- Last resort, as before
  IF v_debit_account_id IS NULL THEN
    SELECT id, account_name INTO v_debit_account_id, v_account_name
    FROM chart_of_accounts
    WHERE account_code = '1110'
    LIMIT 1;

    RAISE WARNING 'No cash/bank ledger in company %; falling back to 1110 (%)', v_company_id, v_account_name;
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

  -- reference_number links an advance to its voucher, so a later edit or
  -- deletion can find and retire it. Company and patient name were resolved
  -- above, before the bank lookup.
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
-- The receipts already sitting on the orphans.
--
-- Post-cutover (>= 2026-07-25) entries move to the voucher's own company's
-- ledger for the same bank. Pre-cutover entries came with the legacy import,
-- are not the book of record, and stay on the stub. Only the debit leg's
-- account changes; no amount moves, so every voucher stays balanced.
-- ==========================================================================

DO $merge$
DECLARE
  v_moved INTEGER := 0;
  v_left  INTEGER := 0;
BEGIN
  WITH map(orphan_id, company_id, survivor_id) AS (
    VALUES
      -- SARASWAT BANK -> Saraswat Bank
      ('3d648798-7776-4b55-8caf-8b89efc4180d'::uuid, '4adfe31a-7073-49fe-bc18-90fd32e00e52'::uuid, '71424fd8-3ff1-4300-8ceb-3a52bc90b380'::uuid),
      ('3d648798-7776-4b55-8caf-8b89efc4180d'::uuid, '5a9cc083-a370-4867-bcde-6d064bebff26'::uuid, 'f7bd244a-b8f6-4663-bf6b-761e1b6a71ff'::uuid),
      ('3d648798-7776-4b55-8caf-8b89efc4180d'::uuid, 'd718b1f4-a85f-409d-8193-b8781a75a550'::uuid, 'fbc08333-ef5b-49c7-9e19-1d84a99f43b5'::uuid),
      -- STATE BANK OF INDIA (DRM) -> State Bank of India
      ('3adab687-4734-4615-9ee8-c947859cfb28'::uuid, '4adfe31a-7073-49fe-bc18-90fd32e00e52'::uuid, '77a186d4-ecae-4028-8023-e837bce343a3'::uuid),
      ('3adab687-4734-4615-9ee8-c947859cfb28'::uuid, '5a9cc083-a370-4867-bcde-6d064bebff26'::uuid, 'e932df23-0131-4c4c-8d32-3e4850480962'::uuid),
      ('3adab687-4734-4615-9ee8-c947859cfb28'::uuid, 'd718b1f4-a85f-409d-8193-b8781a75a550'::uuid, '7b844ae0-de2f-4d37-8c19-89dc116b52cf'::uuid),
      -- Canara Bank [A/C120023677813)JARIPATHKA ] -> Canara Bank Jaripatka
      ('ae35c7ef-e030-445d-a543-92701584429a'::uuid, '4adfe31a-7073-49fe-bc18-90fd32e00e52'::uuid, 'd0b85165-d202-4507-aec2-2e54295e37ce'::uuid),
      ('ae35c7ef-e030-445d-a543-92701584429a'::uuid, '5a9cc083-a370-4867-bcde-6d064bebff26'::uuid, '3a7f7288-f079-462a-9a8c-a4e0d0e5c557'::uuid),
      ('ae35c7ef-e030-445d-a543-92701584429a'::uuid, 'd718b1f4-a85f-409d-8193-b8781a75a550'::uuid, 'f4246968-f47e-441c-af73-46ac054df76d'::uuid),
      -- Canara Bank HOPE PHARMACY [...] -> Canara Bank (Hope Pharmacy co.) / CANARA BANK (Hope Pharmacy) (DRM)
      ('ace5c97d-0c45-4c61-a7d3-6dc728f40739'::uuid, '05513224-58c5-4f6d-974d-78b9ff0de0d5'::uuid, '16987e4a-eb68-4775-a497-12b6c57bcb51'::uuid),
      ('ace5c97d-0c45-4c61-a7d3-6dc728f40739'::uuid, '4adfe31a-7073-49fe-bc18-90fd32e00e52'::uuid, '7f3235ad-67a3-49e7-ad57-399b9b604284'::uuid),
      -- Cash at Bank -> each company's Cash
      ('1e91b68b-c52b-487b-870e-9e0fa0d8ad8b'::uuid, '4adfe31a-7073-49fe-bc18-90fd32e00e52'::uuid, '23994951-c09b-4924-8963-c74933c08680'::uuid),
      ('1e91b68b-c52b-487b-870e-9e0fa0d8ad8b'::uuid, '5a9cc083-a370-4867-bcde-6d064bebff26'::uuid, '94f01917-62e3-4eae-bc7b-0d32a9386ea6'::uuid),
      ('1e91b68b-c52b-487b-870e-9e0fa0d8ad8b'::uuid, 'd718b1f4-a85f-409d-8193-b8781a75a550'::uuid, '49794722-6793-4b73-be9f-64ebab50ade4'::uuid),
      ('1e91b68b-c52b-487b-870e-9e0fa0d8ad8b'::uuid, '05513224-58c5-4f6d-974d-78b9ff0de0d5'::uuid, '9764d7a7-0c46-4816-be26-d1524ba7fd25'::uuid)
  ),
  moved AS (
    UPDATE voucher_entries e
       SET account_id = m.survivor_id
      FROM vouchers v, map m
     WHERE e.voucher_id = v.id
       AND e.account_id = m.orphan_id
       AND v.company_id = m.company_id
       AND v.voucher_date >= DATE '2026-07-25'
    RETURNING e.id
  )
  SELECT count(*) INTO v_moved FROM moved;

  RAISE NOTICE 'Moved % post-cutover entries onto company bank ledgers.', v_moved;

  -- A post-cutover entry can stay behind only if its voucher has no company
  -- or the company has no ledger for that bank. Left in place, reported.
  SELECT count(*) INTO v_left
    FROM voucher_entries e
    JOIN vouchers v ON v.id = e.voucher_id
   WHERE e.account_id IN ('3d648798-7776-4b55-8caf-8b89efc4180d',
                          '3adab687-4734-4615-9ee8-c947859cfb28',
                          'ae35c7ef-e030-445d-a543-92701584429a',
                          'ace5c97d-0c45-4c61-a7d3-6dc728f40739',
                          '1e91b68b-c52b-487b-870e-9e0fa0d8ad8b')
     AND v.voucher_date >= DATE '2026-07-25';

  IF v_left > 0 THEN
    RAISE WARNING '% post-cutover entries remain on orphan bank ledgers (no company on the voucher, or no such bank in that company); left in place.', v_left;
  END IF;

  -- The orphans retire as inactive audit stubs, the same convention the
  -- Cash (HOPE) / Cash at Almirah merges used.
  UPDATE chart_of_accounts
     SET is_active = false,
         account_name = account_name || ' (merged 03 Aug 26)',
         updated_at = NOW()
   WHERE id IN ('3d648798-7776-4b55-8caf-8b89efc4180d',
                '3adab687-4734-4615-9ee8-c947859cfb28',
                'ae35c7ef-e030-445d-a543-92701584429a',
                'ace5c97d-0c45-4c61-a7d3-6dc728f40739',
                '1e91b68b-c52b-487b-870e-9e0fa0d8ad8b')
     AND is_active = true;
END $merge$;
