-- The nine claims from the ESIC scrutiny sheet dated Aug 2026, loaded so the
-- Remark tab opens with real work in it rather than an empty table.
--
-- These arrived as pasted text, not as a spreadsheet, so they could not go in
-- through the tab's Import Excel button. Everything after this batch should.
--
-- The ON CONFLICT clause mirrors what the import does: it refreshes the portal's
-- own fields and never touches justification, so running this twice — or
-- re-importing the same claims from Excel later — cannot erase a written reply.
--
-- Requires 20260801160000_create_esic_claim_remarks.sql. Safe to run twice.

INSERT INTO public.esic_claim_remarks
  (hospital_name, claim_id, hospital, card_id, uhid, beneficiary_name, patient_name,
   admission_type, process_stage, approved_amount, l2_remark)
VALUES
  ('hope', '6861380', 'Hope Hospital Nagpur Sst', '2304322062', 'MH01.0019512652',
   'Mr.suraj Madhukar Thete .', 'Mr. Suraj Madhukar Thete .', 'In', 'Scrutinizer Verified', 82666,
   'kindly provide original referral letter and treating doctor sign and stamp and attestation on ipd, prescription'),

  ('hope', '7119391', 'Hope Hospital Nagpur Sst', '2304592433', 'MH01.0022377365',
   'Mrs.saiyyad Najiya Ali .', 'Mrs. Saiyyad Najiya Ali .', 'In', 'Scrutinizer Verified', 56821,
   NULL),

  ('hope', '6749027', 'Hope Hospital Nagpur Sst', '1014702135', 'SOMN.0000058108',
   'Mr.himmat Ashok Dhore .', 'Master Parth Dhore', 'In', 'Scrutinizer Verified', 57162,
   'kindly provide following documents for further scrutiny, 1.extension of stay from competent ESIC authority, 2.sign and stamp of treating doctor on DS,IPD,prescription, 3.pathologist sign and stamp on pathology report and 4. justification for prolonged stay from treating doctor'),

  ('hope', '6741605', 'Hope Hospital Nagpur Sst', '2303818033', 'MH01.0013721869',
   'Mr. Amit Bais', 'Master Meet Amit Bais', 'In', 'Scrutinizer Verified', 91441,
   'VALIDITY OF EXTENSION LETTER ATTACHED IS ONLY UPTO 25/4/25, BUT AS PER RECORDS DOD IS ON 29/4/25. KINDLY PROVIDE JUSTIFICATION FOR SAME, FOR FURTHER PROCESSING OF BILL'),

  ('hope', '6780689', 'Hope Hospital Nagpur Sst', '2303464593', 'MH01.0008322925',
   'Mr. Sachin Dhanraj Meshram', 'Ms. Chaitali Sachin Meshram', 'In', 'Scrutinizer Verified', 24793,
   'kindly provide following documents for further scrutiny, 1.extension of stay from competent ESIC authority, 2.sign and stamp of treating doctor on DS,IPD,prescription, 3.pathologist sign and stamp on pathology report and 4. justification for prolonged stay from treating doctor'),

  ('hope', '6993151', 'Hope Hospital Nagpur Sst', '2302739903', 'SOMN.0000005978',
   'Mr.sandip Manikrao Pande', 'Ms. Mrs. Yogita', 'In', 'Scrutinizer Verified', 147542,
   NULL),

  ('hope', '6949699', 'Hope Hospital Nagpur Sst', '2302985277', 'NAGK.0000005681',
   'Mr.lakhan Lal Kesuram Shahu', 'Mr. Lakhan Lal Kesuram Shahu', 'In', 'Scrutinizer Verified', 147744,
   NULL),

  ('hope', '7089774', 'Hope Hospital Nagpur Sst', '2303147720', 'SOMW.0000013417',
   'Mr. Hemant Chafle', 'Mr. Hemant Chafle', 'In', 'Scrutinizer Verified', 78807,
   NULL),

  ('hope', '6872963', 'Hope Hospital Nagpur Sst', '2303909607', 'MH01.0015177601',
   'Mrs.roshani Siddharath Meshram .', 'Mrs. Samruddhi Siddarth Meshram', 'In', 'Scrutinizer Verified', 117280,
   NULL)

ON CONFLICT (hospital_name, claim_id) DO UPDATE SET
  hospital         = EXCLUDED.hospital,
  card_id          = EXCLUDED.card_id,
  uhid             = EXCLUDED.uhid,
  beneficiary_name = EXCLUDED.beneficiary_name,
  patient_name     = EXCLUDED.patient_name,
  admission_type   = EXCLUDED.admission_type,
  process_stage    = EXCLUDED.process_stage,
  approved_amount  = EXCLUDED.approved_amount,
  l2_remark        = EXCLUDED.l2_remark,
  updated_at       = now();

NOTIFY pgrst, 'reload schema';
