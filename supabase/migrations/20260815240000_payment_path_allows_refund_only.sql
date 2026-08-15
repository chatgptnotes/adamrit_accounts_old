-- A refund-only entry has no advance amount, and must still be allowed.
--
-- record_patient_payment refused any amount <= 0. That is right for a payment
-- and wrong for a refund: the desktop modal explicitly permits a refund with
-- an empty advance amount — "Refund - amount is optional (can be refund-only
-- or combined with advance)" — carrying the sum in returned_amount instead.
--
-- Found before switching that screen over, not after. Had the screen been
-- moved first, every refund-only entry would have started failing, and the
-- staff would have met a rule that reads perfectly sensibly and is simply not
-- how refunds are recorded here.
--
-- So the rule becomes: a payment needs a positive amount; a refund needs a
-- positive amount OR a positive returned_amount. Nothing else changes.

CREATE OR REPLACE FUNCTION public.record_patient_payment(
  p_patient_id           UUID,
  p_amount               NUMERIC,
  p_payment_mode         TEXT,
  p_collected_by_user_id UUID    DEFAULT NULL,
  p_visit_id             TEXT    DEFAULT NULL,
  p_patient_name         TEXT    DEFAULT NULL,
  p_patients_id          TEXT    DEFAULT NULL,
  p_bill_no              TEXT    DEFAULT NULL,
  p_date_of_admission    DATE    DEFAULT NULL,
  p_payment_date         TIMESTAMPTZ DEFAULT NULL,
  p_is_refund            BOOLEAN DEFAULT false,
  p_refund_reason        TEXT    DEFAULT NULL,
  p_returned_amount      NUMERIC DEFAULT 0,
  p_billing_executive    TEXT    DEFAULT NULL,
  p_reference_number     TEXT    DEFAULT NULL,
  p_remarks              TEXT    DEFAULT NULL,
  p_bank_account_id      UUID    DEFAULT NULL,
  p_bank_account_name    TEXT    DEFAULT NULL,
  p_package_name         TEXT    DEFAULT NULL,
  p_package_days         INT     DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_mode TEXT;
  v_counter TEXT;
  v_name TEXT;
  v_id UUID;
  v_amount NUMERIC := COALESCE(p_amount, 0);
  v_returned NUMERIC := COALESCE(p_returned_amount, 0);
  v_warnings TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF p_patient_id IS NULL THEN
    RAISE EXCEPTION 'Which patient is this payment for?';
  END IF;

  -- A payment needs money coming in. A refund may have none — the sum is in
  -- returned_amount — but it cannot be empty in both directions.
  IF COALESCE(p_is_refund, false) THEN
    IF v_amount < 0 OR v_returned < 0 THEN
      RAISE EXCEPTION 'A refund cannot be a negative amount';
    END IF;
    IF v_amount = 0 AND v_returned = 0 THEN
      RAISE EXCEPTION 'Enter what is being refunded';
    END IF;
  ELSIF v_amount <= 0 THEN
    RAISE EXCEPTION 'Enter an amount greater than zero';
  END IF;

  IF NULLIF(btrim(COALESCE(p_visit_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Which visit is this payment against?';
  END IF;

  v_mode := upper(btrim(COALESCE(p_payment_mode, '')));
  IF v_mode = '' THEN RAISE EXCEPTION 'How was this paid?'; END IF;

  IF COALESCE(p_is_refund, false) AND btrim(COALESCE(p_refund_reason, '')) = '' THEN
    RAISE EXCEPTION 'Say why the money is being refunded';
  END IF;

  -- Cash must name a person: it goes into a drawer, and an unattributed note
  -- is one nobody can be asked about. Money going OUT as a refund is the same
  -- question — whose drawer did it leave.
  IF v_mode = 'CASH' AND p_collected_by_user_id IS NULL THEN
    RAISE EXCEPTION 'Cash has to be recorded against the person who handled it. Sign in properly, or record this as the payment mode it actually was.';
  END IF;

  IF p_collected_by_user_id IS NOT NULL THEN
    SELECT COALESCE(full_name, email) INTO v_name FROM "User" WHERE id = p_collected_by_user_id;
    IF v_name IS NULL THEN RAISE EXCEPTION 'That collector is not a known user'; END IF;
  END IF;

  SELECT lower(btrim(COALESCE(hospital_name, ''))) INTO v_counter
    FROM patients WHERE id = p_patient_id;
  IF v_counter IS NULL THEN RAISE EXCEPTION 'That patient no longer exists'; END IF;

  IF v_mode = 'CASH' AND v_counter <> ''
     AND NOT (cash_opening_state(v_counter)->>'declared')::boolean THEN
    v_warnings := v_warnings || format(
      'No opening cash has been declared for %s. The payment is recorded; the drawer has no baseline to check it against.',
      v_counter);
  END IF;

  INSERT INTO advance_payment (
    patient_id, visit_id, patient_name, patients_id, bill_no, date_of_admission,
    advance_amount, returned_amount, is_refund, refund_reason,
    payment_date, payment_mode, billing_executive, reference_number, remarks,
    bank_account_id, bank_account_name, package_name, package_days,
    status, created_by, collected_by_user_id
  ) VALUES (
    p_patient_id, p_visit_id,
    COALESCE(NULLIF(btrim(COALESCE(p_patient_name, '')), ''),
             (SELECT name FROM patients WHERE id = p_patient_id)),
    COALESCE(NULLIF(btrim(COALESCE(p_patients_id, '')), ''),
             (SELECT patients_id FROM patients WHERE id = p_patient_id)),
    NULLIF(btrim(COALESCE(p_bill_no, '')), ''),
    p_date_of_admission,
    v_amount, v_returned, COALESCE(p_is_refund, false),
    NULLIF(btrim(COALESCE(p_refund_reason, '')), ''),
    COALESCE(p_payment_date, now()), v_mode,
    COALESCE(NULLIF(btrim(COALESCE(p_billing_executive, '')), ''), v_name),
    NULLIF(btrim(COALESCE(p_reference_number, '')), ''),
    NULLIF(btrim(COALESCE(p_remarks, '')), ''),
    p_bank_account_id, p_bank_account_name, p_package_name, p_package_days,
    'ACTIVE', p_collected_by_user_id::text, p_collected_by_user_id
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'id', v_id, 'counter', v_counter, 'mode', v_mode,
    'collectedBy', v_name, 'warnings', to_jsonb(v_warnings));
END $$;

DO $verify$
DECLARE v_pat UUID; v_visit TEXT; v_user UUID; v_res JSONB; v_ok BOOLEAN; v_id UUID;
BEGIN
  SELECT id INTO v_user FROM "User" LIMIT 1;
  SELECT p.id, v.visit_id INTO v_pat, v_visit
    FROM patients p JOIN visits v ON v.patient_id = p.id
   WHERE p.hospital_name IS NOT NULL AND v.visit_id IS NOT NULL LIMIT 1;

  -- (a) THE POINT: a refund-only entry, zero advance, is allowed again.
  v_res := record_patient_payment(v_pat, 0, 'UPI', NULL, v_visit, NULL, NULL, NULL,
                                  NULL, NULL, true, 'patient cancelled', 500);
  v_id := (v_res->>'id')::uuid;
  IF (SELECT returned_amount FROM advance_payment WHERE id = v_id) <> 500 THEN
    RAISE EXCEPTION 'ABORT: the refunded sum was not stored';
  END IF;
  DELETE FROM advance_payment WHERE id = v_id;

  -- (b) but a refund of nothing at all is still refused
  v_ok := false;
  BEGIN
    PERFORM record_patient_payment(v_pat, 0, 'UPI', NULL, v_visit, NULL, NULL, NULL,
                                   NULL, NULL, true, 'why', 0);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN v_ok := (SQLERRM LIKE '%what is being refunded%');
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'ABORT: an empty refund was accepted'; END IF;

  -- (c) and an ordinary payment of zero is still refused
  v_ok := false;
  BEGIN
    PERFORM record_patient_payment(v_pat, 0, 'UPI', NULL, v_visit);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN v_ok := (SQLERRM LIKE '%greater than zero%');
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'ABORT: a zero payment was accepted'; END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
