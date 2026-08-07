-- The bank/UPI confirmation for a pharmacy bill, kept on the bill itself.
--
-- Mirrors expense_bills.payment_proof_path / _url so the pharmacy screens can
-- reuse the same upload helper the Expense Bill register uses. The QR the
-- patient scans is the pharmacy's own, held in ledger_payment_qr against the
-- Canara Bank ledger — no new table needed for that.
--
-- Applied through apply_migration(): one transaction, rolls back on failure.
-- Idempotent, and it verifies itself before committing.

ALTER TABLE public.pharmacy_sales
  ADD COLUMN IF NOT EXISTS payment_proof_path TEXT,
  ADD COLUMN IF NOT EXISTS payment_proof_url  TEXT,
  ADD COLUMN IF NOT EXISTS payment_proof_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_proof_by   TEXT;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'pharmacy_sales'
       AND column_name = 'payment_proof_url'
  ) THEN
    RAISE EXCEPTION 'ABORT: payment_proof_url was not added to pharmacy_sales';
  END IF;
  RAISE NOTICE 'OK — pharmacy bills can now carry their payment confirmation';
END $$;
