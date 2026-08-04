-- Two things: the Yojana identity keys, and honest surgery fees.
--
-- A. PMJAY IDENTITY (Ruby, 4-Aug: "the program id in the portal of the yojna
--    is the unique patient id"). The portal carries TWO ids and they are not
--    interchangeable:
--      • Program ID    (MQXFW6U00) — the BENEFICIARY, stable across cases
--                                     → belongs on patients
--      • Registration ID (2026070110058001) — one ADMISSION/case
--                                     → belongs on visits (already there)
--    This adds patients.pmjay_program_id and back-fills 124 patients matched
--    to portal rows with high confidence (65 by registration id — an exact
--    key — and 59 by an unambiguous exact name). 8 near-name matches are
--    deliberately NOT written; they are listed for Ruby to confirm, because
--    a wrong beneficiary id misroutes a claim.
--
-- B. SURGERY FEES: 1,940 of 2,083 rows still carry the seeded placeholder
--    (panel 5,000 / private 8,000) — indistinguishable from a decision, and
--    the OT bill auto-fill would pay it. Placeholders become NULL so "not
--    set" is visible, and the fee lookup already treats NULL as 0, which
--    leaves the bill for a human to price.
--
-- Run in the Supabase dashboard SQL Editor. Safe to run twice.

BEGIN;

-- ══ A. PMJAY beneficiary id on the patient ═══════════════════════════════
ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS pmjay_program_id TEXT;

COMMENT ON COLUMN public.patients.pmjay_program_id IS
  'PMJAY/MJPJAY portal Program ID — the beneficiary key, stable across admissions. Per-case ids live on visits.yojana_registration_id.';

CREATE INDEX IF NOT EXISTS patients_pmjay_program_id_idx
  ON public.patients (pmjay_program_id) WHERE pmjay_program_id IS NOT NULL;

UPDATE public.patients SET pmjay_program_id = 'MIHWO610U' WHERE id = '2497d36d-166e-4b9f-8cc8-afecfc61109f' AND pmjay_program_id IS NULL;  -- UHHO26E05004 SHEIKH BASHIR SHEIKH BAHADUR
UPDATE public.patients SET pmjay_program_id = 'PVZ2RD5L8' WHERE id = '52281823-7e2f-47cd-9102-b5516ece0b03' AND pmjay_program_id IS NULL;  -- UHHO26C14001 PIYUSH SANJAY KAWARE
UPDATE public.patients SET pmjay_program_id = 'MUCM6MPRK' WHERE id = '0b588c0b-b67e-43e6-81ba-daa7d7bac9ee' AND pmjay_program_id IS NULL;  -- UHHO26F07003 FAMIDA BEGAM
UPDATE public.patients SET pmjay_program_id = 'PBMFRUZC0' WHERE id = '6977d8b4-88f7-4e55-b2e8-6dcb28910433' AND pmjay_program_id IS NULL;  -- UHHO26G03029 Dhanraj Ramashankar Namdeo
UPDATE public.patients SET pmjay_program_id = 'PYI2GUNIP' WHERE id = '297d8aaa-7171-472d-a571-f95daaa0d69e' AND pmjay_program_id IS NULL;  -- UHHO26F30003 HEMRAJ NACHANKAR
UPDATE public.patients SET pmjay_program_id = 'P9CMZFDZW' WHERE id = '9a7a300f-7b33-427b-a422-03f1a4443103' AND pmjay_program_id IS NULL;  -- UHHO26A06021 CHANDRAMANI SHRIRAM DHAMGAYE
UPDATE public.patients SET pmjay_program_id = 'MHJ15RA96' WHERE id = '01f2ff2f-7475-4e85-bd05-5a927b34c8d8' AND pmjay_program_id IS NULL;  -- UHHO26C05007 SHAHJAD
UPDATE public.patients SET pmjay_program_id = 'MJMUL0BQZ' WHERE id = '50edb1d5-7eb2-4467-b0b2-1367f1d28649' AND pmjay_program_id IS NULL;  -- UHHO26F11006 YOGESH JAMBHULKAR
UPDATE public.patients SET pmjay_program_id = 'P3GP4ST98' WHERE id = 'e2263150-9d2d-4d7d-ac6f-0a8dcfcb4e89' AND pmjay_program_id IS NULL;  -- UHHO26C11001 AMBARDAS VISHVANATH GONDALE 
UPDATE public.patients SET pmjay_program_id = 'P342NHLSC' WHERE id = '7b1d127a-6c59-4a83-962c-ea73bab29f77' AND pmjay_program_id IS NULL;  -- UHHO26G03032 DURGA TELOTE
UPDATE public.patients SET pmjay_program_id = 'JYPAM70DP' WHERE id = '2391ed0c-c76f-4df8-b06f-1ffa35be6f3a' AND pmjay_program_id IS NULL;  -- UHHO26C25006 SHEIKH RAZZAK SHEIKH GAFFAR
UPDATE public.patients SET pmjay_program_id = 'PM6PTA7B9' WHERE id = 'b34934b1-306a-4fb9-9a34-7329dbfff15d' AND pmjay_program_id IS NULL;  -- UHHO26B25002 SAHADEV MAROTI NAGARIKAR
UPDATE public.patients SET pmjay_program_id = 'PJ4DN93HY' WHERE id = '552ea3eb-3b1a-4cf2-ab59-c831f643a156' AND pmjay_program_id IS NULL;  -- UHHO26C05005 KAMLESH MADANKAR
UPDATE public.patients SET pmjay_program_id = 'PGJX3Z91G' WHERE id = '142d6c83-fc29-4c31-bac4-730527ba2c65' AND pmjay_program_id IS NULL;  -- UHHO26G16005 SUHANA PARVEEN HAMID KHAN PATHAN
UPDATE public.patients SET pmjay_program_id = 'MH0P65RZS' WHERE id = '346f866c-8236-4e41-b7a6-7ea12c93fd90' AND pmjay_program_id IS NULL;  -- UHHO26E12001 AASHIK SHAIKH RASHID SHIKH 
UPDATE public.patients SET pmjay_program_id = 'P650WFAGN' WHERE id = '9bd4911d-3a4c-4b83-8ac6-383ed250f17b' AND pmjay_program_id IS NULL;  -- UHHO26G14006 KRISHNA DEVI PAL
UPDATE public.patients SET pmjay_program_id = 'MTNR4XHMZ' WHERE id = '5fb9e477-bc09-451c-9261-f7c9e7ed3a03' AND pmjay_program_id IS NULL;  -- UHHO26C26004 ANITA VIJAY SHAH
UPDATE public.patients SET pmjay_program_id = 'PY4E4YG3P' WHERE id = '49e017a7-cdf7-4d55-8114-74296bcb3a7c' AND pmjay_program_id IS NULL;  -- UHHO26G21002 VAISHALI MOHANE
UPDATE public.patients SET pmjay_program_id = 'AMJPYS9EI' WHERE id = 'cf98167d-c518-4f6c-9011-5e54aa8ea042' AND pmjay_program_id IS NULL;  -- UHHO26C07008 LAXMIKANT SAWARKAR
UPDATE public.patients SET pmjay_program_id = 'MGPIAEJ55' WHERE id = '9093c847-5160-4a4b-8cc9-91a14a0a2cfe' AND pmjay_program_id IS NULL;  -- UHHO26G03023 MOHUMD OAEK NOMAN
UPDATE public.patients SET pmjay_program_id = 'MUG58K8LQ' WHERE id = '458fd0c9-c5c0-448b-bacf-59c4ef508617' AND pmjay_program_id IS NULL;  -- UHHO26G23004 SHAHIN PARVIN HASIB KHAN PATHAN 
UPDATE public.patients SET pmjay_program_id = 'PUNUAB620' WHERE id = '3a1cc2ee-dddc-4174-b518-f8d86acbea81' AND pmjay_program_id IS NULL;  -- UHHO26G03014 RAVIKANT DAHAYAT
UPDATE public.patients SET pmjay_program_id = 'P8VKSR6XH' WHERE id = '13b0bd9b-5b7e-4815-94d0-05bf7a315ffe' AND pmjay_program_id IS NULL;  -- UHHO26G15001 GAYATRI RAJPUT 
UPDATE public.patients SET pmjay_program_id = 'MUBUCUIZE' WHERE id = '7e16c2da-2f09-4a4e-b5a7-5f5327e4f851' AND pmjay_program_id IS NULL;  -- UHHO26E09004 KHURSHID KHAN
UPDATE public.patients SET pmjay_program_id = 'MTBKNWAKD' WHERE id = 'c1fb563f-8897-44ad-8e26-5e3b2ecfa2f1' AND pmjay_program_id IS NULL;  -- UHHO26E18003 SHAKIL AHMAD
UPDATE public.patients SET pmjay_program_id = 'MILEGX218' WHERE id = 'c75d354b-f2c7-41fb-9a41-04278b039a3f' AND pmjay_program_id IS NULL;  -- UHHO26C05006 USHA NAGORAO GABHNE
UPDATE public.patients SET pmjay_program_id = 'PC5MF3H9E' WHERE id = 'a95b0bc1-ced6-439d-a54e-bc5b6811fb68' AND pmjay_program_id IS NULL;  -- UHHO26G23006 RADHABAI MADHAV RAJUKE
UPDATE public.patients SET pmjay_program_id = 'MR013SXFC' WHERE id = 'a7e16a3a-ff96-4e02-866b-ac30c53f50ed' AND pmjay_program_id IS NULL;  -- UHHO26F12006 RAJKUMAR SURYABHAN ZODAPE
UPDATE public.patients SET pmjay_program_id = 'P5QRJ0GQB' WHERE id = 'da7f6daa-8326-473a-9ffd-c85cde188fb4' AND pmjay_program_id IS NULL;  -- UHHO26E08001 MANOJRAM 
UPDATE public.patients SET pmjay_program_id = 'MJORGCEAA' WHERE id = '10ec172d-7b90-4443-bb3c-f7c051d28beb' AND pmjay_program_id IS NULL;  -- UHHO26E14004 GYANITA HIRAMAN RAUT
UPDATE public.patients SET pmjay_program_id = 'YJAMPL8K6' WHERE id = '71eebe34-ed23-4313-a26a-01154cdd13ad' AND pmjay_program_id IS NULL;  -- UHHO26F17004 SALMA BI RAUF SHAH
UPDATE public.patients SET pmjay_program_id = 'PTH4189TH' WHERE id = 'de09c09e-4970-4f03-8d23-d2690ebaac37' AND pmjay_program_id IS NULL;  -- UHHO26F15007 HEMRAJ MARAVI
UPDATE public.patients SET pmjay_program_id = 'MJ5ULFYWJ' WHERE id = 'b7d730a3-62f3-4d0b-b1a5-27b4768812b7' AND pmjay_program_id IS NULL;  -- UHHO26G24006 MEENA RASHE
UPDATE public.patients SET pmjay_program_id = 'MSZJZ357Z' WHERE id = 'e1e8cd4c-55dc-4b79-810c-123ac8ae2efc' AND pmjay_program_id IS NULL;  -- UHHO26G18007 NAMRATA MAHADEV BHAMUDRE 
UPDATE public.patients SET pmjay_program_id = 'MUEDZAUPR' WHERE id = 'd3e25fff-422c-45b1-ac6c-f70637b717e3' AND pmjay_program_id IS NULL;  -- UHHO26G02001 PRABHAKAR SAKHARE
UPDATE public.patients SET pmjay_program_id = 'MUF9LUISZ' WHERE id = '09879fa7-5c94-4d9a-936e-4bb765bd4697' AND pmjay_program_id IS NULL;  -- UHHO26G09006 SHAILA BANO 
UPDATE public.patients SET pmjay_program_id = 'MTNXST3LB' WHERE id = '1d9de890-9450-4ec0-bb19-2392b76fecdf' AND pmjay_program_id IS NULL;  -- UHHO26G06009 SANJAY SAGARE 
UPDATE public.patients SET pmjay_program_id = 'PNRHY5VRP' WHERE id = '2ada184c-76bd-427d-836a-8607eaab07ec' AND pmjay_program_id IS NULL;  -- UHHO26A15001 RAJNI CHAUDHARY
UPDATE public.patients SET pmjay_program_id = 'MGMNSX6XV' WHERE id = 'f0650f7e-5e38-47fc-9fdc-a2d59d179515' AND pmjay_program_id IS NULL;  -- UHHO26F10005 JAWED KHAN JABAZ KHAN
UPDATE public.patients SET pmjay_program_id = 'PIG9D4MUS' WHERE id = '4fca3208-2348-4418-a595-97273971820d' AND pmjay_program_id IS NULL;  -- UHHO26D18002 RAVI YADAV
UPDATE public.patients SET pmjay_program_id = 'PJNSFRDU2' WHERE id = 'b2b1b4ad-a4bd-4f5f-a430-7367d15caedb' AND pmjay_program_id IS NULL;  -- UHAY26G04005 kala bai 
UPDATE public.patients SET pmjay_program_id = 'MRBTZ4IKB' WHERE id = '456f2b8d-8598-429a-953c-3190136db420' AND pmjay_program_id IS NULL;  -- UHHO26F09005 RAJENDRA LODHI 
UPDATE public.patients SET pmjay_program_id = 'MUF80Y469' WHERE id = 'b3182af2-ecb7-428f-a310-38a79ff5fd43' AND pmjay_program_id IS NULL;  -- UHHO26G17001 SURAIYABI SALIM SHEIKH
UPDATE public.patients SET pmjay_program_id = 'MMN5YDFG0' WHERE id = '51320b70-7ce1-4521-9b63-ef169bb4e3a6' AND pmjay_program_id IS NULL;  -- UHHO26E20005 RAMAVATAR PARSARAM ASAWA
UPDATE public.patients SET pmjay_program_id = 'MRA6HTWPW' WHERE id = '3982bddb-80b1-4e59-a62c-5be34a1b59aa' AND pmjay_program_id IS NULL;  -- UHHO26A07003 SUMITRA TIWARI
UPDATE public.patients SET pmjay_program_id = 'PI9QA7I8K' WHERE id = '45e062f4-6550-44c3-9736-0c2ddc452209' AND pmjay_program_id IS NULL;  -- UHHO26G24003 LALAN  SINGH
UPDATE public.patients SET pmjay_program_id = 'MUBZMHU4N' WHERE id = 'db733662-ed1e-4bfb-9fc1-fa6029a1c81d' AND pmjay_program_id IS NULL;  -- UHHO26E09002 AFRAZ BANO ARSHAD ALI 
UPDATE public.patients SET pmjay_program_id = 'MUF7F935A' WHERE id = 'edc47009-c690-4607-9227-75c0eaa2fbe4' AND pmjay_program_id IS NULL;  -- UHHO26G02006 RUDRANSH KISHOR SARWA 
UPDATE public.patients SET pmjay_program_id = 'PDZF6ZN1R' WHERE id = '0603954b-b7d6-4a17-b888-289480dee8a2' AND pmjay_program_id IS NULL;  -- UHHO26G23003 ANOOP DAS SARVE
UPDATE public.patients SET pmjay_program_id = 'MJ45UX4AD' WHERE id = '74d05678-39ef-4477-8c5d-2e47635510f9' AND pmjay_program_id IS NULL;  -- UHHO26G19001 ANITA GURJAR
UPDATE public.patients SET pmjay_program_id = 'MUDJLYMEK' WHERE id = 'e3bacfeb-412b-45f2-b504-197017722b59' AND pmjay_program_id IS NULL;  -- UHHO26F08006 GAURAV SANJAY BHASME
UPDATE public.patients SET pmjay_program_id = 'MSZSLRT2Q' WHERE id = '7541766a-d80b-4cca-bde8-b9ca710c1c9c' AND pmjay_program_id IS NULL;  -- UHHO26F29010 MOHAN DAJIBA WAGHADE 
UPDATE public.patients SET pmjay_program_id = 'MGNJELVPH' WHERE id = 'becf9c73-5213-4f2e-bbd0-a9821390892a' AND pmjay_program_id IS NULL;  -- UHHO26G03030 RAUSHAN JAHAN SHAHEZAD HUSAI 
UPDATE public.patients SET pmjay_program_id = 'PXP1HUIWF' WHERE id = 'af555663-e1ee-4dfe-8dbd-e33e8a13c7f2' AND pmjay_program_id IS NULL;  -- UHHO26F26002 ANJUM NISHA MANSOORI
UPDATE public.patients SET pmjay_program_id = 'MUFS9ZHE3' WHERE id = '5549a34e-0c47-4d64-b1a0-d06d2398cc76' AND pmjay_program_id IS NULL;  -- UHHO26G15006 SANDHYA UMESH GANVIR 
UPDATE public.patients SET pmjay_program_id = 'PJAMY2D51' WHERE id = '997732e4-ca41-4e9e-9df8-2d84ec461727' AND pmjay_program_id IS NULL;  -- UHHO26F28003 AMIT PRABHAKAR RODGE
UPDATE public.patients SET pmjay_program_id = 'PR7RKUSF8' WHERE id = 'e324c795-ce1a-49e3-86d4-9a7799ed18df' AND pmjay_program_id IS NULL;  -- UHHO26G03040 ANIL KUMAR INVATI
UPDATE public.patients SET pmjay_program_id = 'MTMF960AZ' WHERE id = 'b0d3c670-2380-4db7-9415-800c6e3c0b89' AND pmjay_program_id IS NULL;  -- UHAY26B03003 SUBHEDAR SUKHU SARPA
UPDATE public.patients SET pmjay_program_id = 'MH040QRHW' WHERE id = 'bcc4fcfe-a38c-46f7-b029-d7e0db1dbf42' AND pmjay_program_id IS NULL;  -- UHHO26G14003 HARISH JAGTAP
UPDATE public.patients SET pmjay_program_id = 'MR9KM0LKE' WHERE id = '188ec602-586e-400e-87b0-e65bdfffe3a9' AND pmjay_program_id IS NULL;  -- UHHO26C06011 RAGHUNATH MASTKAR
UPDATE public.patients SET pmjay_program_id = 'P3S6937SQ' WHERE id = '9806f3b6-173e-48ff-9099-808607dc2d15' AND pmjay_program_id IS NULL;  -- UHHO26F21003 HOMDEW TULASIRAMJI BHURLE
UPDATE public.patients SET pmjay_program_id = 'P2RZVFT5J' WHERE id = 'd27ddc23-1bcc-4ec1-a3a2-2b2f76698a21' AND pmjay_program_id IS NULL;  -- UHAY26G27001 NIRNAY RAMTEKE
UPDATE public.patients SET pmjay_program_id = 'MUE2K1M0T' WHERE id = '3dd15788-8519-4874-9d77-77949d9cbbd4' AND pmjay_program_id IS NULL;  -- UHHO26F16009 NASIMA BANO ABDUL KHALIL
UPDATE public.patients SET pmjay_program_id = 'MUCN3O0WN' WHERE id = '0c4ce7aa-150a-43f0-9af8-47c8efa5cbce' AND pmjay_program_id IS NULL;  -- UHHO26G30008 NISHAD BEGAM
UPDATE public.patients SET pmjay_program_id = 'MUFEFWQCQ' WHERE id = '2e395a10-82c0-4f15-97d6-246660b4ca5a' AND pmjay_program_id IS NULL;  -- UHHO26G10005 MAMTA VIJAY MALIK 
UPDATE public.patients SET pmjay_program_id = 'PQPDK3QV7' WHERE id = '6dda68cb-0d46-4faa-a4a3-89ba58b55e7a' AND pmjay_program_id IS NULL;  -- UHHO26G06008 SANTOSH PALI
UPDATE public.patients SET pmjay_program_id = 'YAJPM57Z3' WHERE id = '3ca164a3-7b3a-4f1a-afcc-512a5213de8c' AND pmjay_program_id IS NULL;  -- UHHO26F10007 MINA KHUSHALRAO THAKARE
UPDATE public.patients SET pmjay_program_id = 'PGLDC1KOR' WHERE id = 'fda0ab5d-8685-4b30-84b6-1aa41173a1ce' AND pmjay_program_id IS NULL;  -- UHHO26F29003 SAMPAT GULAB IDAPACHI 
UPDATE public.patients SET pmjay_program_id = 'PHSNB13A3' WHERE id = 'f8b62437-8a6a-46c3-ad4c-b3401d750e6b' AND pmjay_program_id IS NULL;  -- UHHO26E22002 TEEKARAM
UPDATE public.patients SET pmjay_program_id = 'MJ3P5UC84' WHERE id = '4ca48a96-cde8-4012-8901-a12be62255b4' AND pmjay_program_id IS NULL;  -- UHHO26G02005 YOGITA RAJU SHENDE 
UPDATE public.patients SET pmjay_program_id = 'PGNZ0Y2U2' WHERE id = '866e4b33-9601-48ff-99f0-2b267504d308' AND pmjay_program_id IS NULL;  -- UHHO26G08010 MULLO BAI KUSHWAHA
UPDATE public.patients SET pmjay_program_id = 'P1RMQ64QN' WHERE id = '41c48a71-f8ba-4af7-9240-201488d5409c' AND pmjay_program_id IS NULL;  -- UHHO26G24004 SILOCHNA BAI SAHU
UPDATE public.patients SET pmjay_program_id = 'PZNL9RMV3' WHERE id = 'a461cc3d-9248-453d-8f65-734cfdb6c3b9' AND pmjay_program_id IS NULL;  -- UHHO26G20005 ROHIT RAJPOOT
UPDATE public.patients SET pmjay_program_id = 'MTPH2HGXN' WHERE id = 'f945f8c1-21d3-48bc-8654-ec17a9e5d2e1' AND pmjay_program_id IS NULL;  -- UHHO26E20006 VIJAY RAMDAS PARDE
UPDATE public.patients SET pmjay_program_id = 'PD24PNX33' WHERE id = '9875bb19-4e33-4f3a-95d1-10e7b5885cc5' AND pmjay_program_id IS NULL;  -- UHHO26G14008 SAVITRI KUSHWAHA
UPDATE public.patients SET pmjay_program_id = 'MUFJTL1KN' WHERE id = '3de3e1ad-e9ee-4a2e-8718-178f923a9d65' AND pmjay_program_id IS NULL;  -- UHHO26G06002 PUNIBAI RAMESH NIMJE 
UPDATE public.patients SET pmjay_program_id = 'PSL2VEISX' WHERE id = '7c3d6b2a-38f6-46b5-a410-71e857b2622c' AND pmjay_program_id IS NULL;  -- UHHO26C05008 ANKIT TIWARI
UPDATE public.patients SET pmjay_program_id = 'MKOQZM6Z7' WHERE id = '6a6c53d8-a044-4412-96ed-a09fbb7eaea1' AND pmjay_program_id IS NULL;  -- UHHO26F17005 NAJIYA BEGAM
UPDATE public.patients SET pmjay_program_id = 'PVF3Z3E7U' WHERE id = '7815fd7d-832e-49c4-a895-560760173c23' AND pmjay_program_id IS NULL;  -- UHHO26G02003 SUPHI KHAN
UPDATE public.patients SET pmjay_program_id = 'MR86L9NS9' WHERE id = '2abf5466-9e7b-4b75-90ed-9720f8361a09' AND pmjay_program_id IS NULL;  -- UHHO26C17003 PANKAJ AHIRWAR
UPDATE public.patients SET pmjay_program_id = 'PQOH0K4YE' WHERE id = '4234c7ae-194c-4a54-939e-f8099ca3f430' AND pmjay_program_id IS NULL;  -- UHHO26E01003 NAZMEEN HUSEN
UPDATE public.patients SET pmjay_program_id = 'PIXZBQSM6' WHERE id = 'dc1c1d18-3db3-4c6f-8cb2-4ca98c6312d2' AND pmjay_program_id IS NULL;  -- UHHO26F26006 VRINDAVAN SHUKLA
UPDATE public.patients SET pmjay_program_id = 'MUCE9UO5Y' WHERE id = '9c289096-7fd7-4c13-bca5-b6dd021783ba' AND pmjay_program_id IS NULL;  -- UHHO26E19004 JITENDRA SADASHIV BHOYAR
UPDATE public.patients SET pmjay_program_id = 'MF9S6L4QE' WHERE id = 'baab98fe-4345-4285-9f1f-3e3f94b74809' AND pmjay_program_id IS NULL;  -- UHHO26E04006 BHAGWATI GURJAR
UPDATE public.patients SET pmjay_program_id = 'P0E5WL6V6' WHERE id = 'f44fc0d0-38a0-4e58-8bc0-8f7c044eead4' AND pmjay_program_id IS NULL;  -- UHHO26D04002 RAVI PARMAR
UPDATE public.patients SET pmjay_program_id = 'MFDPQW1SP' WHERE id = 'ac8329d5-e4a2-44cc-8ca4-e0ed0dc212f4' AND pmjay_program_id IS NULL;  -- UHHO26G03026 Rahul Dhurve
UPDATE public.patients SET pmjay_program_id = 'YPAJM9PWO' WHERE id = '2be7df6a-8d46-4a28-aa4f-152bff5a72e8' AND pmjay_program_id IS NULL;  -- UHHO26E26005 DURGA KASARE 
UPDATE public.patients SET pmjay_program_id = 'MUBJQSW12' WHERE id = 'cf50c764-109a-4070-afde-34f178c2eb43' AND pmjay_program_id IS NULL;  -- UHHO26F11004 NAJMAA BI SHEIKH AABID
UPDATE public.patients SET pmjay_program_id = 'PY7SPL5J7' WHERE id = '23239ad6-e1a2-4884-abc7-cf3a6da3be5a' AND pmjay_program_id IS NULL;  -- UHHO26G03025 Narendra Waghale
UPDATE public.patients SET pmjay_program_id = 'MI2EKCP4P' WHERE id = 'a22748b2-f028-4083-b17f-edce3bfa295a' AND pmjay_program_id IS NULL;  -- UHHO26F11008 BANDU SHANKARRAO OGALE
UPDATE public.patients SET pmjay_program_id = 'P18QMALKY' WHERE id = '304ad6c2-c464-4696-bbc5-631dad26f309' AND pmjay_program_id IS NULL;  -- UHHO26G07002 NARAYAN SINGH 
UPDATE public.patients SET pmjay_program_id = 'YMJPAAT2Y' WHERE id = 'c2b64610-18a0-43c4-b5b0-d73d0baf859d' AND pmjay_program_id IS NULL;  -- UHHO25L23006 Sushil Haribhau Somkuwar
UPDATE public.patients SET pmjay_program_id = 'MJ3K1QHE7' WHERE id = '66d0d9c8-adfb-4191-b96d-37176485e4aa' AND pmjay_program_id IS NULL;  -- UHHO26F02002 REKHABAI RAMDAS VINDANE
UPDATE public.patients SET pmjay_program_id = 'PASAEFCI3' WHERE id = 'b79e8d4c-3984-437a-b839-f148f1cb61eb' AND pmjay_program_id IS NULL;  -- UHHO26G22002 TIJAUA VISHWAKARMA 
UPDATE public.patients SET pmjay_program_id = 'MUFIF51QG' WHERE id = '04d1f3f7-c96a-42ea-b196-acafab49cb56' AND pmjay_program_id IS NULL;  -- UHHO26G07001 POOJA LOKHANDE
UPDATE public.patients SET pmjay_program_id = 'MUDH6FLW4' WHERE id = '7cec2b76-b9e6-462c-bc64-e90d228940fe' AND pmjay_program_id IS NULL;  -- UHHO26F07005 SHOBHA RATANLALJI GUPTA
UPDATE public.patients SET pmjay_program_id = 'PM2S50SGK' WHERE id = '9081f43f-e947-4fa0-af0b-e7b4774a091b' AND pmjay_program_id IS NULL;  -- UHHO26G03018 Laxmi bai meravi
UPDATE public.patients SET pmjay_program_id = 'MJ47AXQU5' WHERE id = 'b9daa661-2bf3-4bf3-89c5-1c925e115fa1' AND pmjay_program_id IS NULL;  -- UHHO26F16005 VYANKAT SHRIRAM KOTHEKAR
UPDATE public.patients SET pmjay_program_id = 'P4X21FPXG' WHERE id = '93defaec-0183-4834-8a93-5eb2dd1fad76' AND pmjay_program_id IS NULL;  -- UHHO26G03027 Koushal Kumari
UPDATE public.patients SET pmjay_program_id = 'MTP9H5I53' WHERE id = 'ead4d00a-e043-4b18-b2f4-b8ebc2accaa8' AND pmjay_program_id IS NULL;  -- UHHO26D01006 UJAIN KANTA PAWAR
UPDATE public.patients SET pmjay_program_id = 'P9F5N8187' WHERE id = '6f0a8e9e-0bc6-4434-b7e1-73a86e068812' AND pmjay_program_id IS NULL;  -- UHHO26H03004 AASIFA BANO 
UPDATE public.patients SET pmjay_program_id = 'MSI81VAKV' WHERE id = 'c6682c88-0382-4fd8-8785-337a21fe78be' AND pmjay_program_id IS NULL;  -- UHHO26E25008 TAIRUNISSA MOHAMMAD SIDDIQUE ANSARI
UPDATE public.patients SET pmjay_program_id = 'MR7MDSM8E' WHERE id = 'bf3a79a6-6fe8-4bee-9415-456511f6c389' AND pmjay_program_id IS NULL;  -- UHHO26G03031 Kamla Bai Rathor
UPDATE public.patients SET pmjay_program_id = 'MMT9V8BH1' WHERE id = '7eb6a034-fdef-4220-a2aa-882775d5ca3d' AND pmjay_program_id IS NULL;  -- UHHO26G03013 suman sahu
UPDATE public.patients SET pmjay_program_id = 'PATKPCK3J' WHERE id = '902ff8ec-d388-4230-88f9-191d0ba58751' AND pmjay_program_id IS NULL;  -- UHHO26G03035 Bhupnarayan Yadav
UPDATE public.patients SET pmjay_program_id = 'MUQJX3OP6' WHERE id = '94848642-d043-4ec4-bd21-d88a61b6c253' AND pmjay_program_id IS NULL;  -- UHHO26F01004 KISANLAL KAKODIYA 
UPDATE public.patients SET pmjay_program_id = 'MUC6A6FA5' WHERE id = '8118de0d-fec7-44f7-92b5-ab254c448a67' AND pmjay_program_id IS NULL;  -- UHHO26E15003 SHUBHAM VIJAY MENDHEKAR 
UPDATE public.patients SET pmjay_program_id = 'P6QDPM3AU' WHERE id = '32832afa-d68c-483c-9dcc-5216a0506301' AND pmjay_program_id IS NULL;  -- UHHO26B27004 LANKESHWAR MOTGHARE
UPDATE public.patients SET pmjay_program_id = 'PEDWMV40S' WHERE id = '7a7f9089-44ad-4f4a-b115-98a798a37f38' AND pmjay_program_id IS NULL;  -- UHHO26C06009 NITIN YADAV
UPDATE public.patients SET pmjay_program_id = 'MGO2P01J5' WHERE id = 'ea55d38b-de5b-4312-bd0c-09fe2d0e99d2' AND pmjay_program_id IS NULL;  -- UHHO26E27002 KARTIK PILLARE 
UPDATE public.patients SET pmjay_program_id = 'P4PJPF6TX' WHERE id = '6c080713-3605-4804-9cd9-6a468302bf94' AND pmjay_program_id IS NULL;  -- UHHO26G03017 chtur singh
UPDATE public.patients SET pmjay_program_id = 'PMDF7ERW6' WHERE id = 'b307da5c-14d9-45ad-8715-7e9c31d0219e' AND pmjay_program_id IS NULL;  -- UHHO26F11001 DARSHAN VINAYAK MESHRAM
UPDATE public.patients SET pmjay_program_id = 'PYR78VYBM' WHERE id = '025a8c70-0ad6-4c07-b58f-7e42e6e7dadb' AND pmjay_program_id IS NULL;  -- UHHO26G09013 SADHANA BAIS
UPDATE public.patients SET pmjay_program_id = 'PGF5LDIRT' WHERE id = '84e6bf25-4bc3-407e-9d0f-f3cabc022b43' AND pmjay_program_id IS NULL;  -- UHHO26C07007 AMRITLAL CHAUDHARI
UPDATE public.patients SET pmjay_program_id = 'MH7QBZRYS' WHERE id = 'd53b11ea-e2e1-414f-911d-7a81b8b08473' AND pmjay_program_id IS NULL;  -- UHHO26G18002 PAYAL PRASHANT JAMBHULKAR 
UPDATE public.patients SET pmjay_program_id = 'MJO3R6N4S' WHERE id = '1a46d1d4-9b99-4594-8d1f-0e09aa879577' AND pmjay_program_id IS NULL;  -- UHHO26E13003 AHILYA PANDURANG MANGARULE
UPDATE public.patients SET pmjay_program_id = 'PA3O72GTN' WHERE id = '5fcc3e35-d508-423a-87a0-c9a135803f59' AND pmjay_program_id IS NULL;  -- UHHO26G03015 Geeta Sitaram Aambadare
UPDATE public.patients SET pmjay_program_id = 'PWZOMBX5G' WHERE id = '4a479522-3650-4204-916b-b2dbf30f524a' AND pmjay_program_id IS NULL;  -- UHHO26G30007 SHALINI KHANGAR 
UPDATE public.patients SET pmjay_program_id = 'PTK23KO39' WHERE id = '354a7735-2a68-4b13-a33c-d8b52c8de2b7' AND pmjay_program_id IS NULL;  -- UHHO25L10002 Nikita Kurmi
UPDATE public.patients SET pmjay_program_id = 'P4DQ1LFVG' WHERE id = '260e7554-ea85-4862-b044-9cc2f788590f' AND pmjay_program_id IS NULL;  -- UHHO26G03036 Basanti Sahu
UPDATE public.patients SET pmjay_program_id = 'MLXG8ZJG7' WHERE id = '4ff5ab29-e67a-418f-a26d-30c3dc94bff6' AND pmjay_program_id IS NULL;  -- UHHO26F15006 BITATI BAI 
UPDATE public.patients SET pmjay_program_id = 'P4VD84NRS' WHERE id = '13a68197-52a1-417b-a39d-cb3a79bbd6ea' AND pmjay_program_id IS NULL;  -- UHHO26F22004 MOHAMMAD HASIM MOHAMMAD SULEMAN
UPDATE public.patients SET pmjay_program_id = 'MTNIPRN0U' WHERE id = '0665e414-fda5-49c2-a85d-e49378545ba6' AND pmjay_program_id IS NULL;  -- UHHO26G03020 Aaditi yogesh chute
UPDATE public.patients SET pmjay_program_id = 'PD5B7JUXQ' WHERE id = '8323f51d-c4c0-4bf5-84c9-bb4dc22fd865' AND pmjay_program_id IS NULL;  -- UHHO26G03024 Indar
-- ══ B. Placeholder surgery fees become "not set" ═════════════════════════
-- The exact seeded pair only; the 143 rates decided on 4-Aug are untouched.
UPDATE public.surgery_fee_master
   SET panel_rate = NULL, private_rate = NULL
 WHERE panel_rate = 5000 AND private_rate = 8000;

-- Every remaining private_rate of exactly 8,000 is the same seed value that
-- was never decided — a private patient must not be billed a placeholder.
UPDATE public.surgery_fee_master
   SET private_rate = NULL
 WHERE private_rate = 8000;

-- Stop the seed from coming back on new rows.
ALTER TABLE public.surgery_fee_master ALTER COLUMN panel_rate DROP DEFAULT;
ALTER TABLE public.surgery_fee_master ALTER COLUMN private_rate DROP DEFAULT;

-- ══ What this leaves ═════════════════════════════════════════════════════
SELECT 'patients with a PMJAY program id' AS metric, count(*)::TEXT AS value
  FROM public.patients WHERE pmjay_program_id IS NOT NULL
UNION ALL
SELECT 'surgeries with a panel fee set', count(*)::TEXT
  FROM public.surgery_fee_master WHERE panel_rate IS NOT NULL
UNION ALL
SELECT 'surgeries still unpriced', count(*)::TEXT
  FROM public.surgery_fee_master WHERE panel_rate IS NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;
