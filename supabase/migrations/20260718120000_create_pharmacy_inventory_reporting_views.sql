-- Live, hospital-scoped reporting views for the Pharmacy Inventory Report.
-- Stock remains owned by medicine_batch_inventory; these views do not mutate data.

CREATE OR REPLACE VIEW public.v_pharmacy_inventory_batch_report
WITH (security_invoker = true)
AS
SELECT
  mbi.id AS batch_inventory_id,
  mbi.hospital_name,
  mbi.medicine_id,
  COALESCE(mm.medicine_name, m.product_name, m.name, 'Unknown medicine') AS medicine_name,
  COALESCE(mm.generic_name, m.generic) AS generic_name,
  COALESCE(mm.type, m.dosage) AS dosage_form,
  mbi.batch_number,
  mbi.expiry_date,
  mbi.current_stock,
  mbi.received_quantity,
  mbi.sold_quantity,
  mbi.reserved_stock,
  mbi.free_quantity,
  mbi.purchase_price,
  mbi.selling_price,
  mbi.mrp,
  mbi.supplier_id,
  s.supplier_name,
  mbi.grn_number,
  mbi.grn_date,
  mbi.rack_number,
  mbi.shelf_location,
  (mbi.current_stock * COALESCE(mbi.purchase_price, 0)) AS purchase_value,
  (mbi.current_stock * COALESCE(mbi.mrp, 0)) AS mrp_value,
  (mbi.expiry_date - CURRENT_DATE) AS days_to_expiry,
  CASE
    WHEN mbi.expiry_date < CURRENT_DATE THEN 'EXPIRED'
    WHEN mbi.expiry_date <= CURRENT_DATE + 30 THEN 'EXPIRING_SOON'
    WHEN mbi.expiry_date <= CURRENT_DATE + 90 THEN 'NEAR_EXPIRY'
    ELSE 'GOOD'
  END AS expiry_status
FROM public.medicine_batch_inventory mbi
LEFT JOIN public.medicine_master mm ON mm.id = mbi.medicine_id AND COALESCE(mm.is_deleted, false) = false
LEFT JOIN public.medication m ON m.id = mbi.medicine_id
LEFT JOIN public.suppliers s ON s.id = mbi.supplier_id
WHERE mbi.is_active = true;

COMMENT ON VIEW public.v_pharmacy_inventory_batch_report IS
  'Live batch-level pharmacy inventory with medicine, supplier, valuation, and expiry information.';

CREATE OR REPLACE VIEW public.v_pharmacy_inventory_summary_report
WITH (security_invoker = true)
AS
WITH medicine_catalog AS (
  SELECT
    mm.hospital_name,
    mm.id AS medicine_id,
    mm.medicine_name,
    mm.generic_name,
    mm.type AS dosage_form
  FROM public.medicine_master mm
  WHERE COALESCE(mm.is_deleted, false) = false

  UNION

  SELECT
    mbi.hospital_name,
    mbi.medicine_id,
    COALESCE(mm.medicine_name, m.product_name, m.name, 'Unknown medicine') AS medicine_name,
    COALESCE(mm.generic_name, m.generic) AS generic_name,
    COALESCE(mm.type, m.dosage) AS dosage_form
  FROM public.medicine_batch_inventory mbi
  LEFT JOIN public.medicine_master mm ON mm.id = mbi.medicine_id AND COALESCE(mm.is_deleted, false) = false
  LEFT JOIN public.medication m ON m.id = mbi.medicine_id
  WHERE mbi.is_active = true
),
batch_totals AS (
  SELECT
    mbi.hospital_name,
    mbi.medicine_id,
    SUM(mbi.current_stock) AS on_hand_quantity,
    SUM(mbi.current_stock) FILTER (WHERE mbi.expiry_date >= CURRENT_DATE) AS available_quantity,
    COUNT(*) AS batch_count,
    MIN(mbi.expiry_date) FILTER (WHERE mbi.current_stock > 0) AS nearest_expiry,
    COUNT(*) FILTER (WHERE mbi.current_stock > 0 AND mbi.expiry_date < CURRENT_DATE) AS expired_batch_count,
    COUNT(*) FILTER (WHERE mbi.current_stock > 0 AND mbi.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30) AS expiring_soon_batch_count,
    COUNT(*) FILTER (WHERE mbi.current_stock > 0 AND mbi.expiry_date > CURRENT_DATE + 30 AND mbi.expiry_date <= CURRENT_DATE + 90) AS near_expiry_batch_count,
    SUM(mbi.current_stock * COALESCE(mbi.purchase_price, 0)) AS purchase_value,
    SUM(mbi.current_stock * COALESCE(mbi.mrp, 0)) AS mrp_value
  FROM public.medicine_batch_inventory mbi
  WHERE mbi.is_active = true
  GROUP BY mbi.hospital_name, mbi.medicine_id
)
SELECT
  c.hospital_name,
  c.medicine_id,
  c.medicine_name,
  c.generic_name,
  c.dosage_form,
  COALESCE(b.on_hand_quantity, 0) AS on_hand_quantity,
  COALESCE(b.available_quantity, 0) AS available_quantity,
  COALESCE(b.batch_count, 0) AS batch_count,
  b.nearest_expiry,
  COALESCE(b.expired_batch_count, 0) AS expired_batch_count,
  COALESCE(b.expiring_soon_batch_count, 0) AS expiring_soon_batch_count,
  COALESCE(b.near_expiry_batch_count, 0) AS near_expiry_batch_count,
  COALESCE(b.purchase_value, 0) AS purchase_value,
  COALESCE(b.mrp_value, 0) AS mrp_value
FROM medicine_catalog c
LEFT JOIN batch_totals b
  ON b.hospital_name = c.hospital_name AND b.medicine_id = c.medicine_id;

COMMENT ON VIEW public.v_pharmacy_inventory_summary_report IS
  'Medicine-level pharmacy stock summary, including medicines without active batches for out-of-stock reporting.';

GRANT SELECT ON public.v_pharmacy_inventory_batch_report TO authenticated;
GRANT SELECT ON public.v_pharmacy_inventory_summary_report TO authenticated;
