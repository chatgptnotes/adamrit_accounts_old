-- Reorder levels for the drugs Dr M actually watches, by content not by brand.
--
-- THE INSTRUCTION (19 Aug, Dr M): the 21 commonly used drugs, reorder levels as
-- given, notify below level. Then: "use the content of the medicines, do not go
-- by the brand — any brand is ok". And: "4 strip" is 40 tablets, so every level
-- here is a piece count, the unit the batch inventory counts in.
--
-- WHY A RULES TABLE AND NOT A LEVEL PER MEDICINE. Each of these molecules has
-- between 1 and 20 products in medicine_master — 14 atorvastatins, 14 aspirins,
-- 20 calciums. Writing 40 onto each of 14 atorvastatin rows would mean "tell me
-- when ANY brand falls below 40", and since the pharmacy stocks one or two
-- brands of each, twelve of those fourteen sit at zero forever. The alert would
-- be permanent noise from the first morning, which is the same thing as no alert
-- at all.
--
-- A level belongs to the MOLECULE. One rule, matched against every product of
-- that content, compared against the TOTAL stock across all of them. That is
-- what "any brand is ok" means when it is written down.
--
-- HOW THE STRENGTH IS HANDLED. Where the strength is distinctive it is required
-- as well as the molecule: '40', '75', '500', '200', '25' and '3.125' each
-- appear in a product name unambiguously. Where it is a single digit it is NOT
-- required — 'ivabradine 5' would match "3.125" and "25" on a substring, so
-- Ivabradine matches on the molecule alone and covers its strengths together.
-- Each rule below says which it is.
--
-- FOUR ARE NOT LOADED, because they cannot be identified from the name given and
-- guessing an antibiotic or an analgesic combination is not a tidy-up:
--   Cefahed        -- which cephalosporin?
--   Mr             -- a muscle relaxant combination, but which?
--   Sp             -- aceclofenac + paracetamol + serratiopeptidase?
--   Ccm  '05'      -- 5 strips or 5 tablets? Every other line says "strip".
-- They are listed in medicine_reorder_rules with is_active = false and a note,
-- so they are visibly waiting rather than quietly forgotten.

-- --------------------------------------------------------------- 1. the rules

CREATE TABLE IF NOT EXISTS public.medicine_reorder_rules (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- What Dr M calls it. One rule per line of his list.
  label          TEXT NOT NULL,
  -- Every word here must appear in the product or generic name. The molecule,
  -- plus the strength where the strength is distinctive enough to match on.
  include_all    TEXT[] NOT NULL,
  -- Any word here disqualifies a product. Combination products are a different
  -- medicine: Ecosprin AV is aspirin AND atorvastatin, and stocking it does not
  -- mean plain aspirin 75 is on the shelf.
  exclude_any    TEXT[] NOT NULL DEFAULT '{}',
  -- In pieces. Tablets, shots, vials — whatever the batch inventory counts.
  reorder_level  INT NOT NULL CHECK (reorder_level > 0),
  as_written     TEXT,
  note           TEXT,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS medicine_reorder_rules_label_uidx
  ON public.medicine_reorder_rules (lower(btrim(label)));

COMMENT ON TABLE public.medicine_reorder_rules IS
  'Reorder levels by molecule, in pieces. One rule covers every brand of that '
  'content and is compared against their combined stock.';

GRANT SELECT ON public.medicine_reorder_rules TO anon, authenticated;
GRANT INSERT, UPDATE ON public.medicine_reorder_rules TO authenticated;

-- ------------------------------------------------------ 2. which product is which

CREATE OR REPLACE VIEW public.v_medicine_reorder_products AS
SELECT r.id            AS rule_id,
       r.label,
       r.reorder_level,
       m.id            AS medicine_id,
       m.medicine_name,
       COALESCE(s.total_stock, 0) AS stock
  FROM public.medicine_reorder_rules r
  JOIN public.medicine_master m
    ON COALESCE(m.is_deleted, false) = false
   -- Every include word must be present, in the product name or the generic.
   AND NOT EXISTS (
     SELECT 1 FROM unnest(r.include_all) AS w(word)
      WHERE (m.medicine_name || ' ' || COALESCE(m.generic_name, '')) NOT ILIKE '%' || w.word || '%'
   )
   -- And no exclude word may be.
   AND NOT EXISTS (
     SELECT 1 FROM unnest(r.exclude_any) AS x(word)
      WHERE (m.medicine_name || ' ' || COALESCE(m.generic_name, '')) ILIKE '%' || x.word || '%'
   )
  LEFT JOIN (
    SELECT medicine_id, sum(total_stock) AS total_stock
      FROM public.v_medicine_combined_stock
     GROUP BY medicine_id
  ) s ON s.medicine_id = m.id
 WHERE r.is_active;

COMMENT ON VIEW public.v_medicine_reorder_products IS
  'Every product each reorder rule covers, with its stock. Read this to check a '
  'rule is catching the right medicines before trusting its alert.';

GRANT SELECT ON public.v_medicine_reorder_products TO anon, authenticated;

-- --------------------------------------------------- 3. what is short, by content

CREATE OR REPLACE VIEW public.v_medicine_reorder_status AS
SELECT r.id                       AS rule_id,
       r.label,
       r.reorder_level,
       r.as_written,
       count(p.medicine_id)       AS brands_covered,
       COALESCE(sum(p.stock), 0)  AS stock,
       r.reorder_level - COALESCE(sum(p.stock), 0) AS shortfall
  FROM public.medicine_reorder_rules r
  LEFT JOIN public.v_medicine_reorder_products p ON p.rule_id = r.id
 WHERE r.is_active
 GROUP BY r.id, r.label, r.reorder_level, r.as_written;

COMMENT ON VIEW public.v_medicine_reorder_status IS
  'One row per reorder rule: total stock of every brand of that content against '
  'the level. shortfall > 0 means order.';

GRANT SELECT ON public.v_medicine_reorder_status TO anon, authenticated;

-- --------------------------------------------------------------- 4. the levels

INSERT INTO public.medicine_reorder_rules
  (label, include_all, exclude_any, reorder_level, as_written, note)
VALUES
  ('Atorvastatin 40',      ARRAY['atorvastatin','40'], ARRAY['aspirin','clopidogrel'], 40, '4 strip',  'Plain atorvastatin 40; the aspirin and clopidogrel combinations are separate medicines'),
  ('Aspirin 75',           ARRAY['aspirin','75'],      ARRAY['atorvastatin','clopidogrel','rosuvastatin'], 40, '4 strip', 'Plain aspirin 75, not Ecosprin AV or Gold'),
  ('Clopidogrel 75',       ARRAY['clopidogrel','75'],  ARRAY['aspirin','atorvastatin'], 40, '4 strip', 'Plain clopidogrel 75'),
  ('Vitamin D3 shots',     ARRAY['cholecalciferol'],   ARRAY[]::TEXT[], 20, '20 shots', 'Arachitol and equivalents; strength not matched, the oral shots and the injection are counted together'),
  ('Ivabradine',           ARRAY['ivabradine'],        ARRAY[]::TEXT[], 40, '4 strip',  'All strengths together — a single digit 5 would match 25 and 3.125 on a substring'),
  ('Carvedilol 3.125',     ARRAY['carvedilol','3.125'], ARRAY[]::TEXT[], 40, '4 strip', 'Strength is distinctive enough to match on'),
  ('Nandrolone inj',       ARRAY['nandrolone'],        ARRAY[]::TEXT[], 10, '10 qty',   'Deca-Durabolin and equivalents'),
  ('Ondansetron inj',      ARRAY['ondansetron'],       ARRAY[]::TEXT[], 30, '30 qty',   'Injection and tablet counted together — check the product list if that is wrong'),
  ('Ranitidine inj',       ARRAY['ranitidine'],        ARRAY[]::TEXT[], 30, '30 qty',   'Rantac and equivalents'),
  ('B-complex inj',        ARRAY['optineuron'],        ARRAY[]::TEXT[], 30, '30 qty',   'Matched on the Optineuron name: the B-complex generics are not spelled consistently enough to match on content'),
  ('Rabeprazole DSR',      ARRAY['rabeprazole'],       ARRAY[]::TEXT[], 50, '5 strip',  'All rabeprazole including the DSR combinations'),
  ('Pantoprazole DSR',     ARRAY['pantoprazole'],      ARRAY[]::TEXT[], 50, '5 strip',  'All pantoprazole including the DSR combinations'),
  ('Fluconazole 200 inj',  ARRAY['fluconazole','200'], ARRAY[]::TEXT[], 5,  '05',       'Strength matched'),
  ('Metoprolol 25',        ARRAY['metoprolol','25'],   ARRAY[]::TEXT[], 40, '4 strip',  'Met XL 25 and equivalents'),
  ('Metformin 500',        ARRAY['metformin','500'],   ARRAY['glimepiride','vildagliptin','sitagliptin'], 40, '4 strip', 'Plain metformin 500; the gliptin and glimepiride combinations are separate medicines'),
  ('Levetiracetam 500',    ARRAY['levetiracetam','500'], ARRAY[]::TEXT[], 40, '4 strip', 'Levera 500 and equivalents'),
  ('Calcium',              ARRAY['calcium'],           ARRAY['gluconate','chloride'], 60, '06 strip', 'Oral calcium; the injectable salts are excluded')
ON CONFLICT (lower(btrim(label))) DO UPDATE
  SET include_all = EXCLUDED.include_all,
      exclude_any = EXCLUDED.exclude_any,
      reorder_level = EXCLUDED.reorder_level,
      as_written = EXCLUDED.as_written,
      note = EXCLUDED.note,
      is_active = true,
      updated_at = now();

-- The four that cannot be identified. Recorded, inactive, with the question.
INSERT INTO public.medicine_reorder_rules
  (label, include_all, reorder_level, as_written, note, is_active)
VALUES
  ('Cefahed',  ARRAY['cefahed'],  100, '10 strip', 'WAITING ON DR M: which cephalosporin is this? Not in the master under this name.', false),
  ('Mr',       ARRAY['__unknown__'], 60, '6 strip', 'WAITING ON DR M: which muscle relaxant combination?', false),
  ('Sp',       ARRAY['__unknown__'], 60, '6 strip', 'WAITING ON DR M: aceclofenac + paracetamol + serratiopeptidase?', false),
  ('Ccm',      ARRAY['calcium','citrate'], 5, '05', 'WAITING ON DR M: 5 strips (50) or 5 tablets? Every other line says "strip".', false)
ON CONFLICT (lower(btrim(label))) DO NOTHING;

-- ------------------------------------------- 5. the alert covers rules as well

CREATE OR REPLACE FUNCTION public.notify_low_stock_medicines()
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rows  INT := 0;
  v_lines TEXT;
  v_out   INT := 0;
BEGIN
  -- Both sources: a level set against one product, and a level set against a
  -- molecule. The molecule rules are how Dr M's list is held.
  WITH short AS (
    SELECT label AS name, stock, reorder_level, shortfall
      FROM public.v_medicine_reorder_status
     WHERE shortfall > 0
    UNION ALL
    SELECT medicine_name, stock, reorder_level, shortfall
      FROM public.v_medicine_below_reorder
  )
  SELECT count(*),
         string_agg(name || ' — ' || stock || ' left, reorder at ' || reorder_level,
                    E'\n' ORDER BY shortfall DESC, name)
    INTO v_rows, v_lines
    FROM short;

  IF COALESCE(v_rows, 0) = 0 THEN
    RETURN 0;
  END IF;

  -- One digest a day, not one bell per drug.
  IF EXISTS (
    SELECT 1 FROM notifications
     WHERE notification_type = 'medicine_low_stock'
       AND created_at > now() - interval '20 hours'
  ) THEN
    RETURN 0;
  END IF;

  BEGIN
    INSERT INTO notifications (notification_type, title, message, recipient_role,
                               source_table, payload)
    VALUES ('medicine_low_stock',
            v_rows || ' medicine(s) at or below reorder level',
            v_lines,
            'all', 'medicine_master',
            jsonb_build_object('count', v_rows));
    v_out := 1;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Low-stock digest could not be written: %', SQLERRM;
  END;

  RETURN v_out;
END $$;

REVOKE ALL ON FUNCTION public.notify_low_stock_medicines() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_low_stock_medicines() TO anon, authenticated;

-- ------------------------------------------------------------------ 6. verify

DO $verify$
DECLARE v_active INT; v_waiting INT; v_nomatch TEXT;
BEGIN
  SELECT count(*) INTO v_active FROM public.medicine_reorder_rules WHERE is_active;
  IF v_active <> 17 THEN
    RAISE EXCEPTION 'ABORT: % active rule(s), expected the 17 identified drugs', v_active;
  END IF;

  SELECT count(*) INTO v_waiting FROM public.medicine_reorder_rules WHERE NOT is_active;
  IF v_waiting < 4 THEN
    RAISE EXCEPTION 'ABORT: the four unidentified drugs are not recorded as waiting';
  END IF;

  -- A rule that catches no product at all is a rule that will never fire, and a
  -- silent one is worse than none. Named, not tolerated.
  SELECT string_agg(label, ', ') INTO v_nomatch
    FROM public.v_medicine_reorder_status WHERE brands_covered = 0;
  IF v_nomatch IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: these rules match no medicine in the master: %', v_nomatch;
  END IF;

  -- The cron job from 20260819200000 must still be there to run any of this.
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'medicine-low-stock') THEN
    RAISE EXCEPTION 'ABORT: the daily check is not scheduled';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------- 7. read it
-- Every rule, what it caught, and whether it is short today.

SELECT label,
       as_written        AS "as Dr M wrote it",
       reorder_level     AS "reorder at (pieces)",
       brands_covered    AS "brands matched",
       stock             AS "in stock now",
       CASE WHEN shortfall > 0 THEN 'ORDER — short ' || shortfall ELSE 'ok' END AS status
  FROM public.v_medicine_reorder_status
 ORDER BY shortfall DESC, label;
