-- Allow 'Dialysis' as a patient_type on visits (day-care, OPD-like).
-- Legacy rows carry long/case variants ('OPD (Outpatient)', 'ipd', ...) that
-- fail the strict CHECK, so normalize them first; NOT VALID skips any row a
-- later manual cleanup still needs.
ALTER TABLE public.visits DROP CONSTRAINT IF EXISTS visits_patient_type_check;

UPDATE public.visits SET patient_type = 'OPD'       WHERE patient_type ILIKE 'opd%'       AND patient_type <> 'OPD';
UPDATE public.visits SET patient_type = 'IPD'       WHERE patient_type ILIKE 'ipd%'       AND patient_type <> 'IPD';
UPDATE public.visits SET patient_type = 'Emergency' WHERE patient_type ILIKE 'emergency%' AND patient_type <> 'Emergency';
UPDATE public.visits SET patient_type = 'Dialysis'  WHERE patient_type ILIKE 'dialysis%'  AND patient_type <> 'Dialysis';

ALTER TABLE public.visits ADD CONSTRAINT visits_patient_type_check
CHECK (patient_type IN ('OPD', 'IPD', 'Emergency', 'Dialysis') OR patient_type IS NULL) NOT VALID;

-- Any values listed below are unexpected and still stored; report them back.
SELECT patient_type, count(*)
FROM public.visits
WHERE patient_type IS NOT NULL
  AND patient_type NOT IN ('OPD', 'IPD', 'Emergency', 'Dialysis')
GROUP BY patient_type;
