-- ICD-11, the WHO's classification, as a master in Adamrit.
--
-- WHY. The 441 rows in `diagnoses` are free text with a category. They are what
-- clinicians actually type, and they are not going anywhere — but nothing in
-- them is a code, so a diagnosis cannot be counted, compared or claimed against
-- any standard. ICD-11 is that standard.
--
-- THE TABLE IS CREATED EMPTY, DELIBERATELY. ICD-11 content is licensed by the
-- WHO and is not something to write from memory. A fabricated code would look
-- exactly as authoritative as a real one and would end up on a medical record
-- and a claim. It is loaded from the WHO ICD-11 API by api/icd11-sync.ts.
--
-- NOTHING IS FORCED ONTO EXISTING DIAGNOSES. `diagnoses.icd11_code` is nullable
-- and blank everywhere to begin with; the 441 keep working untouched and pick
-- up codes as somebody who knows the right one attaches it. No foreign key on
-- purpose: a code can be set before the master is loaded, and a WHO re-release
-- must not orphan rows in a patient's history.

CREATE TABLE IF NOT EXISTS public.icd11_codes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The MMS code, e.g. '1A00', 'BA00.0'. Absent on chapters and blocks, which
  -- are grouping nodes and carry no code of their own.
  code            TEXT,
  title           TEXT        NOT NULL,
  definition      TEXT,
  -- 'chapter' | 'block' | 'category' — the WHO's own classKind.
  class_kind      TEXT,
  chapter_no      TEXT,
  chapter_title   TEXT,
  parent_uri      TEXT,
  -- The stable WHO identity for this entity. The natural key: codes move
  -- between releases, this does not.
  uri             TEXT        NOT NULL,
  release_version TEXT,
  -- Inclusion terms and synonyms from the WHO entity, so a clinician's wording
  -- finds the code even when it is not the WHO's preferred title.
  synonyms        TEXT[],
  is_leaf         BOOLEAN     NOT NULL DEFAULT false,
  is_active       BOOLEAN     NOT NULL DEFAULT true,
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The WHO URI identifies an entity across releases; re-running the import
-- updates in place rather than duplicating the classification.
CREATE UNIQUE INDEX IF NOT EXISTS icd11_codes_uri_uniq ON public.icd11_codes (uri);
CREATE INDEX IF NOT EXISTS icd11_codes_code_idx     ON public.icd11_codes (code) WHERE code IS NOT NULL;
CREATE INDEX IF NOT EXISTS icd11_codes_chapter_idx  ON public.icd11_codes (chapter_no);

-- One text column the search can ILIKE, covering code, title and synonyms.
-- Generated rather than trigger-maintained, so it cannot drift.
CREATE OR REPLACE FUNCTION public.icd11_search_text(
  p_code TEXT, p_title TEXT, p_synonyms TEXT[]
) RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog
AS $$ SELECT concat_ws(' ', p_code, p_title, array_to_string(p_synonyms, ' ')) $$;

ALTER TABLE public.icd11_codes
  ADD COLUMN IF NOT EXISTS search_text TEXT
  GENERATED ALWAYS AS (public.icd11_search_text(code, title, synonyms)) STORED;

DO $index$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE INDEX IF NOT EXISTS icd11_codes_search_idx
    ON public.icd11_codes USING gin (search_text gin_trgm_ops);
  RAISE NOTICE 'Trigram index on icd11_codes.search_text created.';
EXCEPTION WHEN OTHERS THEN
  -- ICD-11 MMS is tens of thousands of rows, so unlike the 171 packages this
  -- index genuinely matters. Said out loud rather than silently skipped.
  RAISE WARNING 'NO trigram index on icd11_codes (%). Search will be a full scan — enable pg_trgm.', SQLERRM;
END
$index$;

ALTER TABLE public.icd11_codes ENABLE ROW LEVEL SECURITY;

-- TO public, not TO anon: an anon-only policy strands the table the moment
-- staff arrive as `authenticated` (the fault 20260816110000 had to repair).
DROP POLICY IF EXISTS icd11_codes_read ON public.icd11_codes;
CREATE POLICY icd11_codes_read ON public.icd11_codes
  FOR SELECT TO public USING (true);

-- Written only by the importer, which runs with the service role. Nobody edits
-- the WHO's classification by hand — a local edit would be silently replaced on
-- the next sync, which is worse than not being able to make it.
GRANT SELECT ON public.icd11_codes TO anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.icd11_codes FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- The link to what clinicians actually use.
-- ---------------------------------------------------------------------------
ALTER TABLE public.diagnoses
  ADD COLUMN IF NOT EXISTS icd11_code TEXT,
  ADD COLUMN IF NOT EXISTS icd11_uri  TEXT;

COMMENT ON COLUMN public.diagnoses.icd11_code IS
  'ICD-11 MMS code, or NULL. Optional by design — the 441 existing diagnoses predate this and are not blocked by it.';
COMMENT ON COLUMN public.diagnoses.icd11_uri IS
  'The WHO entity URI, which survives a code changing between releases.';

CREATE INDEX IF NOT EXISTS diagnoses_icd11_code_idx
  ON public.diagnoses (icd11_code) WHERE icd11_code IS NOT NULL;

DO $verify$
DECLARE v_cols INT; v_rows INT;
BEGIN
  SELECT count(*) INTO v_cols FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'diagnoses'
     AND column_name IN ('icd11_code', 'icd11_uri');
  IF v_cols <> 2 THEN
    RAISE EXCEPTION 'ABORT: diagnoses did not gain both ICD-11 columns';
  END IF;

  -- Not one existing diagnosis may have been disturbed.
  SELECT count(*) INTO v_rows FROM public.diagnoses WHERE icd11_code IS NOT NULL;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'ABORT: % diagnoses already carry a code — nothing should have been guessed', v_rows;
  END IF;

  RAISE NOTICE 'icd11_codes is ready and empty; it is filled by api/icd11-sync.ts from the WHO API.';
END
$verify$;

NOTIFY pgrst, 'reload schema';
