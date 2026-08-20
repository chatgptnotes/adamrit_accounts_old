-- A spot is approved once, and staff do not take cuts.
--
-- TWO INSTRUCTIONS (20 Aug, Dr M):
--
--   "This patient, Sheikh Taj, was paid, and now it is allowing us to pay that
--    spot again, which should not be possible. The software should give a
--    message that this has already been paid and should not be paid again."
--
--   "hide arpit kinnarkar and suraj rajput as RM. Both are employee of our
--    hospitals. they are not paid cuts"
--
-- WHAT HAPPENED. Visit IH26H20052, sheikh taj mohammad, has TWO spot approvals
-- eighteen minutes apart — MLE-1469 at 13:52 IST and MLE-1470 at 14:10, both
-- Rs 5,000, both for Arpit Kinarkar. record_spot_approval checked the amount,
-- the patient, the referee and the ledgers, and never once asked whether this
-- visit already had a spot. Neither invoice is approved or paid, so no money has
-- moved; the duplicate was caught before it cost anything.
--
-- One other visit is in the same state: IH26G27044, also two.
--
-- THE TWO REFEREE LEDGERS ARE NOT THE SAME ROW. MLE-1469 names ledger
-- 9b26063a… and MLE-1470 names 87637139… — two different "Arpit Kinarkar"
-- ledgers. So the guard cannot match on the ledger id; it matches on the NAME,
-- normalised, or the duplicate walks straight through it.
--
-- AND ARPIT IS STAFF. Which is the second instruction, and the deeper fault: he
-- should not have been selectable as a referee at all. Hiding him from the RM
-- list is not enough on its own — the spot screen picks a LEDGER, not a
-- relationship manager, so the two lists have to agree about who may be paid a
-- cut. One table now says so, and both paths read it.

-- ------------------------------------------------ 1. who may not take a cut

CREATE TABLE IF NOT EXISTS public.commission_excluded_people (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  reason     TEXT,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS commission_excluded_name_uidx
  ON public.commission_excluded_people (lower(btrim(name)));

COMMENT ON TABLE public.commission_excluded_people IS
  'People who may not be named as a referee or relationship manager because they '
  'are on the payroll. Matched on the name: the same person can hold several '
  'ledgers, and two of Arpit Kinarkar''s were used on the same day.';

GRANT SELECT ON public.commission_excluded_people TO anon, authenticated;

INSERT INTO public.commission_excluded_people (name, reason) VALUES
  ('Arpit Kinarkar', 'Hospital employee — Dr M, 20 Aug: not paid cuts'),
  ('Suraj Rajput',   'Hospital employee — Dr M, 20 Aug: not paid cuts')
ON CONFLICT (lower(btrim(name))) DO UPDATE
  SET is_active = true, reason = EXCLUDED.reason;

CREATE OR REPLACE FUNCTION public.is_commission_excluded(p_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM commission_excluded_people e
     WHERE e.is_active
       AND lower(btrim(COALESCE(p_name, ''))) = lower(btrim(e.name))
  );
$$;

REVOKE ALL ON FUNCTION public.is_commission_excluded(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_commission_excluded(TEXT) TO anon, authenticated;

-- Off the RM pickers that already honour is_hidden (RefereePicker, the daily
-- revenue report). The rules below cover the ones that do not.
UPDATE public.relationship_managers
   SET is_hidden = true, updated_at = now()
 WHERE lower(btrim(name)) IN ('arpit kinarkar', 'suraj rajput');

-- ------------------------------------ 2. no second spot, and no staff referee

DO $patch$
DECLARE
  v_src TEXT; v_new TEXT; v_n INT;
  v_anchor TEXT :=
    'IF p_deposit_to_collect IS NOT NULL AND p_deposit_to_collect < 0 THEN\s+RAISE EXCEPTION ''The deposit to collect cannot be negative'';\s+END IF;';
  v_guards TEXT :=
    'IF p_deposit_to_collect IS NOT NULL AND p_deposit_to_collect < 0 THEN' || E'\n' ||
    '    RAISE EXCEPTION ''The deposit to collect cannot be negative'';' || E'\n' ||
    '  END IF;' || E'\n\n' ||
    '  -- One spot per visit per referee. Matched on the NAME, because the same' || E'\n' ||
    '  -- person can hold two ledgers and did: MLE-1469 and MLE-1470 named two' || E'\n' ||
    '  -- different Arpit Kinarkar ledgers eighteen minutes apart.' || E'\n' ||
    '  IF p_visit_id IS NOT NULL AND btrim(p_visit_id) <> '''' THEN' || E'\n' ||
    '    SELECT s.ml_invoice_number INTO v_existing_spot' || E'\n' ||
    '      FROM public.spot_payment_approvals s' || E'\n' ||
    '      JOIN public.chart_of_accounts a ON a.id = s.referee_ledger_id' || E'\n' ||
    '     WHERE btrim(s.visit_id) = btrim(p_visit_id)' || E'\n' ||
    '       AND lower(btrim(a.account_name)) = lower(btrim((' || E'\n' ||
    '             SELECT account_name FROM public.chart_of_accounts WHERE id = p_referee_ledger_id)))' || E'\n' ||
    '     ORDER BY s.created_at LIMIT 1;' || E'\n' ||
    '    IF v_existing_spot IS NOT NULL THEN' || E'\n' ||
    '      RAISE EXCEPTION ''This spot has already been approved for this patient on invoice %. It cannot be approved again.'', v_existing_spot;' || E'\n' ||
    '    END IF;' || E'\n' ||
    '  END IF;' || E'\n\n' ||
    '  -- Staff are not paid cuts.' || E'\n' ||
    '  IF public.is_commission_excluded((' || E'\n' ||
    '       SELECT account_name FROM public.chart_of_accounts WHERE id = p_referee_ledger_id)) THEN' || E'\n' ||
    '    RAISE EXCEPTION ''% is on the payroll and cannot be paid a referral cut.'',' || E'\n' ||
    '      (SELECT btrim(account_name) FROM public.chart_of_accounts WHERE id = p_referee_ledger_id);' || E'\n' ||
    '  END IF;';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'record_spot_approval';
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'ABORT: record_spot_approval is not in this database';
  END IF;

  IF v_src LIKE '%already been approved for this patient%' THEN
    RAISE NOTICE 'record_spot_approval already refuses a second spot — nothing to do';
    RETURN;
  END IF;

  SELECT count(*) INTO v_n FROM regexp_matches(v_src, v_anchor, 'g');
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'ABORT: the deposit guard matched % times, expected 1', v_n;
  END IF;

  v_new := regexp_replace(v_src, v_anchor, v_guards);
  -- The new variable the guards need.
  v_new := regexp_replace(v_new, 'v_approval_id  UUID;', 'v_approval_id  UUID;' || E'\n  v_existing_spot TEXT;');
  IF v_new = v_src THEN
    RAISE EXCEPTION 'ABORT: the patch changed nothing';
  END IF;

  EXECUTE v_new;
  RAISE NOTICE 'record_spot_approval now refuses a second spot and a staff referee';
END
$patch$;

-- ------------------------------------------- 3. and no staff as an RM either

CREATE OR REPLACE FUNCTION public.set_visit_relationship_managers(
  p_visit_id UUID, p_manager_ids UUID[]
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_id UUID; v_pos INT := 0; v_direct_count INT;
  v_existing UUID[]; v_excluded TEXT;
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

  SELECT array_agg(relationship_manager_id ORDER BY position)
    INTO v_existing
    FROM visit_relationship_managers WHERE visit_id = p_visit_id;

  IF v_existing IS NOT NULL THEN
    -- Unchanged is not an edit. This must stay ABOVE the payroll check, or a
    -- visit already carrying a now-excluded manager could never be saved again
    -- for any other reason.
    IF v_existing = p_manager_ids THEN
      RETURN;
    END IF;
    RAISE EXCEPTION
      'The relationship manager was fixed when this visit was registered and cannot be changed. Nothing has been saved.';
  END IF;

  -- Staff are not paid cuts, so they cannot be named on a new visit.
  SELECT btrim(m.name) INTO v_excluded
    FROM relationship_managers m
   WHERE m.id = ANY(p_manager_ids) AND public.is_commission_excluded(m.name)
   LIMIT 1;
  IF v_excluded IS NOT NULL THEN
    RAISE EXCEPTION '% is on the payroll and cannot be named as a relationship manager.', v_excluded;
  END IF;

  FOREACH v_id IN ARRAY p_manager_ids LOOP
    v_pos := v_pos + 1;
    INSERT INTO visit_relationship_managers(visit_id,relationship_manager_id,position)
    VALUES(p_visit_id,v_id,v_pos);
  END LOOP;
  UPDATE visits SET relationship_manager_id=p_manager_ids[1] WHERE id=p_visit_id;
END $$;

-- ------------------------------------------------------------------ verify

DO $verify$
DECLARE v_src TEXT; v_hidden INT;
BEGIN
  IF NOT public.is_commission_excluded('Arpit Kinarkar') THEN
    RAISE EXCEPTION 'ABORT: Arpit Kinarkar is not excluded';
  END IF;
  IF NOT public.is_commission_excluded('  suraj rajput ') THEN
    RAISE EXCEPTION 'ABORT: the name match is not tolerant of case and spacing';
  END IF;
  IF public.is_commission_excluded('Baba Khan') THEN
    RAISE EXCEPTION 'ABORT: a real referee is being excluded';
  END IF;

  SELECT count(*) INTO v_hidden FROM relationship_managers
   WHERE lower(btrim(name)) IN ('arpit kinarkar','suraj rajput') AND is_hidden;
  IF v_hidden < 2 THEN
    RAISE EXCEPTION 'ABORT: only % of the two are hidden', v_hidden;
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'record_spot_approval';
  IF v_src NOT LIKE '%already been approved for this patient%' THEN
    RAISE EXCEPTION 'ABORT: a second spot is still allowed';
  END IF;
  IF v_src NOT LIKE '%is_commission_excluded%' THEN
    RAISE EXCEPTION 'ABORT: a staff referee is still allowed';
  END IF;

  -- The RM lock from this morning must have survived the rewrite.
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'set_visit_relationship_managers';
  IF v_src NOT LIKE '%fixed when this visit was registered%' THEN
    RAISE EXCEPTION 'ABORT: the registration lock has been lost';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
