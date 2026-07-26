-- Accrue the physiotherapy bill when it is generated.
--
-- /physiotherapy-bill builds an OPD physiotherapy bill per visit and, on save
-- (PhysiotherapyBill.tsx:382-392), writes the number, the total and a generated
-- timestamp onto the visit. Nothing posts, so the income exists on a printed
-- bill and nowhere in the books.
--
--     Dr  PT<uid>                     the bill total
--         Cr  4120 Procedure Charges       same amount
--
-- Payment settles it the ordinary way, through the receipt path that already
-- credits the patient ledger.
--
-- WHY 4120 AND NOT A LEDGER OF ITS OWN. post_bill_vouchers already folds
-- financial_summary.total_amount_physiotherapy into 4120 Procedures & services.
-- Sending the OPD bill somewhere else would split one service across two
-- ledgers depending on which screen raised it. The physiotherapy bill number
-- is in the narration, so the detail is not lost.
--
-- THE DOUBLE-COUNT THIS GUARDS AGAINST. total_amount_physiotherapy is typed by
-- hand on the final bill (useFinancialSummary.ts:1412); it is not derived from
-- this bill. A visit carrying both would have its physiotherapy counted twice.
-- Where the final bill has already been approved with a physiotherapy amount
-- this posts nothing and says so. The reverse order - physiotherapy bill first,
-- final bill approved later - cannot be caught from here, so the verification
-- below counts how many visits carry both. If that count is zero the two
-- streams are separate in practice and nothing more is needed.
--
-- REPOSTING. The bill can be saved again. A changed total cancels the earlier
-- voucher and posts afresh, leaving the correction visible in voucher_edit_log.

CREATE OR REPLACE FUNCTION public.accrue_physiotherapy_bill()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_amount     NUMERIC(15,2);
  v_debtor_id  UUID;
  v_income_id  UUID;
  v_company_id UUID;
  v_patient    RECORD;
  v_fs_physio  NUMERIC(15,2);
  v_type_id    UUID;
  v_type_code  TEXT;
  v_voucher_id UUID;
  v_voucher_no TEXT;
  v_reference  TEXT;
  v_narration  TEXT;
BEGIN
  v_reference := 'PHYSIO-' || NEW.id::TEXT;

  -- A save that leaves the total where it was is not a correction.
  IF COALESCE(NEW.physiotherapy_bill_total, 0) = COALESCE(OLD.physiotherapy_bill_total, 0)
     AND NEW.physiotherapy_bill_number IS NOT DISTINCT FROM OLD.physiotherapy_bill_number THEN
    RETURN NEW;
  END IF;

  UPDATE vouchers
     SET status = 'CANCELLED',
         last_modified_by = 'physiotherapy-bill-changed',
         updated_at = now()
   WHERE reference_number = v_reference AND status <> 'CANCELLED';

  v_amount := GREATEST(COALESCE(NEW.physiotherapy_bill_total, 0), 0);
  IF v_amount <= 0 THEN
    RETURN NEW;
  END IF;

  -- If the final bill has already been approved carrying a physiotherapy
  -- amount, that income is in the books. Posting again would double it.
  SELECT COALESCE(SUM(COALESCE(fs.total_amount_physiotherapy, 0)), 0)
    INTO v_fs_physio
    FROM bills b
    JOIN financial_summary fs ON fs.bill_id = b.id
   WHERE b.visit_id = NEW.visit_id
     AND upper(COALESCE(b.status, '')) = 'APPROVED';

  IF v_fs_physio > 0 THEN
    RAISE WARNING 'Visit %: final bill already accrued Rs % of physiotherapy, bill % not posted',
      NEW.visit_id, v_fs_physio, NEW.physiotherapy_bill_number;
    RETURN NEW;
  END IF;

  SELECT p.id, p.patients_id, p.hospital_name, p.name AS patient_name,
         COALESCE(NEW.corporate, p.corporate) AS corporate
    INTO v_patient
    FROM patients p
   WHERE p.id = NEW.patient_id;

  IF v_patient.id IS NULL THEN
    RAISE WARNING 'Visit %: no patient, physiotherapy bill not posted', NEW.visit_id;
    RETURN NEW;
  END IF;

  SELECT pl.account_id INTO v_debtor_id
    FROM patient_ledgers pl WHERE pl.patient_id = v_patient.id;
  IF v_debtor_id IS NULL THEN
    SELECT id INTO v_debtor_id FROM chart_of_accounts
     WHERE account_code = 'PT' || v_patient.patients_id;
  END IF;

  SELECT id INTO v_income_id FROM chart_of_accounts WHERE account_code = '4120';
  v_company_id := public.resolve_patient_company(v_patient.hospital_name, v_patient.corporate);

  SELECT id, voucher_type_code INTO v_type_id, v_type_code
    FROM voucher_types
   WHERE voucher_category = 'SALES' AND is_active = true
   ORDER BY CASE voucher_type_code WHEN 'SV' THEN 1 WHEN 'SAL' THEN 2 ELSE 3 END
   LIMIT 1;

  IF v_type_id IS NULL OR v_debtor_id IS NULL OR v_income_id IS NULL THEN
    RAISE WARNING 'Visit %: ledgers or voucher type missing, physiotherapy bill not posted',
      NEW.visit_id;
    RETURN NEW;
  END IF;

  v_voucher_id := gen_random_uuid();
  v_voucher_no := generate_voucher_number(v_type_code);
  v_narration  := 'Physiotherapy bill '
                  || COALESCE(NULLIF(btrim(NEW.physiotherapy_bill_number), ''), v_reference)
                  || COALESCE(' - ' || NULLIF(btrim(v_patient.patient_name), ''), '');

  INSERT INTO vouchers (
    id, voucher_number, voucher_type_id, voucher_date, reference_number,
    narration, total_amount, company_id, status, created_by, created_at, updated_at
  ) VALUES (
    v_voucher_id, v_voucher_no, v_type_id,
    COALESCE(NEW.physiotherapy_bill_date_to,
             NEW.physiotherapy_bill_generated_at::DATE,
             CURRENT_DATE),
    v_reference, v_narration, v_amount, v_company_id, 'AUTHORISED',
    'physiotherapy-bill', NOW(), NOW()
  );

  -- patient_ledger_id is set on the patient leg so the existing balance trigger
  -- keeps patient_ledgers.current_balance live, as the bill accrual does.
  INSERT INTO voucher_entries (
    id, voucher_id, account_id, patient_ledger_id, narration,
    debit_amount, credit_amount, entry_order, created_at
  ) VALUES
    (gen_random_uuid(), v_voucher_id, v_debtor_id,
     (SELECT id FROM patient_ledgers WHERE patient_id = v_patient.id),
     v_narration, v_amount, 0, 1, NOW()),
    (gen_random_uuid(), v_voucher_id, v_income_id, NULL,
     v_narration, 0, v_amount, 2, NOW());

  RAISE NOTICE 'Visit %: accrued physiotherapy bill % of Rs %',
    NEW.visit_id, NEW.physiotherapy_bill_number, v_amount;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_accrue_physiotherapy_bill ON public.visits;
CREATE TRIGGER trg_accrue_physiotherapy_bill
AFTER UPDATE OF physiotherapy_bill_total, physiotherapy_bill_number ON public.visits
FOR EACH ROW
EXECUTE FUNCTION public.accrue_physiotherapy_bill();
