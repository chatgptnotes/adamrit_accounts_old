-- 1) Optional vouchers (Tally L: Optional): flagged and kept out of books
--    until made regular. Post-dated needs no schema — a future voucher_date
--    is naturally excluded from as-at reports.
ALTER TABLE public.vouchers ADD COLUMN IF NOT EXISTS is_optional BOOLEAN NOT NULL DEFAULT false;

-- 2) Bill-wise details (Tally New Ref / Against Ref): a reference per entry
--    so party-ledger outstandings can be tracked bill by bill.
ALTER TABLE public.voucher_entries ADD COLUMN IF NOT EXISTS bill_ref TEXT;
CREATE INDEX IF NOT EXISTS idx_voucher_entries_bill_ref
  ON public.voucher_entries (bill_ref) WHERE bill_ref IS NOT NULL;

-- 3) Cost Categories (Tally's parallel dimension over cost centres)
CREATE TABLE IF NOT EXISTS public.cost_categories (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.cost_centres
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES public.cost_categories(id) ON DELETE SET NULL;

ALTER TABLE public.cost_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all operations on cost_categories" ON public.cost_categories;
CREATE POLICY "Allow all operations on cost_categories"
  ON public.cost_categories FOR ALL USING (true) WITH CHECK (true);

-- Seed the two obvious hospital dimensions and file existing centres under Departments
INSERT INTO public.cost_categories (name) VALUES ('Departments'), ('Doctors')
ON CONFLICT (name) DO NOTHING;

UPDATE public.cost_centres
SET category_id = (SELECT id FROM public.cost_categories WHERE name = 'Departments')
WHERE category_id IS NULL;

NOTIFY pgrst, 'reload schema';
