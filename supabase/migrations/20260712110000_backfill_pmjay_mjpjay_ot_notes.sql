-- Backfill and auto-generate package-level OT notes for PMJAY / MJPJAY master.
-- Notes are stored in the existing remark column so they can be reused for
-- subsequent patients under the same package.

CREATE OR REPLACE FUNCTION public.pmjay_mjpjay_build_ot_notes(
  p_treatment_plan TEXT,
  p_diagnosis TEXT,
  p_treatment_code TEXT,
  p_category TEXT,
  p_anaesthesia_type TEXT,
  p_surgeons TEXT,
  p_anaesthetists TEXT,
  p_implants TEXT,
  p_package_price NUMERIC,
  p_patient_name_example TEXT
) RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_package_name TEXT;
  v_diagnosis TEXT;
  v_treatment_code TEXT;
  v_category TEXT;
  v_anaesthesia_type TEXT;
  v_surgeons TEXT;
  v_anaesthetists TEXT;
  v_implants TEXT;
  v_package_price TEXT;
  v_patient_example TEXT;
BEGIN
  v_package_name := COALESCE(NULLIF(btrim(p_treatment_plan), ''), NULLIF(btrim(p_treatment_code), ''), 'PMJAY / MJPJAY package');
  v_diagnosis := COALESCE(NULLIF(btrim(p_diagnosis), ''), 'As per hospital records');
  v_treatment_code := COALESCE(NULLIF(btrim(p_treatment_code), ''), 'As per master');
  v_category := COALESCE(NULLIF(btrim(p_category), ''), 'As per package category');
  v_anaesthesia_type := COALESCE(NULLIF(btrim(p_anaesthesia_type), ''), 'As per anaesthetist assessment');
  v_surgeons := COALESCE(NULLIF(btrim(p_surgeons), ''), 'As per package mapping');
  v_anaesthetists := COALESCE(NULLIF(btrim(p_anaesthetists), ''), 'As per package mapping');
  v_implants := COALESCE(NULLIF(btrim(p_implants), ''), 'As per package requirement');
  v_package_price := CASE
    WHEN p_package_price IS NOT NULL THEN 'Rs. ' || to_char(p_package_price, 'FM999,999,999,999')
    ELSE 'As per approved package rate'
  END;
  v_patient_example := NULLIF(btrim(p_patient_name_example), '');

  RETURN concat_ws(E'\n',
    'OT NOTES',
    'Package Name: ' || v_package_name,
    'Diagnosis: ' || v_diagnosis,
    'Treatment Code: ' || v_treatment_code,
    'Category: ' || v_category,
    'Anaesthesia: ' || v_anaesthesia_type,
    'Surgeon(s): ' || v_surgeons,
    'Anaesthetist(s): ' || v_anaesthetists,
    'Implant(s): ' || v_implants,
    'Package Amount: ' || v_package_price,
    CASE WHEN v_patient_example IS NOT NULL THEN 'Patient Example: ' || v_patient_example ELSE NULL END,
    'Procedure Note: The approved package procedure is to be performed under strict aseptic precautions, with correct patient/procedure/site verification, appropriate anaesthesia, haemostasis, closure where applicable, dressing, and post-operative transfer in stable condition.',
    'This is the reusable master OT note for subsequent patients booked under the same PMJAY / MJPJAY package and may be edited for case-specific findings.'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.pmjay_mjpjay_autofill_ot_notes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_surgeons TEXT;
  v_anaesthetists TEXT;
  v_implants TEXT;
BEGIN
  IF NEW.remark IS NULL OR btrim(NEW.remark) = '' THEN
    SELECT string_agg(s.surgeon_name, ', ' ORDER BY s.surgeon_name)
      INTO v_surgeons
    FROM (
      SELECT DISTINCT surgeon_name
      FROM public.pmjay_mjpjay_package_surgeons
      WHERE package_id = NEW.id
        AND surgeon_name IS NOT NULL
        AND btrim(surgeon_name) <> ''
    ) s;

    SELECT string_agg(a.anaesthetist_name, ', ' ORDER BY a.anaesthetist_name)
      INTO v_anaesthetists
    FROM (
      SELECT DISTINCT anaesthetist_name
      FROM public.pmjay_mjpjay_package_anaesthetists
      WHERE package_id = NEW.id
        AND anaesthetist_name IS NOT NULL
        AND btrim(anaesthetist_name) <> ''
    ) a;

    SELECT string_agg(i.implant_name, ', ' ORDER BY i.implant_name)
      INTO v_implants
    FROM (
      SELECT DISTINCT implant_name
      FROM public.pmjay_mjpjay_package_implants
      WHERE package_id = NEW.id
        AND implant_name IS NOT NULL
        AND btrim(implant_name) <> ''
    ) i;

    NEW.remark := public.pmjay_mjpjay_build_ot_notes(
      NEW.treatment_plan,
      NEW.diagnosis,
      NEW.treatment_code,
      NEW.category,
      NEW.anaesthesia_type,
      v_surgeons,
      v_anaesthetists,
      v_implants,
      NEW.package_price,
      NEW.patient_name_example
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pmjay_mjpjay_autofill_ot_notes ON public.pmjay_mjpjay_packages;
CREATE TRIGGER trg_pmjay_mjpjay_autofill_ot_notes
BEFORE INSERT OR UPDATE OF remark, treatment_plan, diagnosis, treatment_code, category, anaesthesia_type, package_price, patient_name_example
ON public.pmjay_mjpjay_packages
FOR EACH ROW
EXECUTE FUNCTION public.pmjay_mjpjay_autofill_ot_notes();

WITH package_links AS (
  SELECT
    p.id,
    p.treatment_plan,
    p.diagnosis,
    p.treatment_code,
    p.category,
    p.anaesthesia_type,
    p.package_price,
    p.patient_name_example,
    surgeons.surgeons,
    anaesthetists.anaesthetists,
    implants.implants
  FROM public.pmjay_mjpjay_packages p
  LEFT JOIN LATERAL (
    SELECT string_agg(s.surgeon_name, ', ' ORDER BY s.surgeon_name) AS surgeons
    FROM (
      SELECT DISTINCT surgeon_name
      FROM public.pmjay_mjpjay_package_surgeons
      WHERE package_id = p.id
        AND surgeon_name IS NOT NULL
        AND btrim(surgeon_name) <> ''
    ) s
  ) surgeons ON TRUE
  LEFT JOIN LATERAL (
    SELECT string_agg(a.anaesthetist_name, ', ' ORDER BY a.anaesthetist_name) AS anaesthetists
    FROM (
      SELECT DISTINCT anaesthetist_name
      FROM public.pmjay_mjpjay_package_anaesthetists
      WHERE package_id = p.id
        AND anaesthetist_name IS NOT NULL
        AND btrim(anaesthetist_name) <> ''
    ) a
  ) anaesthetists ON TRUE
  LEFT JOIN LATERAL (
    SELECT string_agg(i.implant_name, ', ' ORDER BY i.implant_name) AS implants
    FROM (
      SELECT DISTINCT implant_name
      FROM public.pmjay_mjpjay_package_implants
      WHERE package_id = p.id
        AND implant_name IS NOT NULL
        AND btrim(implant_name) <> ''
    ) i
  ) implants ON TRUE
)
UPDATE public.pmjay_mjpjay_packages p
SET remark = public.pmjay_mjpjay_build_ot_notes(
  pl.treatment_plan,
  pl.diagnosis,
  pl.treatment_code,
  pl.category,
  pl.anaesthesia_type,
  pl.surgeons,
  pl.anaesthetists,
  pl.implants,
  pl.package_price,
  pl.patient_name_example
)
FROM package_links pl
WHERE p.id = pl.id
  AND COALESCE(btrim(p.remark), '') = '';

NOTIFY pgrst, 'reload schema';
