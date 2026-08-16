-- Surgery Fees Payable learns who operates, who anaesthetises, and on what.
--
-- WHY. When Gaurav schedules an OT he types the surgeon, the anaesthetist and
-- the anaesthesia type by hand, and nobody sees what any of it will cost until
-- the payable appears at approval. The facts already exist -- the PMJAY/MJPJAY
-- package master carries the anaesthesia type, and its two child tables carry
-- the surgeons and anaesthetists per package -- they were simply never joined
-- to the fee master the surgeon's invoice is priced from.
--
-- WHAT IS DELIBERATELY NOT DONE. Only EXACT name matches are filled in. Of 34
-- active fee rows, 9 match a PMJAY package exactly, 9 match only as a fuzzy
-- substring and 16 not at all. A substring match would attach a surgeon and an
-- anaesthesia type to a PAYABLE INVOICE on the strength of one name containing
-- another -- the same reasoning that resolves a ledger by name alone, which
-- this codebase has been bitten by twice. The other 25 are left blank for a
-- person to fill, and pmjay_package_id records which ones were matched so the
-- provenance is visible rather than assumed.
--
-- Ambiguity is skipped too: if two packages normalise to the same name, neither
-- is used. A coin-toss between two surgeons is worse than an empty field.

-- ---------------------------------------------------------------------------
-- 1. The new columns.
-- ---------------------------------------------------------------------------
ALTER TABLE public.surgery_fee_master
  ADD COLUMN IF NOT EXISTS pmjay_package_id          UUID REFERENCES public.pmjay_mjpjay_packages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS default_surgeon_name      TEXT,
  ADD COLUMN IF NOT EXISTS default_anaesthetist_name TEXT,
  ADD COLUMN IF NOT EXISTS anaesthesia_type          TEXT;

COMMENT ON COLUMN public.surgery_fee_master.pmjay_package_id IS
  'The PMJAY/MJPJAY package this row was matched to, or NULL if matched by hand or not at all. Provenance for the three columns below.';
COMMENT ON COLUMN public.surgery_fee_master.anaesthesia_type IS
  'general | spinal | sedation. Prices the anaesthetist via anaesthesia_fee_master.';

-- ---------------------------------------------------------------------------
-- 2. The anaesthetist's rate, out of the code and into a table.
--
--    It was two hardcoded objects in src/lib/approval-queue-service.ts, so
--    changing a rate meant a deploy, and 'sedation' had no rate at all --
--    a sedation case silently paid the anaesthetist nothing.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.anaesthesia_fee_master (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anaesthesia_type TEXT        NOT NULL,
  panel_rate       NUMERIC     NOT NULL,
  private_rate     NUMERIC     NOT NULL,
  is_active        BOOLEAN     NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One active rate per type, or the lookup has to choose and cannot.
CREATE UNIQUE INDEX IF NOT EXISTS anaesthesia_fee_master_type_uniq
  ON public.anaesthesia_fee_master (lower(btrim(anaesthesia_type)))
  WHERE is_active;

-- The rates as they stood in code on 2026-08-04, plus sedation at the owner's
-- rate (16-Aug). Seeded only when absent, so a later edit is never overwritten.
INSERT INTO public.anaesthesia_fee_master (anaesthesia_type, panel_rate, private_rate)
SELECT v.t, v.p, v.pr
  FROM (VALUES ('general', 3000, 3500), ('spinal', 2000, 2500), ('sedation', 1500, 1500)) AS v(t, p, pr)
 WHERE NOT EXISTS (
   SELECT 1 FROM public.anaesthesia_fee_master a
    WHERE a.is_active AND lower(btrim(a.anaesthesia_type)) = v.t
 );

ALTER TABLE public.anaesthesia_fee_master ENABLE ROW LEVEL SECURITY;

-- TO public, never TO anon alone: an anon-only policy strands the table the
-- moment staff arrive as `authenticated` (the fault 20260816110000 repaired).
DROP POLICY IF EXISTS anaesthesia_fee_master_all ON public.anaesthesia_fee_master;
CREATE POLICY anaesthesia_fee_master_all
  ON public.anaesthesia_fee_master FOR ALL TO public
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.anaesthesia_fee_master TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Fill the exact matches, and only those.
-- ---------------------------------------------------------------------------
WITH normalised_packages AS (
  SELECT p.id,
         p.anaesthesia_type,
         btrim(regexp_replace(lower(COALESCE(p.treatment_plan, '')), '[^a-z0-9]+', ' ', 'g')) AS n_plan,
         btrim(regexp_replace(lower(COALESCE(p.treatment_code, '')), '[^a-z0-9]+', ' ', 'g')) AS n_code
    FROM public.pmjay_mjpjay_packages p
   WHERE p.is_active
),
-- One row per normalised name, and ONLY where that name identifies exactly one
-- package. Two packages sharing a name means we do not know which surgeon.
unambiguous AS (
  SELECT n AS name, min(id::text)::uuid AS package_id
    FROM (
      SELECT id, n_plan AS n FROM normalised_packages WHERE n_plan <> ''
      UNION ALL
      SELECT id, n_code AS n FROM normalised_packages WHERE n_code <> ''
    ) x
   GROUP BY n
  HAVING count(DISTINCT id) = 1
),
matched AS (
  SELECT f.id AS fee_id, u.package_id
    FROM public.surgery_fee_master f
    JOIN unambiguous u
      ON u.name = btrim(regexp_replace(lower(COALESCE(f.procedure_name, '')), '[^a-z0-9]+', ' ', 'g'))
      OR u.name = btrim(regexp_replace(lower(COALESCE(f.yojana_surgery_name, '')), '[^a-z0-9]+', ' ', 'g'))
   WHERE f.is_active
),
-- A fee row could match on both its columns; keep one package per fee row.
one_per_fee AS (
  SELECT fee_id, min(package_id::text)::uuid AS package_id
    FROM matched
   GROUP BY fee_id
  HAVING count(DISTINCT package_id) = 1
)
UPDATE public.surgery_fee_master f
   SET pmjay_package_id = o.package_id,
       anaesthesia_type = NULLIF(btrim(COALESCE(p.anaesthesia_type, '')), ''),
       default_surgeon_name = (
         SELECT NULLIF(string_agg(DISTINCT btrim(s.surgeon_name), ', '), '')
           FROM public.pmjay_mjpjay_package_surgeons s
          WHERE s.package_id = o.package_id AND btrim(COALESCE(s.surgeon_name, '')) <> ''
       ),
       default_anaesthetist_name = (
         SELECT NULLIF(string_agg(DISTINCT btrim(a.anaesthetist_name), ', '), '')
           FROM public.pmjay_mjpjay_package_anaesthetists a
          WHERE a.package_id = o.package_id AND btrim(COALESCE(a.anaesthetist_name, '')) <> ''
       ),
       updated_at = now()
  FROM one_per_fee o
  JOIN public.pmjay_mjpjay_packages p ON p.id = o.package_id
 WHERE f.id = o.fee_id;

-- ---------------------------------------------------------------------------
-- 4. The owner's default surgeon fee where none was ever set (16-Aug).
--    BOTH columns to 5,000, which for the private side is a REDUCTION from the
--    8,000 fallback that lived in code. Chosen deliberately by the owner.
-- ---------------------------------------------------------------------------
UPDATE public.surgery_fee_master
   SET panel_rate = 5000, updated_at = now()
 WHERE is_active AND panel_rate IS NULL;

UPDATE public.surgery_fee_master
   SET private_rate = 5000, updated_at = now()
 WHERE is_active AND private_rate IS NULL;

-- ---------------------------------------------------------------------------
-- 5. Prove it.
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE
  v_no_rate   INT;
  v_matched   INT;
  v_bad_link  INT;
  v_types     INT;
BEGIN
  SELECT count(*) INTO v_no_rate FROM public.surgery_fee_master
   WHERE is_active AND (panel_rate IS NULL OR private_rate IS NULL);
  IF v_no_rate > 0 THEN
    RAISE EXCEPTION 'ABORT: % active fee row(s) still carry no rate', v_no_rate;
  END IF;

  -- Every populated column must be able to point at the package it came from,
  -- or we cannot tell a matched value from one somebody typed.
  SELECT count(*) INTO v_bad_link FROM public.surgery_fee_master
   WHERE is_active AND pmjay_package_id IS NULL
     AND (default_surgeon_name IS NOT NULL
       OR default_anaesthetist_name IS NOT NULL
       OR anaesthesia_type IS NOT NULL);
  IF v_bad_link > 0 THEN
    RAISE EXCEPTION 'ABORT: % row(s) carry package data with no package link', v_bad_link;
  END IF;

  -- Any anaesthesia type written onto a fee row must be priceable.
  SELECT count(*) INTO v_types FROM public.surgery_fee_master f
   WHERE f.is_active AND f.anaesthesia_type IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.anaesthesia_fee_master a
        WHERE a.is_active
          AND lower(btrim(a.anaesthesia_type)) = lower(btrim(f.anaesthesia_type))
     );
  IF v_types > 0 THEN
    RAISE EXCEPTION 'ABORT: % fee row(s) name an anaesthesia type with no rate', v_types;
  END IF;

  SELECT count(*) INTO v_matched FROM public.surgery_fee_master
   WHERE is_active AND pmjay_package_id IS NOT NULL;
  RAISE NOTICE 'Linked % fee row(s) to a PMJAY package; every active row now has both rates.', v_matched;
END
$verify$;

NOTIFY pgrst, 'reload schema';
