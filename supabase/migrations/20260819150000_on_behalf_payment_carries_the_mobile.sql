-- An On-Behalf payment can be saved again.
--
-- THE INSTRUCTION (19 Aug, Dr M): PV1414 would not save. "A mobile number is
-- required for the person the money is paid to" — with 7020646262 typed into
-- the field, on screen, in front of him.
--
-- THE NUMBER WAS NEVER SENT. The On Behalf Of path does not go through
-- saveVoucher; it calls create_on_behalf_payment (VoucherEntry.tsx:1412) and
-- that call passes nine arguments, none of them the mobile. The function was
-- written on 5-Aug (20260805120000:190-198) and inserts its payment voucher
-- with is_auto = false and no party_mobile at all. On 13-Aug
-- require_voucher_party_mobile started refusing exactly that — a hand-typed
-- PAYMENT voucher with no number (20260813240000:47). Nobody joined the two up.
--
-- So EVERY On-Behalf payment has been impossible to save since 13 August. Not
-- intermittent, not this voucher: the field is displayed, filled, and dropped
-- on the floor between the screen and the database. The rule is right and stays
-- exactly as it is; what was missing is the number reaching it.
--
-- WHAT THIS CHANGES. One new argument, and the value carried onto the payment
-- voucher through norm_party_mobile — the same normaliser the payment voucher
-- screen's guard uses, so "+91 70206 46262" and "7020646262" are stored
-- identically wherever they are typed. The rule is NOT relaxed: a missing
-- number is still refused, now by the same trigger, before anything is written.
-- The journal side in the other company's books is untouched (is_auto = true,
-- automatic, no counterparty to ring).
--
-- THE BODY IS TAKEN FROM THE LIVE DATABASE. Rule 3 of docs/money-path-rules.md.
-- pg_get_functiondef is read, patched by exact anchor, re-executed; the two
-- anchors are the ones that tell the PAYMENT insert apart from the JOURNAL
-- insert, and if either matches anything other than exactly once the whole
-- thing aborts and nothing changes.

-- ------------------------------------------------------------ 1. carry it in

DO $patch$
DECLARE
  v_src TEXT;
  v_new TEXT;
  -- The signature. Its last argument today is p_user.
  v_sig_pat  TEXT := 'p_user\s+TEXT\s+DEFAULT\s+NULL\s*\)';
  -- The PAYMENT insert only: the journal insert carries linked_voucher_id here.
  v_cols_pat TEXT := 'on_behalf_of_company_id,\s*pay_to,\s*created_by';
  v_vals_pat TEXT := 'p_behalf_company_id,\s*nullif\(btrim\(p_pay_to\),\s*''''\),\s*v_user';
  v_n INT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'create_on_behalf_payment'
     AND p.pronargs = 9;

  IF v_src IS NULL THEN
    -- Either already fixed, or the function is not what this was written for.
    IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'public' AND p.proname = 'create_on_behalf_payment'
                  AND p.pronargs = 10) THEN
      RAISE NOTICE 'create_on_behalf_payment already takes the mobile — nothing to do';
      RETURN;
    END IF;
    RAISE EXCEPTION 'ABORT: no 9-argument create_on_behalf_payment in this database';
  END IF;

  SELECT count(*) INTO v_n FROM regexp_matches(v_src, v_sig_pat, 'g');
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'ABORT: the signature anchor matched % times, expected 1', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM regexp_matches(v_src, v_cols_pat, 'g');
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'ABORT: the payment-voucher column list matched % times, expected 1 — it must not match the journal insert', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM regexp_matches(v_src, v_vals_pat, 'g');
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'ABORT: the payment-voucher VALUES list matched % times, expected 1', v_n;
  END IF;

  v_new := regexp_replace(v_src, v_sig_pat,
    'p_user TEXT DEFAULT NULL, p_party_mobile TEXT DEFAULT NULL)');
  v_new := regexp_replace(v_new, v_cols_pat,
    'on_behalf_of_company_id, pay_to, party_mobile, created_by');
  v_new := regexp_replace(v_new, v_vals_pat,
    'p_behalf_company_id, nullif(btrim(p_pay_to), ''''), public.norm_party_mobile(p_party_mobile), v_user');

  IF v_new = v_src THEN
    RAISE EXCEPTION 'ABORT: the patch changed nothing';
  END IF;

  EXECUTE v_new;
  RAISE NOTICE 'create_on_behalf_payment now carries the party mobile onto the payment voucher';
END
$patch$;

-- ------------------------------------------------- 2. one function, not two
-- A defaulted argument makes a SECOND function rather than replacing the first,
-- and PostgREST would then have two candidates for the same call. The old one
-- goes, or an on-behalf payment saves or fails depending on which is chosen.

DROP FUNCTION IF EXISTS public.create_on_behalf_payment(
  UUID, UUID, UUID, UUID, NUMERIC, DATE, TEXT, TEXT, TEXT);

-- ------------------------------------------------------------------ 3. verify

DO $verify$
DECLARE v_src TEXT; v_n INT;
BEGIN
  SELECT count(*) INTO v_n
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'create_on_behalf_payment';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'ABORT: % create_on_behalf_payment function(s) exist, expected exactly 1', v_n;
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'create_on_behalf_payment';

  IF v_src NOT LIKE '%p_party_mobile%' THEN
    RAISE EXCEPTION 'ABORT: the function does not take the mobile';
  END IF;
  IF v_src NOT LIKE '%norm_party_mobile%' THEN
    RAISE EXCEPTION 'ABORT: the mobile is not normalised on the way in';
  END IF;

  -- The rule itself must be intact. This fix carries a number to the guard; it
  -- does not weaken the guard, and a migration that quietly did would be worse
  -- than the bug.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname = 'trg_require_voucher_party_mobile' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'ABORT: the party-mobile rule on vouchers is gone';
  END IF;

  RAISE NOTICE 'On-behalf payments accept a mobile and the rule still stands';
END
$verify$;

NOTIFY pgrst, 'reload schema';
