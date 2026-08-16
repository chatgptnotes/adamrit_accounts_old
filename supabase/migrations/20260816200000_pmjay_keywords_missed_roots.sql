-- Five roots the first pass missed, found by reading the 17 packages it left
-- blank rather than assuming the blanks were all meaningless fragments.
--
-- Two of them are misspellings in the Yojana export itself — "Caniectomy" for
-- craniectomy and "Arthrosopic" for arthroscopic. Matching the misspelling is
-- deliberate: the master is the scheme's data and correcting the spelling would
-- change a value the claim is filed against. A keyword is the right place to
-- absorb it, because it costs nothing and finds the row.

DO $apply$
DECLARE v_rows INT;
BEGIN
  WITH dictionary(root, synonyms) AS (
    VALUES
      ('caniectomy',    ARRAY['Decompressive Craniectomy','Skull Decompression','Head Injury Surgery','Neurosurgery']),
      ('arthrosopic',   ARRAY['Arthroscopy','Keyhole Joint Surgery','Scope Surgery']),
      ('cystectomy',    ARRAY['Bladder Removal','Bladder Cancer Surgery','Radical Cystectomy']),
      ('paraumbilical', ARRAY['Paraumbilical Hernia','Umbilical Hernia','Hernia Repair']),
      ('renal tumor',   ARRAY['Kidney Tumour','Renal Cancer','Radical Nephrectomy'])
  ),
  built AS (
    SELECT p.id,
           ARRAY(
             SELECT DISTINCT s FROM (
               SELECT unnest(COALESCE(p.keywords, ARRAY[]::TEXT[])) AS s
               UNION
               SELECT s FROM dictionary d CROSS JOIN LATERAL unnest(d.synonyms) AS s
                WHERE lower(COALESCE(p.treatment_plan, '') || ' ' ||
                            COALESCE(p.diagnosis, '')      || ' ' ||
                            COALESCE(p.category, '')) LIKE '%' || d.root || '%'
             ) u ORDER BY s
           ) AS kw
      FROM public.pmjay_mjpjay_packages p
  )
  UPDATE public.pmjay_mjpjay_packages p
     SET keywords = b.kw, updated_at = now()
    FROM built b
   WHERE p.id = b.id
     AND array_length(b.kw, 1) IS NOT NULL
     AND p.keywords IS DISTINCT FROM b.kw;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RAISE NOTICE 'Additional roots applied to % package(s)', v_rows;
END
$apply$;

DO $verify$
DECLARE v_with INT; v_total INT;
BEGIN
  SELECT count(*) FILTER (WHERE array_length(keywords, 1) > 0), count(*)
    INTO v_with, v_total FROM public.pmjay_mjpjay_packages;
  RAISE NOTICE '% of % packages now carry keywords.', v_with, v_total;
END
$verify$;
