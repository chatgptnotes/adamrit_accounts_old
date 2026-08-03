-- The Saraswat Bank ledger statement shows today's receipts again.
--
-- The Ledger Statement page defaults the payment-mode filter to ONLINE for
-- any bank account. get_ledger_statement_with_patients honoured that through
-- a fallback branch that matched account_group = 'BANK' - the group the old
-- orphan bank ledgers sat in. The per-company bank ledgers the Tally cutover
-- introduced live in group 'Bank Accounts', so after 20260803170000 moved
-- receipts onto them the ONLINE view of every bank went blank while the
-- vouchers sat correctly in the ledger. The filter (and the display CASE
-- that labels bare bank debits ONLINE) now accepts both group names; the
-- function is otherwise exactly as 20251106000006 left it.
--
-- Also backfills receipt vouchers for the only two post-cutover Saraswat
-- advances that have none: Rajesh yadav (UHAY26G25004), Rs 5,000 at 07:16
-- and Rs 5,000 at 07:56 on 25-Jul-2026 - recorded minutes before the
-- voucher-linking trigger went live that morning.

DROP FUNCTION IF EXISTS get_ledger_statement_with_patients(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION get_ledger_statement_with_patients(
  p_account_name TEXT,
  p_from_date TEXT,
  p_to_date TEXT,
  p_mrn_filter TEXT DEFAULT NULL,
  p_payment_mode TEXT DEFAULT NULL,
  p_hospital_name TEXT DEFAULT NULL
)
RETURNS TABLE (
  voucher_date DATE,
  voucher_number TEXT,
  voucher_type TEXT,
  narration TEXT,
  patient_name TEXT,
  mrn_number TEXT,
  patient_id UUID,
  visit_id TEXT,
  visit_type TEXT,
  patient_type TEXT,
  payment_type TEXT,
  debit_amount DECIMAL,
  credit_amount DECIMAL,
  payment_mode TEXT,
  remarks TEXT,
  is_refund BOOLEAN,
  bank_account TEXT,
  account_code TEXT
)
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT ON (ve.id)
    v.voucher_date,
    v.voucher_number::TEXT,
    vt.voucher_type_name::TEXT as voucher_type,
    v.narration::TEXT,

    -- Patient Details
    COALESCE(p.name::TEXT, 'Unknown') as patient_name,
    COALESCE(p.patients_id::TEXT, '') as mrn_number,
    v.patient_id,

    -- Visit Details
    COALESCE(
      vis.visit_id::TEXT,
      v.reference_number::TEXT,
      ''
    ) as visit_id,
    COALESCE(vis.visit_type::TEXT, '') as visit_type,
    COALESCE(vis.patient_type::TEXT, '') as patient_type,

    -- Payment Type
    CASE
      WHEN ap.id IS NOT NULL AND ap.is_refund = FALSE THEN 'ADVANCE_PAYMENT'
      WHEN ap.id IS NOT NULL AND ap.is_refund = TRUE THEN 'ADVANCE_REFUND'
      WHEN fp.id IS NOT NULL THEN 'FINAL_PAYMENT'
      WHEN vt.voucher_type_name ILIKE '%receipt%' THEN 'ADVANCE_PAYMENT'
      WHEN vt.voucher_type_name ILIKE '%payment%' THEN 'ADVANCE_PAYMENT'
      ELSE ''
    END as payment_type,

    -- Amounts
    COALESCE(ve.debit_amount, 0) as debit_amount,
    COALESCE(ve.credit_amount, 0) as credit_amount,

    -- Payment Mode
    COALESCE(
      ap.payment_mode::TEXT,
      fp.mode_of_payment::TEXT,
      CASE
        WHEN coa.account_group IN ('BANK', 'Bank Accounts') AND ve.debit_amount > 0 THEN 'ONLINE'
        WHEN coa.account_name ILIKE '%bank%' AND ve.debit_amount > 0 THEN 'ONLINE'
        ELSE ''
      END
    ) as payment_mode,

    -- Remarks
    COALESCE(
      ap.remarks::TEXT,
      fp.payment_remark::TEXT,
      v.narration::TEXT,
      ''
    ) as remarks,

    -- Is Refund
    COALESCE(ap.is_refund, FALSE) as is_refund,

    -- Bank Account
    COALESCE(
      ap.bank_account_name::TEXT,
      fp.bank_account_name::TEXT,
      ''
    ) as bank_account,
    coa.account_code::TEXT

  FROM voucher_entries ve

  -- Core JOINs
  INNER JOIN vouchers v ON ve.voucher_id = v.id
  INNER JOIN chart_of_accounts coa ON ve.account_id = coa.id
  LEFT JOIN voucher_types vt ON v.voucher_type_id = vt.id
  LEFT JOIN patients p ON v.patient_id = p.id

  -- Visit JOIN
  LEFT JOIN visits vis ON (
    vis.patient_id = v.patient_id
    AND DATE(vis.visit_date) = v.voucher_date
  )

  -- Advance Payment JOIN
  LEFT JOIN advance_payment ap ON (
    ap.patient_id = v.patient_id
    AND DATE(ap.payment_date) = v.voucher_date
    AND (
      ap.advance_amount = GREATEST(ve.debit_amount, ve.credit_amount)
      OR ABS(ap.advance_amount - GREATEST(ve.debit_amount, ve.credit_amount)) < 0.01
      OR ap.bank_account_id = coa.id
    )
  )

  -- Final Payments JOIN
  LEFT JOIN final_payments fp ON (
    fp.patient_id = v.patient_id
    AND fp.payment_date = v.voucher_date
  )

  WHERE
    -- Filter by account name
    coa.account_name = p_account_name

    -- Date range filter
    AND v.voucher_date >= p_from_date::DATE
    AND v.voucher_date <= p_to_date::DATE

    -- Optional MRN filter
    AND (p_mrn_filter IS NULL OR p.patients_id = p_mrn_filter)

    -- Payment mode filter. ONLINE means "receipts into this bank", whatever
    -- instrument carried them (UPI/NEFT/cheque), matching how the page uses
    -- it as the default for every bank account.
    AND (
      p_payment_mode IS NULL
      OR ap.payment_mode::TEXT = p_payment_mode
      OR fp.mode_of_payment::TEXT = p_payment_mode
      OR (p_payment_mode = 'ONLINE' AND coa.account_group IN ('BANK', 'Bank Accounts') AND ve.debit_amount > 0)
    )

    -- Hospital filter
    AND (p_hospital_name IS NULL OR p.hospital_name = p_hospital_name)

  ORDER BY ve.id, v.voucher_date, v.voucher_number;
END;
$$;

GRANT EXECUTE ON FUNCTION get_ledger_statement_with_patients TO authenticated;

COMMENT ON FUNCTION get_ledger_statement_with_patients IS
'Ledger statement function with hospital filtering. Shows voucher entries only for patients from the specified hospital (hope or ayushman). ONLINE mode filter covers both BANK and Bank Accounts ledger groups.';


-- ==========================================================================
-- Backfill: the two 25-Jul Saraswat advances recorded before the trigger
-- started linking vouchers. Idempotent - skips any advance that already has
-- a live voucher.
-- ==========================================================================

DO $backfill$
DECLARE
  r RECORD;
  v_voucher_type_id UUID;
  v_voucher_type_code TEXT;
  v_voucher_id UUID;
  v_voucher_number TEXT;
  v_patient_ledger_id UUID;
  v_patient_account_id UUID;
  v_created INTEGER := 0;
BEGIN
  SELECT id, voucher_type_code INTO v_voucher_type_id, v_voucher_type_code
    FROM voucher_types
   WHERE voucher_type_code IN ('REC', 'RV')
     AND voucher_category = 'RECEIPT'
     AND is_active = true
   ORDER BY CASE WHEN voucher_type_code = 'REC' THEN 1 ELSE 2 END
   LIMIT 1;

  IF v_voucher_type_id IS NULL THEN
    RAISE WARNING 'No active RECEIPT voucher type; backfill skipped.';
    RETURN;
  END IF;

  FOR r IN
    SELECT ap.id, ap.advance_amount, ap.payment_date::DATE AS payment_date,
           ap.payment_mode, ap.patient_id, p.name AS patient_name
      FROM advance_payment ap
      JOIN patients p ON p.id = ap.patient_id
     WHERE ap.id IN ('49d06227-c109-46c0-836e-13f8791f1a45',
                     '195fc867-847f-4beb-afec-53d5528f6545')
       AND COALESCE(ap.status, 'ACTIVE') <> 'CANCELLED'
       AND NOT EXISTS (
             SELECT 1 FROM vouchers vv
              WHERE vv.reference_number = ap.id::TEXT
                AND vv.status <> 'CANCELLED')
  LOOP
    SELECT pl.id, pl.account_id INTO v_patient_ledger_id, v_patient_account_id
      FROM patient_ledgers pl
     WHERE pl.patient_id = r.patient_id;

    IF v_patient_account_id IS NULL THEN
      RAISE WARNING 'Advance % skipped: patient % has no ledger.', r.id, r.patient_id;
      CONTINUE;
    END IF;

    v_voucher_number := generate_voucher_number(v_voucher_type_code);
    v_voucher_id := gen_random_uuid();

    INSERT INTO vouchers (
      id, voucher_number, voucher_type_id, voucher_date, reference_number,
      narration, total_amount, patient_id, company_id, status,
      created_at, updated_at
    ) VALUES (
      v_voucher_id,
      v_voucher_number,
      v_voucher_type_id,
      r.payment_date,
      r.id::TEXT,
      'Advance payment received via ' || r.payment_mode || ' - Saraswat Bank'
        || COALESCE(' #' || NULLIF(btrim(r.patient_name), ''), ''),
      r.advance_amount,
      r.patient_id,
      '5a9cc083-a370-4867-bcde-6d064bebff26',  -- Ayushman Nagpur Hospital
      'AUTHORISED',
      NOW(),
      NOW()
    );

    INSERT INTO voucher_entries (
      id, voucher_id, account_id, narration, debit_amount, credit_amount, created_at
    ) VALUES (
      gen_random_uuid(), v_voucher_id,
      'f7bd244a-b8f6-4663-bf6b-761e1b6a71ff',  -- Saraswat Bank (Ayushman)
      'Payment received from patient via ' || r.payment_mode || ' to Saraswat Bank',
      r.advance_amount, 0, NOW()
    );

    INSERT INTO voucher_entries (
      id, voucher_id, account_id, patient_ledger_id, narration,
      debit_amount, credit_amount, created_at
    ) VALUES (
      gen_random_uuid(), v_voucher_id, v_patient_account_id, v_patient_ledger_id,
      'Patient payment received', 0, r.advance_amount, NOW()
    );

    v_created := v_created + 1;
    RAISE NOTICE 'Backfilled voucher % for advance % (Rs %).', v_voucher_number, r.id, r.advance_amount;
  END LOOP;

  RAISE NOTICE 'Backfill complete: % voucher(s) created.', v_created;
END $backfill$;
