-- ============================================================================
-- Cash Book — back-date fix for Final Payments
-- Switches FINAL_BILL union from fp.created_at to fp.payment_date,
-- with COALESCE fallback so legacy rows (payment_date = NULL) keep showing.
-- Safe: CREATE OR REPLACE only. No data writes, no schema changes.
-- ============================================================================

CREATE OR REPLACE FUNCTION get_cash_book_transactions_direct(
  p_from_date DATE DEFAULT NULL,
  p_to_date DATE DEFAULT NULL,
  p_transaction_type TEXT DEFAULT NULL,
  p_patient_id UUID DEFAULT NULL,
  p_hospital_name TEXT DEFAULT NULL
)
RETURNS TABLE (
  transaction_id TEXT,
  transaction_type TEXT,
  visit_id TEXT,
  patient_id UUID,
  patient_name TEXT,
  transaction_date DATE,
  transaction_time TIMESTAMP WITH TIME ZONE,
  description TEXT,
  amount NUMERIC,
  quantity INTEGER,
  unit_rate NUMERIC,
  rate_type TEXT,
  payment_mode TEXT,
  created_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
  RETURN QUERY

  -- 1. OPD Services (Clinical Services)
  SELECT
    vcs.id::TEXT as transaction_id,
    'OPD_SERVICE'::TEXT as transaction_type,
    vcs.visit_id::TEXT as visit_id,
    v.patient_id,
    p.name::TEXT as patient_name,
    vcs.selected_at::DATE as transaction_date,
    vcs.selected_at::TIMESTAMP WITH TIME ZONE as transaction_time,
    cs.service_name::TEXT as description,
    vcs.amount::NUMERIC as amount,
    vcs.quantity::INTEGER as quantity,
    vcs.rate_used::NUMERIC as unit_rate,
    vcs.rate_type::TEXT as rate_type,
    'CASH'::TEXT as payment_mode,
    vcs.created_at::TIMESTAMP WITH TIME ZONE as created_at,
    vcs.updated_at::TIMESTAMP WITH TIME ZONE as updated_at
  FROM visit_clinical_services vcs
  LEFT JOIN visits v ON vcs.visit_id = v.id
  LEFT JOIN patients p ON v.patient_id = p.id
  LEFT JOIN clinical_services cs ON vcs.clinical_service_id = cs.id
  WHERE vcs.amount > 0
    AND (p_from_date IS NULL OR vcs.selected_at::DATE >= p_from_date)
    AND (p_to_date IS NULL OR vcs.selected_at::DATE <= p_to_date)
    AND (p_transaction_type IS NULL OR 'OPD_SERVICE' = p_transaction_type)
    AND (p_patient_id IS NULL OR v.patient_id = p_patient_id)
    AND (p_hospital_name IS NULL OR p.hospital_name = p_hospital_name)

  UNION ALL

  -- 2. Lab Tests
  SELECT
    vl.id::TEXT as transaction_id,
    'LAB_TEST'::TEXT as transaction_type,
    vl.visit_id::TEXT as visit_id,
    v.patient_id,
    p.name::TEXT as patient_name,
    COALESCE(vl.ordered_date, vl.created_at)::DATE as transaction_date,
    COALESCE(vl.ordered_date, vl.created_at)::TIMESTAMP WITH TIME ZONE as transaction_time,
    l.name::TEXT as description,
    (vl.unit_rate * vl.quantity)::NUMERIC as amount,
    vl.quantity::INTEGER as quantity,
    vl.unit_rate::NUMERIC as unit_rate,
    'standard'::TEXT as rate_type,
    'CASH'::TEXT as payment_mode,
    vl.created_at::TIMESTAMP WITH TIME ZONE as created_at,
    vl.updated_at::TIMESTAMP WITH TIME ZONE as updated_at
  FROM visit_labs vl
  LEFT JOIN visits v ON vl.visit_id = v.id
  LEFT JOIN patients p ON v.patient_id = p.id
  LEFT JOIN lab l ON vl.lab_id = l.id
  WHERE (vl.unit_rate * vl.quantity) > 0
    AND (p_from_date IS NULL OR COALESCE(vl.ordered_date, vl.created_at)::DATE >= p_from_date)
    AND (p_to_date IS NULL OR COALESCE(vl.ordered_date, vl.created_at)::DATE <= p_to_date)
    AND (p_transaction_type IS NULL OR 'LAB_TEST' = p_transaction_type)
    AND (p_patient_id IS NULL OR v.patient_id = p_patient_id)
    AND (p_hospital_name IS NULL OR p.hospital_name = p_hospital_name)

  UNION ALL

  -- 3. Radiology Tests
  SELECT
    vr.id::TEXT as transaction_id,
    'RADIOLOGY'::TEXT as transaction_type,
    vr.visit_id::TEXT as visit_id,
    v.patient_id,
    p.name::TEXT as patient_name,
    COALESCE(vr.ordered_date, vr.created_at)::DATE as transaction_date,
    COALESCE(vr.ordered_date, vr.created_at)::TIMESTAMP WITH TIME ZONE as transaction_time,
    r.name::TEXT as description,
    (vr.unit_rate * vr.quantity)::NUMERIC as amount,
    vr.quantity::INTEGER as quantity,
    vr.unit_rate::NUMERIC as unit_rate,
    'standard'::TEXT as rate_type,
    'CASH'::TEXT as payment_mode,
    vr.created_at::TIMESTAMP WITH TIME ZONE as created_at,
    vr.updated_at::TIMESTAMP WITH TIME ZONE as updated_at
  FROM visit_radiology vr
  LEFT JOIN visits v ON vr.visit_id = v.id
  LEFT JOIN patients p ON v.patient_id = p.id
  LEFT JOIN radiology r ON vr.radiology_id = r.id
  WHERE (vr.unit_rate * vr.quantity) > 0
    AND (p_from_date IS NULL OR COALESCE(vr.ordered_date, vr.created_at)::DATE >= p_from_date)
    AND (p_to_date IS NULL OR COALESCE(vr.ordered_date, vr.created_at)::DATE <= p_to_date)
    AND (p_transaction_type IS NULL OR 'RADIOLOGY' = p_transaction_type)
    AND (p_patient_id IS NULL OR v.patient_id = p_patient_id)
    AND (p_hospital_name IS NULL OR p.hospital_name = p_hospital_name)

  UNION ALL

  -- 4. Mandatory Services
  SELECT
    vms.id::TEXT as transaction_id,
    'MANDATORY_SERVICE'::TEXT as transaction_type,
    vms.visit_id::TEXT as visit_id,
    v.patient_id,
    p.name::TEXT as patient_name,
    vms.selected_at::DATE as transaction_date,
    vms.selected_at::TIMESTAMP WITH TIME ZONE as transaction_time,
    ms.service_name::TEXT as description,
    vms.amount::NUMERIC as amount,
    vms.quantity::INTEGER as quantity,
    vms.rate_used::NUMERIC as unit_rate,
    vms.rate_type::TEXT as rate_type,
    'CASH'::TEXT as payment_mode,
    vms.created_at::TIMESTAMP WITH TIME ZONE as created_at,
    vms.updated_at::TIMESTAMP WITH TIME ZONE as updated_at
  FROM visit_mandatory_services vms
  LEFT JOIN visits v ON vms.visit_id = v.id
  LEFT JOIN patients p ON v.patient_id = p.id
  LEFT JOIN mandatory_services ms ON vms.mandatory_service_id = ms.id
  WHERE vms.amount > 0
    AND (p_from_date IS NULL OR vms.selected_at::DATE >= p_from_date)
    AND (p_to_date IS NULL OR vms.selected_at::DATE <= p_to_date)
    AND (p_transaction_type IS NULL OR 'MANDATORY_SERVICE' = p_transaction_type)
    AND (p_patient_id IS NULL OR v.patient_id = p_patient_id)
    AND (p_hospital_name IS NULL OR p.hospital_name = p_hospital_name)

  UNION ALL

  -- 5. Pharmacy Sales
  SELECT
    ps.sale_id::TEXT as transaction_id,
    'PHARMACY'::TEXT as transaction_type,
    ps.visit_id::TEXT as visit_id,
    CASE
      WHEN ps.patient_id::TEXT ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN ps.patient_id::UUID
      ELSE NULL
    END as patient_id,
    COALESCE(ps.patient_name, 'Walk-in Customer')::TEXT as patient_name,
    ps.sale_date::DATE as transaction_date,
    ps.sale_date::TIMESTAMP WITH TIME ZONE as transaction_time,
    ('Pharmacy Sale #' || ps.sale_id::TEXT)::TEXT as description,
    ps.total_amount::NUMERIC as amount,
    1::INTEGER as quantity,
    ps.total_amount::NUMERIC as unit_rate,
    'standard'::TEXT as rate_type,
    UPPER(ps.payment_method)::TEXT as payment_mode,
    ps.created_at::TIMESTAMP WITH TIME ZONE as created_at,
    ps.updated_at::TIMESTAMP WITH TIME ZONE as updated_at
  FROM pharmacy_sales ps
  LEFT JOIN patients p ON (
    ps.patient_id::TEXT ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND ps.patient_id::UUID = p.id
  )
  WHERE ps.total_amount > 0
    AND (p_from_date IS NULL OR ps.sale_date::DATE >= p_from_date)
    AND (p_to_date IS NULL OR ps.sale_date::DATE <= p_to_date)
    AND (p_transaction_type IS NULL OR 'PHARMACY' = p_transaction_type)
    AND (p_patient_id IS NULL OR (
      ps.patient_id::TEXT ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND ps.patient_id::UUID = p_patient_id
    ))
    AND (p_hospital_name IS NULL OR p.hospital_name = p_hospital_name OR ps.patient_id IS NULL)

  UNION ALL

  -- 6. Physiotherapy Services
  SELECT
    pbi.id::TEXT as transaction_id,
    'PHYSIOTHERAPY'::TEXT as transaction_type,
    pbi.visit_id::TEXT as visit_id,
    v.patient_id,
    p.name::TEXT as patient_name,
    pbi.created_at::DATE as transaction_date,
    pbi.created_at::TIMESTAMP WITH TIME ZONE as transaction_time,
    pbi.item_name::TEXT as description,
    pbi.amount::NUMERIC as amount,
    pbi.quantity::INTEGER as quantity,
    pbi.cghs_rate::NUMERIC as unit_rate,
    'cghs'::TEXT as rate_type,
    'CASH'::TEXT as payment_mode,
    pbi.created_at::TIMESTAMP WITH TIME ZONE as created_at,
    pbi.updated_at::TIMESTAMP WITH TIME ZONE as updated_at
  FROM physiotherapy_bill_items pbi
  LEFT JOIN visits v ON pbi.visit_id = v.visit_id
  LEFT JOIN patients p ON v.patient_id = p.id
  WHERE pbi.amount > 0
    AND (p_from_date IS NULL OR pbi.created_at::DATE >= p_from_date)
    AND (p_to_date IS NULL OR pbi.created_at::DATE <= p_to_date)
    AND (p_transaction_type IS NULL OR 'PHYSIOTHERAPY' = p_transaction_type)
    AND (p_patient_id IS NULL OR v.patient_id = p_patient_id)
    AND (p_hospital_name IS NULL OR p.hospital_name = p_hospital_name)

  UNION ALL

  -- 7. Direct Sale Bills (Pharmacy walk-in sales)
  SELECT
    dsb.id::TEXT as transaction_id,
    'DIRECT_SALE'::TEXT as transaction_type,
    NULL::TEXT as visit_id,
    NULL::UUID as patient_id,
    COALESCE(dsb.patient_name, 'Walk-in Customer')::TEXT as patient_name,
    dsb.bill_date::DATE as transaction_date,
    dsb.bill_date::TIMESTAMP WITH TIME ZONE as transaction_time,
    ('Direct Sale Bill #' || dsb.bill_number)::TEXT as description,
    dsb.net_amount::NUMERIC as amount,
    1::INTEGER as quantity,
    dsb.net_amount::NUMERIC as unit_rate,
    'standard'::TEXT as rate_type,
    UPPER(COALESCE(dsb.payment_mode, 'CASH'))::TEXT as payment_mode,
    dsb.created_at::TIMESTAMP WITH TIME ZONE as created_at,
    dsb.updated_at::TIMESTAMP WITH TIME ZONE as updated_at
  FROM direct_sale_bills dsb
  WHERE dsb.net_amount > 0
    AND (p_from_date IS NULL OR dsb.bill_date::DATE >= p_from_date)
    AND (p_to_date IS NULL OR dsb.bill_date::DATE <= p_to_date)
    AND (p_transaction_type IS NULL OR 'DIRECT_SALE' = p_transaction_type)
    AND (p_patient_id IS NULL)

  UNION ALL

  -- 8. Advance Payments
  SELECT
    ap.id::TEXT as transaction_id,
    'ADVANCE_PAYMENT'::TEXT as transaction_type,
    ap.visit_id::TEXT as visit_id,
    ap.patient_id,
    COALESCE(ap.patient_name, p.name, 'Unknown Patient')::TEXT as patient_name,
    ap.payment_date::DATE as transaction_date,
    ap.created_at::TIMESTAMP WITH TIME ZONE as transaction_time,
    CASE
      WHEN ap.is_refund THEN ('Advance Payment Refund: ' || COALESCE(ap.refund_reason, 'No reason'))::TEXT
      ELSE ('Advance Payment' || CASE WHEN ap.remarks IS NOT NULL AND ap.remarks != '' THEN (' - ' || ap.remarks) ELSE '' END)::TEXT
    END as description,
    CASE
      WHEN ap.is_refund THEN (ap.advance_amount * -1)::NUMERIC
      ELSE ap.advance_amount::NUMERIC
    END as amount,
    1::INTEGER as quantity,
    ap.advance_amount::NUMERIC as unit_rate,
    'advance'::TEXT as rate_type,
    UPPER(ap.payment_mode)::TEXT as payment_mode,
    ap.created_at::TIMESTAMP WITH TIME ZONE as created_at,
    ap.updated_at::TIMESTAMP WITH TIME ZONE as updated_at
  FROM advance_payment ap
  LEFT JOIN patients p ON ap.patient_id = p.id
  WHERE ap.status = 'ACTIVE'
    AND ap.advance_amount > 0
    AND (p_from_date IS NULL OR ap.payment_date::DATE >= p_from_date)
    AND (p_to_date IS NULL OR ap.payment_date::DATE <= p_to_date)
    AND (p_transaction_type IS NULL OR 'ADVANCE_PAYMENT' = p_transaction_type)
    AND (p_patient_id IS NULL OR ap.patient_id = p_patient_id)
    AND (p_hospital_name IS NULL OR p.hospital_name = p_hospital_name)

  UNION ALL

  -- 9. Final Payments — back-date fix: read payment_date, fall back to created_at for legacy rows
  SELECT
    fp.id::TEXT as transaction_id,
    'FINAL_BILL'::TEXT as transaction_type,
    fp.visit_id::TEXT as visit_id,
    v.patient_id,
    p.name::TEXT as patient_name,
    COALESCE(fp.payment_date, fp.created_at::DATE)::DATE as transaction_date,
    fp.created_at::TIMESTAMP WITH TIME ZONE as transaction_time,
    ('Final Bill Payment - ' || fp.reason_of_discharge ||
     CASE WHEN fp.payment_remark IS NOT NULL AND fp.payment_remark != ''
          THEN ' (' || fp.payment_remark || ')'
          ELSE ''
     END)::TEXT as description,
    fp.amount::NUMERIC as amount,
    1::INTEGER as quantity,
    fp.amount::NUMERIC as unit_rate,
    'final'::TEXT as rate_type,
    UPPER(fp.mode_of_payment)::TEXT as payment_mode,
    fp.created_at::TIMESTAMP WITH TIME ZONE as created_at,
    fp.created_at::TIMESTAMP WITH TIME ZONE as updated_at
  FROM final_payments fp
  LEFT JOIN visits v ON fp.visit_id = v.visit_id
  LEFT JOIN patients p ON v.patient_id = p.id
  WHERE fp.amount > 0
    AND (p_from_date IS NULL OR COALESCE(fp.payment_date, fp.created_at::DATE) >= p_from_date)
    AND (p_to_date   IS NULL OR COALESCE(fp.payment_date, fp.created_at::DATE) <= p_to_date)
    AND (p_transaction_type IS NULL OR 'FINAL_BILL' = p_transaction_type)
    AND (p_patient_id IS NULL OR v.patient_id = p_patient_id)
    AND (p_hospital_name IS NULL OR p.hospital_name = p_hospital_name)

  ORDER BY transaction_date DESC, transaction_time DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_cash_book_transactions_direct TO authenticated;

COMMENT ON FUNCTION get_cash_book_transactions_direct IS
'Cash Book aggregator. FINAL_BILL now keyed on fp.payment_date (back-date-aware), with COALESCE fallback to created_at for legacy rows.';
