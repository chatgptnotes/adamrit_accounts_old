-- Make every RMO duty postable in the company belonging to its RMO master.
--
-- The duty tile credits the RMO's own party ledger and debits the matching
-- company expense head. Older data relied on both being created manually,
-- which left the tile showing "Ledger not ready" for otherwise valid RMOs.
--
-- The first version of this file compared names with lower(btrim(name)) while
-- chart_of_accounts_active_name_uniq indexes on
--   lower(btrim(regexp_replace(account_name, '[^a-zA-Z0-9]+', ' ', 'g')))
-- so "DR JAVED KHAN" looked new next to the existing "Dr. Javed Khan" and the
-- insert died on the unique index. Every name comparison below now uses the
-- index's own normalization — the same fix 20260805160000 made to
-- record_rupali_visit.
--
-- A mapping that is already sound is left alone: RMO ledgers are often named
-- differently from the roster ("DR GAURAV RAJPUT" -> "Dr. Gaurav Pratap Singh"),
-- so only mappings that are inactive, in the wrong company, or pointed at a
-- bank/cash/expense head are rebuilt.
--
-- Safe to run repeatedly.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE company_key = 'drm_pvt_ltd')
     OR NOT EXISTS (SELECT 1 FROM public.companies WHERE company_key = 'ayushman_nagpur') THEN
    RAISE EXCEPTION 'RMO duty setup requires the drm_pvt_ltd and ayushman_nagpur companies';
  END IF;
END;
$$;

INSERT INTO public.ayushman_rmos (name)
SELECT 'Dr. Radhemohan'
WHERE NOT EXISTS (
  SELECT 1
    FROM public.ayushman_rmos
   WHERE lower(btrim(regexp_replace(name, '[^a-zA-Z0-9]+', ' ', 'g'))) = 'dr radhemohan'
);

-- ── One active "Rmo Salary Expenses" head in each hospital's books ──────────
INSERT INTO public.chart_of_accounts
  (account_code, account_name, account_type, account_group,
   company_id, opening_balance, opening_balance_type, is_active)
SELECT 'RMOEXP' || upper(substr(md5(c.id::TEXT || 'rmo salary expenses'), 1, 8)),
       'Rmo Salary Expenses', 'INDIRECT_EXPENSES', 'Indirect Expenses',
       c.id, 0, 'DR', true
  FROM public.companies c
 WHERE c.company_key IN ('drm_pvt_ltd', 'ayushman_nagpur')
   AND NOT EXISTS (
     SELECT 1
       FROM public.chart_of_accounts a
      WHERE a.company_id = c.id
        AND a.is_active
        AND lower(btrim(regexp_replace(a.account_name, '[^a-zA-Z0-9]+', ' ', 'g')))
            = 'rmo salary expenses'
   )
ON CONFLICT (account_code) DO NOTHING;

-- ── Both rosters, each with the company its duties post in ──────────────────
CREATE TEMP TABLE rmo_roster ON COMMIT DROP AS
SELECT 'ayushman'::TEXT AS roster,
       r.id             AS rmo_id,
       btrim(r.name)    AS rmo_name,
       lower(btrim(regexp_replace(r.name, '[^a-zA-Z0-9]+', ' ', 'g'))) AS rmo_norm,
       (SELECT id FROM public.companies WHERE company_key = 'ayushman_nagpur') AS company_id,
       r.ledger_account_id,
       false AS keep
  FROM public.ayushman_rmos r
 WHERE btrim(COALESCE(r.name, '')) <> ''
UNION ALL
SELECT 'hope',
       r.id,
       btrim(r.name),
       lower(btrim(regexp_replace(r.name, '[^a-zA-Z0-9]+', ' ', 'g'))),
       (SELECT id FROM public.companies WHERE company_key = 'drm_pvt_ltd'),
       r.ledger_account_id,
       false
  FROM public.hope_rmos r
 WHERE btrim(COALESCE(r.name, '')) <> '';

-- A mapping is kept when it points at an active party ledger in the right
-- company. Bank, cash and expense heads are never a person's ledger — that is
-- how the duty tile ended up crediting STATE BANK OF INDIA (DRM).
UPDATE rmo_roster t
   SET keep = true
  FROM public.chart_of_accounts a
 WHERE a.id = t.ledger_account_id
   AND a.is_active
   AND a.company_id = t.company_id
   AND COALESCE(a.account_group, '') !~* '^(bank|cash)'
   AND a.account_type NOT IN ('DIRECT_EXPENSES', 'INDIRECT_EXPENSES')
   AND lower(btrim(regexp_replace(a.account_name, '[^a-zA-Z0-9]+', ' ', 'g')))
       <> 'rmo salary expenses';

-- ── Create a party ledger for every RMO that still needs one ────────────────
-- DISTINCT ON collapses roster rows that normalize to the same name, which the
-- unique index would otherwise reject mid-statement.
INSERT INTO public.chart_of_accounts
  (account_code, account_name, account_type, account_group,
   company_id, opening_balance, opening_balance_type, is_active)
SELECT DISTINCT ON (t.company_id, t.rmo_norm)
       'RMO' || upper(substr(md5(t.company_id::TEXT || t.rmo_norm), 1, 8)),
       t.rmo_name, 'CURRENT_LIABILITIES', 'Sundry Creditors',
       t.company_id, 0, 'CR', true
  FROM rmo_roster t
 WHERE NOT t.keep
   AND NOT EXISTS (
     SELECT 1
       FROM public.chart_of_accounts a
      WHERE a.company_id = t.company_id
        AND a.is_active
        AND lower(btrim(regexp_replace(a.account_name, '[^a-zA-Z0-9]+', ' ', 'g'))) = t.rmo_norm
   )
 ORDER BY t.company_id, t.rmo_norm, t.rmo_name
ON CONFLICT (account_code) DO NOTHING;

-- ── Point the rebuilt mappings at the ledger of the same name ───────────────
-- The unique index guarantees at most one active match per company, so the
-- join cannot pick arbitrarily.
UPDATE public.ayushman_rmos r
   SET ledger_account_id = a.id,
       updated_at = now()
  FROM rmo_roster t
  JOIN public.chart_of_accounts a
    ON a.company_id = t.company_id
   AND a.is_active
   AND lower(btrim(regexp_replace(a.account_name, '[^a-zA-Z0-9]+', ' ', 'g'))) = t.rmo_norm
 WHERE t.roster = 'ayushman'
   AND t.rmo_id = r.id
   AND NOT t.keep
   AND r.ledger_account_id IS DISTINCT FROM a.id;

UPDATE public.hope_rmos r
   SET ledger_account_id = a.id,
       updated_at = now()
  FROM rmo_roster t
  JOIN public.chart_of_accounts a
    ON a.company_id = t.company_id
   AND a.is_active
   AND lower(btrim(regexp_replace(a.account_name, '[^a-zA-Z0-9]+', ' ', 'g'))) = t.rmo_norm
 WHERE t.roster = 'hope'
   AND t.rmo_id = r.id
   AND NOT t.keep
   AND r.ledger_account_id IS DISTINCT FROM a.id;

-- ── Existing pending duty bills become approvable immediately ───────────────
UPDATE public.approval_queue q
   SET company_id = party.company_id,
       expense_account_id = expense.id
  FROM public.chart_of_accounts party
  JOIN LATERAL (
    SELECT a.id
      FROM public.chart_of_accounts a
     WHERE a.company_id = party.company_id
       AND a.is_active
       AND lower(btrim(regexp_replace(a.account_name, '[^a-zA-Z0-9]+', ' ', 'g')))
           = 'rmo salary expenses'
     ORDER BY a.account_code
     LIMIT 1
  ) expense ON true
 WHERE q.reference_no LIKE 'RMO-DUTY-%'
   AND q.status = 'PENDING'
   AND q.is_paid = false
   AND q.party_account_id = party.id
   AND (q.company_id IS NULL OR q.expense_account_id IS NULL);

-- ── Proof ──────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_bad   INTEGER;
  v_stuck INTEGER;
  rec     RECORD;
BEGIN
  SELECT count(*) INTO v_bad
    FROM (
      SELECT id FROM public.ayushman_rmos WHERE ledger_account_id IS NULL
      UNION ALL
      SELECT id FROM public.hope_rmos WHERE ledger_account_id IS NULL
    ) missing;
  IF v_bad > 0 THEN
    RAISE EXCEPTION '% RMO master row(s) still have no ledger', v_bad;
  END IF;

  -- Every mapping must now be an active ledger in its own hospital's company.
  SELECT count(*) INTO v_bad
    FROM (
      SELECT r.name, r.ledger_account_id,
             (SELECT id FROM public.companies WHERE company_key = 'ayushman_nagpur') AS company_id
        FROM public.ayushman_rmos r
      UNION ALL
      SELECT r.name, r.ledger_account_id,
             (SELECT id FROM public.companies WHERE company_key = 'drm_pvt_ltd')
        FROM public.hope_rmos r
    ) m
    LEFT JOIN public.chart_of_accounts a ON a.id = m.ledger_account_id
   WHERE a.id IS NULL
      OR NOT a.is_active
      OR a.company_id IS DISTINCT FROM m.company_id
      OR COALESCE(a.account_group, '') ~* '^(bank|cash)'
      OR a.account_type IN ('DIRECT_EXPENSES', 'INDIRECT_EXPENSES');
  IF v_bad > 0 THEN
    RAISE EXCEPTION '% RMO mapping(s) still point outside their company or at a bank/expense head', v_bad;
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

  RAISE NOTICE '--- RMO ledger mappings ---';
  FOR rec IN
    SELECT 'ayushman' AS roster, r.name, a.account_name, a.account_code
      FROM public.ayushman_rmos r
      JOIN public.chart_of_accounts a ON a.id = r.ledger_account_id
    UNION ALL
    SELECT 'hope', r.name, a.account_name, a.account_code
      FROM public.hope_rmos r
      JOIN public.chart_of_accounts a ON a.id = r.ledger_account_id
    ORDER BY 1, 2
  LOOP
    RAISE NOTICE '% | % -> % · %', rec.roster, btrim(rec.name), rec.account_name, rec.account_code;
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
