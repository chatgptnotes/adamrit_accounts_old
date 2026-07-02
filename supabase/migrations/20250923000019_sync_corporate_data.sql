-- Sync corporate data from patients table to visits table
-- This migration populates the corporate column in visits table
-- with data from the related patients table

UPDATE public.visits v
SET corporate = p.corporate
FROM public.patients p
WHERE v.patient_id = p.id
AND p.corporate IS NOT NULL;

-- Add a comment to explain the column's purpose
COMMENT ON COLUMN public.visits.corporate IS 'Corporate affiliation copied from patient record for quick access';