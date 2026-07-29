-- Make the OT Surgical pharmacy threshold admission-wise and cumulative.
--
-- A patient's OT Surgical issues can be split across many bills during one
-- IPD admission. The alert therefore keys on visit_id, totals every completed
-- and active OT-marked sale for that visit, and fires once when the total is
-- strictly greater than Rs. 5,000.

DROP INDEX IF EXISTS public.idx_notifications_ot_surgical_sale;

-- Earlier logic could create one OT alert per sale. Retain the oldest alert for
-- each admission before enforcing the new one-alert-per-visit invariant.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY visit_id
           ORDER BY created_at, id
         ) AS occurrence
    FROM public.notifications
   WHERE notification_type = 'ot_surgical_threshold'
     AND visit_id IS NOT NULL
)
DELETE FROM public.notifications n
 USING ranked r
 WHERE n.id = r.id
   AND r.occurrence > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_ot_surgical_visit
  ON public.notifications(notification_type, visit_id)
  WHERE notification_type = 'ot_surgical_threshold'
    AND visit_id IS NOT NULL;

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

    SELECT COALESCE(SUM(total_amount), 0)
      INTO v_total
      FROM public.pharmacy_sales
     WHERE visit_id = v_sale.visit_id
       AND COALESCE(is_ot_surgical, false) = true
       AND payment_status = 'COMPLETED'
       AND COALESCE(status, 'active') NOT IN (
         'cancelled', 'deleted', 'void', 'refunded'
       );

    IF v_total <= 5000 THEN
      RETURN jsonb_build_object('sent', false, 'reason', 'below_threshold',
                                'visit_id', v_sale.visit_id,
                                'total_ot_surgical_amount', v_total,
                                'threshold_amount', 5000);
    END IF;

    v_payload := jsonb_build_object(
      'patient_name', COALESCE(v_visit.patient_name, v_sale.patient_name),
      'patient_id', v_sale.patient_id,
      'uhid', v_visit.uhid,
      'admission_number', v_visit.visit_id,
      'patient_category', v_visit.corporate,
      'total_ot_surgical_amount', v_total,
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
      'Cumulative OT Surgical pharmacy issues for '
        || COALESCE(v_visit.patient_name, v_sale.patient_name, v_visit.uhid, 'Unknown')
        || CASE WHEN v_visit.uhid IS NOT NULL THEN ' / ' || v_visit.uhid ELSE '' END
        || ' have exceeded the Rs. 5,000 limit for this admission.',
      NULL,
      'all',
      v_sale.hospital_name,
      v_sale.patient_id,
      COALESCE(v_visit.patient_name, v_sale.patient_name),
      v_visit.visit_id,
      'visits',
      v_visit.visit_id,
      v_payload
    )
    ON CONFLICT (notification_type, visit_id)
      WHERE notification_type = 'ot_surgical_threshold'
        AND visit_id IS NOT NULL
      DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    RETURN jsonb_build_object(
      'sent', v_inserted = 1,
      'reason', CASE WHEN v_inserted = 1 THEN 'notified' ELSE 'already_notified' END,
      'visit_id', v_visit.visit_id,
      'total_ot_surgical_amount', v_total,
      'threshold_amount', 5000,
      'recipients', v_inserted
    );
  END IF;

  -- Preserve the existing normal Pharmacy threshold workflow. OT-marked sales
  -- remain excluded from its separate admission-wise cumulative total.
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
                            'visit_id', v_sale.visit_id,
                            'total_amount', v_total,
                            'threshold_amount', v_threshold,
                            'recipients', v_inserted);
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_pharmacy_threshold_after_sale(BIGINT, TEXT)
TO anon, authenticated;

-- New completed bills are checked by save_pharmacy_sale_atomic. Recheck OT
-- totals when a pending bill is approved or a relevant saved value changes.
CREATE OR REPLACE FUNCTION public.recheck_ot_surgical_threshold_after_sale_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(NEW.is_ot_surgical, false) THEN
    PERFORM public.check_pharmacy_threshold_after_sale(
      NEW.sale_id,
      'pharmacy-sale-update'
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_recheck_ot_surgical_threshold
  ON public.pharmacy_sales;

CREATE TRIGGER trg_recheck_ot_surgical_threshold
AFTER UPDATE OF payment_status, status, total_amount, is_ot_surgical, visit_id
ON public.pharmacy_sales
FOR EACH ROW
WHEN (COALESCE(NEW.is_ot_surgical, false) = true)
EXECUTE FUNCTION public.recheck_ot_surgical_threshold_after_sale_update();

-- Backfill one missing alert for every currently active admission whose
-- cumulative completed OT Surgical issues already exceed the threshold.
DO $$
DECLARE
  v_row RECORD;
BEGIN
  FOR v_row IN
    SELECT MAX(ps.sale_id) AS sale_id
      FROM public.pharmacy_sales ps
     WHERE COALESCE(ps.is_ot_surgical, false) = true
       AND ps.payment_status = 'COMPLETED'
       AND COALESCE(ps.status, 'active') NOT IN (
         'cancelled', 'deleted', 'void', 'refunded'
       )
       AND EXISTS (
         SELECT 1
           FROM public.visits v
          WHERE v.visit_id = ps.visit_id
            AND v.admission_date IS NOT NULL
            AND v.discharge_date IS NULL
            AND COALESCE(v.is_discharged, false) = false
            AND lower(COALESCE(
              NULLIF(btrim(v.patient_type), ''),
              v.visit_type,
              ''
            )) <> 'opd'
       )
     GROUP BY ps.visit_id
    HAVING SUM(ps.total_amount) > 5000
  LOOP
    PERFORM public.check_pharmacy_threshold_after_sale(
      v_row.sale_id,
      'migration-backfill'
    );
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.check_pharmacy_threshold_after_sale(BIGINT, TEXT) IS
'Checks cumulative valid pharmacy spend for an admission. OT Surgical sales alert once per visit above Rs. 5,000; normal pharmacy sales retain the configured package-patient threshold.';
