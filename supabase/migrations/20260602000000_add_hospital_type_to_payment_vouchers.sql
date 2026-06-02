-- Make payment vouchers hospital-specific so each hospital's Cashbook / DayBook
-- only pulls in its own vouchers. Existing rows default to 'hope'.

ALTER TABLE public.payment_vouchers
  ADD COLUMN IF NOT EXISTS hospital_type TEXT NOT NULL DEFAULT 'hope';

CREATE INDEX IF NOT EXISTS idx_payment_vouchers_hospital_date
  ON public.payment_vouchers (hospital_type, voucher_date DESC);
