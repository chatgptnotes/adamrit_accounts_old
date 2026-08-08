-- Point DR JAVED KHAN's RMO duty entries at his own ledger.
--
-- ayushman_rmos."DR JAVED KHAN".ledger_account_id was mapped to the bank head
-- STATE BANK OF INDIA (DRM) (code 1121, company_id NULL). The duty tile derives
-- the posting company from the RMO's party ledger, so a company-less bank head
-- made resolveRmoDutyPosting() return NULL and every duty entry for him failed
-- with "Ledger not ready" — and had that head carried a company, the queued bill
-- would have credited a bank instead of the doctor.
--
-- He is remapped to his Tally ledger "Dr. Javed Khan" in Ayushman Nagpur
-- Hospital (group "RMO Salary", opening Dr 7,11,900), so each duty credit runs
-- against his existing advance rather than opening a second balance for the same
-- person. No RMO-DUTY-JAVED-* bills exist yet, so there is nothing to unwind.
--
-- Only Javed is touched. The other RMO mappings are reported, not changed.
-- Safe to run repeatedly.

DO $$
DECLARE
  v_ayushman  UUID;
  v_ledger    UUID;
  v_matches   INTEGER;
  v_expense   UUID;
  v_mapped    UUID;
  v_company   UUID;
  v_rows      INTEGER;
BEGIN
  SELECT id INTO v_ayushman
    FROM public.companies
   WHERE company_key = 'ayushman_nagpur';
  IF v_ayushman IS NULL THEN
    RAISE EXCEPTION 'No company with company_key = ayushman_nagpur';
  END IF;

  -- Resolve the target ledger by name inside that company. Restricting to the
  -- "RMO Salary" group keeps the patient ledgers named "JAVED KHAN (UHAY26...)"
  -- out of the match; an ambiguous result must fail rather than pick one.
  SELECT count(*) INTO v_matches
    FROM public.chart_of_accounts
   WHERE company_id = v_ayushman
     AND is_active
     AND lower(btrim(account_group)) = 'rmo salary'
     AND lower(btrim(account_name)) = 'dr. javed khan';

  SELECT id INTO v_ledger
    FROM public.chart_of_accounts
   WHERE company_id = v_ayushman
     AND is_active
     AND lower(btrim(account_group)) = 'rmo salary'
     AND lower(btrim(account_name)) = 'dr. javed khan'
   ORDER BY account_code
   LIMIT 1;

  IF v_matches = 0 THEN
    RAISE EXCEPTION 'No active "Dr. Javed Khan" ledger in the RMO Salary group of Ayushman Nagpur Hospital';
  ELSIF v_matches > 1 THEN
    RAISE EXCEPTION '% ledgers named "Dr. Javed Khan" in Ayushman Nagpur Hospital — resolve the duplicate first', v_matches;
  END IF;

  -- The duty bill debits this head; without it the tile still says "Ledger not ready".
  SELECT id INTO v_expense
    FROM public.chart_of_accounts
   WHERE company_id = v_ayushman
     AND is_active
     AND lower(btrim(account_name)) = 'rmo salary expenses'
   ORDER BY account_code
   LIMIT 1;
  IF v_expense IS NULL THEN
    RAISE EXCEPTION 'Ayushman Nagpur Hospital has no active "Rmo Salary Expenses" head';
  END IF;

  UPDATE public.ayushman_rmos
     SET ledger_account_id = v_ledger,
         updated_at = now()
   WHERE lower(btrim(name)) = 'dr javed khan';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'No ayushman_rmos row named "DR JAVED KHAN"';
  END IF;

  -- Self-verify from a fresh read rather than trusting the UPDATE.
  SELECT r.ledger_account_id, a.company_id
    INTO v_mapped, v_company
    FROM public.ayushman_rmos r
    LEFT JOIN public.chart_of_accounts a ON a.id = r.ledger_account_id
   WHERE lower(btrim(r.name)) = 'dr javed khan';

  IF v_mapped IS DISTINCT FROM v_ledger THEN
    RAISE EXCEPTION 'DR JAVED KHAN is still mapped to %, expected %', v_mapped, v_ledger;
  END IF;
  IF v_company IS DISTINCT FROM v_ayushman THEN
    RAISE EXCEPTION 'DR JAVED KHAN''s ledger belongs to company %, expected Ayushman Nagpur Hospital %', v_company, v_ayushman;
  END IF;

  RAISE NOTICE 'DR JAVED KHAN -> ledger % (expense head %)', v_ledger, v_expense;
END;
$$;

-- Report the state of every other RMO mapping without changing any of them.
DO $$
DECLARE
  rec RECORD;
BEGIN
  RAISE NOTICE '--- RMO ledger mappings (report only) ---';
  FOR rec IN
    SELECT 'ayushman' AS roster, r.name, a.account_name, a.account_code, a.account_group, c.company_name
      FROM public.ayushman_rmos r
      LEFT JOIN public.chart_of_accounts a ON a.id = r.ledger_account_id
      LEFT JOIN public.companies c ON c.id = a.company_id
    UNION ALL
    SELECT 'hope', r.name, a.account_name, a.account_code, a.account_group, c.company_name
      FROM public.hope_rmos r
      LEFT JOIN public.chart_of_accounts a ON a.id = r.ledger_account_id
      LEFT JOIN public.companies c ON c.id = a.company_id
    ORDER BY 1, 2
  LOOP
    RAISE NOTICE '% | % -> % | % | % | %',
      rec.roster, btrim(rec.name),
      COALESCE(rec.account_name, '(no ledger)'),
      COALESCE(rec.account_code, '-'),
      COALESCE(rec.account_group, '-'),
      COALESCE(rec.company_name, '(no company)');
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
