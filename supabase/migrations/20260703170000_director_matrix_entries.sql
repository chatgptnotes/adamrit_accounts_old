-- Manual entries for the Director Dashboard monthly matrices
-- (income / expenses / receivables / payables / marketing revenue).
-- One row per statement x row-label x year x month.

CREATE TABLE IF NOT EXISTS public.director_matrix_entries (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  statement_key text NOT NULL,
  row_label text NOT NULL,
  year integer NOT NULL,
  month integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  manual_value numeric,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (statement_key, row_label, year, month)
);

-- RLS: mirror the existing master-table policy pattern
-- (see 20250612200000_fix_master_tables_rls_policies.sql).
ALTER TABLE public.director_matrix_entries ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'director_matrix_entries'
      AND policyname = 'Allow all operations on director_matrix_entries for anonymous users'
  ) THEN
    CREATE POLICY "Allow all operations on director_matrix_entries for anonymous users"
    ON public.director_matrix_entries FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'director_matrix_entries'
      AND policyname = 'Allow all operations on director_matrix_entries for authenticated users'
  ) THEN
    CREATE POLICY "Allow all operations on director_matrix_entries for authenticated users"
    ON public.director_matrix_entries FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Make PostgREST pick up the DDL immediately.
NOTIFY pgrst, 'reload schema';
