-- Backfill and auto-generate package-level OT notes for PMJAY / MJPJAY master.
-- Notes are stored in the existing remark column so they can be reused for
-- subsequent patients under the same package.

CREATE OR REPLACE FUNCTION public.pmjay_mjpjay_build_ot_notes(
  p_treatment_plan TEXT
) RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_package_name TEXT;
BEGIN
  v_package_name := COALESCE(NULLIF(btrim(p_treatment_plan), ''), 'PMJAY / MJPJAY package');

  RETURN concat_ws(E'\n',
    'OT NOTES',
    'Package Name: ' || v_package_name,
    'Procedure Note: The patient should be received in the operating theatre after correct identity, consent, and site verification. Standard monitoring must be attached and the anaesthesia team should proceed as per the peri-operative plan recorded for the case.',
    'The operative field should be prepared and draped under strict aseptic precautions. The procedure should be carried out using the accepted technique for the approved package, with careful tissue handling, adequate exposure, protection of adjacent structures, and meticulous haemostasis throughout.',
    'Any required decompression, reduction, fixation, excision, repair, reconstruction, anastomosis, or closure should be completed as indicated by the operative findings and package protocol. Instrument and sponge counts must be verified before closure.',
    'Wound closure should be performed in layers as appropriate, haemostasis confirmed, dressing applied, and the patient shifted to recovery in a stable condition with post-operative instructions, medications, and follow-up as advised by the treating team.'
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
    NEW.remark := public.pmjay_mjpjay_build_ot_notes(NEW.treatment_plan);
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
    p.treatment_plan
  FROM public.pmjay_mjpjay_packages p
)
UPDATE public.pmjay_mjpjay_packages p
SET remark = public.pmjay_mjpjay_build_ot_notes(pl.treatment_plan)
FROM package_links pl
WHERE p.id = pl.id
  AND (
    COALESCE(btrim(p.remark), '') = ''
    OR p.remark ILIKE '%reusable master OT note%'
    OR p.remark ILIKE '%Diagnosis:%'
    OR p.remark ILIKE '%Treatment Code:%'
  );

NOTIFY pgrst, 'reload schema';
