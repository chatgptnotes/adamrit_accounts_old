-- One spelling per job.
--
-- The same role was stored two ways: "Billing" for Shashank, Rizwaq and Azhey
-- against "billing" for eight colleagues; "Receptionist" for Diksha against
-- "receptionist" for Nisha; "Pharmacy" for Ruchika against "pharmacy". Several
-- permission checks compare the role as typed rather than lower-cased, so two
-- people doing the identical job saw different screens -- Diksha was denied
-- things Nisha could reach, for no reason either of them could have guessed.
--
-- Applied with the owner's agreement, knowing it widens access for the three
-- "Billing" users to match the other eight, the Director Dashboard included.
--
-- Idempotent: it lower-cases any role that is not already lower-case, so it
-- also repairs anything typed in mixed case later. "Feedback" (Sonam Masih) is
-- deliberately left alone -- it is not a job, and lower-casing it would only
-- make a wrong role look tidy.

UPDATE public."User"
   SET role = lower(btrim(role))
 WHERE role IS NOT NULL
   AND btrim(role) <> ''
   AND role <> lower(btrim(role))
   AND lower(btrim(role)) <> 'feedback';

DO $verify$
DECLARE v_left TEXT;
BEGIN
  SELECT string_agg(DISTINCT role, ', ') INTO v_left
    FROM public."User"
   WHERE role IS NOT NULL
     AND btrim(role) <> ''
     AND role <> lower(btrim(role))
     AND lower(btrim(role)) <> 'feedback';
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: roles still stored in mixed case: %', v_left;
  END IF;

  -- The pairs that caused it must now be single.
  IF EXISTS (
    SELECT 1 FROM public."User"
     WHERE role IN ('Billing', 'Receptionist', 'Pharmacy')
  ) THEN
    RAISE EXCEPTION 'ABORT: a capitalised duplicate survived';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
