-- Keywords for the PMJAY / MJPJAY package master.
--
-- The search box covers package name, code, diagnosis, category and anaesthesia
-- type. All of those are the Yojana's own wording, so the master is findable
-- only by someone who already knows how the scheme spells things. "Piles",
-- "gallstones" and "keyhole surgery" find nothing.
--
-- WHY A DICTIONARY RATHER THAN A LINE PER PACKAGE. These 171 treatment plans
-- are pipe-joined fragments of a Yojana export: 153 distinct values, of which
-- many are "Open", "Radical", "Basal", "Plate", "Unipolar", "Lap." — fragments
-- with no meaning on their own. Hand-writing synonyms for those would be
-- inventing clinical content for a string that is not a procedure. Instead,
-- recognisable procedures and conditions are matched by root and given real
-- synonyms; a fragment that matches nothing simply gets no keyword, which is an
-- honest outcome rather than a fabricated one.
--
-- SAFE BY DESIGN, like the fee-master keywords: nothing here prices anything.
-- The package is identified by treatment_code / treatment_plan everywhere it
-- matters (packageCodeLookup.ts, OtScheduleFlow's defaults query). A keyword
-- can only widen a search.

ALTER TABLE public.pmjay_mjpjay_packages
  ADD COLUMN IF NOT EXISTS keywords TEXT[];

COMMENT ON COLUMN public.pmjay_mjpjay_packages.keywords IS
  'Search synonyms. Never used to identify or price a package — treatment_code and treatment_plan do that.';

DO $apply$
DECLARE
  v_touched INT := 0;
  v_rows    INT;
BEGIN
  WITH dictionary(root, synonyms) AS (
    VALUES
      -- Orthopaedics
      ('arthroscop',      ARRAY['Arthroscopy','Keyhole Joint Surgery','Scope Surgery']),
      ('meniscus',        ARRAY['Meniscectomy','Meniscal Tear','Knee Cartilage']),
      ('meniscectomy',    ARRAY['Meniscus Repair','Knee Cartilage Surgery']),
      ('bankart',         ARRAY['Shoulder Stabilisation','Labral Repair','Recurrent Shoulder Dislocation']),
      ('synovectomy',     ARRAY['Synovial Removal','Joint Lining Surgery']),
      ('tendon',          ARRAY['Tendon Repair','Tendon Injury','Soft Tissue Repair']),
      ('osteotomy',       ARRAY['Bone Realignment','Corrective Bone Surgery']),
      ('total hip',       ARRAY['Hip Replacement','THR','Arthroplasty']),
      ('hemiarthoplasty', ARRAY['Hemiarthroplasty','Partial Hip Replacement','Femur Neck Fracture']),
      ('unipolar',        ARRAY['Unipolar Hemiarthroplasty','Partial Hip Replacement']),
      ('bipolar',         ARRAY['Bipolar Hemiarthroplasty','Partial Hip Replacement']),
      ('dynamic hip screw', ARRAY['DHS','Intertrochanteric Fracture','Hip Fracture Fixation']),
      ('open reduction',  ARRAY['ORIF','Fracture Fixation','Internal Fixation','Plating','Nailing']),
      ('fracture',        ARRAY['Broken Bone','Fracture Fixation','Trauma']),
      ('core decompression', ARRAY['Avascular Necrosis','AVN Hip','Femoral Head Decompression']),
      ('bone tumour',     ARRAY['Bone Tumor','Bone Cancer','Tumour Excision','Bone Grafting']),
      ('amputation',      ARRAY['Limb Removal','Above Elbow Amputation','Stump Surgery']),
      ('pelviacetabular', ARRAY['Acetabular Fracture','Pelvic Fracture','Pelvis Fixation']),
      -- Spine and neuro
      ('laminectomy',     ARRAY['Spinal Decompression','Canal Stenosis','Spine Surgery']),
      ('discectomy',      ARRAY['Disc Removal','Slipped Disc','Prolapsed Disc','Sciatica']),
      ('corpectomy',      ARRAY['Vertebral Body Removal','Spinal Fusion','Spine Reconstruction']),
      ('spinal fixation', ARRAY['Spinal Fusion','Pedicle Screw','Spine Stabilisation']),
      ('craniectomy',     ARRAY['Skull Decompression','Decompressive Craniectomy','Head Injury Surgery']),
      ('craniotomy',      ARRAY['Skull Opening','Brain Surgery','Neurosurgery']),
      ('head injury',     ARRAY['Traumatic Brain Injury','TBI','Skull Trauma']),
      ('subdural',        ARRAY['Subdural Haematoma','Brain Bleed','Head Injury']),
      ('intracranial hemorrhage', ARRAY['Brain Haemorrhage','Intracranial Bleed','Haemorrhagic Stroke']),
      ('heamorrhagic stroke', ARRAY['Haemorrhagic Stroke','Brain Bleed','CVA']),
      ('ischemic sto',    ARRAY['Ischaemic Stroke','CVA','Brain Infarct','Clot Stroke']),
      ('cerebral venous', ARRAY['Cerebral Venous Thrombosis','CVT','Brain Clot']),
      -- Urology
      ('nephrectomy',     ARRAY['Kidney Removal','Renal Surgery','Kidney Cancer']),
      ('pcnl',            ARRAY['Percutaneous Nephrolithotomy','Kidney Stone Surgery','Renal Calculus']),
      ('nephrolithotomy', ARRAY['Kidney Stone Removal','Renal Stone Surgery']),
      ('dj stenting',     ARRAY['DJ Stent','Ureteric Stent','Double J Stent']),
      ('cystoscopy',      ARRAY['Bladder Endoscopy','Cystoscopic Procedure']),
      ('pyeloplasty',     ARRAY['PUJ Obstruction','Renal Pelvis Repair','Kidney Drainage Repair']),
      ('ureterotomy',     ARRAY['Ureteric Stricture','Ureter Incision']),
      ('meatotomy',       ARRAY['Meatal Stenosis','Urethral Meatus Surgery']),
      ('vesico-vaginal',  ARRAY['VVF Repair','Vesicovaginal Fistula','Urinary Fistula']),
      ('bladder neck',    ARRAY['Bladder Neck Incision','BNI','Urinary Obstruction']),
      -- General surgery / GI
      ('cholecystectomy', ARRAY['Gall Bladder Removal','Gallstones','Cholelithiasis','Keyhole Gall Bladder Surgery']),
      ('cbd',             ARRAY['Common Bile Duct','CBD Exploration','Bile Duct Stones']),
      ('hernia',          ARRAY['Hernia Repair','Mesh Repair','Inguinal Hernia','Hernioplasty']),
      ('hydrocele',       ARRAY['Hydrocelectomy','Scrotal Swelling']),
      ('laparotomy',      ARRAY['Exploratory Laparotomy','Abdominal Exploration','Acute Abdomen']),
      ('splenectomy',     ARRAY['Spleen Removal','Splenic Injury']),
      ('pancreatectomy',  ARRAY['Pancreas Resection','Distal Pancreatectomy','Pancreatic Surgery']),
      ('pancreatic necrosectomy', ARRAY['Pancreatic Necrosis','Necrotising Pancreatitis']),
      ('cystogastrostomy', ARRAY['Pancreatic Pseudocyst','Internal Drainage']),
      ('jejunostomy',     ARRAY['Feeding Jejunostomy','Enteral Feeding','Bowel Anastomosis']),
      ('gastrojejunostomy', ARRAY['Gastric Bypass Drainage','Stomach Bowel Anastomosis']),
      ('ileostomy',       ARRAY['Stoma','Bowel Diversion']),
      ('colostomy',       ARRAY['Stoma','Large Bowel Diversion']),
      ('sigmoid resection', ARRAY['Sigmoid Colectomy','Colon Resection','Bowel Resection']),
      ('sphinecterotomy', ARRAY['Sphincterotomy','Anal Fissure','Fissure Surgery']),
      ('gastroenteritis', ARRAY['Diarrhoea','Dehydration','Stomach Infection']),
      -- Breast / onco
      ('mastectomy',      ARRAY['Breast Removal','Breast Cancer Surgery','MRM']),
      ('axillary dissection', ARRAY['Axillary Clearance','Lymph Node Dissection']),
      ('lumpectomy',      ARRAY['Breast Conserving Surgery','Wide Local Excision']),
      ('bplnd',           ARRAY['Pelvic Lymph Node Dissection','Lymphadenectomy']),
      ('radical neck',    ARRAY['Neck Dissection','Head and Neck Cancer']),
      ('cyclophosphamide', ARRAY['Chemotherapy','Adjuvant Chemotherapy','Cancer Treatment']),
      ('adriamycin',      ARRAY['Doxorubicin','Chemotherapy','Cancer Treatment']),
      -- Obs / gynae
      ('hysterctomy',     ARRAY['Hysterectomy','Uterus Removal','Womb Removal']),
      ('hysterectomy',    ARRAY['Uterus Removal','Womb Removal','TAH']),
      ('salpingoophorectomy', ARRAY['Salpingo-Oophorectomy','Ovary Removal','Tube and Ovary Removal']),
      ('omentectomy',     ARRAY['Omental Resection','Ovarian Cancer Surgery']),
      ('peritonectomy',   ARRAY['Peritoneal Stripping','Cytoreduction']),
      -- ENT / maxillofacial
      ('mastoidectomy',   ARRAY['Mastoid Surgery','Chronic Otitis Media','Middle Ear Surgery']),
      ('stapedectomy',    ARRAY['Otosclerosis','Stapes Surgery','Hearing Restoration']),
      ('ossiculoplasty',  ARRAY['Ossicular Reconstruction','Hearing Restoration','Middle Ear Surgery']),
      ('mandible',        ARRAY['Jaw Fracture','Lower Jaw','Maxillofacial Surgery']),
      ('maxilla',         ARRAY['Upper Jaw Fracture','Maxillofacial Surgery']),
      ('zygoma',          ARRAY['Cheekbone Fracture','Maxillofacial Surgery']),
      ('facio-maxillary', ARRAY['Maxillofacial Injury','Facial Fracture']),
      ('thyroidectomy',   ARRAY['Thyroid Removal','Goitre Surgery','Hemithyroidectomy']),
      -- Cardio / vascular / resp
      ('ptca',            ARRAY['Coronary Angioplasty','Stent','Heart Blockage','Balloon Angioplasty']),
      ('angioplasty',     ARRAY['Balloon Angioplasty','Stenting','Vessel Dilatation']),
      ('stent',           ARRAY['Stenting','Vascular Stent']),
      ('coil',            ARRAY['Coiling','Aneurysm Coiling','Endovascular']),
      ('pacemaker',       ARRAY['PPI','Cardiac Pacing','Heart Rhythm Device']),
      ('congestive heart failure', ARRAY['CCF','Heart Failure','Cardiac Failure']),
      ('pulmonary thromboembolism', ARRAY['PTE','Pulmonary Embolism','Lung Clot']),
      ('thoracoscop',     ARRAY['VATS','Chest Endoscopy','Pleural Surgery']),
      ('decortication',   ARRAY['Empyema','Pleural Peel Removal','Lung Decortication']),
      ('bronchoscopy',    ARRAY['Airway Endoscopy','Foreign Body Removal','Lung Scope']),
      ('respiratory failure', ARRAY['Ventilator Support','Type 2 Respiratory Failure','Hypoxia']),
      -- Medicine / critical care
      ('haemodialysis',   ARRAY['Dialysis','Renal Replacement Therapy','Kidney Dialysis']),
      ('renal failure',   ARRAY['AKI','Acute Kidney Injury','Kidney Failure']),
      ('cirrhosis',       ARRAY['Liver Cirrhosis','Hepatorenal Syndrome','Chronic Liver Disease']),
      ('ketoacidosis',    ARRAY['DKA','Diabetic Emergency','Diabetes Complication']),
      ('hyponatremia',    ARRAY['Low Sodium','Electrolyte Imbalance']),
      ('thrombocytopenia', ARRAY['Low Platelets','Bleeding Diathesis']),
      ('septic shock',    ARRAY['Sepsis','Shock','Critical Care']),
      ('severe sepsis',   ARRAY['Sepsis','Infection','Critical Care']),
      -- Plastics / burns
      ('flap',            ARRAY['Flap Cover','Reconstructive Surgery','Soft Tissue Cover']),
      ('myocutaneous',    ARRAY['Muscle Flap','Reconstructive Surgery']),
      ('skin graf',       ARRAY['Skin Grafting','SSG','Burns Cover']),
      ('burns',           ARRAY['Burn Injury','TBSA','Thermal Injury']),
      ('resuturing',      ARRAY['Wound Resuturing','Wound Dehiscence','Secondary Suturing'])
  ),
  built AS (
    SELECT p.id,
           ARRAY(
             SELECT DISTINCT s
               FROM dictionary d
               CROSS JOIN LATERAL unnest(d.synonyms) AS s
              WHERE lower(COALESCE(p.treatment_plan, '') || ' ' ||
                          COALESCE(p.diagnosis, '')      || ' ' ||
                          COALESCE(p.category, '')) LIKE '%' || d.root || '%'
              ORDER BY s
           ) AS kw
      FROM public.pmjay_mjpjay_packages p
  )
  UPDATE public.pmjay_mjpjay_packages p
     SET keywords = b.kw,
         updated_at = now()
    FROM built b
   WHERE p.id = b.id
     AND array_length(b.kw, 1) IS NOT NULL
     AND p.keywords IS DISTINCT FROM b.kw;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_touched := v_rows;
  RAISE NOTICE 'Keywords written to % package(s)', v_touched;
END
$apply$;

DO $verify$
DECLARE
  v_with INT; v_without INT; v_total INT;
BEGIN
  SELECT count(*) FILTER (WHERE array_length(keywords, 1) > 0),
         count(*) FILTER (WHERE keywords IS NULL OR array_length(keywords, 1) IS NULL),
         count(*)
    INTO v_with, v_without, v_total
    FROM public.pmjay_mjpjay_packages;

  -- Not an error. A package whose whole treatment plan is "Open" or "Plate"
  -- has nothing honest to say, and a fabricated synonym would be worse than a
  -- blank. This is reported so the number is known, never silently accepted.
  RAISE NOTICE '% of % packages have keywords; % matched no clinical root and were left blank.',
    v_with, v_total, v_without;

  IF v_with = 0 THEN
    RAISE EXCEPTION 'ABORT: no package matched any root — the dictionary is not being applied';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
