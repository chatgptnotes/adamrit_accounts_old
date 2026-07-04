-- Cost Centres (Tally-style): master table + one optional cost centre per
-- voucher entry line, so vouchers can be allocated to hospital departments
-- (Pharmacy, Lab, OT, ICU, ...) and reported per centre.

CREATE TABLE IF NOT EXISTS public.cost_centres (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  alias      TEXT,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.voucher_entries
  ADD COLUMN IF NOT EXISTS cost_centre_id UUID REFERENCES public.cost_centres(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_voucher_entries_cost_centre
  ON public.voucher_entries (cost_centre_id) WHERE cost_centre_id IS NOT NULL;

-- Match the access pattern used by other operational tables in this app.
ALTER TABLE public.cost_centres ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all operations on cost_centres" ON public.cost_centres;
CREATE POLICY "Allow all operations on cost_centres"
  ON public.cost_centres
  FOR ALL USING (true) WITH CHECK (true);

-- Seed the obvious hospital departments (edit freely in the Cost Centres screen)
INSERT INTO public.cost_centres (name) VALUES
  ('Pharmacy'), ('Laboratory'), ('Radiology'), ('OT'), ('ICU'), ('OPD'), ('IPD'), ('Administration')
ON CONFLICT (name) DO NOTHING;

NOTIFY pgrst, 'reload schema';
