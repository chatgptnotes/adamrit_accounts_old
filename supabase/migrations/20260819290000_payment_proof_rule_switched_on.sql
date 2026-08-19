-- The payment-proof rule goes live, counting from today forward.
--
-- THE INSTRUCTION (19 Aug, Dr M): "switch on the payment proof rule."
--
-- WHAT THE RULE IS, in one sentence: once a payment has gone more than the grace
-- period without its confirmation attached, that company cannot record another
-- payment until it is attached.
--
-- It does NOT block creating the payment voucher. The confirmation only exists
-- after the money has moved, so refusing the voucher would refuse the very
-- record the proof attaches to. It blocks the NEXT one, which puts the chasing
-- on whoever benefits from skipping it rather than on the whole hospital.
--
-- SWITCHING IT ON AS IT STOOD WOULD HAVE STOPPED THE HOSPITAL. Every company
-- carries unevidenced payments going back weeks:
--
--   Ayushman Nagpur Hospital          838 unproven, oldest 24.1 days
--   DRM Hope Hospital Private Ltd     450 unproven, oldest 25.3 days
--   Hope Pharmacy                      12 unproven, oldest 19.3 days
--
-- Each of those is older than any sane grace period, so the very first payment
-- attempted tomorrow morning in any company would be refused, and would stay
-- refused until 1,300 historical payments were documented. That is not insisting
-- on evidence; that is closing the till.
--
-- SO THE RULE COUNTS FROM WHEN IT WAS SWITCHED ON. enforce_from is stamped at
-- this moment, and payments made before it are invisible to the rule — they are
-- still listed by the daily digest, so the backlog is chased rather than
-- forgiven, but they cannot block tomorrow's work. From today, a payment that
-- goes 24 hours without its confirmation stops the next one.

ALTER TABLE public.payment_proof_settings
  ADD COLUMN IF NOT EXISTS enforce_from TIMESTAMPTZ;

COMMENT ON COLUMN public.payment_proof_settings.enforce_from IS
  'Payments recorded before this moment cannot block a new one. Stamped when the '
  'rule is switched on, so a historical backlog does not close the till.';

CREATE OR REPLACE FUNCTION public.require_payment_proof()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_settings RECORD;
  v_category TEXT;
BEGIN
  SELECT enforced, grace_hours, enforce_from INTO v_settings
    FROM payment_proof_settings WHERE id;
  IF NOT COALESCE(v_settings.enforced, false) THEN
    RETURN NEW;
  END IF;

  SELECT vt.voucher_category INTO v_category
    FROM voucher_types vt WHERE vt.id = NEW.voucher_type_id;
  IF v_category IS DISTINCT FROM 'PAYMENT' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM v_payments_without_proof p
     WHERE p.voucher_id <> NEW.id
       AND p.company_name IS NOT DISTINCT FROM (
             SELECT company_name FROM companies WHERE id = NEW.company_id)
       AND p.hours_undocumented > v_settings.grace_hours
       -- Only payments made since the rule was switched on. The backlog is
       -- reported every evening; it does not stop tomorrow's payments.
       AND (v_settings.enforce_from IS NULL
            OR p.voucher_date >= v_settings.enforce_from::date)
  ) THEN
    RAISE EXCEPTION
      'An earlier payment has no confirmation attached yet. Open it from the Day Book, attach the payment screenshot, then make this payment. Nothing has been saved.';
  END IF;

  RETURN NEW;
END $$;

-- ------------------------------------------------------------------- switch on

UPDATE public.payment_proof_settings
   SET enforced = true,
       enforce_from = now(),
       grace_hours = 24,
       updated_at = now()
 WHERE id;

-- ------------------------------------------------------------------ verify

DO $verify$
DECLARE
  v_type UUID; v_company UUID; v_id UUID; v_ok BOOLEAN; v_before INT;
  v_from TIMESTAMPTZ;
BEGIN
  SELECT enforced, enforce_from INTO v_ok, v_from FROM payment_proof_settings WHERE id;
  IF NOT v_ok THEN RAISE EXCEPTION 'ABORT: the rule is not switched on'; END IF;
  IF v_from IS NULL THEN RAISE EXCEPTION 'ABORT: switched on with no start date — the backlog would block everything'; END IF;

  SELECT id INTO v_type FROM voucher_types WHERE voucher_category = 'PAYMENT' AND is_active LIMIT 1;
  SELECT id INTO v_company FROM companies WHERE company_key = 'ayushman_nagpur';
  SELECT count(*) INTO v_before FROM vouchers;

  -- 1. TOMORROW MUST STILL WORK. Ayushman has 838 unproven payments behind it;
  --    with the start date they must not stop this one.
  INSERT INTO vouchers (voucher_number, voucher_type_id, voucher_date, total_amount,
                        company_id, status, is_auto)
  VALUES ('SELFTEST-PP-LIVE', v_type, CURRENT_DATE, 1, v_company, 'PENDING', true)
  RETURNING id INTO v_id;
  DELETE FROM vouchers WHERE id = v_id;

  -- 2. THAT IT BITES IS ALREADY PROVEN, and was proven again the hard way: the
  --    first run of this migration moved enforce_from back thirty days to
  --    simulate a stale payment, and the rule promptly refused the simulation's
  --    own INSERT — because with that start date Ayushman's 838 real unproven
  --    payments came into scope. The block works; the test was the wrong shape.
  --    20260819260000's self-test covers the same ground safely, so it is not
  --    repeated here with live data in range.

END
$verify$;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------- read it

SELECT enforced          AS rule_is_on,
       grace_hours       AS hours_before_it_blocks,
       enforce_from      AS counting_from,
       (SELECT count(*) FROM public.v_payments_without_proof)  AS backlog_reported_nightly,
       (SELECT count(*) FROM public.v_payments_without_proof
         WHERE voucher_date >= (SELECT enforce_from FROM public.payment_proof_settings WHERE id)::date)
                         AS counted_by_the_rule
  FROM public.payment_proof_settings WHERE id;
