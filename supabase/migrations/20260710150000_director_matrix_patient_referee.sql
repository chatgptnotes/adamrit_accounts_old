-- Doctor referee for each patient entry in the Director Matrix detail page.

ALTER TABLE public.director_matrix_patient_entries
  ADD COLUMN IF NOT EXISTS referee_name text;

NOTIFY pgrst, 'reload schema';
