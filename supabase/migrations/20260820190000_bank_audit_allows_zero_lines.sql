-- Saraswat Bank prints informational zero-value lines ("Penal Charge Coll")
-- and the Ayushman FY 2025-26 statement carries two of them. They are real
-- statement lines, so the audit evidence must hold them — the report total
-- of 1,453 rows must tie exactly. A zero line can never become a voucher;
-- the future posting step requires a non-zero amount regardless.
--
-- Touches only bank_reconciliation_rows (created earlier today). Nothing
-- else in the database is affected.

ALTER TABLE public.bank_reconciliation_rows
  DROP CONSTRAINT IF EXISTS bank_reconciliation_rows_signed_amount_check;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
     WHERE table_schema = 'public'
       AND table_name = 'bank_reconciliation_rows'
       AND constraint_name = 'bank_reconciliation_rows_signed_amount_check'
  ) THEN
    RAISE EXCEPTION 'ABORT — zero-amount check still present';
  END IF;
  RAISE NOTICE 'OK — zero-value bank lines can now be held as evidence';
END $$;
