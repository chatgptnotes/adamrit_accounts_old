-- Panel-wise mandatory documents: the "Not Applicable" third state.
--
-- Submitted / Pending is DERIVED, never stored. A document counts as Submitted
-- when a public.file_uploads row exists for the patient with
-- category = 'registration_document' whose notes JSON documentName matches the
-- required document name. src/lib/registrationDocuments.ts stays the single
-- source of truth for which documents each panel requires.
--
-- "Not Applicable" is the one thing that CANNOT be derived — an absent file is
-- indistinguishable from a file nobody needs to supply. So it, and only it,
-- is persisted here. This table exists because ESIC lists four "(if
-- applicable)" documents; without a waiver every ESIC patient would hold a
-- pending-document notification that no amount of uploading could ever clear.
--
-- Run in the Supabase dashboard SQL editor. Safe to run twice.

CREATE TABLE IF NOT EXISTS public.panel_document_waivers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id    UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  -- The exact label from CORPORATE_REGISTRATION_DOCUMENTS. Always written from
  -- the TS map, never hand-typed, so un-waiving can match on it directly.
  document_name TEXT NOT NULL,
  -- patients.corporate as it read when waived. Audit only — the panel is always
  -- re-resolved from the live patient record, never from this column.
  corporate     TEXT,
  reason        TEXT,
  waived_by     TEXT,
  waived_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One waiver per patient + document. Normalized the same way normalize() in
-- src/lib/registrationDocuments.ts does (trim, collapse whitespace, lowercase)
-- so "Aadhaar  Card" cannot slip past the constraint as a second row.
CREATE UNIQUE INDEX IF NOT EXISTS panel_document_waivers_patient_document_idx
  ON public.panel_document_waivers (
    patient_id,
    (lower(regexp_replace(btrim(document_name), '\s+', ' ', 'g')))
  );

ALTER TABLE public.panel_document_waivers ENABLE ROW LEVEL SECURITY;

-- NOTE: public.notifications has SELECT/UPDATE USING (true) but no INSERT
-- policy, which is exactly why nothing can write to it from the browser. This
-- table gets a working INSERT and DELETE so the checklist can toggle N/A
-- client-side without a SECURITY DEFINER function.
DROP POLICY IF EXISTS "panel_document_waivers_select" ON public.panel_document_waivers;
CREATE POLICY "panel_document_waivers_select"
  ON public.panel_document_waivers FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "panel_document_waivers_insert" ON public.panel_document_waivers;
CREATE POLICY "panel_document_waivers_insert"
  ON public.panel_document_waivers FOR INSERT
  TO anon, authenticated WITH CHECK (true);

-- Un-marking N/A is a hard delete: a row's only meaning is "waived", so there
-- is nothing to update. No UPDATE policy on purpose.
DROP POLICY IF EXISTS "panel_document_waivers_delete" ON public.panel_document_waivers;
CREATE POLICY "panel_document_waivers_delete"
  ON public.panel_document_waivers FOR DELETE
  TO anon, authenticated USING (true);

-- Realtime, so the tablet bell recomputes the moment a document is marked N/A
-- on another device.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'panel_document_waivers')
  THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.panel_document_waivers';
  END IF;
END $$;

COMMENT ON TABLE public.panel_document_waivers IS
'Per-patient "this mandatory panel document does not apply" marks. Submitted/Pending is derived from file_uploads and is NOT stored here.';

NOTIFY pgrst, 'reload schema';
