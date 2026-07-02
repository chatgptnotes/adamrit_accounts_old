-- Fix schema gaps causing ~30K Postgres errors/5 days (found via log aggregation 2026-07-02).
-- Each statement is idempotent.

-- 1. visits.insurance_type (16,394 errors) — queried by FinalBill.tsx rate selection.
ALTER TABLE public.visits ADD COLUMN IF NOT EXISTS insurance_type text;

-- 2. patients.category (1,975 errors) — embedded via patients(category) in FinalBill.tsx.
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS category text;

-- 3. lab.hospital_name (2,986 errors) — FinalBill.tsx filters lab services by hospital.
--    NOTE: rows default to NULL, so FinalBill's lab list stays empty (same as today's
--    error behavior) until hospital_name is backfilled, e.g.:
--    UPDATE public.lab SET hospital_name = 'hope' WHERE hospital_name IS NULL;
ALTER TABLE public.lab ADD COLUMN IF NOT EXISTS hospital_name text;

-- 4. medication table (8,135 errors) — missing in this project; ~15 pharmacy/medication
--    features read and write it. Schema = generated types (types.ts) plus the extra
--    columns StockManagement / pharmacy-billing-service expect.
CREATE TABLE IF NOT EXISTS public.medication (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  generic_name text,
  category text,
  dosage text,
  strength text,
  description text,
  barcode text,
  brand_name text[],
  drug_id text,
  druginfo text,
  exp_date text,
  "Exp_date" text,
  is_deleted boolean DEFAULT false,
  is_implant boolean DEFAULT false,
  item_code text,
  item_type integer,
  loose_stock integer,
  loose_stock_quantity integer,
  manufacturer text,
  manufacturer_id text,
  medicine_code text,
  pack text,
  price_per_strip text,
  product_name text,
  generic text,
  shelf text,
  stock text,
  supplier_id text,
  supplier_name text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- RLS: mirror the existing master-table policy pattern
-- (see 20250612200000_fix_master_tables_rls_policies.sql).
ALTER TABLE public.medication ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'medication'
      AND policyname = 'Allow all operations on medication for anonymous users'
  ) THEN
    CREATE POLICY "Allow all operations on medication for anonymous users"
    ON public.medication FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'medication'
      AND policyname = 'Allow all operations on medication for authenticated users'
  ) THEN
    CREATE POLICY "Allow all operations on medication for authenticated users"
    ON public.medication FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Make PostgREST pick up the DDL immediately.
NOTIFY pgrst, 'reload schema';
