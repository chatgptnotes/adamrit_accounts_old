-- Move saved invoice snapshots out of the broadly-readable bills row.
-- The trigger keeps the existing FinalBill write contract intact while storing
-- the sensitive JSON in a table readable only through get_invoice_content().

SET search_path = public, extensions;

CREATE TABLE IF NOT EXISTS public.bill_content (
  bill_id UUID PRIMARY KEY REFERENCES public.bills(id) ON DELETE CASCADE,
  items_json JSONB,
  patient_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.bill_content (bill_id, items_json, patient_data)
SELECT id, bill_items_json, bill_patient_data
  FROM public.bills
 WHERE bill_items_json IS NOT NULL OR bill_patient_data IS NOT NULL
ON CONFLICT (bill_id) DO UPDATE
  SET items_json = COALESCE(EXCLUDED.items_json, public.bill_content.items_json),
      patient_data = COALESCE(EXCLUDED.patient_data, public.bill_content.patient_data),
      updated_at = now();

CREATE OR REPLACE FUNCTION public.capture_bill_content()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NEW.bill_items_json IS NOT NULL OR NEW.bill_patient_data IS NOT NULL THEN
    INSERT INTO public.bill_content (bill_id, items_json, patient_data, updated_at)
    VALUES (NEW.id, NEW.bill_items_json, NEW.bill_patient_data, now())
    ON CONFLICT (bill_id) DO UPDATE
      SET items_json = COALESCE(EXCLUDED.items_json, public.bill_content.items_json),
          patient_data = COALESCE(EXCLUDED.patient_data, public.bill_content.patient_data),
          updated_at = now();
  END IF;

  NEW.bill_items_json := NULL;
  NEW.bill_patient_data := NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS capture_bill_content_before_write ON public.bills;
CREATE TRIGGER capture_bill_content_before_write
  BEFORE INSERT OR UPDATE OF bill_items_json, bill_patient_data ON public.bills
  FOR EACH ROW EXECUTE FUNCTION public.capture_bill_content();

-- Clear the legacy readable columns after the backfill. The trigger preserves
-- the values in bill_content while the UPDATE makes old rows safe as well.
UPDATE public.bills
   SET bill_items_json = NULL,
       bill_patient_data = NULL
 WHERE bill_items_json IS NOT NULL OR bill_patient_data IS NOT NULL;

ALTER TABLE public.bill_content ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bill_content FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_invoice_content(
  p_bill_id UUID,
  p_grant_token TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_state JSONB;
  v_granted BOOLEAN := FALSE;
  v_content RECORD;
BEGIN
  v_state := public.invoice_lock_state(p_bill_id);
  IF v_state IS NULL OR COALESCE((v_state->>'found')::BOOLEAN, FALSE) = FALSE THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bill_not_found');
  END IF;

  IF COALESCE((v_state->>'is_locked')::BOOLEAN, FALSE) THEN
    IF p_grant_token IS NULL OR btrim(p_grant_token) = '' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'locked', 'bill_no', v_state->>'bill_no');
    END IF;

    SELECT TRUE INTO v_granted
      FROM public.invoice_access_grants
     WHERE bill_id = p_bill_id
       AND token_hash = encode(digest(p_grant_token, 'sha256'), 'hex')
       AND revoked_at IS NULL
       AND expires_at > now()
     LIMIT 1;

    IF NOT COALESCE(v_granted, FALSE) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'locked', 'bill_no', v_state->>'bill_no');
    END IF;
  END IF;

  SELECT bc.items_json, bc.patient_data INTO v_content
    FROM public.bill_content bc
   WHERE bc.bill_id = p_bill_id;

  RETURN jsonb_build_object(
    'ok', true,
    'is_locked', COALESCE((v_state->>'is_locked')::BOOLEAN, FALSE),
    'sections', COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.section_order)
                            FROM public.bill_sections s WHERE s.bill_id = p_bill_id), '[]'::jsonb),
    'line_items', COALESCE((SELECT jsonb_agg(to_jsonb(li) ORDER BY li.item_order)
                              FROM public.bill_line_items li WHERE li.bill_id = p_bill_id), '[]'::jsonb),
    'bill_items_json', v_content.items_json,
    'bill_patient_data', v_content.patient_data
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_invoice_content(UUID, TEXT) TO anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
