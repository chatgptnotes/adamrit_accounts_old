-- Patient-level entries behind each date in the Director Matrix detail page.
-- The day's revenue in director_matrix_daily_entries is the sum of these package amounts.

CREATE TABLE IF NOT EXISTS public.director_matrix_patient_entries (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  statement_key text NOT NULL,
  row_label text NOT NULL,
  year integer NOT NULL,
  month integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  day integer NOT NULL CHECK (day BETWEEN 1 AND 31),
  patient_name text NOT NULL,
  panel text NOT NULL DEFAULT 'Private',
  admission_date date,
  package_amount numeric NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS director_matrix_patient_entries_lookup_idx
ON public.director_matrix_patient_entries (statement_key, year, month, row_label);

ALTER TABLE public.director_matrix_patient_entries ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'director_matrix_patient_entries'
      AND policyname = 'Allow all operations on director_matrix_patient_entries for anonymous users'
  ) THEN
    CREATE POLICY "Allow all operations on director_matrix_patient_entries for anonymous users"
    ON public.director_matrix_patient_entries FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'director_matrix_patient_entries'
      AND policyname = 'Allow all operations on director_matrix_patient_entries for authenticated users'
  ) THEN
    CREATE POLICY "Allow all operations on director_matrix_patient_entries for authenticated users"
    ON public.director_matrix_patient_entries FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
