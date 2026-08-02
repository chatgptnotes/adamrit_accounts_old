-- Default GST rate for every medicine sold this financial year.
-- Since the Sept-2025 GST rationalisation, medicines and medical consumables
-- attract 5%. Sets 5% only where no rate has been chosen yet, so anything the
-- accountant classified by hand (including future nil-rated exceptions) stays.

UPDATE public.medication m
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

-- How many medicines now carry a rate
SELECT count(*) AS rated_medicines FROM public.medication WHERE gst_rate IS NOT NULL;
