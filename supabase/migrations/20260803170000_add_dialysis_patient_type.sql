-- Allow 'Dialysis' as a patient_type on visits (day-care, OPD-like)
ALTER TABLE public.visits DROP CONSTRAINT IF EXISTS visits_patient_type_check;

ALTER TABLE public.visits ADD CONSTRAINT visits_patient_type_check
CHECK (patient_type IN ('OPD', 'IPD', 'Emergency', 'Dialysis') OR patient_type IS NULL);
