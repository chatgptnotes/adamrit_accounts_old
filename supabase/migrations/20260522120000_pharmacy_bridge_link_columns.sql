-- Bridge tablet treatment-sheet approvals into the desktop pharmacy queue.
--
-- When a doctor approves a medicine on the tablet (visit_medications), the app
-- creates a normal `prescriptions` + `prescription_items` record so it flows
-- through the existing desktop pharmacy (notification -> dispense -> billing),
-- unchanged. These columns link the two so we can dedup and keep dispense
-- status in sync (see 20260522120001_pharmacy_bridge_dispense_sync.sql).
--
-- Additive + idempotent. RLS on both tables is already permissive (anon FOR ALL).

ALTER TABLE public.prescriptions
  ADD COLUMN IF NOT EXISTS visit_id uuid,
  ADD COLUMN IF NOT EXISTS source  text NOT NULL DEFAULT 'desktop';
-- source: 'desktop' = camera/manual (existing); 'ward' = bridged from tablet.

ALTER TABLE public.prescription_items
  ADD COLUMN IF NOT EXISTS visit_medication_id uuid;

-- Dedup: one prescription_item per source visit_medications row. Partial so the
-- many existing NULL rows (camera/manual items) are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS uq_prescription_items_visit_medication_id
  ON public.prescription_items (visit_medication_id)
  WHERE visit_medication_id IS NOT NULL;

-- Fast find-or-create of the open ward prescription for a visit.
CREATE INDEX IF NOT EXISTS idx_prescriptions_visit_id
  ON public.prescriptions (visit_id)
  WHERE visit_id IS NOT NULL;

-- PostgREST caches the schema; refresh so the new columns are usable.
NOTIFY pgrst, 'reload schema';
