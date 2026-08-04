-- Tally cutover opening balances, applied from Ruby's 4-Aug exports.
--
-- Three Tally ledger-master exports (each a perfectly balanced trial,
-- convention: positive = Cr) are the book of record for the 25-Jul-2026
-- cutover. Study findings:
--   • ALL LEDGER.json  = DRM Hope — already matches Adamrit (1,128/1,130
--     non-zero ledgers exact). Only fix: Tally keeps TDS Receivable
--     AY 23-24 and FY 23-24 as SEPARATE ledgers; the 4-Aug merge is undone.
--   • ayushman (1).json — Adamrit's Ayushman openings were systematically
--     sign-flipped by the original import (assets as Cr, etc.): 468 ledgers
--     replaced with the file's values, 2 missing ledgers created.
--   • pharmacy (1).json — same flip on a small chart: 20 replaced, 1 created.
--   • Hope Hospitals (legacy partnership): no export — untouched, per Ruby.
--
-- Every current opening is snapshotted into opening_balance_backup_20260804
-- before anything changes (first run only), so this is fully reversible.
-- The final SELECT proves each company's openings sum to zero.
--
-- Run in the Supabase dashboard SQL Editor. Safe to run twice.

BEGIN;

CREATE TABLE IF NOT EXISTS public.opening_balance_backup_20260804 AS
SELECT id, account_code, account_name, company_id, opening_balance,
       opening_balance_type, now() AS backed_up_at
  FROM public.chart_of_accounts
 WHERE false;

INSERT INTO public.opening_balance_backup_20260804
SELECT id, account_code, account_name, company_id, opening_balance,
       opening_balance_type, now()
  FROM public.chart_of_accounts
 WHERE NOT EXISTS (SELECT 1 FROM public.opening_balance_backup_20260804);

-- ===== DRM HOPE: restore the TDS AY / FY split (Tally keeps them separate) =====
UPDATE public.chart_of_accounts
   SET opening_balance = 1705180.51, opening_balance_type = 'DR'
 WHERE id = '3cbfe8c1-c4e5-48bb-8f17-d557648d027f';  -- Tds Receivable AY 23-24

UPDATE public.chart_of_accounts
   SET account_name = 'Tds Receivable F Y 23-24', is_active = true,
       opening_balance = 3940253.00, opening_balance_type = 'DR'
 WHERE id = '4461fecc-b862-43a3-b1d0-27f3fd74d8b6';  -- reactivate the merged stub

-- ===== AYUSHMAN =====
UPDATE public.chart_of_accounts SET opening_balance=23009336.79, opening_balance_type='CR' WHERE id='b51dd857-d270-4d62-90b2-fa8b8c836754';  -- Profit & Loss A/c
UPDATE public.chart_of_accounts SET opening_balance=500.00, opening_balance_type='DR' WHERE id='d39dae60-0cef-4f2a-86c7-48e74bc023ee';  -- Aarav Enterprises
UPDATE public.chart_of_accounts SET opening_balance=176444.00, opening_balance_type='DR' WHERE id='7ec731da-17fe-4427-8ab5-d4ad85117f2d';  -- Aarti Dudhbale (Sister)
UPDATE public.chart_of_accounts SET opening_balance=11333.00, opening_balance_type='DR' WHERE id='66eba29c-7715-498a-a33a-da19124d87f4';  -- AARTI TELANGE
UPDATE public.chart_of_accounts SET opening_balance=500.00, opening_balance_type='DR' WHERE id='d598b5bd-15f7-411a-bce0-1a255cfbe2aa';  -- ABAB KHAN
UPDATE public.chart_of_accounts SET opening_balance=500.00, opening_balance_type='DR' WHERE id='67acaf2c-3fdb-4c5a-a828-f5e039806e35';  -- Abbubakar Khan
UPDATE public.chart_of_accounts SET opening_balance=91700.00, opening_balance_type='DR' WHERE id='0093fe68-2d4e-4941-a8b4-22340ac5649a';  -- ABHI INFOTECH
UPDATE public.chart_of_accounts SET opening_balance=7500.00, opening_balance_type='DR' WHERE id='2901ba8c-15ef-4ac1-910f-eb7bf28abb00';  -- Abhishekh Dannar
UPDATE public.chart_of_accounts SET opening_balance=31000.00, opening_balance_type='DR' WHERE id='a8dfaaa9-bee8-4511-8c11-94059d8992de';  -- Abubakar Brother
UPDATE public.chart_of_accounts SET opening_balance=9167.00, opening_balance_type='DR' WHERE id='d54b34fe-7d8f-4d09-ab46-b1fc0a2f37c4';  -- Aditya Sharma
UPDATE public.chart_of_accounts SET opening_balance=15000.00, opening_balance_type='CR' WHERE id='af5fb87d-120d-47e4-b6c5-9e1c75a1321c';  -- Agast Sarote UAHO25J12002
UPDATE public.chart_of_accounts SET opening_balance=58956.00, opening_balance_type='DR' WHERE id='f46e18e7-2471-4e8b-b898-f9fd1a4ad00c';  -- Air Conditioner (AC)
UPDATE public.chart_of_accounts SET opening_balance=2900.00, opening_balance_type='DR' WHERE id='37ce6907-ee47-49b5-a79b-05d53bd6605e';  -- AJAY MESHRAM
UPDATE public.chart_of_accounts SET opening_balance=5611.00, opening_balance_type='DR' WHERE id='997a8fd7-37ae-4a68-8be5-c6602200d249';  -- Akash Ramteke (Brother)
UPDATE public.chart_of_accounts SET opening_balance=95708.60, opening_balance_type='CR' WHERE id='3da6ebb3-20b2-4a84-98a6-75e4371d4eca';  -- AKMC Lab
UPDATE public.chart_of_accounts SET opening_balance=234567.00, opening_balance_type='DR' WHERE id='1d871885-5864-4008-b60e-496c4d713658';  -- Akshay Barapatre
UPDATE public.chart_of_accounts SET opening_balance=2000.00, opening_balance_type='DR' WHERE id='fb9a608c-8f8e-4e7a-8b7f-f3cc6d3fa36d';  -- Akshay Meshram (Brother)
UPDATE public.chart_of_accounts SET opening_balance=67200.00, opening_balance_type='DR' WHERE id='66e86e60-f82b-4973-a50a-b6147dcf3123';  -- Allengers Medical System Ltd
UPDATE public.chart_of_accounts SET opening_balance=37000.00, opening_balance_type='DR' WHERE id='991b9537-28bc-4600-b24a-970ba4151ceb';  -- AMAN BLOOD CENTER NAGPUR
UPDATE public.chart_of_accounts SET opening_balance=114000.00, opening_balance_type='DR' WHERE id='2e09f1e2-a0fb-46d5-850a-174d4ae24006';  -- Aman Rajak
UPDATE public.chart_of_accounts SET opening_balance=280550.00, opening_balance_type='DR' WHERE id='144abbee-af9a-48ab-a7f8-7455310a3399';  -- Amapath Pathalogy
UPDATE public.chart_of_accounts SET opening_balance=27460.00, opening_balance_type='DR' WHERE id='9308e194-da98-4071-ad36-5cb2e160eb68';  -- American Oncology
UPDATE public.chart_of_accounts SET opening_balance=48099.00, opening_balance_type='DR' WHERE id='e8dcc458-6543-4b47-960b-282270bcd5ed';  -- Amisha Patale
UPDATE public.chart_of_accounts SET opening_balance=10800.00, opening_balance_type='DR' WHERE id='82b737c9-433b-44b9-ad37-c128cd1d2d8b';  -- Amit Bagde (Wardboy)
UPDATE public.chart_of_accounts SET opening_balance=6120.00, opening_balance_type='DR' WHERE id='f384a2da-44af-4482-899f-c8c963153842';  -- Anand Sales
UPDATE public.chart_of_accounts SET opening_balance=8300.00, opening_balance_type='CR' WHERE id='d06dd922-7bb2-4b00-b5eb-d78020f33b87';  -- Anil Vaidhya
UPDATE public.chart_of_accounts SET opening_balance=3000.00, opening_balance_type='DR' WHERE id='c97530b9-7982-4277-8539-e0e902430c39';  -- ANIRUP COMPUTER
UPDATE public.chart_of_accounts SET opening_balance=215416.00, opening_balance_type='CR' WHERE id='c8d0deef-3fc1-404a-b4af-53df6caf6f98';  -- Ankit Hardware and Plywood
UPDATE public.chart_of_accounts SET opening_balance=50000.00, opening_balance_type='DR' WHERE id='00517d94-f6bb-4946-98d3-459ce2b9f6a9';  -- ANORA MURALI
UPDATE public.chart_of_accounts SET opening_balance=29610.00, opening_balance_type='DR' WHERE id='2f4ade5e-64f2-44a6-9585-8076e3a25a16';  -- AQUA FRESH WATER
UPDATE public.chart_of_accounts SET opening_balance=44800.00, opening_balance_type='DR' WHERE id='17636230-9cf4-49fb-86a6-523aaa781770';  -- Archana Fulzale
UPDATE public.chart_of_accounts SET opening_balance=45478.00, opening_balance_type='DR' WHERE id='e9247a0b-5ac2-4703-a444-c01dd3bae4ef';  -- Archana Meshram (Sis)
UPDATE public.chart_of_accounts SET opening_balance=382417.00, opening_balance_type='DR' WHERE id='ee55d50b-003c-463b-8910-20533fe7699f';  -- Arpit Kinarkar
UPDATE public.chart_of_accounts SET opening_balance=15000.00, opening_balance_type='DR' WHERE id='037716a9-fdb0-4e42-845d-ab99b28e549e';  -- Arun Agre
UPDATE public.chart_of_accounts SET opening_balance=61500.00, opening_balance_type='DR' WHERE id='2481d2f9-eb28-4e53-8842-a27421cd1661';  -- Arvind Invate
UPDATE public.chart_of_accounts SET opening_balance=70800.00, opening_balance_type='DR' WHERE id='830189db-0b59-4a48-b28b-fce1c911b132';  -- Arvind Technician
UPDATE public.chart_of_accounts SET opening_balance=73345.00, opening_balance_type='DR' WHERE id='bef8a0a6-d9a3-42e3-9a06-a081701a0b5e';  -- Arya Bouncer Seacurity
UPDATE public.chart_of_accounts SET opening_balance=15000.00, opening_balance_type='DR' WHERE id='77011c18-f4c4-482a-bcde-d778d54d85a5';  -- ASHIF SHEIKH [ AUTO ]
UPDATE public.chart_of_accounts SET opening_balance=129650.00, opening_balance_type='DR' WHERE id='d3d10f4c-54fa-4dd4-bf6e-1a404f6be66b';  -- Ashish Dubey
UPDATE public.chart_of_accounts SET opening_balance=10080.00, opening_balance_type='CR' WHERE id='2765e7d6-12f7-465a-85f1-9da0275f3a5a';  -- Ashish Surgi Pharma
UPDATE public.chart_of_accounts SET opening_balance=36200.00, opening_balance_type='CR' WHERE id='9fcc6a4c-8622-476f-aaee-76c7c7ae85e5';  -- ASHOK YEPURE ( RENT )
UPDATE public.chart_of_accounts SET opening_balance=10000.00, opening_balance_type='DR' WHERE id='4ce70872-6273-416d-866e-7745c9db4879';  -- Ashvini Burade
UPDATE public.chart_of_accounts SET opening_balance=94327.00, opening_balance_type='DR' WHERE id='13799952-c223-4c6f-8e9a-df2f0df94934';  -- Asian Surgical
UPDATE public.chart_of_accounts SET opening_balance=14500.00, opening_balance_type='CR' WHERE id='a5404f4e-0588-428f-932b-714e450ba5c8';  -- A S SURGICAL & DEVICES
UPDATE public.chart_of_accounts SET opening_balance=53025.00, opening_balance_type='DR' WHERE id='58ce2d3d-509e-4232-93b0-4bb392ac6ecd';  -- Atul Dhurve
UPDATE public.chart_of_accounts SET opening_balance=140833.00, opening_balance_type='DR' WHERE id='0c2cd6a8-7aa6-44dc-b76e-b6cbe90c8d0a';  -- Atul Raut
UPDATE public.chart_of_accounts SET opening_balance=3200.00, opening_balance_type='DR' WHERE id='dd00c9d0-f92d-4cf9-a69b-f71db7133d1b';  -- AYUSH BLOOD CENTER
UPDATE public.chart_of_accounts SET opening_balance=114467.00, opening_balance_type='DR' WHERE id='7b7df4a4-547c-49d6-8d70-32e99e6d97bc';  -- Ayushman Pharmacy
UPDATE public.chart_of_accounts SET opening_balance=26800.00, opening_balance_type='DR' WHERE id='7308b7c6-acef-4f76-b2cd-db659bddfbea';  -- Azhar Khan (Receiption)
UPDATE public.chart_of_accounts SET opening_balance=152000.00, opening_balance_type='DR' WHERE id='1e55a1f7-3a6a-4aca-bfbd-8a7aa4d46432';  -- Azhar Sheikh (Electrician)
UPDATE public.chart_of_accounts SET opening_balance=4468.00, opening_balance_type='DR' WHERE id='0cbed1d1-ec09-4b17-8a63-fe5d6282e51d';  -- Baba Sai Metal Mart
UPDATE public.chart_of_accounts SET opening_balance=5000.00, opening_balance_type='DR' WHERE id='25acf74b-0719-44b1-a0d0-3c6ae141ac8e';  -- Balaji Enterprises
UPDATE public.chart_of_accounts SET opening_balance=25439.00, opening_balance_type='CR' WHERE id='52e96e96-36e4-401b-93ee-cd4774c23560';  -- Bhagwat and Sons
UPDATE public.chart_of_accounts SET opening_balance=29983.00, opening_balance_type='DR' WHERE id='92a002c2-d5c0-4b52-9f39-202485d39560';  -- Bharati Thakare
UPDATE public.chart_of_accounts SET opening_balance=5218.00, opening_balance_type='DR' WHERE id='3f5fd428-561e-432c-99d3-fece6b86b774';  -- Bharat Medical System
UPDATE public.chart_of_accounts SET opening_balance=6000.00, opening_balance_type='DR' WHERE id='b45c6769-7742-4840-b583-8b4f674f2102';  -- Bhawani Multispeciality Hospital
UPDATE public.chart_of_accounts SET opening_balance=58341.87, opening_balance_type='DR' WHERE id='b7a1ba6c-fb88-4daa-bdc9-1994d34885dd';  -- Biochemistry Analyzer
UPDATE public.chart_of_accounts SET opening_balance=2425.62, opening_balance_type='DR' WHERE id='b309f583-799f-4ebe-880f-6f5eb073ff6b';  -- Biomax N-K30
UPDATE public.chart_of_accounts SET opening_balance=344886.92, opening_balance_type='DR' WHERE id='7ea87712-c4e2-4ca4-992f-6ddbed1fc94e';  -- Biopath Diagnostics Center
UPDATE public.chart_of_accounts SET opening_balance=1919200.00, opening_balance_type='DR' WHERE id='fde11c4d-5f54-4495-9271-6126edfb4884';  -- Biviji MRI AND CT
UPDATE public.chart_of_accounts SET opening_balance=32800.06, opening_balance_type='CR' WHERE id='93f92e25-d66a-4c27-874c-7d866802e4f8';  -- BRAVURA MEDIA
UPDATE public.chart_of_accounts SET opening_balance=14000.00, opening_balance_type='DR' WHERE id='70a812d8-12d0-40d5-9106-571e8b12a256';  -- CA  NIKHIL RATHI
UPDATE public.chart_of_accounts SET opening_balance=43000.00, opening_balance_type='DR' WHERE id='25cfb3d0-ad95-4774-8983-ccc28ecd495d';  -- CASA ROYAL
UPDATE public.chart_of_accounts SET opening_balance=5185800.00, opening_balance_type='DR' WHERE id='94f01917-62e3-4eae-bc7b-0d32a9386ea6';  -- Cash
UPDATE public.chart_of_accounts SET opening_balance=60207.00, opening_balance_type='DR' WHERE id='f18b869f-bd26-4c91-b884-2f4cf684022b';  -- Centre Point Hotel
UPDATE public.chart_of_accounts SET opening_balance=2700.00, opening_balance_type='DR' WHERE id='8c24fd53-7d1b-4c0c-8248-38dd7dd7566e';  -- Chandra Enterpeises 25-26
UPDATE public.chart_of_accounts SET opening_balance=171833.00, opening_balance_type='DR' WHERE id='ce9d1831-879c-43fb-b02c-c3b4361150c7';  -- Chetana Kurvanshi
UPDATE public.chart_of_accounts SET opening_balance=240000.00, opening_balance_type='CR' WHERE id='364a38ff-21f6-436a-b9d9-a399ffbd73f2';  -- CM Fund
UPDATE public.chart_of_accounts SET opening_balance=38786.40, opening_balance_type='DR' WHERE id='b63fb902-e5d2-4e0c-992c-d975bbe04b0f';  -- Computer & Laptop
UPDATE public.chart_of_accounts SET opening_balance=29500.00, opening_balance_type='DR' WHERE id='4e2c0964-3d45-4964-b3d3-e5ff7f4e12d3';  -- COOLER
UPDATE public.chart_of_accounts SET opening_balance=6100.00, opening_balance_type='DR' WHERE id='8c9e6f97-4c00-4c37-91d4-e52b830df930';  -- C P Computer
UPDATE public.chart_of_accounts SET opening_balance=44250.00, opening_balance_type='DR' WHERE id='4af7d4a3-a1b8-4a74-90f8-0b3af1fd706c';  -- CRASH CARD
UPDATE public.chart_of_accounts SET opening_balance=71750.00, opening_balance_type='DR' WHERE id='7f88a832-f039-4d5d-ad49-5aec209edf46';  -- Deepak Khandate (Technician)
UPDATE public.chart_of_accounts SET opening_balance=2667.00, opening_balance_type='CR' WHERE id='2c0f0532-d921-4746-8a7c-8c601845855f';  -- Deepali Gajbhiye
UPDATE public.chart_of_accounts SET opening_balance=16707.81, opening_balance_type='DR' WHERE id='f3571dd7-ac1e-44c9-984e-9b6b6241f678';  -- Dental Machine
UPDATE public.chart_of_accounts SET opening_balance=54172.00, opening_balance_type='DR' WHERE id='babb4d15-f6d0-47d6-b716-f6d91d92ed2a';  -- Devendra Yadav
UPDATE public.chart_of_accounts SET opening_balance=189194.10, opening_balance_type='DR' WHERE id='821442a0-c982-4f82-a4eb-a7f26ee2fe21';  -- Devil 6155 Bapap with Accessories
UPDATE public.chart_of_accounts SET opening_balance=35000.00, opening_balance_type='DR' WHERE id='7bdf5198-bada-412a-9967-4eb49b764ff0';  -- Dhruti Enterprises
UPDATE public.chart_of_accounts SET opening_balance=18600.00, opening_balance_type='DR' WHERE id='5198f53b-132a-4e1c-b4c7-1f5efe322883';  -- Dhyneshwar Waghmare
UPDATE public.chart_of_accounts SET opening_balance=59833.00, opening_balance_type='DR' WHERE id='fb0fd7a3-e4bd-43de-8f3e-e86f348cd3d8';  -- Diksha Chauhan
UPDATE public.chart_of_accounts SET opening_balance=17230.00, opening_balance_type='CR' WHERE id='17b22542-4168-4485-b69d-4f2d01116971';  -- Dilip Security
UPDATE public.chart_of_accounts SET opening_balance=13500.00, opening_balance_type='DR' WHERE id='7f73ee70-6ef5-44de-a0fd-5a5f63ef43b3';  -- Dinesh Madhukar Tawade
UPDATE public.chart_of_accounts SET opening_balance=47666.00, opening_balance_type='DR' WHERE id='1fac6793-18fb-469d-8035-da9852955928';  -- Divya Maushi
UPDATE public.chart_of_accounts SET opening_balance=32151.00, opening_balance_type='DR' WHERE id='d7308341-c61f-410e-8287-67d23a34959c';  -- D K STATIONERY
UPDATE public.chart_of_accounts SET opening_balance=162000.00, opening_balance_type='DR' WHERE id='ac8fa502-c3fb-4a70-b22d-d01a59463474';  -- Dnyaneshwar Warghane
UPDATE public.chart_of_accounts SET opening_balance=67700.00, opening_balance_type='DR' WHERE id='ecf2609f-e98f-46d3-8602-efc35281faa3';  -- DR. ABHISEKH SAMBHARE
UPDATE public.chart_of_accounts SET opening_balance=2500.00, opening_balance_type='CR' WHERE id='a31e49bf-798d-44f8-a4b8-45eefce91d36';  -- DR. ADITYA RAUT
UPDATE public.chart_of_accounts SET opening_balance=276000.00, opening_balance_type='DR' WHERE id='a9fcc286-8373-40d9-ba51-a00a01462516';  -- DR. Afzal Sheikh
UPDATE public.chart_of_accounts SET opening_balance=6600.00, opening_balance_type='CR' WHERE id='01abbeab-37b2-4cf5-8b25-6e813c045866';  -- DR. AISHWARYA KHADATKAR
UPDATE public.chart_of_accounts SET opening_balance=20000.00, opening_balance_type='DR' WHERE id='1f4ee536-1350-4d29-99b7-38bdac91b1c6';  -- DR. AKSHAY AKULWAR
UPDATE public.chart_of_accounts SET opening_balance=206850.00, opening_balance_type='DR' WHERE id='eb978ff9-6ca2-40f0-b038-f7b208d0e111';  -- Dr. Akshay Dalal
UPDATE public.chart_of_accounts SET opening_balance=5000.00, opening_balance_type='DR' WHERE id='64dedb0a-a5d7-489d-853c-c4653c9f1178';  -- Dr. Amit Saoji
UPDATE public.chart_of_accounts SET opening_balance=180550.00, opening_balance_type='DR' WHERE id='6e558c44-1b12-4a9e-ae94-22a808a3f466';  -- Dr. Amodh Chaoursiya
UPDATE public.chart_of_accounts SET opening_balance=9950.00, opening_balance_type='CR' WHERE id='dda017e4-ff4a-43c9-b125-69e0a06a6784';  -- Dr. Amol Raghuwanshi
UPDATE public.chart_of_accounts SET opening_balance=5000.00, opening_balance_type='DR' WHERE id='fb3f9d28-7a35-4969-88d4-5771f6ce9ea7';  -- DR. ANIL BAJAJ
UPDATE public.chart_of_accounts SET opening_balance=686000.00, opening_balance_type='DR' WHERE id='f0745b84-72f6-476d-8513-909a3d5a2df8';  -- Dr. Ankit Daware
UPDATE public.chart_of_accounts SET opening_balance=3000.00, opening_balance_type='DR' WHERE id='cdd2ec3a-ad01-4f9d-aa95-0a8c8783bb12';  -- Dr. Ankit Panjwani [ NEWROLOGISIT ]
UPDATE public.chart_of_accounts SET opening_balance=24650.00, opening_balance_type='DR' WHERE id='414d2ae2-3806-4938-b691-c77617d83fc3';  -- Dr. Arpit Dhakate
UPDATE public.chart_of_accounts SET opening_balance=1000.00, opening_balance_type='DR' WHERE id='df5da6e5-e794-47f6-a91f-9274ef35a0a9';  -- DR ASHWARYA
UPDATE public.chart_of_accounts SET opening_balance=12000.00, opening_balance_type='CR' WHERE id='eedaf70b-b835-4554-be52-2eb4ba917b8a';  -- Dr. Asif Sheikh
UPDATE public.chart_of_accounts SET opening_balance=500.00, opening_balance_type='DR' WHERE id='3011702a-bce4-4c4b-af55-732073b291ae';  -- Dr. Asrani Mam
UPDATE public.chart_of_accounts SET opening_balance=21200.00, opening_balance_type='CR' WHERE id='6950824e-4b4f-4743-a4fa-dfa46a60e247';  -- Dr. Atul Katkar
UPDATE public.chart_of_accounts SET opening_balance=236500.00, opening_balance_type='CR' WHERE id='cea2d192-c4cf-4d88-b463-40b7fd743f19';  -- Dr. Atul Rajkondawar
UPDATE public.chart_of_accounts SET opening_balance=500.00, opening_balance_type='DR' WHERE id='af825b0e-ab26-4296-9500-d6f12e3688b1';  -- Dr. Barkha (Dentel)
UPDATE public.chart_of_accounts SET opening_balance=3063324.66, opening_balance_type='DR' WHERE id='675c3a5f-4532-4544-8c14-ac102828a95d';  -- Dr. B K Murali
UPDATE public.chart_of_accounts SET opening_balance=282000.00, opening_balance_type='DR' WHERE id='4841502d-78e8-4a7f-9b46-37ef5677016f';  -- Dr. B K Murali (Ortho)
UPDATE public.chart_of_accounts SET opening_balance=56700.00, opening_balance_type='DR' WHERE id='940e65ae-f631-4151-82ae-54a3654a32ab';  -- Dr. Chirag Patil
UPDATE public.chart_of_accounts SET opening_balance=15000.00, opening_balance_type='DR' WHERE id='5cf413f1-883c-4379-a9fe-b88529972048';  -- Dr. Daksh
UPDATE public.chart_of_accounts SET opening_balance=1000.00, opening_balance_type='DR' WHERE id='072862e5-0bfd-45b5-9234-201d800897dd';  -- DR DAKSH KEDIA
UPDATE public.chart_of_accounts SET opening_balance=800.00, opening_balance_type='DR' WHERE id='5152293e-86ef-4cf0-9289-3de9f3a74280';  -- DR. DEEPAK JAIN
UPDATE public.chart_of_accounts SET opening_balance=704200.00, opening_balance_type='DR' WHERE id='38f3db56-70da-428b-b2cf-a053066bddc7';  -- Dr. Dhiraj Gupta
UPDATE public.chart_of_accounts SET opening_balance=544000.00, opening_balance_type='DR' WHERE id='8bb66e92-7ff7-49f9-a793-f7b03eb6af17';  -- Dr. Dinesh Sharma
UPDATE public.chart_of_accounts SET opening_balance=15000.00, opening_balance_type='DR' WHERE id='4440b662-97e8-47f9-96ed-ca4b1cd615d5';  -- Dr. Dipti Kawade
UPDATE public.chart_of_accounts SET opening_balance=7900.00, opening_balance_type='DR' WHERE id='de76c018-c59c-4504-8bf4-3b46301c9783';  -- Dr. Gajendra Pounikar
UPDATE public.chart_of_accounts SET opening_balance=16000.00, opening_balance_type='DR' WHERE id='92435d67-bcd2-4e15-9d5e-aab08848b31f';  -- Dr. Ghanshyam Chude
UPDATE public.chart_of_accounts SET opening_balance=16100.00, opening_balance_type='DR' WHERE id='622384fb-d80e-45e0-b220-4bb6cd86c8f4';  -- Dr. Harsh Jain
UPDATE public.chart_of_accounts SET opening_balance=53465.00, opening_balance_type='DR' WHERE id='5f3e3001-62da-46e6-a2ed-56fb225d846b';  -- Drill Machine
UPDATE public.chart_of_accounts SET opening_balance=500.00, opening_balance_type='DR' WHERE id='6cfb14e9-f048-48ca-abab-e8e6c89d7f95';  -- Dr. Jaideep Dalavi
UPDATE public.chart_of_accounts SET opening_balance=711900.00, opening_balance_type='DR' WHERE id='13fddbb5-f933-4c20-a4e3-b0f9555691b5';  -- Dr. Javed Khan
UPDATE public.chart_of_accounts SET opening_balance=90900.00, opening_balance_type='DR' WHERE id='da9038e9-9ae9-44dc-9310-1ff1116ca038';  -- Dr. Jayant Nikose
UPDATE public.chart_of_accounts SET opening_balance=148500.00, opening_balance_type='DR' WHERE id='657de883-bbcc-4d16-9dd8-d9c87a534771';  -- Dr. Jiwan Kinkar
UPDATE public.chart_of_accounts SET opening_balance=28800.00, opening_balance_type='DR' WHERE id='23dafd69-5159-44e1-bd73-1c491d7abb5f';  -- Dr. Kailash Agrawal
UPDATE public.chart_of_accounts SET opening_balance=1500.00, opening_balance_type='DR' WHERE id='fc949578-04da-42b8-bd99-37ef870fdbd5';  -- Dr. Kapil Raut(Oncologist)
UPDATE public.chart_of_accounts SET opening_balance=1000.00, opening_balance_type='DR' WHERE id='53628807-acf2-4198-953b-186ca8814948';  -- Dr. Ketan Modak
UPDATE public.chart_of_accounts SET opening_balance=123310.00, opening_balance_type='DR' WHERE id='efdcc955-e194-4287-852f-9773cf855097';  -- Dr. Kunal Chattani
UPDATE public.chart_of_accounts SET opening_balance=7200.00, opening_balance_type='DR' WHERE id='839df300-1896-49a3-b728-8a233edb347b';  -- Dr. Manish Agrawal
UPDATE public.chart_of_accounts SET opening_balance=109500.00, opening_balance_type='DR' WHERE id='af9ffe16-748a-43bb-80dd-b98408c8ed76';  -- Dr. Manish Kalambe
UPDATE public.chart_of_accounts SET opening_balance=500.00, opening_balance_type='CR' WHERE id='574f0486-ff75-4b57-919d-28014ca796db';  -- Dr. Mayur Gawande
UPDATE public.chart_of_accounts SET opening_balance=12891338.00, opening_balance_type='CR' WHERE id='cacd5954-096a-43ec-97a1-0402c8aab598';  -- Drm Hope Hospital Pvt Ltd
UPDATE public.chart_of_accounts SET opening_balance=1000.00, opening_balance_type='DR' WHERE id='3acab67d-882e-444f-8c53-d800ba7b19ea';  -- DR. MILIND CHANGOLE
UPDATE public.chart_of_accounts SET opening_balance=45450.00, opening_balance_type='DR' WHERE id='0944d2e8-9037-4217-8fe5-3c508b81f5a0';  -- Dr. Milind Dhakate
UPDATE public.chart_of_accounts SET opening_balance=255500.00, opening_balance_type='DR' WHERE id='101a87a9-a6c9-4d87-b860-04396907015a';  -- Dr. Mona Basantwani
UPDATE public.chart_of_accounts SET opening_balance=92000.00, opening_balance_type='DR' WHERE id='0b424782-8a12-4e6f-a8e6-ce62f958765c';  -- DR. MUDHSIR ESIC[GENRAL SURGEN ]
UPDATE public.chart_of_accounts SET opening_balance=3000.00, opening_balance_type='DR' WHERE id='813772d8-9d27-4777-ac7a-ad7e719eaaef';  -- Dr. Narendra Anesthetic
UPDATE public.chart_of_accounts SET opening_balance=4000.00, opening_balance_type='DR' WHERE id='52c803a6-a065-4aa4-8561-592bce1b2262';  -- Dr. Naziya Khan (Ent)
UPDATE public.chart_of_accounts SET opening_balance=10000.00, opening_balance_type='DR' WHERE id='93486cfc-6fb8-4f81-b33e-7b5f3591cc0f';  -- Dr. Neha Nakade
UPDATE public.chart_of_accounts SET opening_balance=1647450.00, opening_balance_type='DR' WHERE id='4080c8b5-ee26-4a75-b1cf-51783a9550b4';  -- Dr. Nikhil Khobragde
UPDATE public.chart_of_accounts SET opening_balance=9000.00, opening_balance_type='CR' WHERE id='c182586d-39fc-4202-8bee-fbe704114938';  -- Dr. Nikhil Lakhade
UPDATE public.chart_of_accounts SET opening_balance=1200.00, opening_balance_type='DR' WHERE id='0e4abb56-ef78-4540-abc9-bc5bc1646236';  -- Dr. Nikita Gupta
UPDATE public.chart_of_accounts SET opening_balance=28500.00, opening_balance_type='DR' WHERE id='900a2c0a-bceb-4925-b865-703ce532764c';  -- Dr. Nimisha Mrinal
UPDATE public.chart_of_accounts SET opening_balance=500.00, opening_balance_type='DR' WHERE id='ca733d91-26ea-48e5-9ed6-ca217848d1e9';  -- Dr. Nita Walde
UPDATE public.chart_of_accounts SET opening_balance=325200.00, opening_balance_type='DR' WHERE id='c1a25af1-65bc-45b5-bd86-527e7df538b3';  -- Dr. Nitin Arikar
UPDATE public.chart_of_accounts SET opening_balance=1500.00, opening_balance_type='DR' WHERE id='e17e69a6-148a-4db4-b6d2-1c6a1bad4801';  -- Dr Parag Masram
UPDATE public.chart_of_accounts SET opening_balance=11000.00, opening_balance_type='CR' WHERE id='f9d4a766-490f-4464-a2e5-64f4bcb3a81e';  -- Dr. Pooja Gandhi
UPDATE public.chart_of_accounts SET opening_balance=26300.00, opening_balance_type='DR' WHERE id='a2179c8c-1987-45b2-8d08-7fbcc5a9124a';  -- Dr. Prakash Sonkusare
UPDATE public.chart_of_accounts SET opening_balance=21600.00, opening_balance_type='DR' WHERE id='12b77e79-d34f-4e45-a3ba-4e82bc80b098';  -- Dr. Pramod Gandhi Endocrinologist
UPDATE public.chart_of_accounts SET opening_balance=699000.00, opening_balance_type='DR' WHERE id='b98eae5d-ab81-43ca-80f5-d72db898bb72';  -- DR. PRANALI GURUKAR
UPDATE public.chart_of_accounts SET opening_balance=1500.00, opening_balance_type='CR' WHERE id='531cf7e3-2731-45e6-b990-5b4e6bda0c74';  -- DR. PRANAM SADWARTE
UPDATE public.chart_of_accounts SET opening_balance=140600.00, opening_balance_type='DR' WHERE id='a7fcae47-e2fe-492f-91b3-e19877cb021d';  -- Dr. Prashik Walde
UPDATE public.chart_of_accounts SET opening_balance=19850.00, opening_balance_type='DR' WHERE id='38c8c011-14b4-449c-a4d2-1cbc0e023572';  -- DR. PRATIK SANGDE [ ANETHISYA
UPDATE public.chart_of_accounts SET opening_balance=291700.00, opening_balance_type='DR' WHERE id='0e22789f-77d7-481d-b1a1-ee31a8bfbe53';  -- Dr. Prayank Meshram
UPDATE public.chart_of_accounts SET opening_balance=9500.00, opening_balance_type='DR' WHERE id='7bdbddc8-d08b-4aac-a0b9-2aaff09573ea';  -- Dr. Priyal Shelkar
UPDATE public.chart_of_accounts SET opening_balance=10100.00, opening_balance_type='CR' WHERE id='f5a61036-df3e-4543-9e35-6416af5410c8';  -- Dr. Radhemohan Yadav
UPDATE public.chart_of_accounts SET opening_balance=7000.00, opening_balance_type='DR' WHERE id='6bd0dd4b-2fea-477d-b0ac-d5eed2e41962';  -- Dr. Rahul Arora(Haematologist)
UPDATE public.chart_of_accounts SET opening_balance=50500.00, opening_balance_type='DR' WHERE id='d3975a2b-63fd-4cfe-8ff6-7de9fdd52f26';  -- Dr. Rahul Pandey
UPDATE public.chart_of_accounts SET opening_balance=12000.00, opening_balance_type='CR' WHERE id='94b2b6ab-f986-4afc-b6a2-3d0351cdd3fb';  -- Dr. Rajat Sahu
UPDATE public.chart_of_accounts SET opening_balance=10000.00, opening_balance_type='DR' WHERE id='5237375e-1f49-4f8a-a4e9-943bc0fb24a6';  -- Dr. Rajesh Diwedi
UPDATE public.chart_of_accounts SET opening_balance=1200.00, opening_balance_type='DR' WHERE id='6034956b-6fe9-4bdf-bd2c-35370fdf31af';  -- Dr. Ramesh Sharma  (Darmtologist)
UPDATE public.chart_of_accounts SET opening_balance=2500.00, opening_balance_type='DR' WHERE id='28e7e061-ac24-4211-8df3-a62aea223ab7';  -- Dr. Rasika Akulwar
UPDATE public.chart_of_accounts SET opening_balance=5000.00, opening_balance_type='DR' WHERE id='b10c52c4-c418-4e80-9014-1950b655091c';  -- Dr Rashika Patil ( Anethetic)
UPDATE public.chart_of_accounts SET opening_balance=500.00, opening_balance_type='CR' WHERE id='28e7e061-ac24-4211-8df3-a62aea223ab7';  -- Dr. Rasika Akulwar
UPDATE public.chart_of_accounts SET opening_balance=14100.00, opening_balance_type='DR' WHERE id='0a252d4c-26b3-4635-abde-5750aabe4f5e';  -- Dr. Ritesh Mate
UPDATE public.chart_of_accounts SET opening_balance=160800.00, opening_balance_type='DR' WHERE id='2e81ea1b-bc0c-4442-a5e3-96a189229a15';  -- Dr. Ritesh Navkhare
UPDATE public.chart_of_accounts SET opening_balance=13100.00, opening_balance_type='DR' WHERE id='26fabfc0-c86d-433c-a3b3-fe256920e9b1';  -- Dr. Ritesh Saturday
UPDATE public.chart_of_accounts SET opening_balance=267000.00, opening_balance_type='DR' WHERE id='07b8fa8f-9267-48b2-a079-c5a617fc3d82';  -- DR. ROHAN SOITKAR
UPDATE public.chart_of_accounts SET opening_balance=222500.00, opening_balance_type='DR' WHERE id='fda892e1-01f8-4ee9-81c1-6f8f65a989b7';  -- Dr. Rohit Asrani
UPDATE public.chart_of_accounts SET opening_balance=12000.00, opening_balance_type='DR' WHERE id='ae9f5845-9e90-459d-ab13-02c56a32ef45';  -- Dr. Rupesh Bhange
UPDATE public.chart_of_accounts SET opening_balance=16000.00, opening_balance_type='DR' WHERE id='ae9f5845-9e90-459d-ab13-02c56a32ef45';  -- Dr. Rupesh Bhange
UPDATE public.chart_of_accounts SET opening_balance=2500.00, opening_balance_type='DR' WHERE id='e4cc89d1-8947-4243-bb83-596475b63f40';  -- DR SABBIR RAJA
UPDATE public.chart_of_accounts SET opening_balance=6600.00, opening_balance_type='DR' WHERE id='a5bed7f2-2615-4c46-93eb-39342bb9b177';  -- Dr. Sachin Gatibandhe
UPDATE public.chart_of_accounts SET opening_balance=6410.00, opening_balance_type='DR' WHERE id='4049d02d-2b5d-496d-90a5-b3283549dc8f';  -- Dr. Sagar Sahane
UPDATE public.chart_of_accounts SET opening_balance=3000.00, opening_balance_type='DR' WHERE id='c9dfbc2f-096b-48a6-bbb3-5cdf1a437047';  -- DR. SAMEER JOSHI
UPDATE public.chart_of_accounts SET opening_balance=26000.00, opening_balance_type='DR' WHERE id='274e6e73-20d0-413f-895b-c9be086062c0';  -- DR. SANDIP MESHRAM
UPDATE public.chart_of_accounts SET opening_balance=10000.00, opening_balance_type='DR' WHERE id='d234c63f-efb8-4584-bb4e-a00fb2bbe818';  -- Dr. Sarang Katrojwar (General Surgeon)
UPDATE public.chart_of_accounts SET opening_balance=286800.00, opening_balance_type='DR' WHERE id='68f2af2a-4298-4e06-b966-9512a4c2ea89';  -- Dr. Sharad Kawle
UPDATE public.chart_of_accounts SET opening_balance=12500.00, opening_balance_type='DR' WHERE id='de0063f6-b525-4ea1-90d5-6ae49048821a';  -- Dr. Shashank Modak
UPDATE public.chart_of_accounts SET opening_balance=202500.00, opening_balance_type='DR' WHERE id='9fbaec78-7702-4ffb-a31a-acd75ace39a6';  -- DR. SHIRAJ KHAN
UPDATE public.chart_of_accounts SET opening_balance=26000.00, opening_balance_type='DR' WHERE id='86dfa5b7-d2f6-4ef6-9b7e-86d508cab0a7';  -- Dr. Shrikant Perkha
UPDATE public.chart_of_accounts SET opening_balance=30000.00, opening_balance_type='DR' WHERE id='8d67e04c-8ef8-4aa0-bdb6-78fa9106760d';  -- Dr. Shrirao Room Deposite
UPDATE public.chart_of_accounts SET opening_balance=15000.00, opening_balance_type='CR' WHERE id='39590b40-62f4-4ffe-a720-2833fa1d8ef1';  -- Dr. Shrirao Room Rent (Ashish/taufik)
UPDATE public.chart_of_accounts SET opening_balance=1000.00, opening_balance_type='CR' WHERE id='ebea0f0e-6cc5-4eba-93bd-f6849f43584c';  -- Dr Shubham Thakur
UPDATE public.chart_of_accounts SET opening_balance=0.00, opening_balance_type='DR' WHERE id='9f1c1c0c-4f4b-4e1a-aa89-f1dc4cdcdd02';  -- Dr. Sidharth Jain
UPDATE public.chart_of_accounts SET opening_balance=193000.00, opening_balance_type='DR' WHERE id='e9645e9e-c45f-4627-a8f3-effe76e3f626';  -- DR. SIKHANDAR KHAN
UPDATE public.chart_of_accounts SET opening_balance=80500.00, opening_balance_type='DR' WHERE id='7dc9aeeb-2284-491f-8c57-b93a24742782';  -- DR. SMITA GUPTE
UPDATE public.chart_of_accounts SET opening_balance=6000.00, opening_balance_type='DR' WHERE id='5224ad92-873d-420b-9092-c7b4c5f2c2d1';  -- Dr. Sneha Pawaskar
UPDATE public.chart_of_accounts SET opening_balance=16000.00, opening_balance_type='DR' WHERE id='e082582e-90a3-4456-a2c0-61b7d96fc5fb';  -- Dr. Suchitra Uikey
UPDATE public.chart_of_accounts SET opening_balance=38200.00, opening_balance_type='DR' WHERE id='0df434b8-1204-49cb-b49a-e670ace1c82f';  -- Dr. Sudesh Wankhede
UPDATE public.chart_of_accounts SET opening_balance=790800.00, opening_balance_type='DR' WHERE id='db16bd2e-deb6-41db-b32d-ea89db686b59';  -- Dr. Suhas Tiple
UPDATE public.chart_of_accounts SET opening_balance=10000.00, opening_balance_type='DR' WHERE id='10e255e4-6b0e-4236-b8c2-f24d105cce11';  -- Dr. Sujeet Kumar
UPDATE public.chart_of_accounts SET opening_balance=1000.00, opening_balance_type='DR' WHERE id='c97c1ebe-1298-46fc-b3d9-48e6cba811ec';  -- Dr. Sumedh Mahajan
UPDATE public.chart_of_accounts SET opening_balance=329400.00, opening_balance_type='DR' WHERE id='62d33e6b-1c56-4947-ab4c-8d7d9d4d7a1b';  -- Dr. Sumedh Ramteke
UPDATE public.chart_of_accounts SET opening_balance=2000.00, opening_balance_type='CR' WHERE id='3c93e072-16a8-415c-8ab8-69283811a062';  -- Dr . Sumit Ramteke
UPDATE public.chart_of_accounts SET opening_balance=4500.00, opening_balance_type='DR' WHERE id='4720e842-77de-4415-879b-4db193e8ffc1';  -- Dr. Sunil Bedade
UPDATE public.chart_of_accounts SET opening_balance=30000.00, opening_balance_type='DR' WHERE id='2af94ead-00d4-49b3-9b42-feb5f9cc416e';  -- Dr. Surekha Nandagawali
UPDATE public.chart_of_accounts SET opening_balance=242475.90, opening_balance_type='DR' WHERE id='c593a8fb-0b25-461f-a776-9b89e0ab207e';  -- Dr. Sushil Rathi
UPDATE public.chart_of_accounts SET opening_balance=62900.00, opening_balance_type='CR' WHERE id='dfb5ad19-f6f9-4aa3-a794-a1d8a41315dd';  -- Dr. Swapnil Charpe
UPDATE public.chart_of_accounts SET opening_balance=51350.00, opening_balance_type='DR' WHERE id='0623549f-d5d6-41ef-b80d-86a3b90d52fd';  -- Dr. Tejas Sadavrte
UPDATE public.chart_of_accounts SET opening_balance=28500.00, opening_balance_type='DR' WHERE id='4d1c9235-bdaf-4ce6-9448-95e349471c1b';  -- DR. THAVENDRA DIHARE [Pediatric Surgeon ]
UPDATE public.chart_of_accounts SET opening_balance=2000.00, opening_balance_type='DR' WHERE id='85be037f-9b8a-44e4-95a4-d4e1c18d3759';  -- DR. TRUPTI DHAWLE
UPDATE public.chart_of_accounts SET opening_balance=3500.00, opening_balance_type='DR' WHERE id='ccf04a0c-25ce-486f-9f82-fd4503521286';  -- Dr Twinkle Meshram
UPDATE public.chart_of_accounts SET opening_balance=4000.00, opening_balance_type='DR' WHERE id='cd55b30a-2ca7-4bd4-b198-27b9454afd29';  -- DR VED MAHAJAN
UPDATE public.chart_of_accounts SET opening_balance=413950.00, opening_balance_type='DR' WHERE id='ca5ec0a0-e6fd-40e1-841f-a483290adf88';  -- Dr. Vijay Bansod
UPDATE public.chart_of_accounts SET opening_balance=209800.00, opening_balance_type='DR' WHERE id='20af8f43-f697-46ea-af08-959d0cde4ef8';  -- Dr. Vinod Borkar
UPDATE public.chart_of_accounts SET opening_balance=120000.00, opening_balance_type='DR' WHERE id='f2be520a-4a37-4ef0-b80d-a2eba34994dc';  -- Dr. Viraj Kakde
UPDATE public.chart_of_accounts SET opening_balance=235530.00, opening_balance_type='DR' WHERE id='943349f8-2a8d-4349-b6e4-71f0b3d3d5db';  -- Dr. Vishal Nandagawali
UPDATE public.chart_of_accounts SET opening_balance=57500.00, opening_balance_type='DR' WHERE id='fef18333-baf4-46e4-951e-1e7fe53e8218';  -- Dr. Vishwajeet Rajput
UPDATE public.chart_of_accounts SET opening_balance=6000.00, opening_balance_type='DR' WHERE id='b9e5e647-a795-4923-9cc0-6acf153ec745';  -- Dr. Yogesh Gaikwad
UPDATE public.chart_of_accounts SET opening_balance=500.00, opening_balance_type='DR' WHERE id='54942ff2-c167-441e-9b62-7bce836f2aee';  -- Dr. Yogesh Talmale
UPDATE public.chart_of_accounts SET opening_balance=222620.00, opening_balance_type='DR' WHERE id='f772989c-f5ab-4c40-9c1a-3ed610155847';  -- ECHS
UPDATE public.chart_of_accounts SET opening_balance=10000.00, opening_balance_type='CR' WHERE id='e568a486-becc-451d-92bf-486193b2157e';  -- Elite Multiventure Pvt Ltd
UPDATE public.chart_of_accounts SET opening_balance=414600.09, opening_balance_type='DR' WHERE id='85bf325e-4535-4020-8cc4-960d4daee8b1';  -- Empty Cylinder
UPDATE public.chart_of_accounts SET opening_balance=30000.00, opening_balance_type='DR' WHERE id='4b3bd03a-0077-4cb0-be9f-4bb2dd2a2cc0';  -- Fire Fab Engineering & Contactor
UPDATE public.chart_of_accounts SET opening_balance=51392.00, opening_balance_type='DR' WHERE id='7db352e5-64f6-4a5b-ae33-5e97c341d40c';  -- First Pharmacy
UPDATE public.chart_of_accounts SET opening_balance=287710.00, opening_balance_type='DR' WHERE id='40bfc0f8-b32f-48cf-8df8-a8f36a9e7a9e';  -- FRIENDS SURGICAL
UPDATE public.chart_of_accounts SET opening_balance=33907.50, opening_balance_type='DR' WHERE id='38fb63ed-90cd-45f2-bc15-f5d60a89ffea';  -- Furniture & Fixture
UPDATE public.chart_of_accounts SET opening_balance=470436.29, opening_balance_type='CR' WHERE id='c1d50113-f057-4fbb-9d57-130c7d2f4d6b';  -- GALAXY SCAN CENTER
UPDATE public.chart_of_accounts SET opening_balance=1474846.32, opening_balance_type='CR' WHERE id='fff85391-81f8-4277-87d5-45eeb95f7e00';  -- GANDHI LAB
UPDATE public.chart_of_accounts SET opening_balance=2104576.00, opening_balance_type='CR' WHERE id='c3f498a0-6a4d-4e7f-a162-3f60fd6aac01';  -- Gandhi Research Institute
UPDATE public.chart_of_accounts SET opening_balance=298100.00, opening_balance_type='DR' WHERE id='82cf984d-33b6-4674-ae9e-9dbd90e629ec';  -- Ganesh Sharnagat
UPDATE public.chart_of_accounts SET opening_balance=150000.00, opening_balance_type='DR' WHERE id='54ff64a8-551c-49c7-9b48-e69b9d22f5ae';  -- Gaurav Ramesh Agrawal
UPDATE public.chart_of_accounts SET opening_balance=219190.43, opening_balance_type='DR' WHERE id='5b5a2950-f5c3-4b56-8cc3-1cd4cb255f9e';  -- Generator  (Kirloskar 45)
UPDATE public.chart_of_accounts SET opening_balance=1000.00, opening_balance_type='DR' WHERE id='20d28105-513a-4dc0-8807-e4c215fb04f3';  -- Ghanshyam Hardware & Paint Mart
UPDATE public.chart_of_accounts SET opening_balance=190512.44, opening_balance_type='CR' WHERE id='3572b82c-1899-438a-9e7d-246fea97cdaf';  -- Global Scan
UPDATE public.chart_of_accounts SET opening_balance=10000.00, opening_balance_type='DR' WHERE id='22b49512-2f88-4baf-9d45-71940e3f25b1';  -- Gratity at World
UPDATE public.chart_of_accounts SET opening_balance=8400.00, opening_balance_type='DR' WHERE id='22ff6bbc-be9c-46f4-8c3a-723501490bc0';  -- Gurudas Lonarkar
UPDATE public.chart_of_accounts SET opening_balance=40500.00, opening_balance_type='DR' WHERE id='b9889c5a-c742-45c3-b90a-0e071ccebd60';  -- Harsh Tandekar Bouncer
UPDATE public.chart_of_accounts SET opening_balance=120714.25, opening_balance_type='DR' WHERE id='576ff236-5436-4620-b617-5a55c253a408';  -- Heamodailysis Machine
UPDATE public.chart_of_accounts SET opening_balance=287137.60, opening_balance_type='DR' WHERE id='bfd84556-3847-4d32-be04-f0c0c5b2b151';  -- Helix CT Scan
UPDATE public.chart_of_accounts SET opening_balance=10000.00, opening_balance_type='CR' WHERE id='3c2ac389-8518-4966-8302-7726da3ec27b';  -- Hemkali Thakur
UPDATE public.chart_of_accounts SET opening_balance=20000.00, opening_balance_type='DR' WHERE id='b15cd8f6-279b-418e-aacd-5e0c0cebe8e5';  -- HONEST COMPUTER
UPDATE public.chart_of_accounts SET opening_balance=32728772.00, opening_balance_type='CR' WHERE id='7996d7b9-dcf2-44c1-81a9-a2c8bfa45745';  -- Hope Hospital (Partnership Firm)
UPDATE public.chart_of_accounts SET opening_balance=7837700.00, opening_balance_type='CR' WHERE id='ca8ae60a-c6d9-4aa2-8772-39b2301a6d9b';  -- Hope Multispeciality Hospital
UPDATE public.chart_of_accounts SET opening_balance=1649708.00, opening_balance_type='CR' WHERE id='7d6d9b1a-d26e-4588-9937-b3772d9bbf5d';  -- Hope Pharmacy
UPDATE public.chart_of_accounts SET opening_balance=4046.00, opening_balance_type='DR' WHERE id='8dcc688e-5c45-4499-9a3c-4c23f5ca0409';  -- Hospirush Pharmacy
UPDATE public.chart_of_accounts SET opening_balance=27904287.36, opening_balance_type='DR' WHERE id='27cece3f-e64c-44f2-b7cb-8e3883f84f68';  -- Hospital Equipment
UPDATE public.chart_of_accounts SET opening_balance=25000.00, opening_balance_type='DR' WHERE id='a0e568e3-13c6-4a5d-87ee-31edfac476f9';  -- IMAGE INTERPRISES
UPDATE public.chart_of_accounts SET opening_balance=152500.00, opening_balance_type='DR' WHERE id='61a369a9-f47c-4eec-a5b6-e9ab2e1b8ddc';  -- Income Tax Adavcne
UPDATE public.chart_of_accounts SET opening_balance=274300.00, opening_balance_type='DR' WHERE id='d7fdc4b6-68fb-4192-bd09-9bba1b26965f';  -- Insight Diagnostics Center
UPDATE public.chart_of_accounts SET opening_balance=7000.00, opening_balance_type='DR' WHERE id='f2a06456-a6ea-4247-acf5-e4c422aeb07d';  -- Institute Surgical Pathalogy
UPDATE public.chart_of_accounts SET opening_balance=81000.00, opening_balance_type='DR' WHERE id='5a19c4b6-ac64-4f62-8825-44a9b84e8356';  -- JAAR ENTERPRISES
UPDATE public.chart_of_accounts SET opening_balance=50970.00, opening_balance_type='DR' WHERE id='3900823e-20af-4938-968d-3438a380385f';  -- Jagruti S. Tembhare
UPDATE public.chart_of_accounts SET opening_balance=1000.00, opening_balance_type='CR' WHERE id='8f428bb8-f05f-4941-bb93-e5c28512e1ac';  -- JAIN MEDICAL AGENCIES
UPDATE public.chart_of_accounts SET opening_balance=44650.00, opening_balance_type='DR' WHERE id='b7d1b82d-2fb8-4f7c-85e3-c99af8350848';  -- Jaishree Gharade
UPDATE public.chart_of_accounts SET opening_balance=10202.00, opening_balance_type='DR' WHERE id='a6ef82c2-0cea-4a53-b3fc-900a2f648529';  -- JAYSHREE PIPE & SANTITATION
UPDATE public.chart_of_accounts SET opening_balance=179444.00, opening_balance_type='DR' WHERE id='9604e60d-bd96-4f18-ae5f-e1e398072485';  -- Just Dial
UPDATE public.chart_of_accounts SET opening_balance=32866.00, opening_balance_type='DR' WHERE id='c840f6a0-158c-47e2-912a-6414f7ff0996';  -- Kajal Lakhe
UPDATE public.chart_of_accounts SET opening_balance=70367.00, opening_balance_type='DR' WHERE id='e2013e34-81a5-49a5-9471-40c4a56e05a9';  -- Kartik Masram (Wardboy)
UPDATE public.chart_of_accounts SET opening_balance=1500.00, opening_balance_type='DR' WHERE id='b1cc4374-0e34-4cdb-99b6-6f63cbf5d85e';  -- Kartik Prints
UPDATE public.chart_of_accounts SET opening_balance=13867.00, opening_balance_type='DR' WHERE id='03d665c3-b699-45ea-afda-dd21def50485';  -- Kashish Jagwani
UPDATE public.chart_of_accounts SET opening_balance=81417.00, opening_balance_type='DR' WHERE id='0075c35d-5d84-4c2f-9b05-c0e8397c105b';  -- Khushboo Karade
UPDATE public.chart_of_accounts SET opening_balance=74001.00, opening_balance_type='DR' WHERE id='b058e6a3-d4f4-41cd-8659-a3225a9951e3';  -- Kiran Maushi
UPDATE public.chart_of_accounts SET opening_balance=8400.00, opening_balance_type='DR' WHERE id='7ed278ec-0dad-4eda-9a39-440b4fa103a6';  -- Kishor Bawangade (Billing)
UPDATE public.chart_of_accounts SET opening_balance=2500.00, opening_balance_type='DR' WHERE id='8b83a921-28d0-4b69-8912-f3f7b3277bdd';  -- Kohinoor Enterprises
UPDATE public.chart_of_accounts SET opening_balance=700.00, opening_balance_type='DR' WHERE id='04693cce-39f0-4cac-b2dd-d5bda865e63f';  -- Komal Bangar (Sis)
UPDATE public.chart_of_accounts SET opening_balance=33000.00, opening_balance_type='DR' WHERE id='bffb8d98-6a05-4eaa-9da8-07fe378ba3e7';  -- Kunal Patil
UPDATE public.chart_of_accounts SET opening_balance=50575.00, opening_balance_type='DR' WHERE id='0b5b5dfc-b79e-4223-81c8-0ec8b38dfb02';  -- Labchem Healthcare
UPDATE public.chart_of_accounts SET opening_balance=14400.00, opening_balance_type='DR' WHERE id='f1f23e85-b749-47fe-8913-52959138f7ba';  -- Lalita Nishad
UPDATE public.chart_of_accounts SET opening_balance=100.00, opening_balance_type='DR' WHERE id='76469ecb-7525-4a91-9006-afc9e7909aa4';  -- Lalit Meshram
UPDATE public.chart_of_accounts SET opening_balance=62059.82, opening_balance_type='DR' WHERE id='2e201870-d2ea-4a14-a74b-aa961ba27eb8';  -- Laptop
UPDATE public.chart_of_accounts SET opening_balance=81100.00, opening_balance_type='DR' WHERE id='d848c781-8be0-4ec9-aba5-7c39fe936a3a';  -- Laxmi Wase (Maushi)
UPDATE public.chart_of_accounts SET opening_balance=118480.00, opening_balance_type='DR' WHERE id='5de4f6f0-f65b-4353-adcb-5a505c7a87b7';  -- LIFE LINE PATH LAB
UPDATE public.chart_of_accounts SET opening_balance=228464.93, opening_balance_type='DR' WHERE id='1a791b7b-34aa-4b86-a533-e3ead102dd0f';  -- Lift
UPDATE public.chart_of_accounts SET opening_balance=194001.00, opening_balance_type='DR' WHERE id='36068b2f-15ba-4f1b-b9b2-9d3145f2229c';  -- Lokesh Ambade
UPDATE public.chart_of_accounts SET opening_balance=9946.00, opening_balance_type='DR' WHERE id='80d64e16-76d5-47ca-a959-cdbcd8f3c387';  -- LOKMAT SAMACHAR
UPDATE public.chart_of_accounts SET opening_balance=5159.00, opening_balance_type='DR' WHERE id='b807c4ba-9a1e-411c-aebc-b4a99c856a4b';  -- Madan Trading Co.
UPDATE public.chart_of_accounts SET opening_balance=12000.00, opening_balance_type='DR' WHERE id='1d682cb0-a241-4ede-8c94-fa93eff7c794';  -- MADHURI GAWADI
UPDATE public.chart_of_accounts SET opening_balance=1000.00, opening_balance_type='DR' WHERE id='da8232a6-1fa2-4d75-a2b4-2c8430d59e0f';  -- Madhuri Marbate
UPDATE public.chart_of_accounts SET opening_balance=2800.00, opening_balance_type='DR' WHERE id='c2f43fa0-d881-40bf-a142-91f72e455218';  -- Madhuri Tumsare (Sis)
UPDATE public.chart_of_accounts SET opening_balance=80000.00, opening_balance_type='DR' WHERE id='9921137e-9b5d-47e1-8b9e-bdfa352c0d96';  -- Mahanagar Housekeeping
UPDATE public.chart_of_accounts SET opening_balance=1017196.00, opening_balance_type='DR' WHERE id='6c88e663-a91a-4276-bf9d-e95f2ba35a88';  -- Mahatma Jyotirao Phule Jan Arogya Yojana (MJPJAY)
UPDATE public.chart_of_accounts SET opening_balance=7500.00, opening_balance_type='DR' WHERE id='fd6f5b84-ff52-42d3-8f48-1791fc0e8732';  -- Mahendra Power Zone
UPDATE public.chart_of_accounts SET opening_balance=5000.00, opening_balance_type='DR' WHERE id='0a74d646-294d-4784-b060-6b51bcefb72a';  -- Malti Yenkeshwar
UPDATE public.chart_of_accounts SET opening_balance=65940.00, opening_balance_type='CR' WHERE id='bc33a330-81ff-4eef-a213-6ce1ecd921df';  -- Mangnet Technologies
UPDATE public.chart_of_accounts SET opening_balance=101333.00, opening_balance_type='DR' WHERE id='21f615f2-bbcd-480b-bc51-21bed9946fc9';  -- Manjusha Koche
UPDATE public.chart_of_accounts SET opening_balance=5706.00, opening_balance_type='DR' WHERE id='4814b6c1-ad48-4486-b035-6d11e69c6c04';  -- Manman Mfg Company Pvt Ltd
UPDATE public.chart_of_accounts SET opening_balance=5000.00, opening_balance_type='CR' WHERE id='7a99f3c2-838f-4799-8935-99f8e7b717dc';  -- Manoj Yadav
UPDATE public.chart_of_accounts SET opening_balance=3640.00, opening_balance_type='DR' WHERE id='e53f66e0-ec7b-480c-8110-203eff7938f8';  -- MANSI PUBLICATION
UPDATE public.chart_of_accounts SET opening_balance=51999.00, opening_balance_type='DR' WHERE id='9fbbf6dd-00ed-43df-8165-740c4d5f4740';  -- Manthan Patil
UPDATE public.chart_of_accounts SET opening_balance=117582.27, opening_balance_type='DR' WHERE id='64173899-5b39-4617-a0b5-bb670286524e';  -- Mars Lite x Ray Machine
UPDATE public.chart_of_accounts SET opening_balance=14447.00, opening_balance_type='DR' WHERE id='0737c21f-acf1-42ac-bbb1-36c97f145c8c';  -- MAULI HEALTHCARE
UPDATE public.chart_of_accounts SET opening_balance=80204.13, opening_balance_type='DR' WHERE id='fb766b11-2a20-422e-99a7-56d49ab626c1';  -- Medical Instrument
UPDATE public.chart_of_accounts SET opening_balance=6993.00, opening_balance_type='DR' WHERE id='585c1ae7-77fc-4685-a525-1dbfb98bffa3';  -- Mediline Enterprises
UPDATE public.chart_of_accounts SET opening_balance=400.00, opening_balance_type='DR' WHERE id='921fe870-12d4-49c9-86ae-047f137fa938';  -- Medinplus Enterprises
UPDATE public.chart_of_accounts SET opening_balance=710.00, opening_balance_type='DR' WHERE id='d82b0559-9dbd-4e79-848f-cb60a378d5dc';  -- Medplus
UPDATE public.chart_of_accounts SET opening_balance=162400.00, opening_balance_type='DR' WHERE id='c4d68d4f-c28e-4b07-9ab2-f996137cdcd6';  -- Meena Yadav (Maushi)
UPDATE public.chart_of_accounts SET opening_balance=12300.00, opening_balance_type='DR' WHERE id='90d5486a-d975-4923-bc86-18a0e2a39936';  -- MITA BOUNCER
UPDATE public.chart_of_accounts SET opening_balance=8000.00, opening_balance_type='DR' WHERE id='6757cf84-97d3-4cea-ab8b-dbd09f15be72';  -- Mobile Hutt
UPDATE public.chart_of_accounts SET opening_balance=16610.00, opening_balance_type='DR' WHERE id='9262207f-ea53-42b1-8626-0d75cb8f9a8a';  -- MOHIT CHEMICALS
UPDATE public.chart_of_accounts SET opening_balance=4070.00, opening_balance_type='DR' WHERE id='48d350b3-cdf0-4da9-9647-cbf11cb61c7e';  -- Mona Enterpriese
UPDATE public.chart_of_accounts SET opening_balance=10000.00, opening_balance_type='DR' WHERE id='bd26b53a-e063-4ad4-8c1d-fd737e9410d9';  -- Monish Ghumule
UPDATE public.chart_of_accounts SET opening_balance=3800.00, opening_balance_type='DR' WHERE id='66a62acd-f5a3-4b96-b774-5f865825bfb3';  -- M PATH LAB
UPDATE public.chart_of_accounts SET opening_balance=150000.00, opening_balance_type='DR' WHERE id='26d090ea-7218-4995-89e6-27c6f94772ea';  -- MPCB Ayushman Bank Gurantee
UPDATE public.chart_of_accounts SET opening_balance=1275595.00, opening_balance_type='DR' WHERE id='153e6279-769c-4e42-a288-d42c86dfe647';  -- MSEDCL
UPDATE public.chart_of_accounts SET opening_balance=4400.00, opening_balance_type='DR' WHERE id='df9dd31a-9cd6-4960-ba9e-82888713f0b9';  -- Mukesh Driver
UPDATE public.chart_of_accounts SET opening_balance=36440.00, opening_balance_type='DR' WHERE id='ca71a49a-4779-4ccf-a1de-a235c5e40b2d';  -- MUSKAN BISEN
UPDATE public.chart_of_accounts SET opening_balance=54000.00, opening_balance_type='DR' WHERE id='2013e28e-b1ca-4cbe-bb34-f86b4aa21650';  -- NAGPUR HEALTH CARE SERVICES
UPDATE public.chart_of_accounts SET opening_balance=254600.00, opening_balance_type='DR' WHERE id='3301b639-f4f7-4002-bf2f-4ad9f2b10100';  -- Naidu Hotel
UPDATE public.chart_of_accounts SET opening_balance=7867.00, opening_balance_type='DR' WHERE id='3568199a-8903-4f9d-9b07-6ffa4d316f0d';  -- Naina Mesham
UPDATE public.chart_of_accounts SET opening_balance=56767.00, opening_balance_type='DR' WHERE id='e36964f1-e663-41ca-8e5b-5b9bd04e2403';  -- Nandini Raut
UPDATE public.chart_of_accounts SET opening_balance=15000.00, opening_balance_type='CR' WHERE id='f12d2ca4-b42c-40a9-844b-71724f767acc';  -- Naumi Bai
UPDATE public.chart_of_accounts SET opening_balance=7587.00, opening_balance_type='DR' WHERE id='3d94385a-a927-4a51-8d34-92677fd459c1';  -- Navbharat Advertisement
UPDATE public.chart_of_accounts SET opening_balance=356.00, opening_balance_type='CR' WHERE id='5e420d03-8d0b-4438-b306-d13b17ce8d47';  -- Neha Patale
UPDATE public.chart_of_accounts SET opening_balance=2040630.00, opening_balance_type='DR' WHERE id='d3d1c0fb-ef37-4757-abf6-5aef5f7c13c1';  -- Nephrocare Healthcare Services Pvt Ltd
UPDATE public.chart_of_accounts SET opening_balance=20000.00, opening_balance_type='CR' WHERE id='fe39f437-47eb-4d27-b4be-6bee5f166a2c';  -- New Bharat Medical System
UPDATE public.chart_of_accounts SET opening_balance=7496.00, opening_balance_type='DR' WHERE id='a077b245-4bcd-4d1f-8b2f-628e22cede22';  -- New Shreewardhan Complex
UPDATE public.chart_of_accounts SET opening_balance=98115.00, opening_balance_type='DR' WHERE id='e9684d83-0459-41a0-a6d7-bf98d52a613d';  -- Nikhil Neware
UPDATE public.chart_of_accounts SET opening_balance=4000.00, opening_balance_type='CR' WHERE id='b8d6681e-0b45-4b6a-9be7-dd84b2bb545a';  -- Nikita  Uikey
UPDATE public.chart_of_accounts SET opening_balance=61900.00, opening_balance_type='DR' WHERE id='d5a8896c-25ad-422b-9306-9d2facf18f5e';  -- Nitin Bawane ( x Ray)
UPDATE public.chart_of_accounts SET opening_balance=12800.00, opening_balance_type='DR' WHERE id='a8bbdc15-df8c-4d5f-8451-d5500b814bba';  -- Nitin Sahare (Driver)
UPDATE public.chart_of_accounts SET opening_balance=3600.00, opening_balance_type='DR' WHERE id='8af6a2f1-d42b-4331-8bd8-518a7f83a60a';  -- Nitin Thakre
UPDATE public.chart_of_accounts SET opening_balance=4316.00, opening_balance_type='DR' WHERE id='a446ffc8-5b9b-406f-9d2b-cf098ac99e5c';  -- NMC
UPDATE public.chart_of_accounts SET opening_balance=615450.00, opening_balance_type='DR' WHERE id='583e6867-83e6-40f6-94f3-3840bb103d55';  -- Nobal Scan Center
UPDATE public.chart_of_accounts SET opening_balance=202.00, opening_balance_type='CR' WHERE id='d65b45f2-1106-4699-bafc-ebbc5eccf18c';  -- Novelty General Store
UPDATE public.chart_of_accounts SET opening_balance=3500.00, opening_balance_type='DR' WHERE id='101cfb5e-580a-4210-ba75-445237bad62f';  -- OM SAI HEALTHCARE
UPDATE public.chart_of_accounts SET opening_balance=248310.00, opening_balance_type='DR' WHERE id='5716ab8f-9f26-488d-9362-1feaa07418ca';  -- Opening Stock
UPDATE public.chart_of_accounts SET opening_balance=592220.17, opening_balance_type='DR' WHERE id='381d68d8-6d2b-44d8-947c-6470288f6d49';  -- Orange Scan
UPDATE public.chart_of_accounts SET opening_balance=66029.00, opening_balance_type='CR' WHERE id='8d9683c3-e2da-47a3-8397-e721fdc63984';  -- Oriental Associate & Facility Management
UPDATE public.chart_of_accounts SET opening_balance=131295.00, opening_balance_type='DR' WHERE id='3b0add48-c974-45d2-abff-361a925d0cd6';  -- Oshin Tembhurne (x-Ray)
UPDATE public.chart_of_accounts SET opening_balance=136300.00, opening_balance_type='DR' WHERE id='4f3b0eaf-67c4-4acf-93bc-e535406e49e4';  -- PAKHI TIFFIN SERVICES
UPDATE public.chart_of_accounts SET opening_balance=209583.00, opening_balance_type='DR' WHERE id='d3f2e0c3-c891-4df5-afea-27521d62290e';  -- Pankaj Patel
UPDATE public.chart_of_accounts SET opening_balance=7500.00, opening_balance_type='DR' WHERE id='87c780d9-e2d4-436c-b127-a57e211f6623';  -- Pest Control Services
UPDATE public.chart_of_accounts SET opening_balance=20049.37, opening_balance_type='DR' WHERE id='2e9677f5-c077-4db5-b030-cfec860ba66c';  -- PFT Machine
UPDATE public.chart_of_accounts SET opening_balance=6530.00, opening_balance_type='DR' WHERE id='6c107d3d-b7e4-4e72-a783-e8ce131c4720';  -- Phasorz Technologies Pvt Ltd
UPDATE public.chart_of_accounts SET opening_balance=95668.00, opening_balance_type='DR' WHERE id='4a846782-ac0d-42f5-8d58-43e2d27c440d';  -- Pinky Dahenhawar
UPDATE public.chart_of_accounts SET opening_balance=66732.00, opening_balance_type='DR' WHERE id='4c49bd6b-d552-44fb-81ac-44ec7a47262d';  -- Pooja Harinkhede
UPDATE public.chart_of_accounts SET opening_balance=15000.00, opening_balance_type='CR' WHERE id='fba2b61b-8e82-4a94-8853-46c7ab48cd10';  -- Poonam Saket
UPDATE public.chart_of_accounts SET opening_balance=905498.00, opening_balance_type='DR' WHERE id='d7768eef-24b3-4bde-8ac9-afff45f27700';  -- Pradhan Mantri Jan Arogya Yojana (PMJAY)
UPDATE public.chart_of_accounts SET opening_balance=13067.00, opening_balance_type='DR' WHERE id='9921d7e9-8804-4cf8-b246-5905d9127dd5';  -- Pranali Karhade
UPDATE public.chart_of_accounts SET opening_balance=79801.00, opening_balance_type='DR' WHERE id='9e7234c5-aaa5-4af0-a3b8-ff5e3b922195';  -- Pranay Thakare
UPDATE public.chart_of_accounts SET opening_balance=2300.00, opening_balance_type='DR' WHERE id='e7accae3-abc6-4746-bff1-b7c168414a92';  -- Prashant Computer
UPDATE public.chart_of_accounts SET opening_balance=12600.00, opening_balance_type='DR' WHERE id='67c2571c-6da7-49e3-b40d-d428f83b2fba';  -- Pratik Brother
UPDATE public.chart_of_accounts SET opening_balance=10000.00, opening_balance_type='DR' WHERE id='b68ec739-0288-48ef-a271-7c625c7df15f';  -- Pratik Vyankat (Wardboy)
UPDATE public.chart_of_accounts SET opening_balance=31000.00, opening_balance_type='CR' WHERE id='c6768275-0d51-4030-b30d-4e47da730bce';  -- Premlal Verma
UPDATE public.chart_of_accounts SET opening_balance=20000.00, opening_balance_type='DR' WHERE id='e4993c5a-d937-454f-80c8-ca2b3f52299a';  -- PRIME ENTERPRISES
UPDATE public.chart_of_accounts SET opening_balance=85000.00, opening_balance_type='DR' WHERE id='7be153a3-2817-4f49-9b27-080c696ce679';  -- Priti Warjukar
UPDATE public.chart_of_accounts SET opening_balance=132300.00, opening_balance_type='DR' WHERE id='df603adb-9136-42d5-8e97-5398e720a433';  -- Priyanka Tandekar
UPDATE public.chart_of_accounts SET opening_balance=34664.00, opening_balance_type='DR' WHERE id='9adde7e9-d628-4c3f-abaa-fc4f95b1e49c';  -- P-Square Biomedical
UPDATE public.chart_of_accounts SET opening_balance=6900.00, opening_balance_type='CR' WHERE id='5cd77877-141e-468a-9ee3-500b4c1009ef';  -- Pusad Urban Co-Operative Bank Ltd
UPDATE public.chart_of_accounts SET opening_balance=11000.00, opening_balance_type='DR' WHERE id='7183e334-c576-4aed-a68d-12db7275de4e';  -- Rachana Rathod (Lab)
UPDATE public.chart_of_accounts SET opening_balance=10010.00, opening_balance_type='DR' WHERE id='dd4b5db0-1a62-40f8-b03d-8a86686c24b9';  -- RADIO CLUB
UPDATE public.chart_of_accounts SET opening_balance=115993.00, opening_balance_type='DR' WHERE id='f8e25dbf-f2bb-4e9a-b41b-64f88e00c7a1';  -- Rahul Dhamti
UPDATE public.chart_of_accounts SET opening_balance=30500.00, opening_balance_type='DR' WHERE id='362abe9d-36d8-4f01-9f87-d8328f1b142d';  -- Rainbow Scan Center
UPDATE public.chart_of_accounts SET opening_balance=1000.00, opening_balance_type='CR' WHERE id='a5442776-ab31-4b6a-a29c-808102cb3358';  -- Rajani Thakur
UPDATE public.chart_of_accounts SET opening_balance=104000.00, opening_balance_type='DR' WHERE id='e5bd5d08-c648-4221-a70c-a1fb1ab8f0ec';  -- Raj Enterprises
UPDATE public.chart_of_accounts SET opening_balance=31000.00, opening_balance_type='DR' WHERE id='fe38abce-07f7-4fc4-b75c-a6872b5fcb03';  -- Raj Prasad Mishra
UPDATE public.chart_of_accounts SET opening_balance=44000.00, opening_balance_type='DR' WHERE id='281bfb12-d550-4a61-bfa0-27618b0c254b';  -- RAKESH MANEKAR [OT]
UPDATE public.chart_of_accounts SET opening_balance=20000.00, opening_balance_type='CR' WHERE id='34e0e7d7-4f3e-4b8a-bebf-0434e4b29d9c';  -- Rameshwar Prajapati
UPDATE public.chart_of_accounts SET opening_balance=12500.00, opening_balance_type='CR' WHERE id='68bf1796-09e4-479e-a28c-773f93f1104c';  -- Ramray Pandey
UPDATE public.chart_of_accounts SET opening_balance=9333.80, opening_balance_type='DR' WHERE id='c699ab05-e3f5-4336-a43d-10bd24f2a086';  -- Rentech Laboratories Pvt Ltd
UPDATE public.chart_of_accounts SET opening_balance=59200.00, opening_balance_type='DR' WHERE id='409d300a-ef4c-4f67-b412-33c889f1b707';  -- Rima Varade
UPDATE public.chart_of_accounts SET opening_balance=1500.00, opening_balance_type='DR' WHERE id='8c20904f-a236-4909-aa45-109906510ea3';  -- Ritesh Jhariya
UPDATE public.chart_of_accounts SET opening_balance=32000.00, opening_balance_type='DR' WHERE id='ad8bd9d5-65cd-44da-9de6-acf7698596a8';  -- Rmo Salary
UPDATE public.chart_of_accounts SET opening_balance=9450.00, opening_balance_type='DR' WHERE id='5713421d-3f1b-4c29-82ac-59c38f1633d3';  -- ROHIT ENTERPRISES
UPDATE public.chart_of_accounts SET opening_balance=16667.00, opening_balance_type='DR' WHERE id='6feb8477-4e04-4c75-9f17-e6e672da8ba0';  -- ROHIT JOSHI
UPDATE public.chart_of_accounts SET opening_balance=19037.87, opening_balance_type='DR' WHERE id='69b8d41c-69b8-4d2f-bddd-a6ae4257d3a1';  -- RO Machine
UPDATE public.chart_of_accounts SET opening_balance=37834.00, opening_balance_type='DR' WHERE id='75d2ab6a-6b99-4937-b448-04f1d44c7501';  -- Roma Ghei
UPDATE public.chart_of_accounts SET opening_balance=3383.00, opening_balance_type='DR' WHERE id='81c35e26-30a7-4417-8eea-88c9055cf462';  -- Roshana Wadiwa (Sis)
UPDATE public.chart_of_accounts SET opening_balance=84850.00, opening_balance_type='DR' WHERE id='c1e8c660-4265-4ba5-a559-ece8be6e1d49';  -- Roshan Tarkel
UPDATE public.chart_of_accounts SET opening_balance=95000.00, opening_balance_type='DR' WHERE id='8e401784-9e07-42c4-ac48-6c28e932368a';  -- ROYAL HEALTHCARE
UPDATE public.chart_of_accounts SET opening_balance=24578.00, opening_balance_type='DR' WHERE id='0894242a-4c2e-4685-b4c0-519843b6a564';  -- Royal Sundaram General Insurance Co.
UPDATE public.chart_of_accounts SET opening_balance=70000.00, opening_balance_type='DR' WHERE id='5e4dc3d5-c54c-4437-afd1-263d8a555c72';  -- Royal Surgical
UPDATE public.chart_of_accounts SET opening_balance=9290.00, opening_balance_type='DR' WHERE id='171d3ad2-1e58-42ec-aab2-ee3e4128eb2a';  -- Royal Trading Corporation
UPDATE public.chart_of_accounts SET opening_balance=2300.00, opening_balance_type='DR' WHERE id='91c170dd-08aa-4e81-8c7e-b384651ee61e';  -- Ruby Heart Clinic
UPDATE public.chart_of_accounts SET opening_balance=10333.00, opening_balance_type='DR' WHERE id='37543c2e-56ee-4463-954f-34961e2db81a';  -- Ruchi Chamlate
UPDATE public.chart_of_accounts SET opening_balance=190284.50, opening_balance_type='DR' WHERE id='c2041573-b4bc-4718-ad35-d5f49855bc78';  -- RUDRA OFFSET
UPDATE public.chart_of_accounts SET opening_balance=230300.00, opening_balance_type='DR' WHERE id='c2f183a6-29c6-4ddc-ab20-1d68a71c0ef0';  -- Rupali Ghumde (Sis)
UPDATE public.chart_of_accounts SET opening_balance=17500.00, opening_balance_type='DR' WHERE id='c296ef7d-0cab-47bb-8a16-d31dcb96ba83';  -- Rupali Girme
UPDATE public.chart_of_accounts SET opening_balance=20600.00, opening_balance_type='DR' WHERE id='beeb4e2a-3fc3-43c3-99a2-52cec915a762';  -- Rutuja Trading Company
UPDATE public.chart_of_accounts SET opening_balance=600.00, opening_balance_type='DR' WHERE id='b1b7116c-0c4e-4980-aecb-f83258fdcc6c';  -- Rutusha Moon (Sis)
UPDATE public.chart_of_accounts SET opening_balance=5000.00, opening_balance_type='DR' WHERE id='29d92315-8319-4990-97e3-c6c0cf2bb939';  -- Sachin Godbole (Wardboy)
UPDATE public.chart_of_accounts SET opening_balance=28200.00, opening_balance_type='DR' WHERE id='23a14a55-f077-483d-9464-a5cda54d752a';  -- Sagar Bawane
UPDATE public.chart_of_accounts SET opening_balance=2033.00, opening_balance_type='CR' WHERE id='27ba9aa5-a60e-419b-9d18-ee1976929af6';  -- Sagar Uikey (Wardboy)
UPDATE public.chart_of_accounts SET opening_balance=355488.00, opening_balance_type='DR' WHERE id='1e78242e-3389-4d65-a53c-aca6a978df64';  -- Sagar Viadhya
UPDATE public.chart_of_accounts SET opening_balance=29000.00, opening_balance_type='DR' WHERE id='1a4f91a2-ebf3-4a2b-bb14-f0ecf483c708';  -- Saikat Data
UPDATE public.chart_of_accounts SET opening_balance=30044.00, opening_balance_type='DR' WHERE id='76e28592-8d24-4533-88ad-86e1cef671b4';  -- Sakshi Narnaware (Sis)
UPDATE public.chart_of_accounts SET opening_balance=17000.00, opening_balance_type='DR' WHERE id='69993108-470c-4e77-b670-ca0747708a02';  -- Salary Advance
UPDATE public.chart_of_accounts SET opening_balance=11330.00, opening_balance_type='CR' WHERE id='c195d091-2da9-4fc5-aeab-ede361b4cc36';  -- Samruddhi Deshmukh
UPDATE public.chart_of_accounts SET opening_balance=19000.00, opening_balance_type='DR' WHERE id='8ca2c203-1243-45db-ace6-53d0a66a603e';  -- Sandeep Khote
UPDATE public.chart_of_accounts SET opening_balance=30667.00, opening_balance_type='DR' WHERE id='94fbf8ee-e9d7-4304-96f9-6c4359470b4b';  -- Sandeep Wardboy
UPDATE public.chart_of_accounts SET opening_balance=2360.00, opening_balance_type='CR' WHERE id='f320388e-0710-4817-a84f-1be20ad7cd09';  -- Sandip Stationery
UPDATE public.chart_of_accounts SET opening_balance=10667.00, opening_balance_type='CR' WHERE id='eef5722c-7596-457b-8813-03ec75b8b018';  -- Sanjana  Badole (Sis)
UPDATE public.chart_of_accounts SET opening_balance=240000.00, opening_balance_type='DR' WHERE id='8916f5a8-051d-423c-9963-b8c424f5fa0d';  -- Sanjay Khobragade
UPDATE public.chart_of_accounts SET opening_balance=23800.00, opening_balance_type='CR' WHERE id='9bb9f87f-b8ab-4bca-a74a-318834c11c03';  -- Santosh Bhalavi IH26C31001
UPDATE public.chart_of_accounts SET opening_balance=183234.00, opening_balance_type='DR' WHERE id='419a6ad3-6608-4ed2-87b6-95ab1850202e';  -- Santoshi Patle (Sister)
UPDATE public.chart_of_accounts SET opening_balance=25000.00, opening_balance_type='CR' WHERE id='5e6244d3-1ae1-4e2b-a65e-de34a4be0f7c';  -- Santoshkumar Kol
UPDATE public.chart_of_accounts SET opening_balance=25300.00, opening_balance_type='DR' WHERE id='ad9d290d-3b15-486f-b2de-79733e78951b';  -- Sarang Sonwane
UPDATE public.chart_of_accounts SET opening_balance=2929604.66, opening_balance_type='DR' WHERE id='f7bd244a-b8f6-4663-bf6b-761e1b6a71ff';  -- Saraswat Bank
UPDATE public.chart_of_accounts SET opening_balance=36917.00, opening_balance_type='DR' WHERE id='5ecab05c-bede-4c66-aceb-8fe7f547f652';  -- SAVITA GHARDE
UPDATE public.chart_of_accounts SET opening_balance=1200.00, opening_balance_type='DR' WHERE id='9e675219-705c-435c-8fde-ab5e1ce0a061';  -- Savita Medical System
UPDATE public.chart_of_accounts SET opening_balance=5000.00, opening_balance_type='DR' WHERE id='0ce3621d-0e51-41be-94f1-5ffbbbba6e59';  -- SBI Saving A/c 4905
UPDATE public.chart_of_accounts SET opening_balance=17593.00, opening_balance_type='CR' WHERE id='0ab12f67-9f28-4c81-95d3-db5da26e2a19';  -- SEA HOLIDAY( MURALI )
UPDATE public.chart_of_accounts SET opening_balance=3000000.00, opening_balance_type='CR' WHERE id='18088e79-65b7-4e8a-ac2a-d2a1844c943a';  -- Security Deposite From Sachin Agrawal
UPDATE public.chart_of_accounts SET opening_balance=4175000.00, opening_balance_type='DR' WHERE id='51e297b8-e1bc-4dcd-a1ee-8c4c6d9f273a';  -- Security Deposit- Gandhi Research Institute
UPDATE public.chart_of_accounts SET opening_balance=29960.00, opening_balance_type='CR' WHERE id='ac690bdc-a891-4b1a-ab79-6975163b64eb';  -- Sejal Enterprises
UPDATE public.chart_of_accounts SET opening_balance=700000.00, opening_balance_type='DR' WHERE id='b7ef8d14-28e8-4961-af6c-1b60b9e56355';  -- Senthil Transport
UPDATE public.chart_of_accounts SET opening_balance=18000.00, opening_balance_type='DR' WHERE id='b7e121d2-e77c-4c21-936f-f1303f1d7d35';  -- Seva Surgical & Drug Store
UPDATE public.chart_of_accounts SET opening_balance=3766.00, opening_balance_type='DR' WHERE id='beaecd8a-fa6a-46b2-b321-7f5a43cd4ecb';  -- Shabana Maushi
UPDATE public.chart_of_accounts SET opening_balance=10000.00, opening_balance_type='DR' WHERE id='03ffb95b-0275-4b89-ad42-563c2f4a9fb1';  -- Shahid Arts and Traders
UPDATE public.chart_of_accounts SET opening_balance=20000.00, opening_balance_type='CR' WHERE id='d0e88c17-dcaa-4ded-b0df-a82e449f147c';  -- Shahrukh Ullah Khan
UPDATE public.chart_of_accounts SET opening_balance=99016.00, opening_balance_type='DR' WHERE id='8780bd19-8544-4802-bad9-3d28343169bc';  -- Shailesh Ninave
UPDATE public.chart_of_accounts SET opening_balance=236000.00, opening_balance_type='DR' WHERE id='7e74e8be-e3aa-47ed-b166-2937b812ba0e';  -- Shankar Bhurare (Vac Machine)
UPDATE public.chart_of_accounts SET opening_balance=45833.00, opening_balance_type='DR' WHERE id='d0753385-d69e-4957-838f-5e156dcc2923';  -- Shashank Upgade
UPDATE public.chart_of_accounts SET opening_balance=2500.00, opening_balance_type='DR' WHERE id='30138851-cf92-4994-8aeb-6c48a9e6bbfe';  -- Sheetal Paul
UPDATE public.chart_of_accounts SET opening_balance=45333.00, opening_balance_type='DR' WHERE id='1c2007d3-7281-4a71-a3e6-ecb25d845ea3';  -- Shital Gawai
UPDATE public.chart_of_accounts SET opening_balance=2000.00, opening_balance_type='CR' WHERE id='ed91b12c-8c6d-4b4c-ae45-f7de20d7c983';  -- Shivani Uikey
UPDATE public.chart_of_accounts SET opening_balance=125400.00, opening_balance_type='DR' WHERE id='f06811c6-585c-4f12-9285-29ec35be44c7';  -- Shoib Sheikh (Receiption)
UPDATE public.chart_of_accounts SET opening_balance=24120.00, opening_balance_type='DR' WHERE id='9a6ca0b2-c2d7-4c81-9f85-311b37f439c7';  -- SHRAWANI ENTERPRISES
UPDATE public.chart_of_accounts SET opening_balance=189870.00, opening_balance_type='DR' WHERE id='874183ed-9529-4a19-ae83-84128c162ab0';  -- Shrawan Ingole
UPDATE public.chart_of_accounts SET opening_balance=33750.00, opening_balance_type='DR' WHERE id='5b85cfda-6185-4458-b441-97c9098966f3';  -- Shree Balaji Enterprises
UPDATE public.chart_of_accounts SET opening_balance=50000.00, opening_balance_type='CR' WHERE id='8253aebd-0b4d-499e-9aae-d987706a084f';  -- Shree Biomedical Services
UPDATE public.chart_of_accounts SET opening_balance=58250.00, opening_balance_type='DR' WHERE id='ad43aeff-64d6-475b-8aa2-f60d7c00244a';  -- Shree Medical & Surgical
UPDATE public.chart_of_accounts SET opening_balance=72772.00, opening_balance_type='DR' WHERE id='3fdf509a-d713-41c5-8e69-4d3e4b4fca53';  -- Shri Chinteshwar Agency
UPDATE public.chart_of_accounts SET opening_balance=130000.00, opening_balance_type='DR' WHERE id='e20b0fe2-5d45-478f-99ce-c4ec45c4ce94';  -- Shrikant Bhaelrao
UPDATE public.chart_of_accounts SET opening_balance=168580.00, opening_balance_type='DR' WHERE id='6582f984-8566-43d2-a8e7-d2acd4850513';  -- Shri Siddivinayak Surgicals
UPDATE public.chart_of_accounts SET opening_balance=10000.00, opening_balance_type='DR' WHERE id='8daa84f7-3121-48c5-a802-3c390f617519';  -- Shri Vitthal Ads
UPDATE public.chart_of_accounts SET opening_balance=0.00, opening_balance_type='DR' WHERE id='8daa84f7-3121-48c5-a802-3c390f617519';  -- Shri Vitthal Ads
UPDATE public.chart_of_accounts SET opening_balance=11200.00, opening_balance_type='DR' WHERE id='b811a279-1a90-40e4-9abb-303dfd78a444';  -- Shubhangla Gogale
UPDATE public.chart_of_accounts SET opening_balance=7720.00, opening_balance_type='DR' WHERE id='ba7e377c-5fb0-4c6a-bb4c-d90ba8ce7368';  -- SHUBH IRON HARDWARE
UPDATE public.chart_of_accounts SET opening_balance=13500.00, opening_balance_type='DR' WHERE id='4e9b6dce-3585-46b9-8535-633b5951c1f8';  -- Shweta Armarkar
UPDATE public.chart_of_accounts SET opening_balance=5000.00, opening_balance_type='CR' WHERE id='26d4526f-8b65-46b6-a582-1e7cba114edb';  -- Shyamu Tripathi UAHO25J11006
UPDATE public.chart_of_accounts SET opening_balance=8512.00, opening_balance_type='DR' WHERE id='deaff3d1-3bd1-4822-9a79-e49d44b85b48';  -- Simran Kohad (Sis)
UPDATE public.chart_of_accounts SET opening_balance=68530.00, opening_balance_type='CR' WHERE id='c1806b92-3033-4fec-9de3-6510e0bafbc4';  -- Sky Computers
UPDATE public.chart_of_accounts SET opening_balance=5600.00, opening_balance_type='DR' WHERE id='3e0e0ea8-6452-4d17-9f51-a453598ccc7a';  -- S L SALES
UPDATE public.chart_of_accounts SET opening_balance=2892646.23, opening_balance_type='DR' WHERE id='10ae8dcb-6d01-470b-b91e-b7cef75a67a2';  -- SMT CAROLINE KOLMAN AMMON
UPDATE public.chart_of_accounts SET opening_balance=30000.00, opening_balance_type='DR' WHERE id='603a194d-3d27-4b17-8462-865fe782c0af';  -- Sony Engineering
UPDATE public.chart_of_accounts SET opening_balance=16200.00, opening_balance_type='DR' WHERE id='e58f98fd-f08c-4422-bbe4-e1ef1cd7a6cf';  -- SSD Medical Supplies Pvt Ltd
UPDATE public.chart_of_accounts SET opening_balance=4842.99, opening_balance_type='DR' WHERE id='7ee79105-08f9-4a32-9ae8-0557ae829488';  -- Stablyzer Escon Type 03
UPDATE public.chart_of_accounts SET opening_balance=3780.00, opening_balance_type='DR' WHERE id='e932df23-0131-4c4c-8d32-3e4850480962';  -- State Bank of India
UPDATE public.chart_of_accounts SET opening_balance=230000.00, opening_balance_type='CR' WHERE id='f02b0c53-6f5b-497f-9b3d-083ffd48e29a';  -- STATE BANK OF INDIA ( MURALI SIR )
UPDATE public.chart_of_accounts SET opening_balance=151867.00, opening_balance_type='DR' WHERE id='38aa3083-ef8d-413e-a73e-ebfd3e838b47';  -- Superb Hygenic Disposals
UPDATE public.chart_of_accounts SET opening_balance=478720.00, opening_balance_type='DR' WHERE id='8960e4a3-d580-4ba8-8ea8-3d4f93118ec4';  -- Suraj Ramji Rajput
UPDATE public.chart_of_accounts SET opening_balance=4463449.57, opening_balance_type='DR' WHERE id='b7b35db3-3ec3-451f-882e-fb68a68552c5';  -- Suspenses A/c
UPDATE public.chart_of_accounts SET opening_balance=2000.00, opening_balance_type='DR' WHERE id='db742860-6660-402a-84f1-3061f7c6ee68';  -- Tahir Welders
UPDATE public.chart_of_accounts SET opening_balance=1800.00, opening_balance_type='DR' WHERE id='f0ae929f-23ca-4c37-a9e6-a36afa338427';  -- TALHA
UPDATE public.chart_of_accounts SET opening_balance=29200.00, opening_balance_type='DR' WHERE id='f7f4296c-8724-46bf-8403-6e4ab03a090f';  -- Talha Brother
UPDATE public.chart_of_accounts SET opening_balance=7112.29, opening_balance_type='DR' WHERE id='bd62a22d-bc53-45d7-92b2-4b90c6f2f58f';  -- Tally Tac LLP
UPDATE public.chart_of_accounts SET opening_balance=165333.00, opening_balance_type='DR' WHERE id='621c5e8c-db9d-40cf-a2cf-0e58774b237a';  -- Taufik Sheikh
UPDATE public.chart_of_accounts SET opening_balance=10549.00, opening_balance_type='DR' WHERE id='380c6e91-18fa-4eba-bcec-2889c9e04d38';  -- Tds on Cash Wdl
UPDATE public.chart_of_accounts SET opening_balance=10340.00, opening_balance_type='CR' WHERE id='3be9d120-aec7-436a-8c87-30693b84acdf';  -- TDS ON CONTRACT 194C
UPDATE public.chart_of_accounts SET opening_balance=1552645.92, opening_balance_type='CR' WHERE id='b62a2e9d-17b8-48cd-bac8-47d76a95c9a4';  -- Tds on Rent
UPDATE public.chart_of_accounts SET opening_balance=945.00, opening_balance_type='CR' WHERE id='c98d7e79-33fe-4006-aa15-5bcbdcb05c82';  -- Tds on Salary
UPDATE public.chart_of_accounts SET opening_balance=1405725.42, opening_balance_type='CR' WHERE id='48cfe14a-66fe-44cb-bd45-442e2bb4706c';  -- TDS PAYABLE
UPDATE public.chart_of_accounts SET opening_balance=419413.75, opening_balance_type='DR' WHERE id='04665a63-1e91-47d0-b84b-e75feb7cb9c7';  -- Tds Receivable
UPDATE public.chart_of_accounts SET opening_balance=131409.74, opening_balance_type='DR' WHERE id='c33e864f-99d6-4609-9ca4-52eb2e61c4fa';  -- Tds Receivable Fy 24-25
UPDATE public.chart_of_accounts SET opening_balance=195000.00, opening_balance_type='DR' WHERE id='2339bbeb-6ba2-45df-ae08-d7d7e06fef06';  -- Technomed Devices
UPDATE public.chart_of_accounts SET opening_balance=257133.00, opening_balance_type='DR' WHERE id='ff82fb86-20b6-4ac8-a82b-9a9c013bbb1e';  -- Tejaram Dalane (Bunty)
UPDATE public.chart_of_accounts SET opening_balance=5700.00, opening_balance_type='CR' WHERE id='98847cf3-b43a-4419-8c10-1b43564895b5';  -- THAARA ENTERPRISES
UPDATE public.chart_of_accounts SET opening_balance=14850.00, opening_balance_type='DR' WHERE id='a67cbb98-d392-443b-b469-52648178affc';  -- The Hitwada
UPDATE public.chart_of_accounts SET opening_balance=2200.00, opening_balance_type='DR' WHERE id='877059f7-b0fa-4d2b-b544-7fae932a82a8';  -- THYROCARE
UPDATE public.chart_of_accounts SET opening_balance=1178.73, opening_balance_type='DR' WHERE id='730a6223-b68d-4321-9f02-dc1773f1af5f';  -- TJSB Sahakari Bank Ltd
UPDATE public.chart_of_accounts SET opening_balance=20.00, opening_balance_type='DR' WHERE id='3bf5a8a1-da40-401f-a106-8fd91ec4f1d2';  -- tjsb sahkari bank (CDSILVER/5-NAGPUR BRANCH)
UPDATE public.chart_of_accounts SET opening_balance=5800.00, opening_balance_type='DR' WHERE id='e5400d25-362b-4ae1-a397-f350ebb63f7b';  -- True Scan Dental Diagnostics
UPDATE public.chart_of_accounts SET opening_balance=109503.00, opening_balance_type='DR' WHERE id='01e3622f-c63d-48d2-ace0-5fb7a1b3c688';  -- Trupti Gaikwad
UPDATE public.chart_of_accounts SET opening_balance=12296.95, opening_balance_type='DR' WHERE id='a1ec99a0-ffd1-40c6-b194-ecfe3ad5d9cd';  -- UPS Inbuilt Battery
UPDATE public.chart_of_accounts SET opening_balance=101133.00, opening_balance_type='DR' WHERE id='86b782c4-f022-4bdd-8673-7d595242f8f7';  -- Uttara Mauhsi
UPDATE public.chart_of_accounts SET opening_balance=1000.00, opening_balance_type='CR' WHERE id='a1c79061-af8c-4057-ade4-cedb4667e6af';  -- Vedant Baghel
UPDATE public.chart_of_accounts SET opening_balance=5000.00, opening_balance_type='DR' WHERE id='68bde9d9-54b0-4f4a-a645-e938dd38b191';  -- Vidarbha Diagnostics Center Pvt Ltd Galaxy
UPDATE public.chart_of_accounts SET opening_balance=1286857.32, opening_balance_type='DR' WHERE id='63add141-0088-4a41-b225-45a6bb5f4a23';  -- Vidarbh Air Product Pvt Ltd
UPDATE public.chart_of_accounts SET opening_balance=38665.76, opening_balance_type='CR' WHERE id='10128cad-9679-4274-a065-8defbe293edb';  -- Vidarbh Infotech Pvt Ltd
UPDATE public.chart_of_accounts SET opening_balance=2500.00, opening_balance_type='DR' WHERE id='ac1ce9f9-9d0d-4fff-a82b-f4afcd498b50';  -- Vijay Chatpaliwar (Housekeeping)
UPDATE public.chart_of_accounts SET opening_balance=115000.00, opening_balance_type='DR' WHERE id='f209e11d-d009-4a3e-bbfc-6a8366e5bbb4';  -- VIJI MAM MOHAN NAGAR RENT
UPDATE public.chart_of_accounts SET opening_balance=25000.00, opening_balance_type='DR' WHERE id='b9799623-f374-473f-a159-caff049f0703';  -- Vijiyalaxmi Murali
UPDATE public.chart_of_accounts SET opening_balance=55999.00, opening_balance_type='DR' WHERE id='85898fff-ada8-4b44-a35c-a83361013230';  -- Vinita Baghele
UPDATE public.chart_of_accounts SET opening_balance=29133.00, opening_balance_type='DR' WHERE id='2774e697-c0ab-459b-ba97-e07c889e575b';  -- Vishakha Wasnik (Maushi)
UPDATE public.chart_of_accounts SET opening_balance=76500.00, opening_balance_type='CR' WHERE id='e1d70db0-2b7d-4832-87a0-de6e472b29b0';  -- Vishal Ratnani & Co.
UPDATE public.chart_of_accounts SET opening_balance=12600.00, opening_balance_type='DR' WHERE id='d7c2577f-959c-476f-bbe1-c5c87700faab';  -- Vivek Brother
UPDATE public.chart_of_accounts SET opening_balance=130000.00, opening_balance_type='CR' WHERE id='f62ba0b3-f7a5-44f9-8f97-8129d38ad0d2';  -- Yash Bala
UPDATE public.chart_of_accounts SET opening_balance=4304.00, opening_balance_type='CR' WHERE id='c3ad3939-bf07-4eed-a10d-821735a14898';  -- Yash Enterprises
INSERT INTO public.chart_of_accounts (account_code, account_name, account_type, account_group, company_id, opening_balance, opening_balance_type, is_active)
SELECT 'OB25A_0001', 'DR Akhil  Jaiswal', 'EQUITY', 'Capital Account', '5a9cc083-a370-4867-bcde-6d064bebff26', 8000.00, 'DR', true
WHERE NOT EXISTS (SELECT 1 FROM public.chart_of_accounts WHERE company_id='5a9cc083-a370-4867-bcde-6d064bebff26' AND lower(btrim(account_name))=lower('DR Akhil  Jaiswal'));
INSERT INTO public.chart_of_accounts (account_code, account_name, account_type, account_group, company_id, opening_balance, opening_balance_type, is_active)
SELECT 'OB25A_0002', 'Dr. Azim Alam', 'CURRENT_LIABILITIES', 'Consultant', '5a9cc083-a370-4867-bcde-6d064bebff26', 3500.00, 'DR', true
WHERE NOT EXISTS (SELECT 1 FROM public.chart_of_accounts WHERE company_id='5a9cc083-a370-4867-bcde-6d064bebff26' AND lower(btrim(account_name))=lower('Dr. Azim Alam'));

-- ===== PHARMACY =====
UPDATE public.chart_of_accounts SET opening_balance=642165.38, opening_balance_type='DR' WHERE id='9402e69f-0350-4f0f-afe0-e4a40846b146';  -- Profit & Loss A/c
UPDATE public.chart_of_accounts SET opening_balance=13090.00, opening_balance_type='CR' WHERE id='2e96e576-48fd-4e0d-b07a-0de051eb087c';  -- ADARSH SALES
UPDATE public.chart_of_accounts SET opening_balance=19041.00, opening_balance_type='CR' WHERE id='a579a2f9-70ca-4b5a-8dbb-bca8ea743ae6';  -- ANKIT AGENCIES
UPDATE public.chart_of_accounts SET opening_balance=1515542.00, opening_balance_type='CR' WHERE id='39165e6f-26bd-46fe-9a40-537e1e0a8344';  -- Asian Surgical Co.
UPDATE public.chart_of_accounts SET opening_balance=16640.00, opening_balance_type='CR' WHERE id='d1be64fc-cfa6-4eb1-80c4-13242b8e99cd';  -- BRIGHTON PHARMA SOLUTIONS
UPDATE public.chart_of_accounts SET opening_balance=105888.00, opening_balance_type='CR' WHERE id='16987e4a-eb68-4775-a497-12b6c57bcb51';  -- Canara Bank
UPDATE public.chart_of_accounts SET opening_balance=2995152.00, opening_balance_type='DR' WHERE id='9764d7a7-0c46-4816-be26-d1524ba7fd25';  -- Cash
UPDATE public.chart_of_accounts SET opening_balance=13767.54, opening_balance_type='DR' WHERE id='2280a8f8-87e6-4740-b792-195e7aff3f84';  -- CGST
UPDATE public.chart_of_accounts SET opening_balance=580600.00, opening_balance_type='CR' WHERE id='33b58772-44ef-4b70-851d-d4084751c632';  -- FIRST PHARMACY
UPDATE public.chart_of_accounts SET opening_balance=550751.00, opening_balance_type='CR' WHERE id='6368046d-2f60-444a-b747-08aca08af31a';  -- HOSPIRUSH PHARMACY
UPDATE public.chart_of_accounts SET opening_balance=3641.00, opening_balance_type='CR' WHERE id='0405d2da-71cb-40c8-9453-cb82c06c26a7';  -- J JASWANTLAL & BROS. AGENCY
UPDATE public.chart_of_accounts SET opening_balance=24801.00, opening_balance_type='CR' WHERE id='6048aea2-51fb-4f44-8797-94fff99006bc';  -- Metro Medical Agencies
UPDATE public.chart_of_accounts SET opening_balance=19570.00, opening_balance_type='CR' WHERE id='1727699b-8931-47b4-8614-03d4364ed39b';  -- N. B. SALES
UPDATE public.chart_of_accounts SET opening_balance=27372.00, opening_balance_type='CR' WHERE id='f4e102a7-a0b4-48c6-b0b6-a0a72cdf89df';  -- NEETA AGENCIES
UPDATE public.chart_of_accounts SET opening_balance=97895.00, opening_balance_type='CR' WHERE id='5b832603-4570-430d-888f-1eba021a769b';  -- NEO PHARMA
UPDATE public.chart_of_accounts SET opening_balance=2730.00, opening_balance_type='CR' WHERE id='3d65572a-0964-41f6-b0bf-6a141f2b4473';  -- New Abhayankar
UPDATE public.chart_of_accounts SET opening_balance=23030.00, opening_balance_type='CR' WHERE id='d5dfa6bc-8826-4b44-bcea-3f46fb3c515e';  -- PUNIT MEDICAL STORE
UPDATE public.chart_of_accounts SET opening_balance=222.00, opening_balance_type='CR' WHERE id='a61621d9-8a99-44a6-84c4-7a774aa0aa8e';  -- RENUKA AGENCIES
UPDATE public.chart_of_accounts SET opening_balance=13772.08, opening_balance_type='DR' WHERE id='408f2c43-3a22-44d8-931d-2a87430e95e1';  -- SGST
UPDATE public.chart_of_accounts SET opening_balance=667221.00, opening_balance_type='CR' WHERE id='738ca5a1-6d5b-4257-a4f6-22041203c4b6';  -- SSV PHARMACEUTICAL AND DISTRIBUTOR
INSERT INTO public.chart_of_accounts (account_code, account_name, account_type, account_group, company_id, opening_balance, opening_balance_type, is_active)
SELECT 'OB25P_0001', 'IVAAN HEALTHCARE PVT LTD', 'CURRENT_LIABILITIES', 'Sundry Creditors', '05513224-58c5-4f6d-974d-78b9ff0de0d5', 3177.00, 'DR', true
WHERE NOT EXISTS (SELECT 1 FROM public.chart_of_accounts WHERE company_id='05513224-58c5-4f6d-974d-78b9ff0de0d5' AND lower(btrim(account_name))=lower('IVAAN HEALTHCARE PVT LTD'));
-- ===== Proof: every company's openings must net to zero =====
SELECT c.company_name,
       count(*) FILTER (WHERE COALESCE(a.opening_balance,0) <> 0) AS ledgers_with_opening,
       round(sum(CASE WHEN UPPER(COALESCE(a.opening_balance_type,'DR'))='CR'
                      THEN -COALESCE(a.opening_balance,0)
                      ELSE COALESCE(a.opening_balance,0) END)::numeric, 2) AS net_should_be_zero
  FROM public.chart_of_accounts a
  JOIN public.companies c ON c.id = a.company_id
 WHERE a.is_active
 GROUP BY c.company_name
 ORDER BY c.company_name;

NOTIFY pgrst, 'reload schema';

COMMIT;
