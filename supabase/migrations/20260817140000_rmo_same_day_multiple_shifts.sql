-- One RMO can work morning, evening AND night on the same day.
--
-- THE COMPLAINT (17 Aug, Dr M): Gaurav's RMO duty tile will not accept the same
-- RMO for a second shift on the same date.
--
-- WHAT WAS ACTUALLY HAPPENING. The tile and the service are already shift-aware
-- -- addRmoDutyApproval's check-then-insert filters on duty_shift, so it was
-- happy to record a second shift. The block was underneath it, in the unique
-- index added by 20260802140000:
--
--   (reference_no, lower(party_name), COALESCE(company_id::text, ''))
--
-- reference_no is RMO-DUTY-<date>, identical for all three shifts of a day, and
-- duty_shift is not in the key. So the second shift for the same RMO on the
-- same day violated the index. That raises 23505, which
-- approval-queue-service.ts deliberately treats as "already recorded" and
-- reports back as created:false -- so the tile said "Already recorded" and the
-- RMO simply never got paid for that shift. A silent lost write on a money
-- path, which is the failure CLAUDE.md's rule 7 exists to stop.
--
-- Live evidence: 33 RMO-DUTY rows, all three shifts represented, and NOT ONE
-- case of the same RMO on two shifts in a day. Nobody had ever got a second
-- shift through.
--
-- THE FIX. Put duty_shift in the key. Uniqueness becomes one bill per RMO per
-- shift per day, which is still exactly the protection the original index was
-- written for -- a re-tap on the SAME shift is still refused, and two
-- concurrent taps still cannot both insert.
--
-- SALARY ROWS ARE UNAFFECTED. The index also covers SALARY-<yyyy-mm>, whose
-- rows carry duty_shift IS NULL. COALESCE(duty_shift, '') maps every one of
-- them to the same '' , so a salary month stays one bill per party per company
-- exactly as before. Verified below rather than asserted.
--
-- NO REHEARSAL INSERT. This deliberately does not test itself by inserting a
-- duty row and deleting it: approval_queue is the accounting approval queue,
-- and a rehearsal that leaves anything behind is the 17-Aug ghost-notification
-- incident (20260817120000). The index definition is checked directly instead.

DO $change$
BEGIN
  -- Build the replacement BEFORE dropping the old one, so the table is never
  -- left unprotected -- if this migration fails halfway, the original still
  -- stands and duplicates still cannot get in.
  CREATE UNIQUE INDEX IF NOT EXISTS approval_queue_duty_salary_shift_uniq
    ON public.approval_queue (
      reference_no,
      lower(party_name),
      COALESCE(company_id::text, ''),
      COALESCE(duty_shift, '')
    )
    WHERE (reference_no LIKE 'RMO-DUTY-%' OR reference_no LIKE 'SALARY-%')
      AND status <> 'REJECTED';

  DROP INDEX IF EXISTS public.approval_queue_duty_salary_reference_uniq;
END
$change$;

DO $verify$
DECLARE
  v_def TEXT;
  v_old INT;
  v_dupes INT;
BEGIN
  SELECT indexdef INTO v_def
    FROM pg_indexes
   WHERE schemaname = 'public' AND indexname = 'approval_queue_duty_salary_shift_uniq';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'ABORT: the replacement index was not created';
  END IF;

  -- The whole point of the change: the shift must be part of the key.
  IF position('duty_shift' IN v_def) = 0 THEN
    RAISE EXCEPTION 'ABORT: duty_shift is not in the index: %', v_def;
  END IF;

  -- And it must still be UNIQUE and still scoped to the two reference families,
  -- or this has quietly removed the duplicate protection instead of refining it.
  IF position('UNIQUE' IN v_def) = 0 THEN
    RAISE EXCEPTION 'ABORT: the replacement is not a unique index: %', v_def;
  END IF;
  IF position('RMO-DUTY-' IN v_def) = 0 OR position('SALARY-' IN v_def) = 0 THEN
    RAISE EXCEPTION 'ABORT: the replacement lost its reference-family scope: %', v_def;
  END IF;
  IF position('REJECTED' IN v_def) = 0 THEN
    RAISE EXCEPTION 'ABORT: rejected rows would now block the corrected entry: %', v_def;
  END IF;

  SELECT count(*) INTO v_old FROM pg_indexes
   WHERE schemaname = 'public' AND indexname = 'approval_queue_duty_salary_reference_uniq';
  IF v_old > 0 THEN
    RAISE EXCEPTION 'ABORT: the old day-wide index is still there and would still block the second shift';
  END IF;

  -- Salary must still be one bill per party per company per month. If any
  -- month already held duplicates the new index could not have been built, but
  -- state it plainly so the guarantee is on the record rather than implied.
  SELECT count(*) INTO v_dupes FROM (
    SELECT reference_no, lower(party_name) AS p, COALESCE(company_id::text, '') AS c
      FROM public.approval_queue
     WHERE reference_no LIKE 'SALARY-%' AND status <> 'REJECTED'
     GROUP BY 1, 2, 3
    HAVING count(*) > 1
  ) d;
  IF v_dupes > 0 THEN
    RAISE EXCEPTION 'ABORT: % salary month(s) now hold duplicate bills', v_dupes;
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
