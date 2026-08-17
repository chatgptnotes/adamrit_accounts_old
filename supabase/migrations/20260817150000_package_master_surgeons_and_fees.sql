-- Fill the OT tile's surgeon, anaesthetist and payable from the package master.
--
-- THE INSTRUCTION (17 Aug, Dr M): the package master's surgeries belong to
-- specialities, and which speciality a surgeon operates in is already known --
-- apply that to the packages that carry no surgeon, and make Gaurav's OT
-- Schedule tile fill in the surgeon, the anaesthetist and both amounts.
--
-- WHERE THE MAPPING CAME FROM. Nowhere new. The 161 surgeon rows already on
-- this master encode it, and reading them back gives the rule:
--
--   Orthopaedics       Dr. Murali, Dr. Prayank Meshram
--   Neuro Surgery      Dr. Ankit Davre
--   General Surgery    Dr. Nanda Gavli, Dr. Mahendra Kamli
--   Urology            Ritesh Satade, Ved Mahajan
--   Surgical Oncology  Dr. Nanda Gavli
--   ENT                Dr. Vijay Bansod   (given by Dr M, 17 Aug -- no ENT
--                                          surgeon was mapped to any package)
--   Anaesthetist       Dr. Mona Basantvani, who is on all 145 existing links
--
-- WHAT IS NOT FILLED, AND WHY. 17 packages are CONSERVATIVE -- medical
-- management, not operations (septic shock, ketoacidosis, haemodialysis). They
-- are correctly surgeon-less and are left alone. Eight more are left blank on
-- purpose rather than guessed:
--
--   Decortication|Diagnostic thoracoscopy|Thoracoscopic         medical / not an operation
--   Basal                                                       speciality could not be identified
--   Anterior                                                    speciality could not be identified
--   Chronic Haemodialysis|Chronic Haemodialysis|Chronic Haemod  medical / not an operation
--   Open                                                        speciality could not be identified
--   Acute Ischemic Stoke|Acute Ischemic Stoke                   medical / not an operation
--   Acute Ischemic Stoke                                        medical / not an operation
--   Monopolar                                                   speciality could not be identified
--
-- A wrong surgeon here is not cosmetic: the OT tile raises the payable from
-- this name, so guessing would pay the wrong doctor. Blank is recoverable;
-- wrong is not.
--
-- THE FEES MOVE ONTO THE PACKAGE, as instructed. surgery_fee_master matched
-- the packages by procedure NAME and reached only 11 of 172, so the tile fell
-- back to a flat Rs 5,000 for everything else. surgeon_fee / anaesthetist_fee
-- on the package are authoritative when set; NULL keeps today's behaviour
-- exactly, so nothing regresses where no rate is known.
--
-- NOTHING IS OVERWRITTEN. Every insert is guarded on the package having no
-- surgeon / no anaesthetist already, and the fee seed only fills NULLs.

ALTER TABLE public.pmjay_mjpjay_packages
  ADD COLUMN IF NOT EXISTS surgeon_fee NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS anaesthetist_fee NUMERIC(12,2);

COMMENT ON COLUMN public.pmjay_mjpjay_packages.surgeon_fee IS
  'Payable to the surgeon for this package. NULL = fall back to surgery_fee_master then the default.';
COMMENT ON COLUMN public.pmjay_mjpjay_packages.anaesthetist_fee IS
  'Payable to the anaesthetist. NULL = fall back to anaesthesia_fee_master by anaesthesia type.';

DO $change$
DECLARE
  v_before_s INT; v_after_s INT;
  v_before_a INT; v_after_a INT;
  v_fees INT;
BEGIN
  SELECT count(DISTINCT package_id) INTO v_before_s FROM public.pmjay_mjpjay_package_surgeons;
  SELECT count(DISTINCT package_id) INTO v_before_a FROM public.pmjay_mjpjay_package_anaesthetists;

  CREATE TEMP TABLE _assign(package_id UUID, surgeon_name TEXT, surgeon_department TEXT) ON COMMIT DROP;
  INSERT INTO _assign(package_id, surgeon_name, surgeon_department) VALUES
  ('e2d9eb3e-dcd1-47ae-a328-dcb3f26315dc'::uuid, 'Dr. Nanda Gavli', 'General Surgery'),
  ('e2d9eb3e-dcd1-47ae-a328-dcb3f26315dc'::uuid, 'Dr. Mahendra Kamli', 'General Surgery'),
  ('3999a58a-a785-4f03-ac5a-46fc23296774'::uuid, 'Dr. Nanda Gavli', 'General Surgery'),
  ('3999a58a-a785-4f03-ac5a-46fc23296774'::uuid, 'Dr. Mahendra Kamli', 'General Surgery'),
  ('c50ff093-69ef-4365-adc9-2ccf9c410938'::uuid, 'Dr. Nanda Gavli', 'General Surgery'),
  ('c50ff093-69ef-4365-adc9-2ccf9c410938'::uuid, 'Dr. Mahendra Kamli', 'General Surgery'),
  ('57dbbe68-30de-4bc5-b0a8-87b07e4122eb'::uuid, 'Dr. Nanda Gavli', 'General Surgery'),
  ('57dbbe68-30de-4bc5-b0a8-87b07e4122eb'::uuid, 'Dr. Mahendra Kamli', 'General Surgery'),
  ('2d4949b6-4e3d-404b-b8e8-b35ce135a991'::uuid, 'Dr. Vijay Bansod', 'Otorhinolaryngology'),
  ('65d6dcf1-d3e6-4a19-b25b-0c4e85fbe66c'::uuid, 'Dr. Nanda Gavli', 'General Surgery'),
  ('65d6dcf1-d3e6-4a19-b25b-0c4e85fbe66c'::uuid, 'Dr. Mahendra Kamli', 'General Surgery'),
  ('fac8b420-170c-4a44-a631-52e21468aab5'::uuid, 'Dr. Nanda Gavli', 'Surgical Oncology'),
  ('e9072641-d60a-4264-9476-210882e901d0'::uuid, 'Ritesh Satade', 'Urology'),
  ('e9072641-d60a-4264-9476-210882e901d0'::uuid, 'Ved Mahajan', 'Urology'),
  ('14abdbc8-8300-4077-8668-0e3f4d09be86'::uuid, 'Dr. Ankit Davre', 'Neuro Surgery'),
  ('ce0c333c-4ac1-40ed-bb96-b7a84ffba48a'::uuid, 'Dr. Murali', 'Orthopaedics'),
  ('ce0c333c-4ac1-40ed-bb96-b7a84ffba48a'::uuid, 'Dr. Prayank Meshram', 'Orthopaedics'),
  ('766ab4d9-8b49-462f-962e-4b1b81e09287'::uuid, 'Dr. Nanda Gavli', 'General Surgery'),
  ('766ab4d9-8b49-462f-962e-4b1b81e09287'::uuid, 'Dr. Mahendra Kamli', 'General Surgery'),
  ('196c2272-1b71-45d2-a161-424acd4c5a9a'::uuid, 'Dr. Murali', 'Orthopaedics'),
  ('196c2272-1b71-45d2-a161-424acd4c5a9a'::uuid, 'Dr. Prayank Meshram', 'Orthopaedics'),
  ('3453af8c-cbbb-41e0-85cb-c8939aafeecf'::uuid, 'Dr. Nanda Gavli', 'General Surgery'),
  ('3453af8c-cbbb-41e0-85cb-c8939aafeecf'::uuid, 'Dr. Mahendra Kamli', 'General Surgery'),
  ('363cbf26-37c1-4b9f-9c1b-192e83b82944'::uuid, 'Dr. Murali', 'Orthopaedics'),
  ('363cbf26-37c1-4b9f-9c1b-192e83b82944'::uuid, 'Dr. Prayank Meshram', 'Orthopaedics'),
  ('5c118bda-b4ae-4d7f-93e8-03951dd38aaf'::uuid, 'Dr. Ankit Davre', 'Neuro Surgery'),
  ('e2e3e2a5-1568-4af1-82c3-23535ee102f6'::uuid, 'Dr. Nanda Gavli', 'General Surgery'),
  ('e2e3e2a5-1568-4af1-82c3-23535ee102f6'::uuid, 'Dr. Mahendra Kamli', 'General Surgery'),
  ('76f6ae33-fa30-4e87-b7b4-d98571e23f83'::uuid, 'Dr. Nanda Gavli', 'General Surgery'),
  ('76f6ae33-fa30-4e87-b7b4-d98571e23f83'::uuid, 'Dr. Mahendra Kamli', 'General Surgery'),
  ('9d1745ef-7249-4054-b010-684ceb95ea1a'::uuid, 'Dr. Nanda Gavli', 'General Surgery'),
  ('9d1745ef-7249-4054-b010-684ceb95ea1a'::uuid, 'Dr. Mahendra Kamli', 'General Surgery'),
  ('49b4e5db-4452-4b94-b3fc-cd777efdf7b1'::uuid, 'Dr. Vijay Bansod', 'Otorhinolaryngology'),
  ('56f5d966-1e33-4116-812e-382fe3f73879'::uuid, 'Dr. Nanda Gavli', 'General Surgery'),
  ('56f5d966-1e33-4116-812e-382fe3f73879'::uuid, 'Dr. Mahendra Kamli', 'General Surgery'),
  ('f95a93c6-ff78-489c-9994-6b84f7a85ec6'::uuid, 'Dr. Nanda Gavli', 'General Surgery'),
  ('f95a93c6-ff78-489c-9994-6b84f7a85ec6'::uuid, 'Dr. Mahendra Kamli', 'General Surgery'),
  ('d692606b-fd53-4f8d-aa07-b50a4c80ed9f'::uuid, 'Dr. Nanda Gavli', 'General Surgery'),
  ('d692606b-fd53-4f8d-aa07-b50a4c80ed9f'::uuid, 'Dr. Mahendra Kamli', 'General Surgery'),
  ('7b1fb301-b95a-45b3-80e1-af5075b3e213'::uuid, 'Dr. Murali', 'Orthopaedics'),
  ('7b1fb301-b95a-45b3-80e1-af5075b3e213'::uuid, 'Dr. Prayank Meshram', 'Orthopaedics'),
  ('c93ad59e-6bfd-418d-a7c4-66f066349103'::uuid, 'Dr. Murali', 'Orthopaedics'),
  ('c93ad59e-6bfd-418d-a7c4-66f066349103'::uuid, 'Dr. Prayank Meshram', 'Orthopaedics'),
  ('e34b0f86-b22c-47a0-bbf5-a364d6aa2b75'::uuid, 'Dr. Murali', 'Orthopaedics'),
  ('e34b0f86-b22c-47a0-bbf5-a364d6aa2b75'::uuid, 'Dr. Prayank Meshram', 'Orthopaedics'),
  ('13844807-73f5-42a4-a57a-54057ddba8b8'::uuid, 'Dr. Murali', 'Orthopaedics'),
  ('13844807-73f5-42a4-a57a-54057ddba8b8'::uuid, 'Dr. Prayank Meshram', 'Orthopaedics'),
  ('fd114f15-8e5f-456e-a745-c61ec2ab8a0b'::uuid, 'Ritesh Satade', 'Urology'),
  ('fd114f15-8e5f-456e-a745-c61ec2ab8a0b'::uuid, 'Ved Mahajan', 'Urology'),
  ('7bbe0799-44e2-4a46-8585-53dfc2618067'::uuid, 'Dr. Murali', 'Orthopaedics'),
  ('7bbe0799-44e2-4a46-8585-53dfc2618067'::uuid, 'Dr. Prayank Meshram', 'Orthopaedics'),
  ('7aa32502-8e0c-4cf4-a253-21a6053a755d'::uuid, 'Dr. Nanda Gavli', 'Surgical Oncology'),
  ('07cc8f4a-d4a3-4591-94df-f06287f01fcf'::uuid, 'Dr. Murali', 'Orthopaedics'),
  ('07cc8f4a-d4a3-4591-94df-f06287f01fcf'::uuid, 'Dr. Prayank Meshram', 'Orthopaedics'),
  ('642ae634-a6b4-45e8-b184-04211da8668e'::uuid, 'Dr. Nanda Gavli', 'Surgical Oncology'),
  ('60b8b903-9f90-4bfd-a126-0aaba9d9d17b'::uuid, 'Ritesh Satade', 'Urology'),
  ('60b8b903-9f90-4bfd-a126-0aaba9d9d17b'::uuid, 'Ved Mahajan', 'Urology'),
  ('82e2be3a-201e-493a-a4a6-ec8c494a962e'::uuid, 'Ritesh Satade', 'Urology'),
  ('82e2be3a-201e-493a-a4a6-ec8c494a962e'::uuid, 'Ved Mahajan', 'Urology'),
  ('509ec17f-b911-4e63-a4e9-31bf52c70580'::uuid, 'Dr. Nanda Gavli', 'Surgical Oncology'),
  ('f6569adb-36d5-4cad-b74e-bf97e0d8c1d4'::uuid, 'Dr. Murali', 'Orthopaedics'),
  ('f6569adb-36d5-4cad-b74e-bf97e0d8c1d4'::uuid, 'Dr. Prayank Meshram', 'Orthopaedics'),
  ('55afb26f-a4ef-4bba-95e7-1452a93f8de1'::uuid, 'Dr. Murali', 'Orthopaedics'),
  ('55afb26f-a4ef-4bba-95e7-1452a93f8de1'::uuid, 'Dr. Prayank Meshram', 'Orthopaedics'),
  ('6f29591c-e4f6-4260-adcf-a57d52047a9d'::uuid, 'Dr. Ankit Davre', 'Neuro Surgery');

  -- Only packages that carry NO surgeon at all. A package somebody has already
  -- staffed is never touched, however this migration would have classified it.
  INSERT INTO public.pmjay_mjpjay_package_surgeons (package_id, surgeon_name, surgeon_department)
  SELECT a.package_id, a.surgeon_name, a.surgeon_department
    FROM _assign a
   WHERE EXISTS (SELECT 1 FROM public.pmjay_mjpjay_packages p WHERE p.id = a.package_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.pmjay_mjpjay_package_surgeons s WHERE s.package_id = a.package_id
     )
  ON CONFLICT (package_id, surgeon_name) DO NOTHING;

  -- The anaesthetist, for surgical packages that have none. Conservative
  -- packages are medical and get no anaesthetist either.
  INSERT INTO public.pmjay_mjpjay_package_anaesthetists (package_id, anaesthetist_name)
  SELECT p.id, 'Dr. Mona Basantvani'
    FROM public.pmjay_mjpjay_packages p
   WHERE COALESCE(upper(p.category), '') NOT LIKE 'CONSERV%'
     AND NOT EXISTS (
       SELECT 1 FROM public.pmjay_mjpjay_package_anaesthetists x WHERE x.package_id = p.id
     )
  ON CONFLICT (package_id, anaesthetist_name) DO NOTHING;

  -- Seed the payable from the fee master where a row is actually linked to this
  -- package. Name matching is deliberately NOT used: 48 normalised names are
  -- duplicated across this master, so a name match would price the wrong
  -- operation (the reason only 7 rows were ever linked -- 20260816160000).
  UPDATE public.pmjay_mjpjay_packages p
     SET surgeon_fee = f.panel_rate
    FROM public.surgery_fee_master f
   WHERE f.pmjay_package_id = p.id
     AND p.surgeon_fee IS NULL
     AND f.panel_rate > 0;
  GET DIAGNOSTICS v_fees = ROW_COUNT;

  -- The anaesthetist's payable follows the anaesthesia type, the same rule the
  -- tile and the approval queue already use.
  UPDATE public.pmjay_mjpjay_packages p
     SET anaesthetist_fee = a.panel_rate
    FROM public.anaesthesia_fee_master a
   WHERE lower(btrim(a.anaesthesia_type)) = lower(btrim(p.anaesthesia_type))
     AND a.is_active
     AND p.anaesthetist_fee IS NULL
     AND a.panel_rate > 0;

  SELECT count(DISTINCT package_id) INTO v_after_s FROM public.pmjay_mjpjay_package_surgeons;
  SELECT count(DISTINCT package_id) INTO v_after_a FROM public.pmjay_mjpjay_package_anaesthetists;

  RAISE NOTICE 'packages with a surgeon: % -> %, with an anaesthetist: % -> %, surgeon fees seeded: %',
    v_before_s, v_after_s, v_before_a, v_after_a, v_fees;
END
$change$;

DO $verify$
DECLARE
  v_n INT; v_bad INT;
BEGIN
  -- Nobody who already had a surgeon may have gained a second one from this.
  SELECT count(*) INTO v_bad FROM (
    SELECT package_id FROM public.pmjay_mjpjay_package_surgeons
     GROUP BY package_id HAVING count(*) > 6
  ) d;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'ABORT: % package(s) now carry more than six surgeons', v_bad;
  END IF;

  -- Every surgical package must now name a surgeon, except the eight left
  -- blank on purpose. If this number grows, something was classified silently.
  SELECT count(*) INTO v_n
    FROM public.pmjay_mjpjay_packages p
   WHERE COALESCE(upper(p.category), '') NOT LIKE 'CONSERV%'
     AND NOT EXISTS (SELECT 1 FROM public.pmjay_mjpjay_package_surgeons s WHERE s.package_id = p.id);
  IF v_n > 8 THEN
    RAISE EXCEPTION 'ABORT: % surgical package(s) still have no surgeon, expected at most 8', v_n;
  END IF;

  -- Conservative packages are medical: they must NOT have been given one.
  SELECT count(*) INTO v_bad
    FROM public.pmjay_mjpjay_packages p
    JOIN public.pmjay_mjpjay_package_surgeons s ON s.package_id = p.id
   WHERE upper(COALESCE(p.category, '')) LIKE 'CONSERV%'
     AND s.surgeon_department IS NOT NULL
     AND s.created_at > now() - interval '5 minutes';
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'ABORT: % conservative package(s) were given a surgeon', v_bad;
  END IF;

  -- Every surgical package must name an anaesthetist.
  SELECT count(*) INTO v_n
    FROM public.pmjay_mjpjay_packages p
   WHERE COALESCE(upper(p.category), '') NOT LIKE 'CONSERV%'
     AND NOT EXISTS (SELECT 1 FROM public.pmjay_mjpjay_package_anaesthetists a WHERE a.package_id = p.id);
  IF v_n > 0 THEN
    RAISE EXCEPTION 'ABORT: % surgical package(s) still have no anaesthetist', v_n;
  END IF;

  -- ENT must have landed on Dr Vijay Bansod, which was the one name Dr M gave.
  SELECT count(*) INTO v_n FROM public.pmjay_mjpjay_package_surgeons
   WHERE surgeon_department = 'Otorhinolaryngology' AND surgeon_name = 'Dr. Vijay Bansod';
  IF v_n < 2 THEN
    RAISE EXCEPTION 'ABORT: the ENT packages did not get Dr Vijay Bansod (% row(s))', v_n;
  END IF;

  -- A fee that was set must be a real amount, never zero or negative.
  SELECT count(*) INTO v_bad FROM public.pmjay_mjpjay_packages
   WHERE (surgeon_fee IS NOT NULL AND surgeon_fee <= 0)
      OR (anaesthetist_fee IS NOT NULL AND anaesthetist_fee <= 0);
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'ABORT: % package(s) carry a zero or negative payable', v_bad;
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
