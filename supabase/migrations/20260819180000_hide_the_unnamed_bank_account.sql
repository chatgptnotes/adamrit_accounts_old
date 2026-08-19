-- The account nobody can name is not offered for a statement upload.
--
-- THE INSTRUCTION (19 Aug, Dr M): hide it for now.
--
-- WHAT IT IS. chart_of_accounts HMS_BANK, "Bank Account", in Hope
-- Multispeciality Hospital and Research Center. Created 18-Aug at 12:40 IST
-- with the company itself, alongside HMS_CASH and HMS_PL -- the three-ledger
-- skeleton every new company gets. Nothing has ever been posted in that company:
-- opening balance zero, zero rows in voucher_entries, zero payment vouchers
-- naming it. It is a placeholder nobody has filled in, not an account with a
-- forgotten name.
--
-- WHY HIDE RATHER THAN RENAME. Renaming is safe here -- with no entries and no
-- voucher carrying the name as text there is nothing to break, which is not
-- true of a ledger in use -- but nobody knows which bank it is yet, and the
-- Reconciliation screen would offer Tilak "Bank Account — Hope Multispeciality
-- Hospital and Research Center" with no way to tell whether it is the right
-- one. A statement uploaded against the wrong account is a reconciliation that
-- looks finished and is not.
--
-- REVERSIBLE IN ONE LINE, and it will need reversing the day that company
-- starts trading, because its books are meant to come off Dr Murali's bank
-- statements (see the note in src/lib/cashBookScope.ts). Name the ledger, then:
--
--   UPDATE public.recon_sources SET is_active = true
--    WHERE ledger_id = (SELECT id FROM public.chart_of_accounts
--                        WHERE account_code = 'HMS_BANK');
--
-- MATCHED ON THE ACCOUNT CODE, not the label. HMS_BANK identifies this one
-- ledger exactly; "Bank Account" is the kind of name a second company's
-- skeleton could easily be given too.

DO $hide$
DECLARE v_n INT;
BEGIN
  -- Never hide something a statement has already been uploaded against: that
  -- strands the document behind an account the screen no longer offers.
  IF EXISTS (
    SELECT 1
      FROM public.recon_uploads u
      JOIN public.recon_sources s ON s.id = u.source_id
      JOIN public.chart_of_accounts a ON a.id = s.ledger_id
     WHERE a.account_code = 'HMS_BANK'
  ) THEN
    RAISE EXCEPTION 'ABORT: a statement has already been uploaded against HMS_BANK — decide that deliberately, do not hide it';
  END IF;

  -- Nor if the ledger has started being used since this was written.
  IF EXISTS (
    SELECT 1 FROM public.voucher_entries e
      JOIN public.chart_of_accounts a ON a.id = e.account_id
     WHERE a.account_code = 'HMS_BANK'
  ) THEN
    RAISE EXCEPTION 'ABORT: HMS_BANK now carries ledger entries — it is in use and needs its real name, not hiding';
  END IF;

  UPDATE public.recon_sources s
     SET is_active = false
   WHERE s.kind = 'BANK_ACCOUNT'
     AND s.is_active
     AND EXISTS (
       SELECT 1 FROM public.chart_of_accounts a
        WHERE a.id = s.ledger_id AND a.account_code = 'HMS_BANK'
     );
  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF v_n = 0 THEN
    RAISE NOTICE 'HMS_BANK was already hidden — nothing to do';
  ELSE
    RAISE NOTICE 'HMS_BANK hidden from the bank-statement list (% row)', v_n;
  END IF;
END
$hide$;

-- ------------------------------------------------------------------ verify

DO $verify$
DECLARE v_phones INT; v_drm INT; v_banks INT;
BEGIN
  SELECT count(*) INTO v_phones
    FROM public.recon_sources WHERE kind = 'UPI_PHONE' AND is_active;
  IF v_phones < 3 THEN
    RAISE EXCEPTION 'ABORT: % active phone source(s), expected at least 3', v_phones;
  END IF;

  -- What this morning's work was for must survive every tidy-up.
  SELECT count(*) INTO v_drm
    FROM public.recon_sources s
    JOIN public.chart_of_accounts a ON a.id = s.ledger_id
    JOIN public.companies c ON c.id = a.company_id
   WHERE s.kind = 'BANK_ACCOUNT' AND s.is_active
     AND c.company_key = 'drm_pvt_ltd'
     AND a.account_name ILIKE '%state bank%';
  IF v_drm < 1 THEN
    RAISE EXCEPTION 'ABORT: DRM Hope has lost its State Bank of India account';
  END IF;

  SELECT count(*) INTO v_banks
    FROM public.recon_sources WHERE kind = 'BANK_ACCOUNT' AND is_active;
  IF v_banks < 1 THEN
    RAISE EXCEPTION 'ABORT: no bank accounts left to reconcile against';
  END IF;
  RAISE NOTICE '% bank account(s) offered', v_banks;
END
$verify$;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------- read it
-- The dropdown as it now stands. Everything marked "hidden" is a deliberate
-- decision recorded in a migration, not an omission.

SELECT CASE WHEN s.is_active THEN 'in the dropdown' ELSE 'hidden' END AS shown,
       c.company_name AS company,
       s.label        AS bank_account,
       a.account_code
  FROM public.recon_sources s
  LEFT JOIN public.chart_of_accounts a ON a.id = s.ledger_id
  LEFT JOIN public.companies c ON c.id = a.company_id
 WHERE s.kind = 'BANK_ACCOUNT'
 ORDER BY s.is_active DESC, c.company_name, s.label;
