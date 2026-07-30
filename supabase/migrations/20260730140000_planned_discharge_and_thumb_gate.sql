-- Planned discharge list, and the thumb-confirmation gate in front of it.
--
-- Two gaps this closes.
--
-- First, "who is going home today" is decided verbally in the 9 a.m. meeting
-- and recorded nowhere, so the billing desk has no worklist and no way to tell
-- a planned discharge from a patient who simply happens to be admitted.
--
-- Second, and more serious: the government portal requires a thumb impression
-- and a geotagged photo before a patient leaves. Nothing in the system enforces
-- that ordering today, so a gate pass can be printed and the visit closed while
-- the portal upload is still pending. Once the patient has walked out it cannot
-- be redone.
--
-- planned_discharge_date is deliberately a date rather than a boolean: a visit
-- counts as planned only when it equals today, so a tick nobody acted on
-- expires by itself overnight instead of accumulating into a stale list.
--
-- The confirmation photo itself is not stored here. It reuses file_uploads
-- under the category discharge_thumb_confirmation, which already carries the
-- latitude/longitude/capture_source columns the geotag requirement needs.

ALTER TABLE public.visits
  ADD COLUMN IF NOT EXISTS planned_discharge_date DATE,
  ADD COLUMN IF NOT EXISTS planned_discharge_marked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS planned_discharge_marked_by TEXT,
  ADD COLUMN IF NOT EXISTS discharge_billing_staff TEXT,
  ADD COLUMN IF NOT EXISTS arshiya_discharge_summary TEXT;

CREATE INDEX IF NOT EXISTS visits_planned_discharge_date_idx
  ON public.visits (planned_discharge_date)
  WHERE planned_discharge_date IS NOT NULL;

COMMENT ON COLUMN public.visits.planned_discharge_date IS
  'Date this visit was marked for discharge in the morning meeting. The visit shows under "Planned for discharge today" only while this equals the current date, so an unactioned tick expires on its own.';

COMMENT ON COLUMN public.visits.planned_discharge_marked_at IS
  'When the discharge was planned. Also fixes which billing shift owns it, so ownership does not move when the clock passes 4 p.m.';

COMMENT ON COLUMN public.visits.planned_discharge_marked_by IS
  'User id of whoever ticked the discharge checkbox.';

COMMENT ON COLUMN public.visits.discharge_billing_staff IS
  'Billing staffer on shift when the discharge was planned: Arshia 9 a.m. to 4 p.m., Azar from 4 p.m. Resolved once at tick time and stored, not recomputed on read.';

COMMENT ON COLUMN public.visits.arshiya_discharge_summary IS
  'Text of the AI-generated Arshiya discharge summary. Stored because only the rendered PDF was persisted before, and the with-logo and without-logo variants have to be re-rendered from the source text.';

NOTIFY pgrst, 'reload schema';
