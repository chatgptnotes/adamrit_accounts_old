-- Clear cash alerts that point at handovers which no longer exist.
--
-- WHAT WAS FOUND (17 Aug). Nisha Sharma was holding two bell notifications --
-- "CMD handed you Rs 450 at the counter (CH-260817-0022)" and "CMD handed you
-- Rs 500 at Hope Hospital (CH-260816-0020)" -- and Ruchika one, for
-- CH-260815-0017. None of that cash ever existed. All three handovers had
-- already been deleted; only the alerts survived.
--
-- WHERE THEY CAME FROM. trg_notify_cash_handover (20260813350000) fires on
-- INSERT INTO cash_handovers and tells the receiver to acknowledge the money.
-- Several migrations rehearse a handover against the live database and tear it
-- down afterwards -- 20260815xxxxx, 20260816240000, 20260817100000 -- and
-- every one of those teardowns deletes the handover, its denominations and its
-- sources, but never the notification the trigger raised. So each rehearsal
-- left a real person told to confirm money that was never handed to them, on a
-- record that no longer exists.
--
-- 20260817100000 now deletes its own notification and asserts none is left
-- behind. This clears the ones already sitting there, and is written against
-- the orphan condition rather than three ids so that any straggler from a
-- migration not yet examined goes with them.
--
-- NOTHING REAL IS TOUCHED. The condition is "no cash_handovers row with this
-- id", so a live handover's alert cannot match. CH-260817-0023 (Ayushman, 68
-- sources, ACCEPTED), CH-260816-0021, CH-260816-0019 and CH-260815-0018 all
-- keep theirs. The verify block proves it both ways: zero orphans after, and
-- every surviving alert still resolves to a handover.

DO $fix$
DECLARE
  v_before INT; v_deleted INT; v_after INT; v_kept INT; v_dangling INT;
BEGIN
  SELECT count(*) INTO v_before
    FROM notifications n
   WHERE n.source_table = 'cash_handovers'
     AND NOT EXISTS (SELECT 1 FROM cash_handovers h WHERE h.id::TEXT = n.source_id);

  RAISE NOTICE 'orphaned handover notifications before: %', v_before;

  DELETE FROM notifications n
   WHERE n.source_table = 'cash_handovers'
     AND NOT EXISTS (SELECT 1 FROM cash_handovers h WHERE h.id::TEXT = n.source_id);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted <> v_before THEN
    RAISE EXCEPTION 'ABORT: counted % orphans but deleted %', v_before, v_deleted;
  END IF;

  -- None left.
  SELECT count(*) INTO v_after
    FROM notifications n
   WHERE n.source_table = 'cash_handovers'
     AND NOT EXISTS (SELECT 1 FROM cash_handovers h WHERE h.id::TEXT = n.source_id);
  IF v_after <> 0 THEN
    RAISE EXCEPTION 'ABORT: % orphaned notification(s) still present', v_after;
  END IF;

  -- And the real ones survived: every alert that remains resolves to a
  -- handover, and there is still a body of them. A delete that swept the table
  -- clean would be a failure, not a success.
  SELECT count(*) INTO v_kept FROM notifications WHERE source_table = 'cash_handovers';
  SELECT count(*) INTO v_dangling
    FROM notifications n
   WHERE n.source_table = 'cash_handovers'
     AND NOT EXISTS (SELECT 1 FROM cash_handovers h WHERE h.id::TEXT = n.source_id);
  IF v_kept = 0 THEN
    RAISE EXCEPTION 'ABORT: every handover notification was removed, expected the live ones to remain';
  END IF;
  IF v_dangling <> 0 THEN
    RAISE EXCEPTION 'ABORT: % surviving alert(s) still point at nothing', v_dangling;
  END IF;

  RAISE NOTICE 'removed % ghost alert(s); % genuine handover alert(s) kept', v_deleted, v_kept;
END
$fix$;
