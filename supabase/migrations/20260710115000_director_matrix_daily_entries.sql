-- Date-wise entries for every Director Dashboard monthly matrix cell.
-- Rolls up into the month cell by statement x row-label x year x month.

CREATE TABLE IF NOT EXISTS public.director_matrix_daily_entries (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  statement_key text NOT NULL,
  row_label text NOT NULL,
  year integer NOT NULL,
  month integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  day integer NOT NULL CHECK (day BETWEEN 1 AND 31),
  amount numeric NOT NULL DEFAULT 0,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (statement_key, row_label, year, month, day)
);

CREATE INDEX IF NOT EXISTS director_matrix_daily_entries_lookup_idx
ON public.director_matrix_daily_entries (statement_key, year, month, row_label);

ALTER TABLE public.director_matrix_daily_entries ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'director_matrix_daily_entries'
      AND policyname = 'Allow all operations on director_matrix_daily_entries for anonymous users'
  ) THEN
    CREATE POLICY "Allow all operations on director_matrix_daily_entries for anonymous users"
    ON public.director_matrix_daily_entries FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'director_matrix_daily_entries'
      AND policyname = 'Allow all operations on director_matrix_daily_entries for authenticated users'
  ) THEN
    CREATE POLICY "Allow all operations on director_matrix_daily_entries for authenticated users"
    ON public.director_matrix_daily_entries FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
