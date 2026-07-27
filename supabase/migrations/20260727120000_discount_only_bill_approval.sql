-- Ordinary patient bills no longer require a separate bill approval. A
-- positive discount requested by non-admin staff remains the only approval
-- gate. Resolve the discount and the waiting bill in one transaction so the
-- existing bills.status -> APPROVED trigger posts the correct net amount.

CREATE OR REPLACE FUNCTION public.resolve_visit_discount_and_finalize_bill(
  p_discount_id UUID,
  p_decision TEXT,
  p_approver TEXT,
  p_rejection_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_discount public.visit_discounts%ROWTYPE;
  v_visit_id TEXT;
  v_patient_type TEXT;
  v_bill_id UUID;
  v_bill_status TEXT;
  v_bill_total NUMERIC(15,2);
BEGIN
  IF lower(COALESCE(p_decision, '')) NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Discount decision must be approved or rejected';
  END IF;

  IF lower(COALESCE(p_decision, '')) = 'rejected'
     AND NULLIF(btrim(p_rejection_reason), '') IS NULL
  THEN
    RAISE EXCEPTION 'A rejection reason is required';
  END IF;

  SELECT *
    INTO v_discount
    FROM public.visit_discounts
   WHERE id = p_discount_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Discount % was not found', p_discount_id;
  END IF;

  IF COALESCE(v_discount.discount_amount, 0) <= 0
     OR lower(COALESCE(v_discount.approval_status, '')) <> 'pending_approval'
  THEN
    RAISE EXCEPTION 'Only a positive pending discount can be decided';
  END IF;

  SELECT visit_id, lower(btrim(COALESCE(patient_type, '')))
    INTO v_visit_id, v_patient_type
    FROM public.visits
   WHERE id = v_discount.visit_id;

  IF NOT FOUND OR v_patient_type NOT IN ('ipd', 'ipd (inpatient)') THEN
    RAISE EXCEPTION 'Discount approval is only available for IPD visits';
  END IF;

  SELECT id, status, total_amount
    INTO v_bill_id, v_bill_status, v_bill_total
    FROM public.bills
   WHERE visit_id = v_visit_id
   ORDER BY created_at DESC
   LIMIT 1
   FOR UPDATE;

  IF v_bill_id IS NULL OR COALESCE(v_bill_total, 0) <= 0 THEN
    RAISE EXCEPTION 'Save a non-zero bill before deciding its discount';
  END IF;

  -- Posted vouchers must not be made stale by a late discount decision.
  IF v_bill_status = 'APPROVED' THEN
    RAISE EXCEPTION 'Bill is already finalized; its discount is locked';
  END IF;

  UPDATE public.visit_discounts
     SET approval_status = lower(p_decision),
         approved_by = p_approver,
         approved_at = NOW(),
         rejection_reason = CASE
           WHEN lower(p_decision) = 'rejected' THEN NULLIF(btrim(p_rejection_reason), '')
           ELSE NULL
         END,
         updated_at = NOW()
   WHERE id = p_discount_id;

  -- The discount decision is the only bill gate. This also releases older
  -- PENDING_APPROVAL rows when their IPD discount is decided.
  IF v_bill_id IS NOT NULL
     AND v_bill_status IN ('DRAFT', 'PENDING_APPROVAL')
     AND COALESCE(v_bill_total, 0) > 0
  THEN
    UPDATE public.bills
       SET status = 'APPROVED',
           approved_by = p_approver,
           approved_at = NOW(),
           rejection_reason = NULL,
           updated_at = NOW()
     WHERE id = v_bill_id
       AND status IN ('DRAFT', 'PENDING_APPROVAL');

    v_bill_status := 'APPROVED';
  END IF;

  RETURN jsonb_build_object(
    'discount_id', p_discount_id,
    'discount_status', lower(p_decision),
    'bill_id', v_bill_id,
    'bill_status', v_bill_status
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_visit_discount_and_finalize_bill(
  UUID, TEXT, TEXT, TEXT
) TO anon, authenticated;
