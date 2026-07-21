-- Pharmacy cost threshold notifications: when the cumulative valid pharmacy
-- spend for a package patient's CURRENT admission reaches the configured
-- threshold (default Rs. 5000), every active Super Admin gets one realtime
-- tablet notification. Admission-wise, never patient-wise: the sent-flag
-- lives on the visits row, so a re-admission starts from zero again.
--
-- pharmacy_sales.visit_id stores the READABLE admission number (matches
-- visits.visit_id, TEXT) — not the visits.id UUID. All joins here use that.

-- 1. Admission-level sent flag (one alert per admission).
ALTER TABLE public.visits
ADD COLUMN IF NOT EXISTS pharmacy_threshold_notification_sent BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS pharmacy_threshold_notification_sent_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_visits_pharmacy_threshold_sent
ON public.visits(pharmacy_threshold_notification_sent);

-- 2. Threshold settings (hospital-specific row wins over the global NULL row).
CREATE TABLE IF NOT EXISTS public.pharmacy_threshold_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_name TEXT,
  threshold_amount NUMERIC(12,2) NOT NULL DEFAULT 5000,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.pharmacy_threshold_settings (hospital_name, threshold_amount, is_active)
SELECT NULL, 5000, true
WHERE NOT EXISTS (
  SELECT 1 FROM public.pharmacy_threshold_settings WHERE hospital_name IS NULL
);

-- 3. Eligible package categories. Stored corporate values are long scheme
-- names (e.g. 'Ayushman Bharat - Pradhan Mantri Jan Arogya Yojna (PM-JAY)',
-- 'Mahatma Jyotirao Phule jan Arogya Yojana (MJPJAY)'), so each row here is a
-- KEYWORD matched as a substring of lower(trim(corporate)) — note both the
-- 'Yojana' and 'Yojna' spellings exist in production data.
CREATE TABLE IF NOT EXISTS public.pharmacy_threshold_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_name TEXT NOT NULL,
  normalized_category_name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (normalized_category_name)
);

INSERT INTO public.pharmacy_threshold_categories (category_name, normalized_category_name)
VALUES
  ('Yojana', lower('Yojana')),
  ('Yojna', lower('Yojna')),
  ('Ayushman', lower('Ayushman')),
  ('Corporate', lower('Corporate')),
  ('Panel', lower('Panel')),
  ('MJPJAY', lower('MJPJAY')),
  ('PMJAY', lower('PMJAY')),
  ('PM-JAY', lower('PM-JAY')),
  ('MPKAY', lower('MPKAY'))
ON CONFLICT (normalized_category_name) DO NOTHING;

-- 4. General notifications table (reusable beyond pharmacy thresholds).
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  recipient_user_id UUID,
  recipient_role TEXT,
  hospital_name TEXT,
  patient_id TEXT,
  patient_name TEXT,
  visit_id TEXT,
  source_table TEXT,
  source_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_read BOOLEAN NOT NULL DEFAULT false,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient_user_id
ON public.notifications(recipient_user_id);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient_role
ON public.notifications(recipient_role);

CREATE INDEX IF NOT EXISTS idx_notifications_is_read
ON public.notifications(is_read);

CREATE INDEX IF NOT EXISTS idx_notifications_type_visit
ON public.notifications(notification_type, visit_id);

CREATE INDEX IF NOT EXISTS idx_notifications_created_at
ON public.notifications(created_at DESC);

-- The app authenticates against public."User" (custom auth), so client
-- requests run as the anon role — policies must include anon, not just
-- authenticated. Inserts happen only inside the SECURITY DEFINER function.
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications_select" ON public.notifications;
CREATE POLICY "notifications_select"
  ON public.notifications FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "notifications_update" ON public.notifications;
CREATE POLICY "notifications_update"
  ON public.notifications FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- Settings/category tables: readable and editable from the app (future
-- Super Admin settings panel gates access in the UI, matching house style).
ALTER TABLE public.pharmacy_threshold_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pharmacy_threshold_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pharmacy_threshold_settings_all" ON public.pharmacy_threshold_settings;
CREATE POLICY "pharmacy_threshold_settings_all"
  ON public.pharmacy_threshold_settings FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "pharmacy_threshold_categories_all" ON public.pharmacy_threshold_categories;
CREATE POLICY "pharmacy_threshold_categories_all"
  ON public.pharmacy_threshold_categories FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- Realtime inserts for the tablet bell (ignore if already in the publication).
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;

-- 5. Pharmacy sales indexes for the admission-wise running total.
CREATE INDEX IF NOT EXISTS idx_pharmacy_sales_visit_id
ON public.pharmacy_sales(visit_id);

CREATE INDEX IF NOT EXISTS idx_pharmacy_sales_payment_status
ON public.pharmacy_sales(payment_status);

CREATE INDEX IF NOT EXISTS idx_pharmacy_sales_status
ON public.pharmacy_sales(status);

-- 6. The threshold check, called by the frontend right after a sale (header +
-- items) is saved. Never raises for business outcomes — always returns JSONB
-- so the bill flow can log and move on.
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

  -- One row per active Super Admin. Super admins oversee both hospitals (the
  -- tablet SWITCH button flips them freely), so no hospital_type filter —
  -- the hospital is carried on the notification for display instead.
  INSERT INTO public.notifications (
    notification_type, title, message,
    recipient_user_id, recipient_role, hospital_name,
    patient_id, patient_name, visit_id,
    source_table, source_id, payload
  )
  SELECT
    'pharmacy_threshold',
    'Pharmacy Cost Threshold Alert',
    'Pharmacy expenses for a package patient have crossed the configured threshold of Rs. '
      || v_threshold_label || '.',
    u.id,
    u.role,
    v_sale.hospital_name,
    v_sale.patient_id,
    coalesce(v_visit.patient_name, v_sale.patient_name),
    v_visit.visit_id,
    'pharmacy_sales',
    v_sale.sale_id::text,
    v_payload
  FROM public."User" u
  WHERE u.role IN ('superadmin', 'super_admin')
    AND u.is_active IS DISTINCT FROM false;
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
'After a pharmacy sale is saved, checks the admission-wise cumulative valid pharmacy spend for package patients and notifies all active Super Admins once per admission when it reaches the configured threshold.';
