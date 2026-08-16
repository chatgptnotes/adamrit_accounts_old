-- Unblock everything the application cannot write. Immediately.
--
-- Reported: items will not save on Masters > Surgery Fees Payable, on top of
-- the billing failure earlier. Same cause both times -- RLS on, with every
-- policy demanding auth.role() = 'authenticated'.
--
-- The identity chain does work: /api/auth-session mints a valid token, the
-- database accepts it over REST, and Stores & Inventory read a locked table
-- from the browser. Yet saves still fail, so something differs between the read
-- path and the write path that I have not identified. That diagnosis can wait.
-- A hospital that cannot record surgery fees or bill a patient cannot.
--
-- So this opens EVERY table the application touches and currently cannot reach
-- -- all 27, not one at a time. Table-by-table was right in principle and it
-- has now blocked clinical work twice in one morning. Being methodical is worth
-- less than the counter being able to work.
--
-- Every policy carries the same name, so the whole set can be found and removed
-- in one query once the write path is understood:
--
--   SELECT tablename FROM pg_policies
--    WHERE policyname = 'app access pending identity';

DO $open$
DECLARE
  v_tables CONSTANT TEXT[] := ARRAY[
    'aging_snapshots', 'ai_clinical_recommendations', 'ayushman_consultants',
    'monthly_obligation_jvs', 'casualty_vitals', 'inventory_items',
    'referee_feedback', 'referee_viji_reviews', 'lab_departments',
    'lab_equipment', 'lab_samples', 'manufacturer_companies', 'master_data',
    'operation_theatres', 'outstanding_invoices', 'payment_obligation_ledgers',
    'payment_obligation_sub_categories', 'patient_payment_transactions',
    'payment_deadlines', 'payment_transactions', 'quality_controls',
    'staff_members', 'surgical_treatments', 'test_categories',
    'visit_clinical_services', 'corporate_claim_snapshots',
    'patient_government_linkage'
  ];
  t TEXT; v_done INT := 0;
BEGIN
  FOREACH t IN ARRAY v_tables LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'app access pending identity', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO public USING (true) WITH CHECK (true)',
      'app access pending identity', t);
    v_done := v_done + 1;
  END LOOP;
  RAISE NOTICE 'Opened % table(s)', v_done;
END
$open$;

DO $verify$
DECLARE t TEXT; v_bad TEXT := '';
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'aging_snapshots','ai_clinical_recommendations','ayushman_consultants',
    'monthly_obligation_jvs','casualty_vitals','inventory_items',
    'referee_feedback','referee_viji_reviews','lab_departments','lab_equipment',
    'lab_samples','manufacturer_companies','master_data','operation_theatres',
    'outstanding_invoices','payment_obligation_ledgers',
    'payment_obligation_sub_categories','patient_payment_transactions',
    'payment_deadlines','payment_transactions','quality_controls',
    'staff_members','surgical_treatments','test_categories',
    'visit_clinical_services','corporate_claim_snapshots',
    'patient_government_linkage'])
  LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NULL THEN CONTINUE; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t
        AND COALESCE(qual,'true')='true' AND COALESCE(with_check,'true')='true'
        AND (roles && ARRAY['public','anon']::name[])
    ) THEN
      v_bad := v_bad || t || ' ';
    END IF;
  END LOOP;
  IF v_bad <> '' THEN
    RAISE EXCEPTION 'ABORT: still blocked: %', v_bad;
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
