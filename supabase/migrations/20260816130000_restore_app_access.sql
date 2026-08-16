-- Restore the 39 tables the app cannot reach, and say plainly why.
--
-- Reported from the Final Bill: "new row violates row-level security policy for
-- table visit_clinical_services" — an ECG charge would not save. That is one
-- symptom of 39.
--
-- Each of these tables has RLS on and every policy demands
-- auth.role() = 'authenticated'. Staff sign in against our own "User" table and
-- the browser then talks to PostgREST with the ANON key, so auth.role() is
-- 'anon' and the policies match nothing the application sends. Reads come back
-- empty and writes are refused. Billing, discharge summaries, lab orders and
-- samples, medicine master, OT notes, payment transactions and the visit
-- consultant/surgeon/referee tables are all in this state.
--
-- 20260816100000 warned about exactly this shape and deliberately refused to
-- enable RLS on such tables for this reason. Something enabled it on these.
--
-- THIS IS A RESTORE, NOT AN IMPROVEMENT. It adds one permissive policy per
-- table so the application works again. Security is unchanged from the other
-- 237 tables that already admit the anon key — no worse, and no better.
--
-- Additive and reversible on purpose. The existing authenticated policies are
-- left exactly as they are, and each table gains one clearly named policy that
-- can be dropped in a single statement per table once staff genuinely arrive as
-- authenticated. That is the real fix, and it is not this.

DO $restore$
DECLARE
  v_tables CONSTANT TEXT[] := ARRAY[
    'aging_snapshots',
    'ai_clinical_recommendations',
    'corporate_claim_snapshots',
    'discharge_summaries',
    'doctor_plan',
    'inventory_items',
    'lab_departments',
    'lab_equipment',
    'lab_orders',
    'lab_reports',
    'lab_samples',
    'medicine_master',
    'medicine_return_items',
    'medicine_returns',
    'operation_theatres',
    'ot_notes',
    'outstanding_invoices',
    'patient_call_records',
    'patient_government_linkage',
    'patient_payment_transactions',
    'payment_deadlines',
    'payment_obligation_ledgers',
    'payment_obligation_sub_categories',
    'payment_transactions',
    'pharmacy_credit_payments',
    'physiotherapy_bill_items',
    'quality_controls',
    'referee_feedback',
    'referee_viji_reviews',
    'room_management',
    'staff_members',
    'surgical_treatments',
    'test_categories',
    'visit_clinical_services',
    'visit_esic_surgeons',
    'visit_hope_consultants',
    'visit_hope_surgeons',
    'visit_mandatory_services',
    'visit_referees'
  ];
  t TEXT; v_done INT := 0;
BEGIN
  FOREACH t IN ARRAY v_tables LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NULL THEN
      RAISE EXCEPTION 'ABORT: table % does not exist', t;
    END IF;
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'app access pending identity', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO public USING (true) WITH CHECK (true)',
      'app access pending identity', t);
    v_done := v_done + 1;
  END LOOP;
  RAISE NOTICE 'Restored access to % table(s)', v_done;
END
$restore$;

DO $verify$
DECLARE t TEXT; v_missing TEXT := '';
BEGIN
  FOR t IN SELECT unnest(ARRAY['aging_snapshots',
    'ai_clinical_recommendations',
    'corporate_claim_snapshots',
    'discharge_summaries',
    'doctor_plan',
    'inventory_items',
    'lab_departments',
    'lab_equipment',
    'lab_orders',
    'lab_reports',
    'lab_samples',
    'medicine_master',
    'medicine_return_items',
    'medicine_returns',
    'operation_theatres',
    'ot_notes',
    'outstanding_invoices',
    'patient_call_records',
    'patient_government_linkage',
    'patient_payment_transactions',
    'payment_deadlines',
    'payment_obligation_ledgers',
    'payment_obligation_sub_categories',
    'payment_transactions',
    'pharmacy_credit_payments',
    'physiotherapy_bill_items',
    'quality_controls',
    'referee_feedback',
    'referee_viji_reviews',
    'room_management',
    'staff_members',
    'surgical_treatments',
    'test_categories',
    'visit_clinical_services',
    'visit_esic_surgeons',
    'visit_hope_consultants',
    'visit_hope_surgeons',
    'visit_mandatory_services',
    'visit_referees']) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname='public' AND tablename=t
         AND policyname='app access pending identity'
         AND COALESCE(qual,'true')='true'
         AND (roles && ARRAY['public','anon']::name[])
    ) THEN
      v_missing := v_missing || t || ' ';
    END IF;
  END LOOP;
  IF v_missing <> '' THEN
    RAISE EXCEPTION 'ABORT: no working policy on: %', v_missing;
  END IF;

  -- The table locked deliberately an hour ago must NOT have been re-opened.
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='cashbook_handwritten_uploads'
       AND (roles && ARRAY['public','anon']::name[])
  ) THEN
    RAISE EXCEPTION 'ABORT: the cashbook table was re-opened by this migration';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
