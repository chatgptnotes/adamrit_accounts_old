ALTER TABLE prescriptions
  ADD COLUMN IF NOT EXISTS patient_location TEXT
  CHECK (patient_location IN ('ICU', 'Ward', 'Room', 'OT'));
