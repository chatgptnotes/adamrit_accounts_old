-- Tally-style payment voucher entry:
--  * payment_vouchers gains the credited Account ledger and a Narration
--  * payment_voucher_lines holds the Particulars rows (one debit ledger + amount each)

ALTER TABLE public.payment_vouchers
  ADD COLUMN IF NOT EXISTS account_ledger_name TEXT,
  ADD COLUMN IF NOT EXISTS narration TEXT;

CREATE TABLE IF NOT EXISTS public.payment_voucher_lines (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  voucher_id  UUID NOT NULL REFERENCES public.payment_vouchers(id) ON DELETE CASCADE,
  ledger_id   UUID REFERENCES public.tally_ledgers(id) ON DELETE SET NULL,
  ledger_name TEXT NOT NULL,
  amount      NUMERIC(15, 2) NOT NULL,
  line_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_voucher_lines_voucher_id
  ON public.payment_voucher_lines (voucher_id);

-- Match the access pattern used by other operational tables in this app.
ALTER TABLE public.payment_voucher_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all operations on payment_voucher_lines" ON public.payment_voucher_lines;
CREATE POLICY "Allow all operations on payment_voucher_lines"
  ON public.payment_voucher_lines
  FOR ALL USING (true) WITH CHECK (true);

-- Make PostgREST pick up the new columns/table immediately.
NOTIFY pgrst, 'reload schema';
