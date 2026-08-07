-- Five fields the expense invoice form was missing.
--
-- Referral and implant invoices are raised against a patient and a procedure,
-- and the bill arrives long after the surgery. Recording only the invoice date
-- meant none of that could be reported on: which patient, which surgery, when
-- it was done, when the bill actually reached the office, and when it falls
-- due for payment (two months after it was received, by the office's rule).
--
--   patient_id            the patient the bill belongs to (patient_name exists)
--   surgery_name          from surgery_fee_master, free text if not listed
--   date_of_procedure     when the surgery was performed
--   date_of_receiving_bill when the invoice reached the office
--   date_of_payment       receiving + 2 months, set by default, editable
--
-- Applied through apply_migration(): one transaction, rolls back on failure.
-- Idempotent, and it verifies itself before committing.

ALTER TABLE public.expense_bills
  ADD COLUMN IF NOT EXISTS patient_id             TEXT,
  ADD COLUMN IF NOT EXISTS surgery_name           TEXT,
  ADD COLUMN IF NOT EXISTS date_of_procedure      DATE,
  ADD COLUMN IF NOT EXISTS date_of_receiving_bill DATE,
  ADD COLUMN IF NOT EXISTS date_of_payment        DATE;

COMMENT ON COLUMN public.expense_bills.date_of_payment IS
  'When this bill is to be paid. Defaults to two months after '
  'date_of_receiving_bill and can be overridden on the form.';

CREATE INDEX IF NOT EXISTS expense_bills_patient_idx
  ON public.expense_bills (patient_id) WHERE patient_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';

DO $$
DECLARE
  v_missing TEXT := '';
  v_col TEXT;
BEGIN
  FOREACH v_col IN ARRAY ARRAY['patient_id','surgery_name','date_of_procedure',
                               'date_of_receiving_bill','date_of_payment']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'expense_bills'
         AND column_name = v_col
    ) THEN
      v_missing := v_missing || ' ' || v_col || ';';
    END IF;
  END LOOP;
  IF v_missing <> '' THEN
    RAISE EXCEPTION 'ABORT — columns not added:%', v_missing;
  END IF;
  RAISE NOTICE 'OK — expense invoices can carry patient, surgery and the three dates';
END $$;
