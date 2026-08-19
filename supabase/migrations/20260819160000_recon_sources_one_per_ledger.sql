-- Two companies may bank with the same bank.
--
-- THE INSTRUCTION (19 Aug, Dr M): the SBI account of DRM Hope Hospital Private
-- Limited is not in the Reconciliation dropdown.
--
-- IT WAS NEVER ALLOWED TO BE. recon_sources carries
--
--   CREATE UNIQUE INDEX recon_sources_label_uidx ON recon_sources (lower(btrim(label)))
--
-- and the bank accounts were seeded with the bare ledger name as the label
-- (20260807300000:28-40). So the first company to claim "State Bank of India"
-- claimed it for the whole hospital group, and no second row could ever exist.
-- The seed knew it, which is why it reads
--
--   SELECT DISTINCT ON (lower(btrim(a.account_name))) ... ORDER BY ..., c.company_name
--
-- One row per bank NAME, and where two companies share a name the winner is
-- decided by alphabetical order of company. "Ayushman Nagpur Hospital" sorts
-- before "DRM Hope Hospital Private Limited", so Ayushman took State Bank of
-- India, Saraswat Bank, TJSB, Shikshak Sahakari and Pusad Urban, and DRM Hope's
-- own accounts of those names were silently discarded. That is exactly what the
-- dropdown shows: everything DRM-side is a Canara account, because only the
-- Canara names happen to differ between the two companies.
--
-- THE LABEL IS THE WRONG THING TO BE UNIQUE ON. A ledger is. The screen already
-- prints the company beside the label (ReconciliationTilakFlow.tsx:281-286), so
-- two rows named "State Bank of India" read as two different accounts without
-- any change to the label or the screen. Uniqueness moves to the ledger, which
-- is what actually may not appear twice; phones keep theirs by name, which is
-- how PhonePeUploadFlow finds them.
--
-- THE GROUP FILTER WIDENS TOO. The seed matched account_group IN ('Bank
-- Accounts', 'BANK') exactly, so a bank ledger filed under any other spelling
-- was never a candidate at all. Matched on a pattern now, against the group and
-- the type. "Bank Charges" is an indirect expense and does not match either.
--
-- AND IT IS RE-RUNNABLE. The seed ran once, in August. Every bank ledger opened
-- since has been invisible here and would have stayed invisible. Running this
-- again picks up whatever has been added.

-- --------------------------------------------------- 1. uniqueness that fits

DROP INDEX IF EXISTS public.recon_sources_label_uidx;

-- One source per ledger. This is the real rule: the same bank ledger must not
-- be reconciled from two places.
CREATE UNIQUE INDEX IF NOT EXISTS recon_sources_ledger_uidx
  ON public.recon_sources (ledger_id)
  WHERE ledger_id IS NOT NULL;

-- Phones are still found by name (20260807290000:111), so they keep the old
-- rule among themselves.
CREATE UNIQUE INDEX IF NOT EXISTS recon_sources_phone_label_uidx
  ON public.recon_sources (lower(btrim(label)))
  WHERE kind = 'UPI_PHONE';

-- ------------------------------------------------ 2. the accounts left behind

WITH added AS (
  INSERT INTO public.recon_sources (label, kind, ledger_id, holder)
  SELECT a.account_name, 'BANK_ACCOUNT', a.id, c.company_name
    FROM public.chart_of_accounts a
    JOIN public.companies c ON c.id = a.company_id
   WHERE a.is_active
     AND c.is_active
     AND (COALESCE(a.account_group, '') ILIKE '%bank%'
          OR COALESCE(a.account_type, '') ILIKE '%bank%')
     AND NOT EXISTS (
       SELECT 1 FROM public.recon_sources s WHERE s.ledger_id = a.id
     )
  RETURNING label, holder
)
SELECT count(*) AS bank_accounts_added FROM added;

-- ------------------------------------------------------------------ 3. verify

DO $verify$
DECLARE v_phones INT; v_banks INT; v_dupes INT;
BEGIN
  -- The phones must be untouched: they are how three people hand in a day's
  -- history, and this migration has no business near them.
  SELECT count(*) INTO v_phones
    FROM public.recon_sources WHERE kind = 'UPI_PHONE' AND is_active;
  IF v_phones < 3 THEN
    RAISE EXCEPTION 'ABORT: % active phone source(s), expected at least 3', v_phones;
  END IF;

  SELECT count(*) INTO v_banks
    FROM public.recon_sources WHERE kind = 'BANK_ACCOUNT' AND is_active;
  IF v_banks < 1 THEN
    RAISE EXCEPTION 'ABORT: no bank accounts at all';
  END IF;

  -- No ledger may be reconciled from two sources.
  SELECT count(*) INTO v_dupes FROM (
    SELECT ledger_id FROM public.recon_sources
     WHERE ledger_id IS NOT NULL GROUP BY ledger_id HAVING count(*) > 1
  ) d;
  IF v_dupes > 0 THEN
    RAISE EXCEPTION 'ABORT: % ledger(s) appear as more than one source', v_dupes;
  END IF;

  RAISE NOTICE '% bank account(s) now reconcilable across % phone(s)', v_banks, v_phones;
END
$verify$;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------- 4. read it
-- The last result is what the dashboard shows, and NOTICEs are not displayed
-- there. This is the answer to the question that was asked: every bank account
-- the dropdown will now offer, and which company's book it belongs to.

SELECT c.company_name AS company,
       s.label        AS bank_account,
       a.account_group,
       CASE WHEN s.is_active THEN 'in the dropdown' ELSE 'hidden' END AS shown
  FROM public.recon_sources s
  LEFT JOIN public.chart_of_accounts a ON a.id = s.ledger_id
  LEFT JOIN public.companies c ON c.id = a.company_id
 WHERE s.kind = 'BANK_ACCOUNT'
 ORDER BY c.company_name, s.label;
