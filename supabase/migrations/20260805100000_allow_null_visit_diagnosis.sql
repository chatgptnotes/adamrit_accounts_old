-- Diagnosis is optional in the visit-registration form. Keep the foreign-key
-- relationship for supplied diagnoses, but allow visits without one.
ALTER TABLE public.visits
  ALTER COLUMN diagnosis_id DROP NOT NULL;
