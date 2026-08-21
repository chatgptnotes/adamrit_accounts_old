-- What the surgeon and the anaesthetist are paid for this case.
--
-- Both names are now picked from the doctor masters on the OT Schedule tile
-- (never typed by hand), and the amount pre-fills from that master's rate —
-- the surgeon's private rate, the anaesthetist's general or spinal rate
-- depending on the anaesthesia. It stays editable, because a case is
-- sometimes worth more or less than the standing rate.

ALTER TABLE public.ot_schedule
  ADD COLUMN IF NOT EXISTS surgeon_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS anesthetist_amount NUMERIC(12,2);

NOTIFY pgrst, 'reload schema';
