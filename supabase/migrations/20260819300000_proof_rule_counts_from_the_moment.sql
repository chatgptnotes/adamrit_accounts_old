-- The proof rule stops blocking, and could not have blocked wrongly anyway.
--
-- THE INSTRUCTION (19 Aug, Dr M): "switch on the payment proof rule" — then,
-- minutes later, "do not block". So the rule goes back to reporting only: the
-- nightly digest still names every payment with no confirmation attached, and
-- nothing is ever refused. That is the state this migration leaves behind.
--
-- The trigger is corrected as well, so that if it is ever switched on again it
-- cannot repeat the fault below.
--
-- CAUGHT ON THE READBACK. 20260819290000 switched the rule on and stamped
-- enforce_from, but compared it as a DATE:
--
--     AND p.voucher_date >= v_settings.enforce_from::date
--
-- Every payment dated today is on or after today, so all 42 payments already
-- made today — before the rule existed — came into scope. None of them blocks
-- anything yet, because none is 24 hours old. Tomorrow morning every one of them
-- would be, and the first payment attempted in either hospital would be refused
-- for want of confirmations nobody was asked for at the time.
--
-- That is the same "closing the till" the start date was added to prevent,
-- delayed by one night. Compared on created_at against the exact moment now, so
-- only payments recorded AFTER the switch was thrown can ever block another.
--
-- The view gains created_at for the purpose; the daily digest is unchanged and
-- still reports the whole backlog, because the backlog is still worth chasing.

CREATE OR REPLACE VIEW public.v_payments_without_proof AS
SELECT v.id            AS voucher_id,
       v.voucher_number,
       v.voucher_date,
       v.total_amount,
       v.narration,
       v.created_by,
       c.company_name,
       (SELECT a.account_name
          FROM public.voucher_entries e
          JOIN public.chart_of_accounts a ON a.id = e.account_id
         WHERE e.voucher_id = v.id AND e.debit_amount > 0
         ORDER BY e.entry_order LIMIT 1) AS paid_to,
       (SELECT e.account_id
          FROM public.voucher_entries e
         WHERE e.voucher_id = v.id AND e.debit_amount > 0
         ORDER BY e.entry_order LIMIT 1) AS party_account_id,
       round(extract(epoch FROM now() - v.created_at) / 3600.0, 1) AS hours_undocumented,
       -- Appended, not inserted: CREATE OR REPLACE VIEW may only add columns at
       -- the end, and renaming an existing one is what it thought I was doing.
       v.created_at
  FROM public.vouchers v
  JOIN public.voucher_types t ON t.id = v.voucher_type_id
  LEFT JOIN public.companies c ON c.id = v.company_id
 WHERE t.voucher_category = 'PAYMENT'
   AND v.status <> 'CANCELLED'
   AND NOT EXISTS (
     SELECT 1 FROM public.file_uploads f
      WHERE f.voucher_id = v.id
        AND f.category = 'voucher_payment_proof'
   );

GRANT SELECT ON public.v_payments_without_proof TO anon, authenticated;

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
       -- The MOMENT, not the day. A payment recorded an hour before the switch
       -- was thrown was made under the old rules and cannot block anything.
       AND (v_settings.enforce_from IS NULL OR p.created_at > v_settings.enforce_from)
  ) THEN
    RAISE EXCEPTION
      'An earlier payment has no confirmation attached yet. Open it from the Day Book, attach the payment screenshot, then make this payment. Nothing has been saved.';
  END IF;

  RETURN NEW;
END $$;

-- ------------------------------------------------------------- stop blocking

UPDATE public.payment_proof_settings
   SET enforced = false, updated_at = now()
 WHERE id;

-- ------------------------------------------------------------------ verify

DO $verify$
DECLARE v_on BOOLEAN; v_type UUID; v_company UUID; v_id UUID; v_before INT;
BEGIN
  SELECT enforced INTO v_on FROM payment_proof_settings WHERE id;
  IF v_on THEN
    RAISE EXCEPTION 'ABORT: the rule is still blocking payments';
  END IF;

  -- A payment must go through, in the company with the largest backlog.
  SELECT id INTO v_type FROM voucher_types WHERE voucher_category = 'PAYMENT' AND is_active LIMIT 1;
  SELECT id INTO v_company FROM companies WHERE company_key = 'ayushman_nagpur';
  SELECT count(*) INTO v_before FROM vouchers;

  INSERT INTO vouchers (voucher_number, voucher_type_id, voucher_date, total_amount,
                        company_id, status, is_auto)
  VALUES ('SELFTEST-PP-OFF', v_type, CURRENT_DATE, 1, v_company, 'PENDING', true)
  RETURNING id INTO v_id;
  DELETE FROM vouchers WHERE id = v_id;

  IF (SELECT count(*) FROM vouchers) <> v_before THEN
    RAISE EXCEPTION 'ABORT: the self-test left a row behind';
  END IF;

  -- And the digest must still be scheduled: not blocking is not the same as
  -- not looking.
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'payments-without-proof') THEN
    RAISE EXCEPTION 'ABORT: the nightly report is gone as well as the block';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------- read it

SELECT enforced      AS blocks_payments,
       enforce_from  AS would_count_from_if_switched_on,
       (SELECT count(*) FROM public.v_payments_without_proof)
                     AS reported_nightly_at_1830_ist
  FROM public.payment_proof_settings WHERE id;
