-- Every payment leaves evidence, and eventually the books insist on it.
--
-- THE INSTRUCTION (19 Aug, Dr M): "No payments will be done before a JV is
-- posted, Invoice is uploaded and a payment voucher is generated in Adamrit" —
-- then, on whether the software should require the confirmation rather than
-- trust the habit: "yes insist".
--
-- THE RULE CANNOT BE SWITCHED ON TODAY, AND SAYING SO IS THE POINT. Of the 1,342
-- payment vouchers written in the last thirty days, 46 carry a payment-proof
-- attachment and 1,296 do not. A hard rule turned on now would refuse almost
-- every payment the hospital makes tomorrow morning.
--
-- So this ships the way rule 5 of docs/money-path-rules.md requires: anything
-- that can stop the hospital goes behind a switch, DEFAULTED OFF. What is on
-- from today is the seeing — a view and one digest a day naming the payments
-- with no evidence. The habit forms against a shrinking list, and when the list
-- is near zero the switch is one UPDATE:
--
--   UPDATE public.payment_proof_settings SET enforced = true WHERE id;
--
-- WHERE IT BITES, WHEN IT IS ON. Not on creating the voucher — the confirmation
-- only exists after the money has moved, so refusing the voucher would refuse
-- the very record the proof attaches to. It bites on the NEXT payment: a party
-- with an unevidenced payment older than the grace period cannot be paid again
-- until that one is documented. That insists without stopping the first payment
-- of a day, and it puts the chase on the person who benefits from skipping it.
--
-- Enforced AT ENTRY in a BEFORE INSERT trigger that only raises — never a
-- deferred constraint (20260814230000, which unwound work at COMMIT instead of
-- refusing it) and never a trigger that writes a child row (20260728171000).

-- --------------------------------------------------------------- 1. the switch

CREATE TABLE IF NOT EXISTS public.payment_proof_settings (
  id          BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  enforced    BOOLEAN NOT NULL DEFAULT false,
  -- How long a payment may go undocumented before it blocks the next one.
  grace_hours INT NOT NULL DEFAULT 24 CHECK (grace_hours >= 0),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.payment_proof_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.payment_proof_settings IS
  'One row. enforced=false means the unevidenced payments are only reported; '
  'true means a party with one cannot be paid again until it is documented.';

GRANT SELECT ON public.payment_proof_settings TO anon, authenticated;

-- ------------------------------------------------------ 2. what has no proof

CREATE OR REPLACE VIEW public.v_payments_without_proof AS
SELECT v.id            AS voucher_id,
       v.voucher_number,
       v.voucher_date,
       v.total_amount,
       v.narration,
       v.created_by,
       c.company_name,
       -- The party paid: the debit side of a payment voucher.
       (SELECT a.account_name
          FROM public.voucher_entries e
          JOIN public.chart_of_accounts a ON a.id = e.account_id
         WHERE e.voucher_id = v.id AND e.debit_amount > 0
         ORDER BY e.entry_order LIMIT 1) AS paid_to,
       (SELECT e.account_id
          FROM public.voucher_entries e
         WHERE e.voucher_id = v.id AND e.debit_amount > 0
         ORDER BY e.entry_order LIMIT 1) AS party_account_id,
       round(extract(epoch FROM now() - v.created_at) / 3600.0, 1) AS hours_undocumented
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

COMMENT ON VIEW public.v_payments_without_proof IS
  'Payment vouchers carrying no payment-confirmation attachment. The list the '
  'daily digest reads and the rule counts.';

GRANT SELECT ON public.v_payments_without_proof TO anon, authenticated;

-- --------------------------------------------------------------- 3. the rule

CREATE OR REPLACE FUNCTION public.require_payment_proof()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_settings RECORD;
  v_category TEXT;
BEGIN
  SELECT enforced, grace_hours INTO v_settings FROM payment_proof_settings WHERE id;
  IF NOT COALESCE(v_settings.enforced, false) THEN
    RETURN NEW;
  END IF;

  SELECT vt.voucher_category INTO v_category
    FROM voucher_types vt WHERE vt.id = NEW.voucher_type_id;
  IF v_category IS DISTINCT FROM 'PAYMENT' THEN
    RETURN NEW;
  END IF;

  -- The party is on the entries, which are written after this row. So the block
  -- is by COMPANY: anyone in a company that owes evidence stops the company's
  -- next payment. Blunt on purpose — it is the company's accountant who fixes
  -- it, and a per-party test would need the entries this trigger cannot see.
  IF EXISTS (
    SELECT 1 FROM v_payments_without_proof p
     WHERE p.voucher_id <> NEW.id
       AND p.company_name IS NOT DISTINCT FROM (
             SELECT company_name FROM companies WHERE id = NEW.company_id)
       AND p.hours_undocumented > v_settings.grace_hours
  ) THEN
    RAISE EXCEPTION
      'An earlier payment has no confirmation attached yet. Open it from the Day Book, attach the payment screenshot, then make this payment. Nothing has been saved.';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_require_payment_proof ON public.vouchers;
CREATE TRIGGER trg_require_payment_proof
  BEFORE INSERT ON public.vouchers
  FOR EACH ROW EXECUTE FUNCTION public.require_payment_proof();

-- ------------------------------------------------------------- 4. the chasing

CREATE OR REPLACE FUNCTION public.notify_payments_without_proof(p_hours INT DEFAULT 24)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n INT; v_amount NUMERIC; v_lines TEXT;
BEGIN
  SELECT count(*), COALESCE(sum(total_amount), 0),
         string_agg(voucher_number || ' — ' || COALESCE(paid_to, 'unknown') || ', '
                    || to_char(total_amount, 'FM99,99,99,990'),
                    E'\n' ORDER BY voucher_date DESC, voucher_number DESC)
    INTO v_n, v_amount, v_lines
    FROM (SELECT * FROM v_payments_without_proof
           WHERE hours_undocumented > p_hours
           ORDER BY voucher_date DESC LIMIT 20) t;

  IF COALESCE(v_n, 0) = 0 THEN RETURN 0; END IF;

  IF EXISTS (SELECT 1 FROM notifications
              WHERE notification_type = 'payment_without_proof'
                AND created_at > now() - interval '20 hours') THEN
    RETURN 0;
  END IF;

  BEGIN
    INSERT INTO notifications (notification_type, title, message, recipient_role,
                               source_table, payload)
    VALUES ('payment_without_proof',
            v_n || ' payment(s) with no confirmation attached',
            v_lines || E'\n\nOpen each from the Day Book and attach the payment screenshot.',
            'all', 'vouchers',
            jsonb_build_object('count', v_n, 'amount', v_amount));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Unproven-payment digest could not be written: %', SQLERRM;
    RETURN 0;
  END;
  RETURN 1;
END $$;

REVOKE ALL ON FUNCTION public.notify_payments_without_proof(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_payments_without_proof(INT) TO anon, authenticated;

SELECT cron.unschedule('payments-without-proof')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'payments-without-proof');

-- 18:30 IST (13:00 UTC), at the end of the paying day.
SELECT cron.schedule(
  'payments-without-proof',
  '0 13 * * *',
  $cron$ SELECT public.notify_payments_without_proof(); $cron$
);

-- ------------------------------------------------------------------ verify

DO $verify$
DECLARE
  v_was BOOLEAN; v_type UUID; v_company UUID; v_id UUID; v_ok BOOLEAN; v_before INT;
BEGIN
  SELECT enforced INTO v_was FROM payment_proof_settings WHERE id;
  IF v_was IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'ABORT: the rule must ship switched OFF, and it is %', v_was;
  END IF;

  SELECT id INTO v_type FROM voucher_types WHERE voucher_category = 'PAYMENT' AND is_active LIMIT 1;
  SELECT id INTO v_company FROM companies WHERE company_key = 'drm_pvt_ltd';
  IF v_type IS NULL OR v_company IS NULL THEN
    RAISE EXCEPTION 'ABORT: need a PAYMENT type and a company to self-test';
  END IF;

  SELECT count(*) INTO v_before FROM vouchers;

  -- OFF: a payment saves, which is the state this migration leaves behind.
  INSERT INTO vouchers (voucher_number, voucher_type_id, voucher_date, total_amount,
                        company_id, status, is_auto)
  VALUES ('SELFTEST-PP-A', v_type, CURRENT_DATE, 1, v_company, 'PENDING', true)
  RETURNING id INTO v_id;
  DELETE FROM vouchers WHERE id = v_id;

  -- ON: it is refused, and refused BEFORE anything is written.
  UPDATE payment_proof_settings SET enforced = true WHERE id;
  v_ok := false;
  BEGIN
    INSERT INTO vouchers (voucher_number, voucher_type_id, voucher_date, total_amount,
                          company_id, status, is_auto)
    VALUES ('SELFTEST-PP-B', v_type, CURRENT_DATE, 1, v_company, 'PENDING', true);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_ok := SQLERRM LIKE '%no confirmation attached%';
  END;
  UPDATE payment_proof_settings SET enforced = COALESCE(v_was, false) WHERE id;

  IF NOT v_ok THEN
    DELETE FROM vouchers WHERE voucher_number = 'SELFTEST-PP-B';
    RAISE EXCEPTION 'ABORT: an undocumented company was allowed to pay again';
  END IF;
  IF (SELECT count(*) FROM vouchers) <> v_before THEN
    DELETE FROM vouchers WHERE voucher_number IN ('SELFTEST-PP-A', 'SELFTEST-PP-B');
    RAISE EXCEPTION 'ABORT: the refused voucher was written anyway';
  END IF;

  -- And it must be OFF again after the test.
  IF (SELECT enforced FROM payment_proof_settings WHERE id) THEN
    RAISE EXCEPTION 'ABORT: the self-test left the rule switched on';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'payments-without-proof') THEN
    RAISE EXCEPTION 'ABORT: the daily digest is not scheduled';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------- read it
-- The size of the backlog the habit has to clear before the switch can be
-- turned on, and how much of it is recent enough to still be chaseable.

SELECT (SELECT enforced FROM public.payment_proof_settings WHERE id)      AS rule_is_on,
       count(*)                                                           AS without_proof_total,
       count(*) FILTER (WHERE voucher_date >= current_date - 7)            AS last_7_days,
       to_char(COALESCE(sum(total_amount) FILTER (WHERE voucher_date >= current_date - 7), 0),
               'FM99,99,99,990')                                          AS value_last_7_days
  FROM public.v_payments_without_proof;
