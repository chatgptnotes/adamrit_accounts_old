-- Tidy the two oddities the reconciliation list turned up.
--
-- THE INSTRUCTION (19 Aug, Dr M): tidy them.
--
-- Both appeared because 20260819160000 widened the bank filter from two exact
-- group spellings to a pattern and became re-runnable. That was right -- it is
-- what put DRM Hope's SBI back -- but it also swept in two ledgers nobody would
-- upload a monthly bank statement against.
--
-- 1. "Pharmacy UPI" (Hope Pharmacy). A UPI settlement account, not a bank whose
--    statement anyone reconciles here. It had no row before this morning, so
--    hiding it puts that ledger back exactly where it was rather than taking
--    something away. is_active = false, not a delete: the row keeps its id, so
--    if a statement ever is uploaded against it the history is still intact and
--    one UPDATE brings it back.
--
-- 2. "Bank Account" (Hope Multispeciality Hospital and Research Center). This
--    one is NOT renamed here, deliberately. The LEDGER name is what would have
--    to change, and a ledger name is resolved BY NAME in the money paths --
--    payment_voucher_cash_ledger matches on lower(btrim(account_name))
--    (20260814360000:47-58) -- while the active-name unique index ignores
--    punctuation, which has produced 23505 duplicate-key twice before. Renaming
--    it is a one-line change and a safe one, but only once somebody says which
--    bank it is, and inventing a name for an account in the book of record is
--    not a tidy-up. The last statement below reports what the database knows
--    about it so that question can be answered from facts.

-- ------------------------------------------------------------ 1. hide the UPI

DO $tidy$
DECLARE v_n INT;
BEGIN
  UPDATE public.recon_sources s
     SET is_active = false
   WHERE s.kind = 'BANK_ACCOUNT'
     AND s.is_active
     AND EXISTS (
       SELECT 1 FROM public.chart_of_accounts a
        WHERE a.id = s.ledger_id
          AND lower(btrim(a.account_name)) = 'pharmacy upi'
     );
  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF v_n = 0 THEN
    RAISE NOTICE 'Pharmacy UPI was already hidden — nothing to do';
  ELSE
    RAISE NOTICE 'Pharmacy UPI hidden from the bank-statement list (% row)', v_n;
  END IF;

  -- Nothing may be hidden that a statement has already been uploaded against:
  -- that would strand the upload behind an account the screen no longer offers.
  IF EXISTS (
    SELECT 1 FROM public.recon_uploads u
      JOIN public.recon_sources s ON s.id = u.source_id
     WHERE NOT s.is_active AND s.kind = 'BANK_ACCOUNT'
  ) THEN
    RAISE EXCEPTION 'ABORT: a hidden bank account already has uploads against it — unhide it and decide deliberately';
  END IF;
END
$tidy$;

-- ------------------------------------------------------------------ 2. verify

DO $verify$
DECLARE v_banks INT; v_phones INT; v_drm INT;
BEGIN
  SELECT count(*) INTO v_phones
    FROM public.recon_sources WHERE kind = 'UPI_PHONE' AND is_active;
  IF v_phones < 3 THEN
    RAISE EXCEPTION 'ABORT: % active phone source(s), expected at least 3', v_phones;
  END IF;

  -- The thing this morning's work was for must still be there.
  SELECT count(*) INTO v_drm
    FROM public.recon_sources s
    JOIN public.chart_of_accounts a ON a.id = s.ledger_id
    JOIN public.companies c ON c.id = a.company_id
   WHERE s.kind = 'BANK_ACCOUNT' AND s.is_active
     AND c.company_key = 'drm_pvt_ltd'
     AND a.account_name ILIKE '%state bank%';
  IF v_drm < 1 THEN
    RAISE EXCEPTION 'ABORT: DRM Hope has lost its State Bank of India account again';
  END IF;

  SELECT count(*) INTO v_banks
    FROM public.recon_sources WHERE kind = 'BANK_ACCOUNT' AND is_active;
  RAISE NOTICE '% bank account(s) offered, DRM Hope''s SBI among them', v_banks;
END
$verify$;

NOTIFY pgrst, 'reload schema';

-- --------------------------------------------------------------- 3. read it
-- The dropdown as it now stands, plus everything known about the generically
-- named ledger so it can be named properly in a follow-up.

SELECT c.company_name                      AS company,
       s.label                             AS bank_account,
       a.account_code,
       a.account_group,
       CASE WHEN s.is_active THEN 'in the dropdown' ELSE 'hidden' END AS shown,
       (SELECT count(*) FROM public.voucher_entries e WHERE e.account_id = a.id)
                                           AS ledger_entries
  FROM public.recon_sources s
  LEFT JOIN public.chart_of_accounts a ON a.id = s.ledger_id
  LEFT JOIN public.companies c ON c.id = a.company_id
 WHERE s.kind = 'BANK_ACCOUNT'
 ORDER BY s.is_active DESC, c.company_name, s.label;
