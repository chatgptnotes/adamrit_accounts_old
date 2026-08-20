-- The relationship manager is decided at registration and never again.
--
-- THE INSTRUCTION (20 Aug, Dr M): the referee/RM must not be editable after
-- admission — OPD admission as well as IPD — "fixed with no override, not
-- editable means nobody, not you, not accounts". Corrections, if one is ever
-- truly needed, are a database change made deliberately and on the record.
--
-- WHY THE RULE IS "SET ONCE" AND NOT "NEVER UPDATE". Registration writes the RM
-- in TWO statements: it INSERTs the visit carrying relationship_manager_id, then
-- calls set_visit_relationship_managers() for the multi-RM rows
-- (VisitRegistrationForm.tsx:654). A blanket "no update after insert" would
-- refuse the second half of registering a patient. So the rule is that the FIRST
-- set stands: a visit with no RM may be given one, and a visit that has one may
-- never have it changed or removed.
--
-- WHERE THE EDITING WAS HAPPENING. The Director Dashboard's daily revenue report
-- offers a checkbox list of managers per row; that writes through
-- set_daily_revenue_relationship_managers, which calls
-- set_visit_relationship_managers in turn (20260805120000:135). Closing the
-- setter therefore closes the screen Dr M photographed, without touching it.
--
-- AND THE TABLES ARE GUARDED TOO, not just the setter. PostgREST exposes visits
-- and visit_relationship_managers directly, so a rule that lived only in the
-- function would be one .update() away from being bypassed. Enforced at entry,
-- in BEFORE triggers that only raise.

-- ------------------------------------------------- 1. the setter holds the line

CREATE OR REPLACE FUNCTION public.set_visit_relationship_managers(
  p_visit_id UUID, p_manager_ids UUID[]
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_id UUID; v_pos INT := 0; v_direct_count INT;
  v_existing UUID[];
BEGIN
  IF COALESCE(array_length(p_manager_ids,1),0) < 1 OR array_length(p_manager_ids,1) > 3 THEN
    RAISE EXCEPTION 'Choose between one and three relationship managers';
  END IF;
  IF (SELECT count(DISTINCT x) FROM unnest(p_manager_ids) x) <> array_length(p_manager_ids,1) THEN
    RAISE EXCEPTION 'The same relationship manager cannot be selected twice';
  END IF;
  SELECT count(*) INTO v_direct_count FROM relationship_managers m
   WHERE m.id=ANY(p_manager_ids) AND lower(btrim(m.name))='direct';
  IF v_direct_count > 0 AND array_length(p_manager_ids,1) > 1 THEN
    RAISE EXCEPTION 'DIRECT cannot be combined with another relationship manager';
  END IF;
  IF (SELECT count(*) FROM relationship_managers WHERE id=ANY(p_manager_ids)) <> array_length(p_manager_ids,1) THEN
    RAISE EXCEPTION 'One or more relationship managers no longer exist';
  END IF;

  -- What this visit already carries, in order.
  SELECT array_agg(relationship_manager_id ORDER BY position)
    INTO v_existing
    FROM visit_relationship_managers WHERE visit_id = p_visit_id;

  IF v_existing IS NOT NULL THEN
    -- Saving the visit again with the SAME managers is not an edit. The
    -- registration form re-sends them whenever any other field is changed, so
    -- refusing this would make the rest of the visit uneditable too.
    IF v_existing = p_manager_ids THEN
      RETURN;
    END IF;
    RAISE EXCEPTION
      'The relationship manager was fixed when this visit was registered and cannot be changed. Nothing has been saved.';
  END IF;

  FOREACH v_id IN ARRAY p_manager_ids LOOP
    v_pos := v_pos + 1;
    INSERT INTO visit_relationship_managers(visit_id,relationship_manager_id,position)
    VALUES(p_visit_id,v_id,v_pos);
  END LOOP;
  UPDATE visits SET relationship_manager_id=p_manager_ids[1] WHERE id=p_visit_id;
END $$;

-- --------------------------------------------- 2. the rows cannot be rewritten

CREATE OR REPLACE FUNCTION public.freeze_visit_relationship_managers()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  -- The setter above writes these rows through a SECURITY DEFINER function
  -- during registration; it is allowed to, because it only ever writes where
  -- there was nothing. Everything else is refused.
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'The relationship manager on this visit was fixed at registration and cannot be removed.';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION
      'The relationship manager on this visit was fixed at registration and cannot be changed.';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_freeze_visit_rms ON public.visit_relationship_managers;
CREATE TRIGGER trg_freeze_visit_rms
  BEFORE UPDATE OR DELETE ON public.visit_relationship_managers
  FOR EACH ROW EXECUTE FUNCTION public.freeze_visit_relationship_managers();

CREATE OR REPLACE FUNCTION public.freeze_visit_rm_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  -- Null to a value is registration filling it in. Value to anything else is an
  -- edit, and there is no such thing.
  IF OLD.relationship_manager_id IS NOT NULL
     AND NEW.relationship_manager_id IS DISTINCT FROM OLD.relationship_manager_id THEN
    RAISE EXCEPTION
      'The relationship manager was fixed when this visit was registered and cannot be changed. Nothing has been saved.';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_freeze_visit_rm_column ON public.visits;
CREATE TRIGGER trg_freeze_visit_rm_column
  BEFORE UPDATE OF relationship_manager_id ON public.visits
  FOR EACH ROW EXECUTE FUNCTION public.freeze_visit_rm_column();

-- ------------------------------------------ 3. carrying it into the admission

/**
 * The managers on a patient's most recent visit that has any.
 *
 * "Admit To Hospital" on the OPD dashboard opens the visit form in CREATE mode
 * (OpdPatientTable.tsx:636), so admitting makes a NEW visit rather than
 * converting the OPD one. Without this the IPD visit starts blank and somebody
 * has to remember who referred the patient — and, with the rule above, gets one
 * chance to get it right.
 */
CREATE OR REPLACE FUNCTION public.patient_last_relationship_managers(p_patient_id UUID)
RETURNS UUID[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT array_agg(vrm.relationship_manager_id ORDER BY vrm.position)
    FROM visit_relationship_managers vrm
   WHERE vrm.visit_id = (
     SELECT v.id FROM visits v
      JOIN visit_relationship_managers x ON x.visit_id = v.id
     WHERE v.patient_id = p_patient_id
     ORDER BY v.visit_date DESC NULLS LAST, v.created_at DESC
     LIMIT 1
   );
$$;

REVOKE ALL ON FUNCTION public.patient_last_relationship_managers(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.patient_last_relationship_managers(UUID) TO anon, authenticated;

-- ------------------------------------------------------------------ verify

DO $verify$
DECLARE
  v_patient UUID; v_visit UUID; v_rm1 UUID; v_rm2 UUID; v_ok BOOLEAN; v_carried UUID[];
BEGIN
  SELECT id INTO v_rm1 FROM relationship_managers WHERE lower(btrim(name)) <> 'direct' LIMIT 1;
  SELECT id INTO v_rm2 FROM relationship_managers
   WHERE lower(btrim(name)) <> 'direct' AND id <> v_rm1 LIMIT 1;
  IF v_rm1 IS NULL OR v_rm2 IS NULL THEN
    RAISE EXCEPTION 'ABORT: need two relationship managers to self-test';
  END IF;

  SELECT patient_id, id INTO v_patient, v_visit
    FROM visits WHERE patient_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM visit_relationship_managers x WHERE x.visit_id = visits.id)
   LIMIT 1;
  IF v_visit IS NULL THEN
    RAISE NOTICE 'No RM-less visit to self-test with — rule installed, not exercised';
    RETURN;
  END IF;

  -- (a) The first set is allowed: this is registration.
  PERFORM public.set_visit_relationship_managers(v_visit, ARRAY[v_rm1]);
  IF NOT EXISTS (SELECT 1 FROM visit_relationship_managers WHERE visit_id = v_visit) THEN
    RAISE EXCEPTION 'ABORT: registration could not set the manager';
  END IF;

  -- (b) Re-sending the same managers is not an edit, or every other field on the
  --     visit becomes uneditable too.
  PERFORM public.set_visit_relationship_managers(v_visit, ARRAY[v_rm1]);

  -- (c) A different manager is refused.
  v_ok := false;
  BEGIN
    PERFORM public.set_visit_relationship_managers(v_visit, ARRAY[v_rm2]);
  EXCEPTION WHEN OTHERS THEN
    v_ok := SQLERRM LIKE '%fixed when this visit was registered%';
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'ABORT: the manager was changed after registration';
  END IF;

  -- (d) And so is going around the setter, straight at the tables.
  v_ok := false;
  BEGIN
    UPDATE visits SET relationship_manager_id = v_rm2 WHERE id = v_visit;
  EXCEPTION WHEN OTHERS THEN
    v_ok := SQLERRM LIKE '%fixed when this visit was registered%';
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'ABORT: the column could be changed directly';
  END IF;

  v_ok := false;
  BEGIN
    DELETE FROM visit_relationship_managers WHERE visit_id = v_visit;
  EXCEPTION WHEN OTHERS THEN
    v_ok := SQLERRM LIKE '%cannot be removed%';
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'ABORT: the rows could be deleted';
  END IF;

  -- (e) The carry-forward finds what was just set.
  v_carried := public.patient_last_relationship_managers(v_patient);
  IF v_carried IS NULL OR NOT (v_rm1 = ANY(v_carried)) THEN
    RAISE EXCEPTION 'ABORT: the admission would not carry the manager forward';
  END IF;

  -- Put the test visit back as it was found.
  ALTER TABLE visit_relationship_managers DISABLE TRIGGER trg_freeze_visit_rms;
  ALTER TABLE visits DISABLE TRIGGER trg_freeze_visit_rm_column;
  DELETE FROM visit_relationship_managers WHERE visit_id = v_visit;
  UPDATE visits SET relationship_manager_id = NULL WHERE id = v_visit;
  ALTER TABLE visit_relationship_managers ENABLE TRIGGER trg_freeze_visit_rms;
  ALTER TABLE visits ENABLE TRIGGER trg_freeze_visit_rm_column;
END
$verify$;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------- read it

SELECT count(*) FILTER (WHERE rm.visit_id IS NOT NULL) AS visits_with_a_manager,
       count(*) FILTER (WHERE rm.visit_id IS NULL)     AS visits_still_open,
       count(*)                                        AS visits_last_60_days
  FROM public.visits v
  LEFT JOIN LATERAL (
    SELECT 1 AS visit_id FROM public.visit_relationship_managers x WHERE x.visit_id = v.id LIMIT 1
  ) rm ON true
 WHERE v.visit_date >= current_date - 60;
