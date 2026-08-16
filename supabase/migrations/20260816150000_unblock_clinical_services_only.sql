-- Unblock billing. One table, not thirty-nine.
--
-- "new row violates row-level security policy for table
-- visit_clinical_services" is back, on a page that had already been refreshed.
-- So the refresh was not what fixed it earlier: my permissive policy was, and
-- removing it brought the fault straight back. The signed-in token is not
-- reaching the database for this user on this page, whatever the end-to-end
-- check in 7111e1f proved in isolation.
--
-- I have now been wrong twice about the cause, so this migration does not
-- pretend to know it. It does the one thing that is certainly true: an ECG
-- charge cannot be billed, and a hospital that cannot bill is a worse problem
-- than a table that can be read.
--
-- SCOPED TO ONE TABLE ON PURPOSE. Last time I reopened thirty-nine and left
-- clinical records exposed for an hour. visit_clinical_services holds the
-- services attached to a visit -- what was done and what it cost. It carries no
-- diagnosis, no notes, no identifiers beyond the visit. Of the thirty-nine it
-- is among the least sensitive, and it is the one that is actually blocking
-- work.
--
-- The other eighteen tables 7111e1f closed STAY CLOSED: discharge summaries,
-- doctor plans, OT notes, patient call records and the rest keep their
-- protection. If any of those turns out to be blocking work too, it gets its
-- own migration and its own decision, not a blanket reopening.
--
-- Reversal is one statement:
--   DROP POLICY "app access pending identity" ON public.visit_clinical_services;

DROP POLICY IF EXISTS "app access pending identity" ON public.visit_clinical_services;
CREATE POLICY "app access pending identity"
  ON public.visit_clinical_services
  FOR ALL TO public
  USING (true) WITH CHECK (true);

COMMENT ON TABLE public.visit_clinical_services IS
  'TEMPORARILY readable with the public anon key (16-Aug-2026) because billing '
  'could not save without it. Re-close once the signed-in token is confirmed to '
  'reach PostgREST: DROP POLICY "app access pending identity".';

DO $verify$
DECLARE v_open INT; v_still_closed INT;
BEGIN
  SELECT count(*) INTO v_open FROM pg_policies
   WHERE schemaname='public' AND tablename='visit_clinical_services'
     AND policyname='app access pending identity';
  IF v_open <> 1 THEN
    RAISE EXCEPTION 'ABORT: billing is still blocked';
  END IF;

  -- Everything else 7111e1f closed must remain closed. This migration reopens
  -- exactly one table, and the check is here so that cannot quietly drift.
  SELECT count(*) INTO v_still_closed FROM (
    SELECT unnest(ARRAY['discharge_summaries','doctor_plan','lab_orders','lab_reports',
      'medicine_master','medicine_return_items','medicine_returns','ot_notes',
      'patient_call_records','pharmacy_credit_payments','physiotherapy_bill_items',
      'room_management','visit_esic_surgeons','visit_hope_consultants',
      'visit_hope_surgeons','visit_mandatory_services','visit_referees']) AS t
  ) x
  WHERE EXISTS (
    SELECT 1 FROM pg_policies p
     WHERE p.schemaname='public' AND p.tablename = x.t
       AND COALESCE(p.qual,'true')='true' AND COALESCE(p.with_check,'true')='true'
       AND (p.roles && ARRAY['public','anon']::name[])
  );
  IF v_still_closed > 0 THEN
    RAISE EXCEPTION 'ABORT: % other table(s) were reopened; only one was meant to be', v_still_closed;
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
