-- Shift-wise RMO duty: morning / evening / night, each with its own rate.
--
-- The duty entry stops carrying a typed amount — the person recording the
-- duty picks only the RMO and the shift, and the payable comes from the
-- shift rate on the RMO master. The shift is stored on the bill so the
-- monthly report can count an RMO's morning / evening / night duties and
-- total what they earned.

ALTER TABLE public.hope_rmos
  ADD COLUMN IF NOT EXISTS morning_rate NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS evening_rate NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS night_rate NUMERIC(12,2);

ALTER TABLE public.ayushman_rmos
  ADD COLUMN IF NOT EXISTS morning_rate NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS evening_rate NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS night_rate NUMERIC(12,2);

ALTER TABLE public.approval_queue
  ADD COLUMN IF NOT EXISTS duty_shift TEXT;

NOTIFY pgrst, 'reload schema';
