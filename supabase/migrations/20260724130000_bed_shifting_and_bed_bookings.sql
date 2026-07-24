-- Bed Shifting + Bed Booking (tablet tiles).
--
-- 1. ward_shiftings gains bed-level from/to columns. The existing from_ward /
--    shifting_ward columns keep holding room_management.ward_type NAMES so the
--    desktop Shifting page and useShiftingAccommodation (FinalBill accommodation
--    generation) are unaffected.
-- 2. bed_bookings reserves a free bed for an incoming patient. A bed is
--    "booked" (orange) while a row with status = 'booked' exists for it.
--
-- Occupancy itself is NOT stored: a bed is occupied when an undischarged visit
-- carries ward_allotted = room_management.ward_id and room_allotted = bed number.
--
-- Run this in the Supabase dashboard SQL Editor (project xvkxccqaopbnkvwgyfjv).
-- Safe to run twice.

-- 1. Bed-level shift history --------------------------------------------------
ALTER TABLE public.ward_shiftings
  ADD COLUMN IF NOT EXISTS from_ward_id TEXT,
  ADD COLUMN IF NOT EXISTS from_room    TEXT,
  ADD COLUMN IF NOT EXISTS from_bed     TEXT,
  ADD COLUMN IF NOT EXISTS to_ward_id   TEXT,
  ADD COLUMN IF NOT EXISTS to_room      TEXT,
  ADD COLUMN IF NOT EXISTS to_bed       TEXT,
  ADD COLUMN IF NOT EXISTS shifted_by   TEXT;

CREATE INDEX IF NOT EXISTS ward_shiftings_visit_date_idx
  ON public.ward_shiftings (visit_id, shifting_date DESC);

-- 2. Bed bookings -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bed_bookings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_name TEXT,
  ward_id       TEXT NOT NULL,            -- room_management.ward_id
  bed_number    TEXT NOT NULL,            -- matches visits.room_allotted
  visit_id      UUID REFERENCES public.visits(id),
  patient_name  TEXT NOT NULL,
  patients_id   TEXT,
  booked_from   TIMESTAMPTZ NOT NULL DEFAULT now(),
  booked_until  TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'booked'
                CHECK (status IN ('booked', 'released', 'converted')),
  remark        TEXT,
  created_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Hard backstop against double-booking: one live booking per bed.
CREATE UNIQUE INDEX IF NOT EXISTS bed_bookings_active_bed_idx
  ON public.bed_bookings (ward_id, bed_number)
  WHERE status = 'booked';

CREATE INDEX IF NOT EXISTS bed_bookings_hospital_status_idx
  ON public.bed_bookings (hospital_name, status);

ALTER TABLE public.bed_bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bed_bookings_select" ON public.bed_bookings;
CREATE POLICY "bed_bookings_select"
  ON public.bed_bookings FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "bed_bookings_insert" ON public.bed_bookings;
CREATE POLICY "bed_bookings_insert"
  ON public.bed_bookings FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Update is used only to release / convert a booking.
DROP POLICY IF EXISTS "bed_bookings_update" ON public.bed_bookings;
CREATE POLICY "bed_bookings_update"
  ON public.bed_bookings FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- 3. Let PostgREST see the new columns / table immediately.
NOTIFY pgrst, 'reload schema';
