-- DRM Hope's doctor payouts come out of State Bank of India.
--
-- THE INSTRUCTION (19 Aug, Dr M): "SBI is the account from which payments are
-- made", answering which account DRM Hope's three misposted payouts should have
-- credited.
--
-- WHAT IS BEING REPAIRED. PV0862, PV0866 (9-Aug) and PV0736 (6-Aug), Rs 1,000
-- each. All three credited "Bank Charges" — an INDIRECT EXPENSES ledger. This is
-- worse than the Canara mix-up in Ayushman: there the wrong bank was reduced,
-- here NO bank was reduced at all and an expense account was credited instead,
-- so DRM Hope's expenses are understated by Rs 3,000 and its bank overstated by
-- the same. Cause and fix are in 20260819250000: the auto-pick matched any
-- ledger whose NAME contained "bank".
--
-- WHICH SBI, AND WHY THIS ONE. DRM Hope has two:
--
--   STATE BANK OF INDIA                    50 entries, last used 18-Aug
--   STATE BANK OF INDIA ( MURALI SIR )      3 entries, last used 07-Aug
--
-- The plain one is the account in daily use; the other is named for a person.
-- "The account from which payments are made" is the first. Recorded here rather
-- than assumed silently: if it is the wrong one, this file names the two and the
-- correction is the same three lines with the other id.
--
-- THE DEFAULT IS SET TOO. Ayushman's payouts were corrected this afternoon
-- without setting its default and the next payout would have gone back to Canara;
-- that lesson is applied here in the same migration rather than a week later.

-- --------------------------------------------------- 1. repair the three

DO $repair$
DECLARE
  v_company UUID;
  v_charges UUID;
  v_sbi     UUID;
  v_n       INT;
BEGIN
  SELECT id INTO v_company FROM public.companies WHERE company_key = 'drm_pvt_ltd';
  SELECT id INTO v_charges FROM public.chart_of_accounts
   WHERE company_id = v_company AND account_name = 'Bank Charges';
  SELECT id INTO v_sbi FROM public.chart_of_accounts
   WHERE company_id = v_company AND is_active
     AND btrim(account_name) = 'STATE BANK OF INDIA';

  IF v_sbi IS NULL THEN
    RAISE EXCEPTION 'ABORT: DRM Hope has no active ledger named exactly STATE BANK OF INDIA';
  END IF;
  -- Never the personal one by accident.
  IF v_sbi = (SELECT id FROM public.chart_of_accounts
               WHERE company_id = v_company
                 AND account_name ILIKE '%MURALI SIR%') THEN
    RAISE EXCEPTION 'ABORT: that is the account named for a person, not the hospital''s';
  END IF;

  SELECT count(*) INTO v_n
    FROM public.vouchers v
    JOIN public.voucher_entries e ON e.voucher_id = v.id AND e.credit_amount > 0
   WHERE v.company_id = v_company
     AND v.narration LIKE 'Doctor payout%'
     AND e.account_id = v_charges;

  UPDATE public.voucher_entries e
     SET account_id = v_sbi
    FROM public.vouchers v
   WHERE v.id = e.voucher_id
     AND v.company_id = v_company
     AND v.narration LIKE 'Doctor payout%'
     AND e.credit_amount > 0
     AND e.account_id = v_charges;

  RAISE NOTICE '% doctor payout(s) moved off Bank Charges onto State Bank of India', v_n;
END
$repair$;

-- ------------------------------------------------------- 2. and from now on

INSERT INTO public.company_qr_bank (company_id, account_id, note)
SELECT c.id, a.id, 'Dr M, 19-Aug: SBI is the account payments are made from'
  FROM public.companies c
  JOIN public.chart_of_accounts a
    ON a.company_id = c.id AND a.is_active AND btrim(a.account_name) = 'STATE BANK OF INDIA'
 WHERE c.company_key = 'drm_pvt_ltd'
ON CONFLICT (company_id) DO UPDATE
  SET account_id = EXCLUDED.account_id, note = EXCLUDED.note, updated_at = now();

-- ------------------------------------------------------------------ verify

DO $verify$
DECLARE v_company UUID; v_bad INT; v_unbalanced INT; v_name TEXT;
BEGIN
  SELECT id INTO v_company FROM public.companies WHERE company_key = 'drm_pvt_ltd';

  -- No payout anywhere may credit something that is not a bank or cash.
  SELECT count(*) INTO v_bad
    FROM public.vouchers v
    JOIN public.voucher_entries e ON e.voucher_id = v.id AND e.credit_amount > 0
    JOIN public.chart_of_accounts a ON a.id = e.account_id
   WHERE v.narration LIKE 'Doctor payout%'
     AND lower(COALESCE(a.account_group, '')) NOT LIKE '%bank%'
     AND lower(COALESCE(a.account_group, '')) NOT LIKE '%cash%';
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'ABORT: % payout(s) still credit a non-bank ledger', v_bad;
  END IF;

  SELECT count(*) INTO v_unbalanced FROM (
    SELECT v.id FROM public.vouchers v
      JOIN public.voucher_entries e ON e.voucher_id = v.id
     WHERE v.narration LIKE 'Doctor payout%'
     GROUP BY v.id
    HAVING round(sum(e.debit_amount) - sum(e.credit_amount), 2) <> 0
  ) t;
  IF v_unbalanced > 0 THEN
    RAISE EXCEPTION 'ABORT: % payout voucher(s) no longer balance', v_unbalanced;
  END IF;

  -- The next DRM Hope payout must land on SBI on its own.
  SELECT account_name INTO v_name FROM public.chart_of_accounts
   WHERE id = public.qr_payout_bank_ledger(v_company);
  IF btrim(COALESCE(v_name, '')) <> 'STATE BANK OF INDIA' THEN
    RAISE EXCEPTION 'ABORT: the next DRM Hope payout would go to %', v_name;
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------- read it

SELECT c.company_name,
       a.account_name AS credited,
       count(*)       AS payouts,
       to_char(sum(v.total_amount), 'FM99,99,99,990.00') AS total
  FROM public.vouchers v
  JOIN public.companies c ON c.id = v.company_id
  JOIN public.voucher_entries e ON e.voucher_id = v.id AND e.credit_amount > 0
  JOIN public.chart_of_accounts a ON a.id = e.account_id
 WHERE v.narration LIKE 'Doctor payout%'
 GROUP BY c.company_name, a.account_name
 ORDER BY c.company_name, a.account_name;
