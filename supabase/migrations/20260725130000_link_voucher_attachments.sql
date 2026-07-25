-- Link invoice/approval and payment-proof uploads to accounting vouchers.
-- Existing patient document uploads remain untouched because voucher_id is nullable.

ALTER TABLE public.file_uploads
  ADD COLUMN IF NOT EXISTS voucher_id UUID
  REFERENCES public.vouchers(id)
  ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS file_uploads_voucher_category_idx
  ON public.file_uploads (voucher_id, category, created_at DESC)
  WHERE voucher_id IS NOT NULL;

COMMENT ON COLUMN public.file_uploads.voucher_id IS
  'Accounting voucher owning this upload. Voucher categories are voucher_invoice_approval and voucher_payment_proof.';
