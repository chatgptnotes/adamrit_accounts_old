-- The HMIS uses its own application-session roles for these screens and calls
-- Supabase with the public client, like the existing portal-import workflow.
-- This changes policies on the two new corporate-scheme tables only.

DROP POLICY IF EXISTS "corporate_schemes_authenticated_all" ON public.corporate_schemes;
DROP POLICY IF EXISTS "corporate_scheme_records_authenticated_all" ON public.corporate_scheme_records;

CREATE POLICY "corporate_schemes_hmis_client_all"
  ON public.corporate_schemes FOR ALL
  TO public USING (true) WITH CHECK (true);

CREATE POLICY "corporate_scheme_records_hmis_client_all"
  ON public.corporate_scheme_records FOR ALL
  TO public USING (true) WITH CHECK (true);
