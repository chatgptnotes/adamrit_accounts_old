-- OT Surgical pharmacy threshold notifications.
--
-- Reuses the existing notifications table, realtime publication and tablet
-- bell. Pharmacy sales are saved through one database transaction so an OT
-- sale is never committed when its required notification check fails.

ALTER TABLE public.pharmacy_sales
  ADD COLUMN IF NOT EXISTS is_ot_surgical BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS save_request_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pharmacy_sales_save_request_id
  ON public.pharmacy_sales(save_request_id)
  WHERE save_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pharmacy_sales_visit_non_ot
  ON public.pharmacy_sales(visit_id)
  WHERE is_ot_surgical = false;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_ot_surgical_sale
  ON public.notifications(notification_type, source_table, source_id)
  WHERE notification_type = 'ot_surgical_threshold';

CREATE OR REPLACE FUNCTION public.check_pharmacy_threshold_after_sale(
  p_sale_id BIGINT,
  p_created_by TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale RECORD;
  v_visit RECORD;
  v_category TEXT;
  v_threshold NUMERIC(12,2);
  v_total NUMERIC(12,2);
  v_updated INTEGER := 0;
  v_inserted INTEGER := 0;
  v_threshold_label TEXT;
  v_payload JSONB;
BEGIN
  SELECT sale_id, visit_id, total_amount, bill_number, hospital_name,
         patient_id, patient_name, is_ot_surgical
    INTO v_sale
    FROM public.pharmacy_sales
   WHERE sale_id = p_sale_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('sent', false, 'reason', 'sale_not_found');
  END IF;

  IF v_sale.visit_id IS NULL OR btrim(v_sale.visit_id) = '' THEN
    RETURN jsonb_build_object('sent', false, 'reason', 'no_visit_id');
  END IF;

  IF v_sale.is_ot_surgical THEN
    -- OT alerts are tied strictly to the admission stored on this sale. The
    -- visit-level category is authoritative; never fall back to a patient's
    -- historical category.
    SELECT v.id, v.visit_id, v.patient_id, v.corporate,
           p.name AS patient_name, p.patients_id AS uhid
      INTO v_visit
      FROM public.visits v
      LEFT JOIN public.patients p ON p.id = v.patient_id
     WHERE v.visit_id = v_sale.visit_id
       AND v.admission_date IS NOT NULL
       AND v.discharge_date IS NULL
       AND COALESCE(v.is_discharged, false) = false
       AND lower(COALESCE(NULLIF(btrim(v.patient_type), ''), v.visit_type, '')) <> 'opd'
     LIMIT 1;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('sent', false, 'reason', 'no_active_admission',
                                'visit_id', v_sale.visit_id);
    END IF;

    v_category := lower(btrim(COALESCE(v_visit.corporate, '')));
    IF v_category = '' OR NOT EXISTS (
      SELECT 1
        FROM public.pharmacy_threshold_categories c
       WHERE c.is_active = true
         AND v_category LIKE '%' || c.normalized_category_name || '%'
    ) THEN
      RETURN jsonb_build_object('sent', false, 'reason', 'category_not_eligible',
                                'visit_id', v_sale.visit_id,
                                'category', v_category);
    END IF;

    -- OT uses the individual bill and a strict greater-than boundary.
    IF COALESCE(v_sale.total_amount, 0) <= 5000 THEN
      RETURN jsonb_build_object('sent', false, 'reason', 'below_threshold',
                                'visit_id', v_sale.visit_id,
                                'bill_amount', COALESCE(v_sale.total_amount, 0),
                                'threshold_amount', 5000);
    END IF;

    v_payload := jsonb_build_object(
      'patient_name', COALESCE(v_visit.patient_name, v_sale.patient_name),
      'patient_id', v_sale.patient_id,
      'uhid', v_visit.uhid,
      'admission_number', v_visit.visit_id,
      'patient_category', v_visit.corporate,
      'threshold_amount', 5000,
      'latest_bill_number', v_sale.bill_number,
      'latest_bill_amount', v_sale.total_amount,
      'latest_sale_id', v_sale.sale_id,
      'is_ot_surgical', true,
      'date_time', now(),
      'created_by', p_created_by
    );

    INSERT INTO public.notifications (
      notification_type, title, message,
      recipient_user_id, recipient_role, hospital_name,
      patient_id, patient_name, visit_id,
      source_table, source_id, payload
    )
    VALUES (
      'ot_surgical_threshold',
      'OT Surgical Pharmacy Threshold Alert',
      'OT Surgical pharmacy issue for Yojana Corporate patient '
        || COALESCE(v_visit.patient_name, v_sale.patient_name, v_visit.uhid, 'Unknown')
        || CASE WHEN v_visit.uhid IS NOT NULL THEN ' / ' || v_visit.uhid ELSE '' END
        || ' has exceeded the Rs. 5,000 limit.',
      NULL,
      'all',
      v_sale.hospital_name,
      v_sale.patient_id,
      COALESCE(v_visit.patient_name, v_sale.patient_name),
      v_visit.visit_id,
      'pharmacy_sales',
      v_sale.sale_id::text,
      v_payload
    )
    ON CONFLICT (notification_type, source_table, source_id)
      WHERE notification_type = 'ot_surgical_threshold'
      DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    RETURN jsonb_build_object(
      'sent', v_inserted = 1,
      'reason', CASE WHEN v_inserted = 1 THEN 'notified' ELSE 'already_notified' END,
      'visit_id', v_visit.visit_id,
      'bill_amount', v_sale.total_amount,
      'threshold_amount', 5000,
      'recipients', v_inserted
    );
  END IF;

  -- Existing normal Pharmacy threshold workflow. OT-marked sales are the only
  -- new exclusion from its admission-wise cumulative total.
  SELECT v.id, v.visit_id, v.patient_id,
         COALESCE(NULLIF(btrim(v.corporate), ''), p.corporate) AS corporate,
         p.name AS patient_name,
         p.patients_id AS uhid
    INTO v_visit
    FROM public.visits v
    LEFT JOIN public.patients p ON p.id = v.patient_id
   WHERE v.visit_id = v_sale.visit_id
     AND v.discharge_date IS NULL
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('sent', false, 'reason', 'no_active_admission',
                              'visit_id', v_sale.visit_id);
  END IF;

  v_category := lower(btrim(COALESCE(v_visit.corporate, '')));
  IF v_category = '' OR NOT EXISTS (
    SELECT 1
      FROM public.pharmacy_threshold_categories c
     WHERE c.is_active = true
       AND v_category LIKE '%' || c.normalized_category_name || '%'
  ) THEN
    RETURN jsonb_build_object('sent', false, 'reason', 'category_not_eligible',
                              'visit_id', v_sale.visit_id,
                              'category', v_category);
  END IF;

  SELECT threshold_amount
    INTO v_threshold
    FROM public.pharmacy_threshold_settings
   WHERE is_active = true
     AND (hospital_name IS NULL
          OR (v_sale.hospital_name IS NOT NULL
              AND lower(hospital_name) = lower(v_sale.hospital_name)))
   ORDER BY (hospital_name IS NOT NULL) DESC, updated_at DESC
   LIMIT 1;

  IF v_threshold IS NULL THEN
    v_threshold := 5000;
  END IF;

  SELECT COALESCE(SUM(total_amount), 0)
    INTO v_total
    FROM public.pharmacy_sales
   WHERE visit_id = v_sale.visit_id
     AND COALESCE(is_ot_surgical, false) = false
     AND payment_status = 'COMPLETED'
     AND COALESCE(status, 'active') NOT IN ('cancelled', 'deleted', 'void');

  IF v_total < v_threshold THEN
    RETURN jsonb_build_object('sent', false, 'reason', 'below_threshold',
                              'visit_id', v_sale.visit_id,
                              'total_amount', v_total,
                              'threshold_amount', v_threshold);
  END IF;

  UPDATE public.visits
     SET pharmacy_threshold_notification_sent = true,
         pharmacy_threshold_notification_sent_at = now()
   WHERE id = v_visit.id
     AND pharmacy_threshold_notification_sent = false;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    RETURN jsonb_build_object('sent', false, 'reason', 'already_notified',
                              'visit_id', v_sale.visit_id,
                              'total_amount', v_total,
                              'threshold_amount', v_threshold);
  END IF;

  v_threshold_label := trim(trailing '.' from to_char(v_threshold, 'FM99999999990.99'));
  v_payload := jsonb_build_object(
    'patient_name', COALESCE(v_visit.patient_name, v_sale.patient_name),
    'patient_id', v_sale.patient_id,
    'uhid', v_visit.uhid,
    'admission_number', v_visit.visit_id,
    'patient_category', v_visit.corporate,
    'total_pharmacy_amount', v_total,
    'threshold_amount', v_threshold,
    'latest_bill_number', v_sale.bill_number,
    'latest_bill_amount', v_sale.total_amount,
    'latest_sale_id', v_sale.sale_id,
    'date_time', now(),
    'created_by', p_created_by
  );

  INSERT INTO public.notifications (
    notification_type, title, message,
    recipient_user_id, recipient_role, hospital_name,
    patient_id, patient_name, visit_id,
    source_table, source_id, payload
  )
  VALUES (
    'pharmacy_threshold',
    'Pharmacy Cost Threshold Alert',
    'Pharmacy expenses for a package patient have crossed the configured threshold of Rs. '
      || v_threshold_label || '.',
    NULL,
    'all',
    v_sale.hospital_name,
    v_sale.patient_id,
    COALESCE(v_visit.patient_name, v_sale.patient_name),
    v_visit.visit_id,
    'pharmacy_sales',
    v_sale.sale_id::text,
    v_payload
  );
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RETURN jsonb_build_object('sent', true, 'reason', 'notified',
                            'visit_id', v_visit.visit_id,
                            'total_amount', v_total,
                            'threshold_amount', v_threshold,
                            'recipients', v_inserted);
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_pharmacy_threshold_after_sale(BIGINT, TEXT)
TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.save_pharmacy_sale_atomic(
  p_sale JSONB,
  p_items JSONB,
  p_created_by TEXT DEFAULT NULL,
  p_request_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale_id BIGINT;
  v_request_id UUID := COALESCE(p_request_id, gen_random_uuid());
  v_is_ot_surgical BOOLEAN := COALESCE((p_sale->>'is_ot_surgical')::boolean, false);
  v_notification_result JSONB;
BEGIN
  IF p_items IS NULL
     OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'At least one pharmacy sale item is required';
  END IF;

  SELECT sale_id
    INTO v_sale_id
    FROM public.pharmacy_sales
   WHERE save_request_id = v_request_id;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'sale_id', v_sale_id,
      'duplicate_request', true
    );
  END IF;

  INSERT INTO public.pharmacy_sales (
    sale_type, patient_id, visit_id, patient_name, prescription_number,
    doctor_id, doctor_name, ward_type, remarks, hospital_name, bill_number,
    subtotal, discount, discount_percentage, tax_gst, tax_percentage,
    total_amount, payment_method, payment_status, sale_date,
    is_ot_surgical, save_request_id, created_at, updated_at
  )
  VALUES (
    NULLIF(p_sale->>'sale_type', ''),
    NULLIF(p_sale->>'patient_id', ''),
    NULLIF(p_sale->>'visit_id', ''),
    NULLIF(p_sale->>'patient_name', ''),
    NULLIF(p_sale->>'prescription_number', ''),
    NULLIF(p_sale->>'doctor_id', '')::integer,
    NULLIF(p_sale->>'doctor_name', ''),
    NULLIF(p_sale->>'ward_type', ''),
    NULLIF(p_sale->>'remarks', ''),
    NULLIF(p_sale->>'hospital_name', ''),
    NULLIF(p_sale->>'bill_number', ''),
    COALESCE(NULLIF(p_sale->>'subtotal', '')::numeric, 0),
    COALESCE(NULLIF(p_sale->>'discount', '')::numeric, 0),
    COALESCE(NULLIF(p_sale->>'discount_percentage', '')::numeric, 0),
    COALESCE(NULLIF(p_sale->>'tax_gst', '')::numeric, 0),
    COALESCE(NULLIF(p_sale->>'tax_percentage', '')::numeric, 0),
    COALESCE(NULLIF(p_sale->>'total_amount', '')::numeric, 0),
    NULLIF(p_sale->>'payment_method', ''),
    COALESCE(NULLIF(p_sale->>'payment_status', ''), 'COMPLETED'),
    COALESCE(NULLIF(p_sale->>'sale_date', '')::timestamptz, now()),
    v_is_ot_surgical,
    v_request_id,
    now(),
    now()
  )
  ON CONFLICT (save_request_id) WHERE save_request_id IS NOT NULL
  DO NOTHING
  RETURNING sale_id INTO v_sale_id;

  IF v_sale_id IS NULL THEN
    SELECT sale_id
      INTO v_sale_id
      FROM public.pharmacy_sales
     WHERE save_request_id = v_request_id;

    RETURN jsonb_build_object(
      'success', true,
      'sale_id', v_sale_id,
      'duplicate_request', true
    );
  END IF;

  INSERT INTO public.pharmacy_sale_items (
    sale_id, medication_id, medication_name, generic_name, item_code,
    batch_number, expiry_date, quantity, pack_size, loose_quantity,
    unit_price, mrp, cost_price, discount, discount_percentage,
    ward_discount, tax_amount, tax_percentage, total_price, manufacturer,
    dosage_form, strength, is_implant, created_at
  )
  SELECT
    v_sale_id, x.medication_id, x.medication_name, x.generic_name, x.item_code,
    x.batch_number, x.expiry_date, x.quantity, x.pack_size, x.loose_quantity,
    x.unit_price, x.mrp, x.cost_price, x.discount, x.discount_percentage,
    x.ward_discount, x.tax_amount, x.tax_percentage, x.total_price, x.manufacturer,
    x.dosage_form, x.strength, x.is_implant, now()
  FROM jsonb_populate_recordset(NULL::public.pharmacy_sale_items, p_items) AS x;

  IF v_is_ot_surgical THEN
    -- Any technical failure propagates and rolls back header, items, payment
    -- trigger side-effects and notification work together.
    v_notification_result :=
      public.check_pharmacy_threshold_after_sale(v_sale_id, p_created_by);
  ELSE
    -- Preserve the existing normal Pharmacy behavior: notification failures
    -- do not fail a successfully saved sale.
    BEGIN
      v_notification_result :=
        public.check_pharmacy_threshold_after_sale(v_sale_id, p_created_by);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Normal pharmacy threshold check failed for sale %: %',
        v_sale_id, SQLERRM;
      v_notification_result := jsonb_build_object(
        'sent', false,
        'reason', 'notification_check_failed'
      );
    END;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'sale_id', v_sale_id,
    'duplicate_request', false,
    'notification', v_notification_result
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_pharmacy_sale_atomic(JSONB, JSONB, TEXT, UUID)
TO anon, authenticated;

COMMENT ON FUNCTION public.save_pharmacy_sale_atomic(JSONB, JSONB, TEXT, UUID) IS
'Atomically saves a pharmacy sale and its items. OT Surgical notification failures roll back the sale; normal Pharmacy notification failures preserve existing save behavior.';
