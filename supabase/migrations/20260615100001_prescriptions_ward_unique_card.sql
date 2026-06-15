-- Guard against duplicate ward pharmacy cards from the approve race.
--
-- The tablet bridge does find-or-create of "the open ward card for this visit
-- today". Two medicines approved within the same instant can both miss the card
-- and each INSERT one, producing two duplicate cards for one visit/day. This
-- partial unique index makes a visit have at most one non-cancelled ward card
-- per day; the bridge now catches the resulting 23505 and reuses the winner's
-- card (see src/lib/ward-prescription-bridge.ts).
--
-- Requires the backfill (20260615100000) to have collapsed any pre-existing
-- duplicates first. Partial + IF NOT EXISTS, so it is safe and idempotent and
-- leaves desktop/camera prescriptions (source <> 'ward') untouched.

CREATE UNIQUE INDEX IF NOT EXISTS uq_prescriptions_ward_open_per_visit_day
  ON public.prescriptions (visit_id, prescription_date)
  WHERE source = 'ward' AND status <> 'CANCELLED';

NOTIFY pgrst, 'reload schema';
