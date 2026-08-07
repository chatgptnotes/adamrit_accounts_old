-- Test patient + visit for Patient Location (ICU/Ward/Room/OT) feature
-- Run this in Supabase SQL editor.

DO $$
DECLARE
  v_patient_id UUID;
  v_visit_id   UUID;
BEGIN
  INSERT INTO patients (name, age, gender, phone, corporate, hospital_name)
  VALUES ('Test Patient - Location Feature', 35, 'Male', '9999999999', 'private', 'hope')
  RETURNING id INTO v_patient_id;

  INSERT INTO visits (patient_id, visit_id, appointment_with, admission_date, status, hospital_name)
  VALUES (v_patient_id, 'TEST-LOC-001', 'Dr. Test Doctor', CURRENT_DATE, 'admitted', 'hope')
  RETURNING id INTO v_visit_id;

  RAISE NOTICE 'Done — patient_id=% visit_id=%', v_patient_id, v_visit_id;
END $$;
