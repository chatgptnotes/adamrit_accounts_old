-- One place to record a patient payment.
--
-- Seven files insert into advance_payment directly. That is why there is
-- nowhere to put a rule, and why rules kept ending up in triggers — where both
-- of this month's worst failures happened.
--
-- THE COST, MEASURED RATHER THAN ASSERTED. Of the last 300 payments (10–15
-- August), only 95 record who took the money. Of the 203 taken in CASH, only
-- 62 are traceable to a person; 124 carry a typed name in billing_executive
-- instead, which the cash handover can see but cannot claim. Two of the seven
-- call sites set collected_by_user_id. The other five do not, and no amount of
-- asking will make seven files agree.
--
-- So: one function, holding the rules once.
--
--   * the amount must be positive
--   * payment_mode is normalised — 'Cash' and 'CASH' were both being stored
--   * status defaults to ACTIVE rather than being left to each caller
--   * CASH MUST NAME WHO TOOK IT. This is the whole point. A card or UPI
--     payment lands in a bank and can be traced; cash goes into a drawer, and
--     an unattributed note is one nobody can be asked about.
--   * a refund must say why
--   * the counter comes from the patient's hospital, never from the caller —
--     the same assumption that put Farhan's pharmacy count on Hope's counter
--
-- IT WARNS, IT DOES NOT LECTURE. If the counter has no opening cash declared,
-- the payment still goes through and the caller is handed a warning to show.
-- Refusing a patient's money over a missing drawer count would be the worse
-- failure, and that decision was already taken once this week.
--
-- NOTHING CALLS THIS YET, deliberately. The seven call sites are how the
-- hospital takes money; they get switched one at a time, each verifiable on
-- its own, with somebody watching. This commit cannot change behaviour.

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
  v_warnings TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF p_patient_id IS NULL THEN
    RAISE EXCEPTION 'Which patient is this payment for?';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Enter an amount greater than zero';
  END IF;
  -- advance_payment.visit_id is NOT NULL. Said here in words, because a
  -- caller that omits it should read "which visit?" and not a constraint name.
  IF NULLIF(btrim(COALESCE(p_visit_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Which visit is this payment against?';
  END IF;

  -- 'Cash' and 'CASH' were both being stored, and every downstream report
  -- compares upper-cased. One spelling, decided here.
  v_mode := upper(btrim(COALESCE(p_payment_mode, '')));
  IF v_mode = '' THEN RAISE EXCEPTION 'How was this paid?'; END IF;

  IF p_is_refund AND btrim(COALESCE(p_refund_reason, '')) = '' THEN
    RAISE EXCEPTION 'Say why the money is being refunded';
  END IF;

  -- Cash must name a person. A card or UPI payment lands in a bank and can be
  -- traced; cash goes into a drawer, and an unattributed note is one nobody
  -- can be asked about. 141 of the last 203 cash payments are in that state.
  IF v_mode = 'CASH' AND p_collected_by_user_id IS NULL THEN
    RAISE EXCEPTION 'Cash has to be recorded against the person who took it. Sign in properly, or record this as the payment mode it actually was.';
  END IF;

  IF p_collected_by_user_id IS NOT NULL THEN
    SELECT COALESCE(full_name, email) INTO v_name FROM "User" WHERE id = p_collected_by_user_id;
    IF v_name IS NULL THEN RAISE EXCEPTION 'That collector is not a known user'; END IF;
  END IF;

  -- The counter is the patient's hospital, never the caller's opinion of it.
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
    p_amount, COALESCE(p_returned_amount, 0), COALESCE(p_is_refund, false),
    NULLIF(btrim(COALESCE(p_refund_reason, '')), ''),
    COALESCE(p_payment_date, now()), v_mode,
    -- Kept for the screens that show it, but the id above is what the cash
    -- handover claims against. A typed name is a label, not an attribution.
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

REVOKE ALL ON FUNCTION public.record_patient_payment FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_patient_payment TO anon, authenticated;

COMMENT ON FUNCTION public.record_patient_payment IS
  'The one way to record a patient payment. Seven screens insert into '
  'advance_payment directly; they are being moved here one at a time so the '
  'rules live in one place instead of in triggers.';

DO $verify$
DECLARE
  v_pat UUID; v_user UUID; v_res JSONB; v_ok BOOLEAN; v_id UUID; v_n INT; v_visit TEXT;
BEGIN
  SELECT id INTO v_user FROM "User" LIMIT 1;
  SELECT p.id, v.visit_id INTO v_pat, v_visit
    FROM patients p JOIN visits v ON v.patient_id = p.id
   WHERE p.hospital_name IS NOT NULL AND v.visit_id IS NOT NULL LIMIT 1;
  IF v_pat IS NULL OR v_user IS NULL THEN
    RAISE EXCEPTION 'ABORT: need a patient with a visit, and a user, to self-test';
  END IF;

  -- (a) THE POINT: cash without a named collector is refused.
  v_ok := false;
  BEGIN
    PERFORM record_patient_payment(v_pat, 100, 'CASH', NULL, v_visit);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_ok := (SQLERRM LIKE '%person who took it%');
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'ABORT: cash was accepted with nobody named'; END IF;

  -- (b) but UPI is not blocked — it lands in a bank and can be traced.
  v_res := record_patient_payment(v_pat, 100, 'upi', NULL, v_visit);
  v_id := (v_res->>'id')::uuid;
  IF v_res->>'mode' <> 'UPI' THEN
    RAISE EXCEPTION 'ABORT: the payment mode was not normalised (%)', v_res->>'mode';
  END IF;
  DELETE FROM advance_payment WHERE id = v_id;

  -- (c) cash WITH a collector goes through, and records the id
  v_res := record_patient_payment(v_pat, 100, ' Cash ', v_user, v_visit);
  v_id := (v_res->>'id')::uuid;
  IF (SELECT collected_by_user_id FROM advance_payment WHERE id = v_id) <> v_user THEN
    RAISE EXCEPTION 'ABORT: the collector was not recorded';
  END IF;
  IF (SELECT payment_mode FROM advance_payment WHERE id = v_id) <> 'CASH' THEN
    RAISE EXCEPTION 'ABORT: " Cash " was not normalised to CASH';
  END IF;
  IF (SELECT status FROM advance_payment WHERE id = v_id) <> 'ACTIVE' THEN
    RAISE EXCEPTION 'ABORT: status did not default to ACTIVE';
  END IF;
  DELETE FROM advance_payment WHERE id = v_id;

  -- (d) zero and negative are refused
  FOR v_n IN SELECT unnest(ARRAY[0, -5]) LOOP
    v_ok := false;
    BEGIN
      PERFORM record_patient_payment(v_pat, v_n, 'UPI', NULL, v_visit);
    EXCEPTION WHEN SQLSTATE 'P0001' THEN v_ok := true;
    END;
    IF NOT v_ok THEN RAISE EXCEPTION 'ABORT: an amount of % was accepted', v_n; END IF;
  END LOOP;

  -- (e) a refund must say why
  v_ok := false;
  BEGIN
    PERFORM record_patient_payment(v_pat, 100, 'UPI', NULL, v_visit, NULL, NULL, NULL,
                                   NULL, NULL, true, NULL);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN v_ok := (SQLERRM LIKE '%why the money%');
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'ABORT: a refund was accepted with no reason'; END IF;

  -- (f) a payment with no visit says which visit, not a constraint name
  v_ok := false;
  BEGIN
    PERFORM record_patient_payment(v_pat, 100, 'UPI', NULL, NULL);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN v_ok := (SQLERRM LIKE '%Which visit%');
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'ABORT: a payment with no visit was accepted'; END IF;

  -- (g) nothing survives the self-test
  SELECT count(*) INTO v_n FROM advance_payment
   WHERE patient_id = v_pat AND advance_amount = 100 AND created_at > now() - interval '1 minute';
  IF v_n > 0 THEN
    DELETE FROM advance_payment
     WHERE patient_id = v_pat AND advance_amount = 100 AND created_at > now() - interval '1 minute';
    RAISE EXCEPTION 'ABORT: % self-test payment(s) left behind', v_n;
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
