-- Pharmacy threshold notifications go to EVERY logged-in user, not just Super
-- Admins.
--
-- Before: check_pharmacy_threshold_after_sale fanned out one notifications row
-- per active Super Admin, and the tablet bell queried by recipient_role then
-- collapsed the fan-out to one card per event.
--
-- After: exactly ONE row per alert event, recipient_user_id NULL and
-- recipient_role 'all'. Read state is deliberately GLOBAL — whoever taps
-- "Mark all read" clears the alert for everyone. RLS was already USING (true)
-- for anon/authenticated, so no policy change is needed.

-- 1. Collapse the historical per-Super-Admin fan-out to one row per event.
--    Same event => same notification_type + visit_id + created_at (every row
--    of one fan-out shares a single insert timestamp). The oldest row of each
--    group survives; because read is now global, the survivor counts as read
--    if ANY admin had already read it. DELETES the redundant sibling rows.
DO $$
DECLARE
  v_deleted INTEGER;
BEGIN
  WITH ranked AS (
    SELECT id,
           notification_type,
           visit_id,
           created_at,
           is_read,
           read_at,
           ROW_NUMBER() OVER (
             PARTITION BY notification_type, visit_id, created_at
             ORDER BY id
           ) AS rn
    FROM public.notifications
  ),
  survivors AS (
    SELECT r.id,
           bool_or(a.is_read) AS any_read,
           max(a.read_at)     AS latest_read_at
    FROM ranked r
    JOIN ranked a
      ON a.notification_type IS NOT DISTINCT FROM r.notification_type
     AND a.visit_id          IS NOT DISTINCT FROM r.visit_id
     AND a.created_at        =  r.created_at
    WHERE r.rn = 1
    GROUP BY r.id
  )
  UPDATE public.notifications n
     SET recipient_user_id = NULL,
         recipient_role    = 'all',
         is_read           = s.any_read,
         read_at           = CASE WHEN s.any_read THEN s.latest_read_at ELSE NULL END
    FROM survivors s
   WHERE n.id = s.id;

  DELETE FROM public.notifications n
   USING (
     SELECT id,
            ROW_NUMBER() OVER (
              PARTITION BY notification_type, visit_id, created_at
              ORDER BY id
            ) AS rn
     FROM public.notifications
   ) d
   WHERE n.id = d.id
     AND d.rn > 1;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RAISE NOTICE 'Collapsed notification fan-out: deleted % duplicate rows', v_deleted;
END $$;

-- 2. Insert one shared row per event instead of one per Super Admin.
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
  v_recipients INTEGER := 0;
  v_threshold_label TEXT;
  v_payload JSONB;
BEGIN
  SELECT sale_id, visit_id, total_amount, bill_number, hospital_name,
         patient_id, patient_name
    INTO v_sale
    FROM public.pharmacy_sales
   WHERE sale_id = p_sale_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('sent', false, 'reason', 'sale_not_found');
  END IF;

  IF v_sale.visit_id IS NULL OR btrim(v_sale.visit_id) = '' THEN
    RETURN jsonb_build_object('sent', false, 'reason', 'no_visit_id');
  END IF;

  -- Active admission only: a discharged visit never alerts, and a fresh
  -- admission gets a fresh visits row (new visit_id) with the flag false.
  -- visits.corporate is NULL on most rows in production — the category truly
  -- lives on patients.corporate, so fall back to it.
  SELECT v.id, v.visit_id, v.patient_id,
         coalesce(nullif(btrim(v.corporate), ''), p.corporate) AS corporate,
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

  v_category := lower(btrim(coalesce(v_visit.corporate, '')));

  -- Keyword (substring) match: 'ayushman bharat - pradhan mantri jan arogya
  -- yojna (pm-jay)' is eligible because it contains 'yojna' / 'pm-jay'.
  IF v_category = '' OR NOT EXISTS (
    SELECT 1 FROM public.pharmacy_threshold_categories c
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

  -- Cumulative valid spend for this admission. COMPLETED only, which already
  -- excludes PENDING / PENDING_DISCOUNT_APPROVAL / CANCELLED / REFUNDED;
  -- soft-deleted rows (status cancelled/deleted/void) are excluded too.
  SELECT COALESCE(SUM(total_amount), 0)
    INTO v_total
    FROM public.pharmacy_sales
   WHERE visit_id = v_sale.visit_id
     AND payment_status = 'COMPLETED'
     AND COALESCE(status, 'active') NOT IN ('cancelled', 'deleted', 'void');

  IF v_total < v_threshold THEN
    RETURN jsonb_build_object('sent', false, 'reason', 'below_threshold',
                              'visit_id', v_sale.visit_id,
                              'total_amount', v_total,
                              'threshold_amount', v_threshold);
  END IF;

  -- Atomic once-per-admission guard: only the caller that flips the flag
  -- from false wins; concurrent callers see 0 rows updated and skip.
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
    'patient_name', coalesce(v_visit.patient_name, v_sale.patient_name),
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

  -- ONE shared row for every user. recipient_user_id NULL + recipient_role
  -- 'all' means "not addressed to anybody in particular"; the bell shows it to
  -- whoever is logged in and read state is global by design.
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
    coalesce(v_visit.patient_name, v_sale.patient_name),
    v_visit.visit_id,
    'pharmacy_sales',
    v_sale.sale_id::text,
    v_payload
  );
  GET DIAGNOSTICS v_recipients = ROW_COUNT;

  RETURN jsonb_build_object('sent', true, 'reason', 'notified',
                            'visit_id', v_visit.visit_id,
                            'total_amount', v_total,
                            'threshold_amount', v_threshold,
                            'recipients', v_recipients);
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_pharmacy_threshold_after_sale(BIGINT, TEXT)
TO anon, authenticated;

COMMENT ON FUNCTION public.check_pharmacy_threshold_after_sale(BIGINT, TEXT) IS
'After a pharmacy sale is saved, checks the admission-wise cumulative valid pharmacy spend for package patients and raises one shared notification (visible to all users, global read state) per admission when it reaches the configured threshold.';
