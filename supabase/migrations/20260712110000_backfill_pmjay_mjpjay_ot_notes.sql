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
  v_haystack TEXT;
  v_access TEXT;
  v_dissection TEXT;
  v_confirmation TEXT;
  v_closure TEXT;
BEGIN
  v_package_name := COALESCE(NULLIF(btrim(p_treatment_plan), ''), 'PMJAY / MJPJAY package');
  v_haystack := lower(v_package_name);

  IF v_haystack ~ 'laparoscopic|laparoscopy|robotic' OR v_haystack ~ 'cystectomy' THEN
    v_access := 'The patient was positioned appropriately for laparoscopy, the abdomen was painted and draped in a sterile fashion, pneumoperitoneum was created, and the initial port was introduced under direct vision. Additional working ports were placed under vision as required.';
    v_dissection := 'The cystic lesion or target pathology was identified and carefully dissected from the surrounding tissues using sharp and blunt dissection, with meticulous attention to adjacent bowel, bladder, ureteric, vascular, or other critical structures as applicable.';
    IF v_haystack ~ 'cholecystectomy' THEN
      v_confirmation := 'Critical view of safety was obtained, the cystic duct and artery were secured, and the intended anatomical endpoint was achieved without visible leak or bleeding.';
    ELSIF v_haystack ~ 'append' THEN
      v_confirmation := 'The appendiceal base was secured and the specimen was delivered intact, with no residual stump bleeding or contamination seen at completion.';
    ELSIF v_haystack ~ 'hernia' THEN
      v_confirmation := 'The defect was closed or reinforced as planned, the reduced contents were viable, and no active bleeding or bowel compromise was seen.';
    ELSIF v_haystack ~ 'hysterectomy' THEN
      v_confirmation := 'The intended pelvic dissection was completed, the target tissue was removed, and the operative field showed satisfactory haemostasis with preserved adjacent structures.';
    ELSE
      v_confirmation := 'The intended lesion was completely excised or treated, the operative bed was dry, and no unintended injury or residual target tissue was seen at completion.';
    END IF;
    v_closure := 'The specimen was retrieved in a bag where applicable, ports were removed under vision, pneumoperitoneum was released, fascial closure was performed at larger port sites as required, skin was approximated with sutures or staples, dressings were applied, and the patient was shifted to recovery in stable condition.';

  ELSIF v_haystack ~ 'urology|uro|dj stent|dj stenting|stenting including cystoscopy|ureter|ureteric|pcnl|pyeloplasty|nephrectomy|cysto' THEN
    IF v_haystack ~ 'pcnl' THEN
      v_access := 'The patient was positioned prone, the flank was prepared and draped, and access to the pelvicalyceal system was obtained under image guidance with tract creation and dilation.';
      v_dissection := 'The collecting system was entered in a controlled manner, the calculi were fragmented and cleared, and the calyceal and ureteric system were inspected for residual obstruction.';
      v_confirmation := 'Stone clearance was confirmed endoscopically and fluoroscopically, the renal system was adequately decompressed, and there was no immediate collecting-system injury.';
      v_closure := 'The tract was secured, haemostasis was confirmed, the access site was dressed or closed as required, and the patient was transferred to recovery in stable condition.';
    ELSIF v_haystack ~ 'pyeloplasty' THEN
      v_access := 'A flank or laparoscopic approach was used, the operative site was painted and draped, and the ureteropelvic junction was exposed with adequate working space.';
      v_dissection := 'The stenotic ureteropelvic junction was dissected, the fibrotic segment was excised when indicated, the pelvis was mobilised, and the ureter was spatulated to allow a tension-free repair.';
      v_confirmation := 'The anastomosis was inspected for watertight alignment, free drainage, and absence of twist or tension, with adequate patency demonstrated at completion.';
      v_closure := 'Meticulous haemostasis was obtained, the repair was completed in layers with absorbable sutures where appropriate, and dressings were applied before recovery transfer.';
    ELSIF v_haystack ~ 'nephrectomy' THEN
      v_access := 'The kidney was approached through the planned open or minimally invasive incision after the site was painted and draped, with layered entry through the skin, subcutaneous tissue, fascia, and muscular planes.';
      v_dissection := 'The renal unit and surrounding hilar structures were carefully dissected, the intended segment or tissue was separated from adjacent structures, and vascular control was maintained throughout.';
      v_confirmation := 'The resected specimen was confirmed, haemostasis at the renal bed and hilum was satisfactory, and no active bleeding or urinary leak was seen at completion.';
      v_closure := 'After final count verification, layered closure was completed with appropriate absorbable and skin sutures, dressing was applied, and the patient was shifted stable to recovery.';
    ELSE
      v_access := 'No external cutaneous incision was required for this endoscopic urology procedure; the bladder and ureteric orifice were accessed cystoscopically under direct vision after sterile preparation and draping.';
      v_dissection := 'The urethra, bladder, and ureteric lumen were inspected, a guidewire was advanced across the ureteric obstruction or target segment, and the double-J stent or endoscopic treatment was deployed in the planned position.';
      v_confirmation := 'Correct proximal and distal curl position or treatment effect was confirmed endoscopically and/or fluoroscopically, urine drainage was checked, and no perforation or active bleeding was seen.';
      v_closure := 'The bladder was emptied, haemostasis was confirmed, no cutaneous incision required closure, and the patient was transferred in stable condition with the prescribed follow-up plan.';
    END IF;
  ELSIF v_haystack ~ 'cardio|angioplasty|ptca|pacemaker|coronary|angiogram|stent' THEN
    v_access := 'Percutaneous vascular access was obtained under sterile precautions after painting and draping, and the target vessel was cannulated using the standard approach for the approved cardiology procedure.';
    v_dissection := 'Guidewire and catheter manipulation were performed across the relevant vascular or coronary segment, with lesion treatment, dilation, or device deployment according to the operative plan.';
    v_confirmation := 'Final angiographic or procedural confirmation showed the intended result, with preserved flow, stable device position, and no immediate procedural complication.';
    v_closure := 'Access-site haemostasis was secured, the puncture site was dressed, and the patient was transferred to recovery in stable condition.';
  ELSIF v_haystack ~ 'neuro|brain|crani|spine|laminectomy|discectomy' THEN
    v_access := 'A standard cranial or posterior spinal incision was made as appropriate, after the operative field was painted and draped under strict aseptic precautions.';
    v_dissection := 'The relevant soft tissues, muscle planes, bone window, lamina, disc space, or neural elements were exposed and decompressed carefully according to the planned neurosurgical procedure.';
    v_confirmation := 'Adequate decompression, restoration of the intended anatomy, haemostasis, and absence of obvious neural compromise were confirmed before closure.';
    v_closure := 'The wound was irrigated, layered closure was completed with appropriate sutures, dressing was applied, and the patient was moved to recovery in stable condition.';
  ELSIF v_haystack ~ 'ortho|fracture|plate|nailing|fixation|arthros|tendon|bone|joint' THEN
    v_access := 'A skin incision was made over the affected segment after painting and draping, and the subcutaneous tissue, fascia, and muscle were dissected to expose the fracture, joint, or operative bone surface.';
    v_dissection := 'The fracture or joint pathology was reduced, debrided, or prepared as needed, and fixation or reconstruction was completed using the planned orthopaedic technique.';
    v_confirmation := 'Alignment, stability, and implant position were checked clinically and/or radiologically, with satisfactory correction and haemostasis at the end of the procedure.';
    v_closure := 'Layered closure was performed with absorbable sutures for deep tissue and appropriate skin sutures or staples, followed by dressing and recovery transfer.';
  ELSIF v_haystack ~ 'general surgery|laparotomy|append|hernia|gastro|chole|lap\\.' THEN
    v_access := 'A standard abdominal or operative incision was made after painting and draping, followed by careful entry through the subcutaneous tissues and fascia.';
    v_dissection := 'The target bowel, appendix, gallbladder, hernia sac, or other involved structures were dissected, controlled, and treated according to the operative plan.';
    v_confirmation := 'The operative field was inspected for completeness of treatment, haemostasis, and absence of leak, with the intended anatomical correction confirmed before closure.';
    v_closure := 'The wound was closed in layers with appropriate sutures, dressing was applied, and the patient was transferred to recovery in stable condition.';
  ELSE
    v_access := 'The operative site was painted and draped under strict aseptic precautions, and the standard incision or access route was used for the procedure.';
    v_dissection := 'The relevant anatomical planes and target structures were carefully dissected, protected, and treated using the accepted technique for the procedure.';
    v_confirmation := 'Completion of the intended operative goal, satisfactory haemostasis, and preservation of adjacent structures were confirmed before the case was closed.';
    v_closure := 'Layered closure was completed with appropriate sutures, dressings were applied, and the patient was shifted to recovery in stable condition.';
  END IF;

  RETURN concat_ws(E'\n',
    'OT NOTES',
    'Procedure: ' || v_package_name,
    'Operative Note',
    '1. The patient was received in the operating theatre, identity and procedure were confirmed, consent was checked, and anaesthesia was induced as planned.',
    '2. The patient was positioned appropriately and the operative field was prepared and draped under strict aseptic precautions. ' || v_access,
    'Dissection / Operative Steps: ' || v_dissection,
    'Operative findings: ' || v_confirmation,
    '5. Haemostasis was confirmed and the intended procedural endpoint was achieved before closure or completion of the case.',
    'Completion / Closure: ' || v_closure
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
