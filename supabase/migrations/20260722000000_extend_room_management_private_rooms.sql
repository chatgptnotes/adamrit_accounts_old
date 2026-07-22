-- Private Room Master: extend the existing room_management ward/bed inventory
-- with per-room private-room attributes, and seed the Second Floor private
-- rooms (22, 24, 26, 27, 28, 29) for Hope. Individual private rooms are modelled
-- as room_management rows (is_private = true), so the IPD "Room Allotted"
-- dropdown, occupancy calc, and the Reena tile keep reading a single source.
--
-- Run this in the Supabase dashboard SQL Editor (project xvkxccqaopbnkvwgyfjv).
-- Safe to run twice.

-- 1. New per-room columns (bed count already lives in maximum_rooms).
ALTER TABLE public.room_management
  ADD COLUMN IF NOT EXISTS is_private            BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_attached_washroom BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS floor                 TEXT,
  ADD COLUMN IF NOT EXISTS room_number           TEXT;

CREATE INDEX IF NOT EXISTS idx_room_management_is_private
  ON public.room_management(is_private);

-- 2. Seed the six Second Floor private rooms for Hope (idempotent on ward_id).
--    maximum_rooms = bed count. Room 29's bed count is a placeholder (1) and can
--    be updated later from the Private Room Master screen.
INSERT INTO public.room_management
  (ward_type, location, ward_id, maximum_rooms, hospital_name,
   is_private, has_attached_washroom, floor, room_number)
SELECT v.ward_type, 'Hope Group', v.ward_id, v.maximum_rooms, 'hope',
       true, v.has_attached_washroom, 'Second Floor', v.room_number
FROM (VALUES
  ('Second Floor - Room No. 22', 'PVTHOP022', 1, false, '22'),
  ('Second Floor - Room No. 24', 'PVTHOP024', 1, true,  '24'),
  ('Second Floor - Room No. 26', 'PVTHOP026', 2, true,  '26'),
  ('Second Floor - Room No. 27', 'PVTHOP027', 2, true,  '27'),
  ('Second Floor - Room No. 28', 'PVTHOP028', 2, true,  '28'),
  ('Second Floor - Room No. 29', 'PVTHOP029', 1, true,  '29')
) AS v(ward_type, ward_id, maximum_rooms, has_attached_washroom, room_number)
WHERE NOT EXISTS (
  SELECT 1 FROM public.room_management r WHERE r.ward_id = v.ward_id
);

-- 3. Let PostgREST see the new columns immediately.
NOTIFY pgrst, 'reload schema';
