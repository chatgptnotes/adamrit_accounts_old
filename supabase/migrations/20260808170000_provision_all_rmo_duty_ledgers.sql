-- Make every RMO duty postable in the company belonging to its RMO master.
--
-- The duty tile credits the RMO's own party ledger and debits the matching
-- company expense head. Older data relied on both being created manually,
-- which left the tile showing "Ledger not ready" for otherwise valid RMOs.
-- This migration is safe to run repeatedly.

INSERT INTO public.ayushman_rmos (name)
SELECT 'Dr. Radhemohan'
WHERE NOT EXISTS (
  SELECT 1
    FROM public.ayushman_rmos
   WHERE lower(btrim(name)) = lower('Dr. Radhemohan')
);

DO $$
DECLARE
  v_drm UUID;
  v_ayushman UUID;
  v_next_code INTEGER;
  v_company UUID;
  v_expense UUID;
BEGIN
  SELECT id INTO v_drm
    FROM public.companies
   WHERE company_key = 'drm_pvt_ltd';
  SELECT id INTO v_ayushman
    FROM public.companies
   WHERE company_key = 'ayushman_nagpur';

  IF v_drm IS NULL OR v_ayushman IS NULL THEN
    RAISE EXCEPTION 'RMO duty setup requires drm_pvt_ltd and ayushman_nagpur companies';
  END IF;

  -- There must be one active RMO salary expense head in each hospital's books.
  FOREACH v_company IN ARRAY ARRAY[v_drm, v_ayushman]
  LOOP
    SELECT id INTO v_expense
      FROM public.chart_of_accounts
     WHERE company_id = v_company
       AND lower(btrim(account_name)) = 'rmo salary expenses'
     ORDER BY is_active DESC, account_code
     LIMIT 1;

    IF v_expense IS NULL THEN
      SELECT COALESCE(MAX(substring(account_code FROM '^RMOEXP_([0-9]+)$')::INTEGER), 0) + 1
        INTO v_next_code
        FROM public.chart_of_accounts
       WHERE account_code ~ '^RMOEXP_[0-9]+$';

      INSERT INTO public.chart_of_accounts
        (account_code, account_name, account_type, account_group,
         company_id, opening_balance, opening_balance_type, is_active)
      VALUES
        ('RMOEXP_' || lpad(v_next_code::TEXT, 6, '0'),
         'Rmo Salary Expenses', 'INDIRECT_EXPENSES', 'Indirect Expenses',
         v_company, 0, 'DR', true)
      RETURNING id INTO v_expense;
    ELSE
      UPDATE public.chart_of_accounts
         SET account_name = 'Rmo Salary Expenses',
             account_type = 'INDIRECT_EXPENSES',
             account_group = COALESCE(account_group, 'Indirect Expenses'),
             is_active = true,
             updated_at = now()
       WHERE id = v_expense;
    END IF;
  END LOOP;

  -- Create party ledgers for every RMO whose name is not already present in
  -- the correct hospital company. Codes are globally unique in this schema.
  SELECT COALESCE(MAX(substring(account_code FROM '^RMO_([0-9]+)$')::INTEGER), 0)
    INTO v_next_code
    FROM public.chart_of_accounts
   WHERE account_code ~ '^RMO_[0-9]+$';

  INSERT INTO public.chart_of_accounts
    (account_code, account_name, account_type, account_group,
     company_id, opening_balance, opening_balance_type, is_active)
  SELECT 'RMO_' || lpad((v_next_code + row_number() OVER (ORDER BY source, name))::INTEGER::TEXT, 6, '0'),
         name, 'CURRENT_LIABILITIES', 'Sundry Creditors', company_id, 0, 'CR', true
    FROM (
      SELECT 'ayushman'::TEXT AS source, btrim(name) AS name, v_ayushman AS company_id
        FROM public.ayushman_rmos
       WHERE btrim(COALESCE(name, '')) <> ''
      UNION ALL
      SELECT 'hope'::TEXT AS source, btrim(name) AS name, v_drm AS company_id
        FROM public.hope_rmos
       WHERE btrim(COALESCE(name, '')) <> ''
    ) r
   WHERE NOT EXISTS (
     SELECT 1
       FROM public.chart_of_accounts a
      WHERE a.company_id = r.company_id
        AND lower(btrim(a.account_name)) = lower(r.name)
   );

  -- Point both RMO masters at a ledger in their own hospital company. This
  -- also corrects an old cross-company mapping without touching the ledger.
  UPDATE public.ayushman_rmos r
     SET ledger_account_id = a.id,
         updated_at = now()
    FROM public.chart_of_accounts a
   WHERE btrim(r.name) <> ''
     AND a.company_id = v_ayushman
     AND a.is_active
     AND lower(btrim(a.account_name)) = lower(btrim(r.name));

  UPDATE public.hope_rmos r
     SET ledger_account_id = a.id,
         updated_at = now()
    FROM public.chart_of_accounts a
   WHERE btrim(r.name) <> ''
     AND a.company_id = v_drm
     AND a.is_active
     AND lower(btrim(a.account_name)) = lower(btrim(r.name));

  -- Existing pending duty bills become approvable immediately.
  UPDATE public.approval_queue q
     SET company_id = party.company_id,
         expense_account_id = expense.id
    FROM public.chart_of_accounts party
    JOIN LATERAL (
      SELECT a.id
        FROM public.chart_of_accounts a
       WHERE a.company_id = party.company_id
         AND a.is_active
         AND lower(btrim(a.account_name)) = 'rmo salary expenses'
       ORDER BY a.account_code
       LIMIT 1
    ) expense ON true
   WHERE q.reference_no LIKE 'RMO-DUTY-%'
     AND q.status = 'PENDING'
     AND q.is_paid = false
     AND q.party_account_id = party.id
     AND (q.company_id IS NULL OR q.expense_account_id IS NULL);
END;
$$;

DO $$
DECLARE
  v_unmapped INTEGER;
  v_stuck INTEGER;
BEGIN
  SELECT count(*) INTO v_unmapped
    FROM (
      SELECT ledger_account_id FROM public.hope_rmos WHERE ledger_account_id IS NULL
      UNION ALL
      SELECT ledger_account_id FROM public.ayushman_rmos WHERE ledger_account_id IS NULL
    ) missing;
  IF v_unmapped > 0 THEN
    RAISE EXCEPTION '% RMO master row(s) still have no ledger', v_unmapped;
  END IF;

  SELECT count(*) INTO v_stuck
    FROM public.approval_queue
   WHERE reference_no LIKE 'RMO-DUTY-%'
     AND status = 'PENDING'
     AND is_paid = false
     AND party_account_id IS NOT NULL
     AND (company_id IS NULL OR expense_account_id IS NULL);
  IF v_stuck > 0 THEN
    RAISE EXCEPTION '% pending RMO duty bill(s) still cannot be approved', v_stuck;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
