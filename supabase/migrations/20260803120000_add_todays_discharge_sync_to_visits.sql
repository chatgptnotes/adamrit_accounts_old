-- Arshiya's "Today’s Discharge" marker is a small, independent worklist
-- signal for Azhar's Documents tile. It intentionally does not replace the
-- existing discharge intimation or planned-discharge/billing workflow fields.
ALTER TABLE public.visits
  ADD COLUMN IF NOT EXISTS todays_discharge_marked BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS visits_todays_discharge_active_idx
  ON public.visits (admission_date)
  WHERE todays_discharge_marked = TRUE
    AND discharge_date IS NULL
    AND COALESCE(is_discharged, FALSE) = FALSE;

-- Preserve the current active selection when this is rolled out. Historical
-- and already discharged visits are deliberately not changed.
UPDATE public.visits
SET todays_discharge_marked = TRUE
WHERE planned_discharge_date = CURRENT_DATE
  AND discharge_date IS NULL
  AND COALESCE(is_discharged, FALSE) = FALSE
  AND todays_discharge_marked = FALSE;

COMMENT ON COLUMN public.visits.todays_discharge_marked IS
  'Internal Arshiya-to-Azhar live worklist marker. True only while the visit should appear in Azhar Documents Today’s Discharge list.';

NOTIFY pgrst, 'reload schema';
