-- Hope Multispeciality Hospital and Research Center joins the books.
--
-- THE INSTRUCTION (18 Aug, Dr M): add another company in accounting — Hope
-- Multispeciality Hospital and Research Center, a proprietary concern of
-- Dr Murali BK. All transactions are to be updated from his bank statements.
--
-- ADDITIVE ONLY. A new company cannot disturb the existing books: every
-- voucher, ledger and report is scoped by company_id, so the four companies
-- already closing to zero are untouched. Nothing here posts a single entry.
--
-- NO OPENING BALANCES, DELIBERATELY. None were given, and an invented opening
-- is indistinguishable from a real one once it is in the books. The concern
-- opens at zero and the balances arrive with the bank statements. The
-- restatement pattern from 4-Aug is how they should be loaded when they come.
--
-- THE BANK LEDGER IS NAMED GENERICALLY for the same reason: Dr M has not said
-- which bank, and a ledger resolved by name is how money lands in the wrong
-- account (money rule 6 — never resolve a ledger by name alone). Renaming one
-- ledger later is trivial; unpicking entries posted to the wrong bank is not.
--
-- NOT ADDED TO THE COUNTER CASH BOOK. That screen reports money taken over a
-- counter, keyed to a hospital's patients. This concern has no counter — its
-- transactions arrive from a bank statement and post as vouchers, so they
-- belong in the Day Book and the ledgers, not in the cash book. Its entry in
-- src/lib/cashBookScope.ts says so explicitly rather than leaving it to the
-- unknown-company fallback.

DO $change$
DECLARE
  v_company UUID;
BEGIN
  SELECT id INTO v_company FROM public.companies WHERE company_key = 'hope_multispeciality';

  IF v_company IS NULL THEN
    INSERT INTO public.companies
      (company_key, company_name, company_type, owner_partners, is_active)
    VALUES
      ('hope_multispeciality',
       'Hope Multispeciality Hospital and Research Center',
       'Proprietorship',
       'Dr. B.K. Murali',
       true)
    RETURNING id INTO v_company;
  END IF;

  -- A company with no ledgers cannot be selected anywhere useful. These three
  -- are the minimum to open a book: somewhere for cash, somewhere for the bank
  -- the statements come from, and the P&L the year closes into.
  INSERT INTO public.chart_of_accounts
    (account_code, account_name, account_type, account_group,
     opening_balance, opening_balance_type, company_id, is_active)
  SELECT v.code, v.name, v.atype, v.agroup, 0, 'DR', v_company, true
    FROM (VALUES
      ('HMS_CASH', 'Cash',            'CURRENT_ASSETS', 'Cash-in-Hand'),
      ('HMS_BANK', 'Bank Account',    'CURRENT_ASSETS', 'Bank Accounts'),
      ('HMS_PL',   'Profit & Loss A/c','CURRENT_ASSETS', 'Primary')
    ) AS v(code, name, atype, agroup)
   WHERE NOT EXISTS (
     SELECT 1 FROM public.chart_of_accounts c
      WHERE c.company_id = v_company AND c.account_name = v.name
   );
END
$change$;

DO $verify$
DECLARE
  v_company UUID;
  v_n INT;
  v_vouchers INT;
BEGIN
  SELECT id INTO v_company FROM public.companies
   WHERE company_key = 'hope_multispeciality' AND is_active;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'ABORT: the company was not created';
  END IF;

  SELECT count(*) INTO v_n FROM public.chart_of_accounts
   WHERE company_id = v_company AND is_active;
  IF v_n < 3 THEN
    RAISE EXCEPTION 'ABORT: the new company has only % ledger(s)', v_n;
  END IF;

  -- It must open empty. Anything posted here already would mean this ran
  -- against a company that was not new.
  SELECT count(*) INTO v_vouchers FROM public.vouchers WHERE company_id = v_company;
  IF v_vouchers > 0 THEN
    RAISE EXCEPTION 'ABORT: % voucher(s) already exist against the new company', v_vouchers;
  END IF;

  SELECT count(*) INTO v_n FROM public.chart_of_accounts
   WHERE company_id = v_company AND opening_balance <> 0;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'ABORT: % ledger(s) opened with a balance nobody supplied', v_n;
  END IF;

  -- The companies that already balance must not have been touched.
  SELECT count(*) INTO v_n FROM public.companies WHERE is_active;
  IF v_n < 5 THEN
    RAISE EXCEPTION 'ABORT: only % active companies remain', v_n;
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
