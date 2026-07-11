-- Implant Bill (vendor invoice for implants used in a surgery) and Implant
-- Sticker (patient-header cover sheet for pasting the manufacturer's implant
-- pouch stickers) — both generated from the Yojna Bill page per visit.

CREATE TABLE IF NOT EXISTS public.implant_bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id TEXT NOT NULL,
  bill_no INTEGER NOT NULL UNIQUE,
  bill_date DATE,
  vendor_name TEXT,
  vendor_address TEXT,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_implant_bills_visit_id ON public.implant_bills(visit_id);

CREATE TABLE IF NOT EXISTS public.implant_stickers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id TEXT NOT NULL,
  batch_numbers TEXT,
  surgery_date DATE,
  surgery_name TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_implant_stickers_visit_id ON public.implant_stickers(visit_id);

ALTER TABLE public.implant_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.implant_stickers ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "implant_bills_all"
    ON public.implant_bills FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "implant_stickers_all"
    ON public.implant_stickers FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

NOTIFY pgrst, 'reload schema';
