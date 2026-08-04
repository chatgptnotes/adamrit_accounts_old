-- Migration: Add category support columns to implants table
-- Date: 2026-04-07

ALTER TABLE implants
  ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'General',
  ADD COLUMN IF NOT EXISTS subcategory TEXT,
  ADD COLUMN IF NOT EXISTS manufacturer TEXT,
  ADD COLUMN IF NOT EXISTS model_number TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS hsn_code TEXT,
  ADD COLUMN IF NOT EXISTS gst_percentage NUMERIC(5,2) DEFAULT 5;

-- Unique constraint on name (needed for ON CONFLICT DO NOTHING seeding)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'implants_name_unique'
  ) THEN
    ALTER TABLE implants ADD CONSTRAINT implants_name_unique UNIQUE (name);
  END IF;
END $$;

-- Seed common implants
INSERT INTO implants (name, category, subcategory, nabh_nabl_rate, non_nabh_nabl_rate, private_rate, bhopal_nabh_rate, bhopal_non_nabh_rate, gst_percentage)
VALUES

-- Orthopedic - Trauma Fixation
('DHS Plate', 'Orthopedic', 'Trauma Fixation', 0, 0, 0, 0, 0, 5),
('DHS Screw', 'Orthopedic', 'Trauma Fixation', 0, 0, 0, 0, 0, 5),
('Dynamic Compression Plate (DCP)', 'Orthopedic', 'Trauma Fixation', 0, 0, 0, 0, 0, 5),
('Locking Compression Plate (LCP)', 'Orthopedic', 'Trauma Fixation', 0, 0, 0, 0, 0, 5),
('Cancellous Screw', 'Orthopedic', 'Trauma Fixation', 0, 0, 0, 0, 0, 5),
('Cortical Screw', 'Orthopedic', 'Trauma Fixation', 0, 0, 0, 0, 0, 5),
('K-Wire', 'Orthopedic', 'Trauma Fixation', 0, 0, 0, 0, 0, 5),
('Distal Femoral Locking Plate', 'Orthopedic', 'Trauma Fixation', 0, 0, 0, 0, 0, 5),

-- Orthopedic - Nails
('Proximal Femoral Nail (PFN)', 'Orthopedic', 'Trauma Fixation', 0, 0, 0, 0, 0, 5),
('Tibial Interlocking Nail', 'Orthopedic', 'Trauma Fixation', 0, 0, 0, 0, 0, 5),

-- Orthopedic - Hip
('Total Hip Replacement (THR)', 'Orthopedic', 'Hip', 0, 0, 0, 0, 0, 5),
('Austin Moore Prosthesis', 'Orthopedic', 'Hip', 0, 0, 0, 0, 0, 5),
('Bipolar Hip Prosthesis', 'Orthopedic', 'Hip', 0, 0, 0, 0, 0, 5),

-- Orthopedic - Knee
('Total Knee Replacement (TKR)', 'Orthopedic', 'Knee', 0, 0, 0, 0, 0, 5),

-- Cardiac - Stent
('Drug Eluting Stent (DES)', 'Cardiac', 'Stent', 0, 0, 0, 0, 0, 12),
('Bare Metal Stent (BMS)', 'Cardiac', 'Stent', 0, 0, 0, 0, 0, 12),

-- Cardiac - Pacemaker
('Permanent Pacemaker (Single Chamber)', 'Cardiac', 'Pacemaker', 0, 0, 0, 0, 0, 12),
('Permanent Pacemaker (Dual Chamber)', 'Cardiac', 'Pacemaker', 0, 0, 0, 0, 0, 12),
('AICD / ICD', 'Cardiac', 'Pacemaker', 0, 0, 0, 0, 0, 12),

-- Cardiac - Valve
('Mechanical Heart Valve', 'Cardiac', 'Valve', 0, 0, 0, 0, 0, 12),
('Bioprosthetic Heart Valve', 'Cardiac', 'Valve', 0, 0, 0, 0, 0, 12),

-- Spinal
('Pedicle Screw System', 'Spinal', 'Spinal Rod', 0, 0, 0, 0, 0, 5),
('Cervical Cage', 'Spinal', 'Cervical', 0, 0, 0, 0, 0, 5),
('Lumbar Cage', 'Spinal', 'Lumbar', 0, 0, 0, 0, 0, 5),
('Spinal Rod', 'Spinal', 'Spinal Rod', 0, 0, 0, 0, 0, 5),

-- General
('Mesh (Hernia)', 'General', 'Mesh', 0, 0, 0, 0, 0, 5),
('IOL (Intraocular Lens)', 'Ophthalmic', 'IOL', 0, 0, 0, 0, 0, 5),
('Cochlear Implant', 'ENT', 'Cochlear', 0, 0, 0, 0, 0, 5),
('Dialysis Catheter', 'General', 'Catheter', 0, 0, 0, 0, 0, 5),
('Central Venous Catheter', 'General', 'Catheter', 0, 0, 0, 0, 0, 5)

ON CONFLICT (name) DO NOTHING;

NOTIFY pgrst, 'reload schema';
