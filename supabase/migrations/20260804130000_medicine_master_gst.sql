-- Pharmacy sale items point at medicine_master, not medication — the previous
-- GST columns landed on the wrong table (0 rows rated). Same change, right
-- table: GST columns + 5% default for everything sold this financial year.

ALTER TABLE public.medicine_master
  ADD COLUMN IF NOT EXISTS gst_rate NUMERIC(4,1),
  ADD COLUMN IF NOT EXISTS hsn_code TEXT;

UPDATE public.medicine_master m
   SET gst_rate = 5
 WHERE m.gst_rate IS NULL
   AND m.id IN (
     SELECT DISTINCT psi.medication_id
       FROM public.pharmacy_sale_items psi
       JOIN public.pharmacy_sales ps ON ps.sale_id = psi.sale_id
      WHERE ps.status = 'active'
        AND ps.sale_date >= DATE '2026-04-01'
        AND psi.medication_id IS NOT NULL
   );

NOTIFY pgrst, 'reload schema';

SELECT count(*) AS rated_medicines FROM public.medicine_master WHERE gst_rate IS NOT NULL;
