-- GST classification on the medicine master. Pharmacy selling prices are
-- MRP-inclusive (sale items store tax 0), so the GST Sales Summary needs the
-- rate on the medicine to back-compute taxable value and tax from gross.

ALTER TABLE public.medication
  ADD COLUMN IF NOT EXISTS gst_rate NUMERIC(4,1),
  ADD COLUMN IF NOT EXISTS hsn_code TEXT;

NOTIFY pgrst, 'reload schema';
