-- Blanket surgeon fees for every procedure in the surgery master, per the
-- owner's interim order (2026-08-02): panel 5,000 / private 8,000. Individual
-- procedures can be re-priced on the Surgery Fee Master screen any time —
-- this fills the master so OT invoices stop generating with blank amounts.

INSERT INTO public.surgery_fee_master (procedure_name, surgery_id, panel_rate, private_rate)
SELECT DISTINCT ON (lower(btrim(s.name)))
       btrim(s.name), s.id, 5000, 8000
  FROM public.cghs_surgery s
 WHERE COALESCE(btrim(s.name), '') <> ''
   AND COALESCE(s.is_active, true)
 ORDER BY lower(btrim(s.name)), s.created_at DESC NULLS LAST
ON CONFLICT ((lower(procedure_name))) WHERE is_active DO NOTHING;

-- Any hand-created rows still missing a rate get the same defaults.
UPDATE public.surgery_fee_master
   SET panel_rate = COALESCE(panel_rate, 5000),
       private_rate = COALESCE(private_rate, 8000),
       updated_at = now()
 WHERE is_active AND (panel_rate IS NULL OR private_rate IS NULL);

SELECT count(*) AS priced_procedures
  FROM public.surgery_fee_master
 WHERE is_active AND panel_rate IS NOT NULL AND private_rate IS NOT NULL;
