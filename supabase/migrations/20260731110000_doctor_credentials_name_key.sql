-- Match doctors on a name that ignores how many spaces someone typed.
--
-- doctor_credentials was seeded from visits.appointment_with and its unique
-- index used lower(btrim(doctor_name)). btrim only trims the ends, so
-- "Dr. Afzal Sheikh" (899 visits) and "Dr. AFZAL  Sheikh" (833 visits, two
-- spaces) both got in as separate doctors.
--
-- That is worse than an untidy master. Upload a signature against one of them
-- and every summary for the other 833 visits finds a row with no signature and
-- prints as unsigned, with nothing on screen to say why.
--
-- So the identity of a doctor becomes a normalised key - lowercased, trimmed,
-- with internal whitespace collapsed - and the duplicates are merged into one
-- row each, keeping whatever details either of them carried.

-- 1. The key -----------------------------------------------------------------
ALTER TABLE public.doctor_credentials
  ADD COLUMN IF NOT EXISTS name_key TEXT
    GENERATED ALWAYS AS (regexp_replace(lower(btrim(doctor_name)), '\s+', ' ', 'g')) STORED;

COMMENT ON COLUMN public.doctor_credentials.name_key IS
  'Whitespace- and case-normalised doctor name. Documents look a signatory up '
  'by this, never by the raw name, because visits.appointment_with is typed by '
  'hand and its spacing varies.';

-- 2. Merge what the old index let through ------------------------------------
-- Keep the earliest row per key and pull any detail the others hold into it,
-- so nothing already filled in is lost.
WITH ranked AS (
  SELECT id, name_key,
         row_number() OVER (PARTITION BY name_key ORDER BY created_at, id) AS rn
    FROM public.doctor_credentials
),
survivor AS (SELECT id, name_key FROM ranked WHERE rn = 1),
loser    AS (SELECT id, name_key FROM ranked WHERE rn > 1),
merged AS (
  SELECT s.id AS keep_id,
         max(l.qualification)   AS qualification,
         max(l.registration_no) AS registration_no,
         max(l.specialty)       AS specialty,
         max(l.signature_url)   AS signature_url,
         max(l.stamp_url)       AS stamp_url
    FROM survivor s
    JOIN loser lo ON lo.name_key = s.name_key
    JOIN public.doctor_credentials l ON l.id = lo.id
   GROUP BY s.id
)
UPDATE public.doctor_credentials c
   SET qualification   = COALESCE(c.qualification,   m.qualification),
       registration_no = COALESCE(c.registration_no, m.registration_no),
       specialty       = COALESCE(c.specialty,       m.specialty),
       signature_url   = COALESCE(c.signature_url,   m.signature_url),
       stamp_url       = COALESCE(c.stamp_url,       m.stamp_url),
       updated_at      = now()
  FROM merged m
 WHERE c.id = m.keep_id;

DELETE FROM public.doctor_credentials c
 USING (
   SELECT id FROM (
     SELECT id, row_number() OVER (PARTITION BY name_key ORDER BY created_at, id) AS rn
       FROM public.doctor_credentials
   ) x WHERE rn > 1
 ) dupe
 WHERE c.id = dupe.id;

-- 3. Replace the index that was not strict enough ----------------------------
DROP INDEX IF EXISTS public.doctor_credentials_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS doctor_credentials_name_key_uniq
  ON public.doctor_credentials (name_key);

-- 4. Any doctor named on a visit who still has no row ------------------------
INSERT INTO public.doctor_credentials (doctor_name)
SELECT DISTINCT ON (regexp_replace(lower(btrim(v.appointment_with)), '\s+', ' ', 'g'))
       btrim(v.appointment_with)
  FROM public.visits v
 WHERE btrim(COALESCE(v.appointment_with, '')) <> ''
   AND NOT EXISTS (
     SELECT 1 FROM public.doctor_credentials c
      WHERE c.name_key = regexp_replace(lower(btrim(v.appointment_with)), '\s+', ' ', 'g'))
 ORDER BY regexp_replace(lower(btrim(v.appointment_with)), '\s+', ' ', 'g'), btrim(v.appointment_with);

-- Every doctor named on a visit should now resolve to exactly one row.
SELECT count(*) AS doctors,
       count(DISTINCT name_key) AS distinct_names,
       count(*) FILTER (WHERE signature_url IS NOT NULL) AS with_signature,
       count(*) FILTER (WHERE stamp_url IS NOT NULL) AS with_stamp
  FROM public.doctor_credentials
 WHERE is_active;
