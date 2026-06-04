-- Hospital scoping for ward-bridged prescriptions.
--
-- Hope and Ayushman run separate pharmacies, so a pharmacist must see only
-- their own hospital's ward orders. `prescriptions` had no hospital column, so
-- bridged ward orders were leaking into every hospital's queue/bell. The bridge
-- now stamps this from the patient's hospital, and the queue/bell filter ward
-- orders by it. (Camera/manual prescriptions are unaffected.)
--
-- Additive + idempotent.

ALTER TABLE public.prescriptions
  ADD COLUMN IF NOT EXISTS hospital_name text;

NOTIFY pgrst, 'reload schema';
