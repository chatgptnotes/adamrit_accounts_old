-- One-time cleanup so per-hospital pharmacy scoping is trustworthy and so the
-- duplicate-card unique index (20260615100001) can be created without conflict.
--
-- Background: the tablet "Approve" bridge stamps prescriptions.hospital_name from
-- the patient. Legacy/bulk-imported patients have a NULL or mixed-case
-- hospital_name, which made approved ward orders vanish from the pharmacy bell.
-- The bell filter now shows NULL-hospital ward orders to everyone, but cleaning
-- the existing data restores real per-hospital scoping.
--
-- Idempotent: re-running only touches rows still needing normalization.

-- 1. Normalize hospital_name on patients (casing/whitespace) so 'Hope' = 'hope'.
UPDATE public.patients
SET hospital_name = lower(trim(hospital_name))
WHERE hospital_name IS NOT NULL
  AND hospital_name <> lower(trim(hospital_name));

-- 2. Backfill ward prescriptions that are missing hospital_name from their
--    patient (prescriptions.patient_id = patients.id, the desktop's key).
UPDATE public.prescriptions p
SET hospital_name = pt.hospital_name
FROM public.patients pt
WHERE p.source = 'ward'
  AND (p.hospital_name IS NULL OR p.hospital_name = '')
  AND p.patient_id = pt.id
  AND pt.hospital_name IS NOT NULL;

-- 3. Normalize any mixed-case hospital_name already on ward prescriptions.
UPDATE public.prescriptions
SET hospital_name = lower(trim(hospital_name))
WHERE source = 'ward'
  AND hospital_name IS NOT NULL
  AND hospital_name <> lower(trim(hospital_name));

-- 4. Collapse pre-existing duplicate OPEN ward cards (same visit + same date)
--    onto the oldest card so the unique index can be created cleanly. Items move
--    to the kept card (visit_medication_id is globally unique, so no collision);
--    the now-empty duplicates are cancelled.
WITH ranked AS (
  SELECT id,
         first_value(id) OVER (
           PARTITION BY visit_id, prescription_date
           ORDER BY created_at ASC, id ASC
         ) AS keep_id
  FROM public.prescriptions
  WHERE source = 'ward'
    AND status <> 'CANCELLED'
    AND visit_id IS NOT NULL
)
UPDATE public.prescription_items pi
SET prescription_id = r.keep_id
FROM ranked r
WHERE pi.prescription_id = r.id
  AND r.id <> r.keep_id;

WITH ranked AS (
  SELECT id,
         first_value(id) OVER (
           PARTITION BY visit_id, prescription_date
           ORDER BY created_at ASC, id ASC
         ) AS keep_id
  FROM public.prescriptions
  WHERE source = 'ward'
    AND status <> 'CANCELLED'
    AND visit_id IS NOT NULL
)
UPDATE public.prescriptions
SET status = 'CANCELLED'
WHERE id IN (SELECT id FROM ranked WHERE id <> keep_id);

NOTIFY pgrst, 'reload schema';
