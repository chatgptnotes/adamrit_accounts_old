-- Make the new keywords actually findable.
--
-- The package master's search is server-side and paginated, built from
-- PostgREST `ilike` filters. keywords is a text[], and PostgREST has no
-- partial-text operator for an array — `cs` matches a whole element, so
-- searching "piles" would never find the keyword "Piles Surgery".
--
-- A generated column mirrors the array as plain text so the existing ilike
-- pattern works unchanged. STORED and generated, so it cannot drift from the
-- array the way a trigger-maintained copy would.
--
-- array_to_string() is only STABLE, and a generated column demands IMMUTABLE,
-- so it is wrapped. Safe here: text[] to text with a fixed separator has no
-- dependence on locale, search_path or session state.

CREATE OR REPLACE FUNCTION public.keywords_to_text(arr TEXT[])
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$ SELECT array_to_string(arr, ' ') $$;

ALTER TABLE public.pmjay_mjpjay_packages
  ADD COLUMN IF NOT EXISTS keywords_text TEXT
  GENERATED ALWAYS AS (public.keywords_to_text(keywords)) STORED;

COMMENT ON COLUMN public.pmjay_mjpjay_packages.keywords_text IS
  'Read-only mirror of keywords, so the search can ilike it. Never write to this — edit keywords.';

-- A trigram index makes the leading-wildcard search fast. It needs pg_trgm,
-- which may not be enabled on this project; the search is correct either way,
-- so a missing extension is reported rather than fatal. 171 rows do not need it.
DO $index$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE INDEX IF NOT EXISTS pmjay_mjpjay_packages_keywords_text_idx
    ON public.pmjay_mjpjay_packages USING gin (keywords_text gin_trgm_ops);
  RAISE NOTICE 'Trigram index on keywords_text created.';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'No trigram index (%). Search still works; at 171 rows the scan is free.', SQLERRM;
END
$index$;

DO $verify$
DECLARE v_sample TEXT; v_hits INT;
BEGIN
  SELECT keywords_text INTO v_sample
    FROM public.pmjay_mjpjay_packages
   WHERE array_length(keywords, 1) > 0
   LIMIT 1;
  IF v_sample IS NULL OR btrim(v_sample) = '' THEN
    RAISE EXCEPTION 'ABORT: keywords_text is empty on a row that has keywords';
  END IF;

  -- The point of the whole migration: a word inside a keyword is findable.
  SELECT count(*) INTO v_hits
    FROM public.pmjay_mjpjay_packages
   WHERE keywords_text ILIKE '%dialysis%';
  IF v_hits = 0 THEN
    RAISE EXCEPTION 'ABORT: partial keyword search matches nothing';
  END IF;

  RAISE NOTICE 'keywords_text is live; "dialysis" matches % package(s).', v_hits;
END
$verify$;

NOTIFY pgrst, 'reload schema';
