-- Private discharged-patient financial archive.
--
-- A row is created only after a private patient is discharged and the saved
-- financial summary has a zero balance. Once created it remains protected;
-- later billing changes move it to adjustment_required rather than exposing
-- the financial record again.

SET search_path = public, extensions;

CREATE TABLE IF NOT EXISTS public.private_financial_archives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id TEXT NOT NULL UNIQUE REFERENCES public.visits(visit_id) ON DELETE CASCADE,
  bill_id UUID REFERENCES public.bills(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'protected'
    CHECK (status IN ('protected', 'adjustment_required')),
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  balance_at_archive NUMERIC(15,2) NOT NULL DEFAULT 0,
  last_checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS private_financial_archives_bill_idx
  ON public.private_financial_archives (bill_id);

ALTER TABLE public.private_financial_archives ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.private_financial_archives FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.private_patient_financial_state(p_visit_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_visit RECORD;
  v_bill RECORD;
  v_summary RECORD;
  v_archive RECORD;
  v_is_private BOOLEAN := FALSE;
  v_is_discharged BOOLEAN := FALSE;
  v_billing_complete BOOLEAN := FALSE;
  v_balance NUMERIC := 0;
  v_has_payment BOOLEAN := FALSE;
BEGIN
  SELECT v.visit_id, v.patient_id, v.patient_type, v.corporate,
         v.discharge_date, p.name AS patient_name, p.corporate AS patient_corporate
    INTO v_visit
    FROM public.visits v
    LEFT JOIN public.patients p ON p.id = v.patient_id
   WHERE v.visit_id = p_visit_id
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false, 'visit_id', p_visit_id);
  END IF;

  v_is_discharged := v_visit.discharge_date IS NOT NULL;
  v_is_private := lower(btrim(COALESCE(NULLIF(v_visit.corporate, ''), v_visit.patient_corporate, '')))
                    IN ('', 'private');

  SELECT b.id, b.bill_no, b.formatted_bill_no, b.total_amount, b.status
    INTO v_bill
    FROM public.bills b
   WHERE b.visit_id = p_visit_id
   ORDER BY b.created_at DESC
   LIMIT 1;

  IF v_bill.id IS NOT NULL THEN
    SELECT fs.balance_total, fs.total_amount_total, fs.amount_paid_total,
           fs.discount_total, fs.refunded_amount_total
      INTO v_summary
      FROM public.financial_summary fs
     WHERE fs.bill_id = v_bill.id
     LIMIT 1;

    v_balance := COALESCE(v_summary.balance_total, 0);
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.final_payments fp WHERE fp.visit_id = p_visit_id
    UNION ALL
    SELECT 1 FROM public.bill_preparation bp
     WHERE bp.visit_id = p_visit_id
       AND (bp.received_date IS NOT NULL OR bp.received_amount IS NOT NULL)
  ) INTO v_has_payment;

  v_billing_complete := v_bill.id IS NOT NULL
                        AND v_summary.balance_total IS NOT NULL
                        AND abs(v_balance) <= 0.01
                        AND (v_has_payment OR COALESCE(v_summary.total_amount_total, v_bill.total_amount, 0) = 0);

  SELECT * INTO v_archive
    FROM public.private_financial_archives a
   WHERE a.visit_id = p_visit_id;

  RETURN jsonb_build_object(
    'found', true,
    'visit_id', p_visit_id,
    'bill_id', v_bill.id,
    'bill_no', COALESCE(v_bill.formatted_bill_no, v_bill.bill_no),
    'patient_name', v_visit.patient_name,
    'is_private', v_is_private,
    'is_discharged', v_is_discharged,
    'billing_complete', v_billing_complete,
    'balance', v_balance,
    'has_payment', v_has_payment,
    'is_archived', v_archive.id IS NOT NULL,
    'archive_status', COALESCE(v_archive.status, NULL),
    'is_locked', v_archive.id IS NOT NULL
                  OR (v_is_private AND v_is_discharged AND v_billing_complete)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_private_financial_archive(p_visit_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_state JSONB;
  v_archive RECORD;
  v_status TEXT;
BEGIN
  v_state := public.private_patient_financial_state(p_visit_id);
  IF COALESCE((v_state->>'found')::BOOLEAN, FALSE) = FALSE THEN
    RETURN v_state;
  END IF;

  SELECT * INTO v_archive
    FROM public.private_financial_archives
   WHERE visit_id = p_visit_id
   FOR UPDATE;

  IF v_archive.id IS NULL
     AND (v_state->>'is_private')::BOOLEAN
     AND (v_state->>'is_discharged')::BOOLEAN
     AND (v_state->>'billing_complete')::BOOLEAN
  THEN
    INSERT INTO public.private_financial_archives
      (visit_id, bill_id, balance_at_archive)
    VALUES
      (p_visit_id, NULLIF(v_state->>'bill_id', '')::UUID,
       COALESCE((v_state->>'balance')::NUMERIC, 0));
  ELSIF v_archive.id IS NOT NULL THEN
    v_status := CASE
      WHEN (v_state->>'is_private')::BOOLEAN
       AND (v_state->>'is_discharged')::BOOLEAN
       AND (v_state->>'billing_complete')::BOOLEAN
      THEN v_archive.status
      ELSE 'adjustment_required'
    END;

    UPDATE public.private_financial_archives
       SET status = v_status,
           last_checked_at = now(),
           updated_at = now()
     WHERE id = v_archive.id;
  END IF;

  RETURN public.private_patient_financial_state(p_visit_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_private_archive_from_row()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_visit_id TEXT;
BEGIN
  v_visit_id := COALESCE(NEW.visit_id, OLD.visit_id);
  IF v_visit_id IS NOT NULL THEN
    PERFORM public.refresh_private_financial_archive(v_visit_id);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_private_archive_from_financial_summary()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_visit_id TEXT;
BEGIN
  SELECT v.visit_id INTO v_visit_id
    FROM public.visits v
   WHERE v.id = COALESCE(NEW.visit_id, OLD.visit_id)
   LIMIT 1;

  IF v_visit_id IS NULL THEN
    SELECT b.visit_id INTO v_visit_id
      FROM public.bills b
     WHERE b.id = COALESCE(NEW.bill_id, OLD.bill_id)
     LIMIT 1;
  END IF;

  IF v_visit_id IS NOT NULL THEN
    PERFORM public.refresh_private_financial_archive(v_visit_id);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS refresh_private_archive_bill_preparation ON public.bill_preparation;
CREATE TRIGGER refresh_private_archive_bill_preparation
  AFTER INSERT OR UPDATE OR DELETE ON public.bill_preparation
  FOR EACH ROW EXECUTE FUNCTION public.refresh_private_archive_from_row();

DROP TRIGGER IF EXISTS refresh_private_archive_final_payments ON public.final_payments;
CREATE TRIGGER refresh_private_archive_final_payments
  AFTER INSERT OR UPDATE OR DELETE ON public.final_payments
  FOR EACH ROW EXECUTE FUNCTION public.refresh_private_archive_from_row();

DROP TRIGGER IF EXISTS refresh_private_archive_bills ON public.bills;
CREATE TRIGGER refresh_private_archive_bills
  AFTER INSERT OR UPDATE OR DELETE ON public.bills
  FOR EACH ROW EXECUTE FUNCTION public.refresh_private_archive_from_row();

DROP TRIGGER IF EXISTS refresh_private_archive_financial_summary ON public.financial_summary;
CREATE TRIGGER refresh_private_archive_financial_summary
  AFTER INSERT OR UPDATE OR DELETE ON public.financial_summary
  FOR EACH ROW EXECUTE FUNCTION public.refresh_private_archive_from_financial_summary();

DROP TRIGGER IF EXISTS refresh_private_archive_visits ON public.visits;
CREATE TRIGGER refresh_private_archive_visits
  AFTER INSERT OR UPDATE OF discharge_date, corporate ON public.visits
  FOR EACH ROW EXECUTE FUNCTION public.refresh_private_archive_from_row();

CREATE OR REPLACE FUNCTION public.invoice_lock_state(p_bill_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT jsonb_build_object(
    'found', true,
    'bill_id', b.id,
    'bill_no', COALESCE(b.formatted_bill_no, b.bill_no),
    'visit_id', b.visit_id,
    'patient_name', COALESCE(p.name, b.bill_patient_data->>'name', 'Patient'),
    'is_private', COALESCE((s->>'is_private')::BOOLEAN, false),
    'is_paid', COALESCE((s->>'has_payment')::BOOLEAN, false),
    'is_discharged', COALESCE((s->>'is_discharged')::BOOLEAN, false),
    'billing_complete', COALESCE((s->>'billing_complete')::BOOLEAN, false),
    'archive_status', s->>'archive_status',
    'is_locked', COALESCE((s->>'is_locked')::BOOLEAN, false)
  )
    FROM public.bills b
    LEFT JOIN public.patients p ON p.id::text = b.patient_id::text
    CROSS JOIN LATERAL public.private_patient_financial_state(b.visit_id) s
   WHERE b.id = p_bill_id
   LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.private_patient_financial_state(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.invoice_lock_state(UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refresh_private_financial_archive(TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
