-- A phone bill has nobody to ring.
--
-- THE INSTRUCTION (20 Aug, Dr M): the phone number field should not be mandatory
-- for phone bills, wifi bills or government services on the payment voucher.
-- The exempt list was confirmed by him from the ledgers that actually exist.
--
-- WHY THE FIELD EXISTS AT ALL, so this does not quietly undo it: a payment
-- voucher names a person the money went to, and a name alone gives nobody to ask
-- three weeks later what it was for. That is worth insisting on for a doctor, a
-- vendor, a porter. It is meaningless for BSNL and for a GST challan.
--
-- TWO PLACES DEMAND IT, and both have to know, or the screen accepts a voucher
-- the database then refuses:
--
--   * PaymentVoucher.tsx, before anything is sent
--   * require_voucher_party_mobile on vouchers — on for every hand-typed
--     PAYMENT/RECEIPT and NOT settings-gated (20260813240000)
--
-- The payment_vouchers trigger is a third, but it has been switched off since
-- 14-Aug after it silently destroyed four vouchers, so it is not in the way.
--
-- HOW A VOUCHER IS RECOGNISED AS EXEMPT. By the ledger being paid. On this
-- screen person_name is the first particulars ledger (PaymentVoucher.tsx:657),
-- so "Telephone" or "BSNL" is both the payee and the ledger, and one match
-- covers both. Matched on a pattern rather than an exact name because the same
-- utility is spelled several ways — "Telephone", "Telephone & Internet
-- Recharge".
--
-- CGHS AND THE OTHER SCHEME LEDGERS ARE DELIBERATELY NOT HERE. They are panels
-- that pay the hospital, not payees; exempting them would waive the rule for
-- money coming in, which is not what was asked and not what it is for.

CREATE TABLE IF NOT EXISTS public.party_mobile_exempt_ledgers (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern    TEXT NOT NULL,
  note       TEXT,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS party_mobile_exempt_pattern_uidx
  ON public.party_mobile_exempt_ledgers (lower(btrim(pattern)));

COMMENT ON TABLE public.party_mobile_exempt_ledgers IS
  'Ledgers paid to an organisation rather than a person, where a mobile number '
  'would be meaningless. Matched case-insensitively as a substring.';

GRANT SELECT ON public.party_mobile_exempt_ledgers TO anon, authenticated;

INSERT INTO public.party_mobile_exempt_ledgers (pattern, note) VALUES
  ('telephone',                        'Phone bills'),
  ('internet',                         'Wifi and broadband'),
  ('telephone & internet recharge',    'The combined recharge ledger'),
  ('bsnl',                             'Phone and broadband'),
  ('gst',                              'Government — GST'),
  ('income tax',                       'Government — income tax'),
  ('msedcl',                           'Government — state electricity'),
  ('mseb',                             'Government — state electricity board'),
  ('electricity expenses',             'Government — electricity')
ON CONFLICT (lower(btrim(pattern))) DO NOTHING;

/** Is this payee one of the organisations that has no phone number to give? */
CREATE OR REPLACE FUNCTION public.party_mobile_exempt(p_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM party_mobile_exempt_ledgers e
     WHERE e.is_active
       AND lower(btrim(COALESCE(p_name, ''))) LIKE '%' || lower(btrim(e.pattern)) || '%'
  );
$$;

REVOKE ALL ON FUNCTION public.party_mobile_exempt(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.party_mobile_exempt(TEXT) TO anon, authenticated;

-- ------------------------------------------------ the rule learns the exception

CREATE OR REPLACE FUNCTION public.require_voucher_party_mobile()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v TEXT; v_category TEXT; v_payee TEXT;
BEGIN
  IF COALESCE(NEW.is_auto, true) THEN
    RETURN NEW;
  END IF;

  SELECT vt.voucher_category INTO v_category
    FROM voucher_types vt WHERE vt.id = NEW.voucher_type_id;

  IF v_category NOT IN ('PAYMENT', 'RECEIPT') THEN
    RETURN NEW;
  END IF;

  -- Who was paid. The accounting voucher carries reference_number 'PV-<uuid>'
  -- back to the payment voucher it was posted from (20260814360000), which is
  -- where the payee's name lives.
  IF NEW.reference_number LIKE 'PV-%' THEN
    SELECT pv.person_name INTO v_payee
      FROM payment_vouchers pv
     WHERE 'PV-' || pv.id::TEXT = NEW.reference_number;
  END IF;
  -- Failing that, the narration carries it: "Payment voucher PV1234 - <name>".
  IF public.party_mobile_exempt(COALESCE(v_payee, NEW.narration)) THEN
    RETURN NEW;
  END IF;

  v := regexp_replace(COALESCE(NEW.party_mobile, ''), '[^0-9]', '', 'g');
  IF length(v) = 12 AND left(v, 2) = '91' THEN v := right(v, 10); END IF;
  IF length(v) = 11 AND left(v, 1) = '0'  THEN v := right(v, 10); END IF;

  IF v = '' THEN
    RAISE EXCEPTION 'A mobile number is required for the person the money is % ',
      CASE WHEN v_category = 'PAYMENT' THEN 'paid to' ELSE 'received from' END;
  END IF;
  IF v !~ '^[6-9][0-9]{10}$' AND v !~ '^[6-9][0-9]{9}$' THEN
    RAISE EXCEPTION 'That mobile number does not look right: % — it should be 10 digits starting 6, 7, 8 or 9', NEW.party_mobile;
  END IF;

  NEW.party_mobile := v;
  RETURN NEW;
END $$;

-- ------------------------------------------------------------------ verify

DO $verify$
DECLARE v_pay UUID; v_id UUID; v_ok BOOLEAN; v_before INT;
BEGIN
  SELECT id INTO v_pay FROM voucher_types WHERE voucher_category = 'PAYMENT' AND is_active LIMIT 1;
  IF v_pay IS NULL THEN RAISE EXCEPTION 'ABORT: no PAYMENT voucher type'; END IF;
  SELECT count(*) INTO v_before FROM vouchers;

  -- The exemption itself.
  IF NOT public.party_mobile_exempt('Telephone & Internet Recharge') THEN
    RAISE EXCEPTION 'ABORT: a phone bill is not recognised as exempt';
  END IF;
  IF NOT public.party_mobile_exempt('BSNL') THEN
    RAISE EXCEPTION 'ABORT: BSNL is not recognised as exempt';
  END IF;
  IF public.party_mobile_exempt('Dr. Ankit Daware') THEN
    RAISE EXCEPTION 'ABORT: a doctor is being treated as exempt';
  END IF;
  -- A panel that pays the hospital must NOT be exempt.
  IF public.party_mobile_exempt('Central Government Health Scheme (CGHS)') THEN
    RAISE EXCEPTION 'ABORT: a panel is being treated as an exempt payee';
  END IF;

  -- An exempt payment saves with no mobile.
  INSERT INTO vouchers (voucher_number, voucher_type_id, voucher_date, total_amount,
                        status, is_auto, narration)
  VALUES ('SELFTEST-PM-EXEMPT', v_pay, CURRENT_DATE, 1, 'PENDING', false,
          'Payment voucher SELFTEST - Telephone')
  RETURNING id INTO v_id;
  DELETE FROM vouchers WHERE id = v_id;

  -- A person still cannot.
  v_ok := false;
  BEGIN
    INSERT INTO vouchers (voucher_number, voucher_type_id, voucher_date, total_amount,
                          status, is_auto, narration)
    VALUES ('SELFTEST-PM-PERSON', v_pay, CURRENT_DATE, 1, 'PENDING', false,
            'Payment voucher SELFTEST - Ramesh the porter');
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_ok := SQLERRM LIKE '%mobile number is required%';
  END;
  IF NOT v_ok THEN
    DELETE FROM vouchers WHERE voucher_number = 'SELFTEST-PM-PERSON';
    RAISE EXCEPTION 'ABORT: a payment to a person was accepted with no mobile';
  END IF;

  IF (SELECT count(*) FROM vouchers) <> v_before THEN
    RAISE EXCEPTION 'ABORT: the self-test left rows behind';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
