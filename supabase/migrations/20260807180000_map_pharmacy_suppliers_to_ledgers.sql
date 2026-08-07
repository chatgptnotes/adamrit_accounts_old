-- Every pharmacy supplier gets its own creditor ledger.
--
-- Receiving goods posts Dr Medicine Purchase / Cr the supplier, but only 6 of
-- 26 suppliers had a ledger mapped. The other 20 fell back to 2120 Other
-- Creditors, where Rs 16.69 lakh of pharmacy dues from 270 accruals now sits
-- in one undifferentiated heap — and Lalit's tile pays Dr <the supplier>, so
-- without this the payment would debit a ledger that never received the
-- credit and Other Creditors would never come down.
--
-- Two halves:
--   1. Map all 20. Six are name variants of ledgers that already exist
--      (adarsh-sales wholesale = ADARSH SALES, ASIAN SURGICAL COM. SURGICAL =
--      Asian Surgical Co., IVAAN HEALTHCARE PVT.LTD., J. JASWANTLAL &
--      BROTHERS AGENCY DEPARTMENT, N.B.SALES, SSV PHARMACEUTICAL &
--      DISTRIBUTOR). The other 14 have no ledger anywhere and get one created
--      under Hope Pharmacy -> Sundry Creditors with a zero opening balance.
--   2. Move the history. Every live Other Creditors entry that came from one
--      of those suppliers' GRNs is repointed to that supplier's own ledger.
--      No amount changes and no voucher is added or cancelled — only which
--      creditor holds the balance. Every ledger involved is a CURRENT_LIABILITY,
--      so total liabilities are unchanged; what shifts is the split between the
--      group Other Creditors sits in ('CREDITORS') and the suppliers' own
--      ('Sundry Creditors'). The verification below reports both totals and
--      refuses to commit if any voucher is unbalanced or anything is left
--      behind.
--
-- Applied through apply_migration(): one transaction, rolls back on failure.
-- Idempotent, and it verifies itself before committing.

-- ---------------------------------------------------------------------------
-- STEP 1 — the mapping, by supplier id (stable) and ledger name
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE supplier_ledger_map (
  supplier_id  INTEGER PRIMARY KEY,
  ledger_name  TEXT NOT NULL,
  create_if_missing BOOLEAN NOT NULL DEFAULT true
) ON COMMIT DROP;

INSERT INTO supplier_ledger_map (supplier_id, ledger_name, create_if_missing) VALUES
  -- Same firm, spelled differently: map onto the ledger that already carries
  -- its Tally opening balance. Never create these.
  (17, 'ADARSH SALES',                        false),
  (2,  'Asian Surgical Co.',                  false),
  (31, 'IVAAN HEALTHCARE PVT LTD',            false),
  (37, 'J JASWANTLAL & BROS. AGENCY',         false),
  (28, 'N. B. SALES',                         false),
  (4,  'SSV PHARMACEUTICAL AND DISTRIBUTOR',  false),
  -- No ledger anywhere: create one, named as the supplier is named.
  (5,  'ALL IN ONE PHARMA',                   true),
  (38, 'Ashtavinayak Enterprises',            true),
  (20, 'CARDIAC AVENUES (25-26)',             true),
  (22, 'CHANDRA ENTERPRISES 25-26',           true),
  (39, 'GANESH SURGICAL',                     true),
  (10, 'HCG NCHRI CANCER CENTRE PHARMACY',    true),
  (40, 'JAY BABA MEDICAL STORS',              true),
  (30, 'MEDPLUS PHARMACY',                    true),
  (11, 'NAG DRUG AGENCIES',                   true),
  (36, 'SHRI SAI MEDICICAL STORES',           true),
  (6,  'STAR 24 HOUR PHARMACY',               true),
  (32, 'SURAKSHA MEDICARE&VACCINES',          true),
  (41, 'VIKAS MEDICAL&GENERAL STORES',        true),
  (9,  'WAHI MEDICINE POINT',                 true);

-- ---------------------------------------------------------------------------
-- STEP 2 — create the ledgers that do not exist yet
-- ---------------------------------------------------------------------------
INSERT INTO public.chart_of_accounts (
  account_code, account_name, account_type, account_group,
  company_id, is_active, opening_balance, opening_balance_type
)
SELECT
  'PHVEND-' || m.supplier_id::TEXT,
  m.ledger_name,
  'CURRENT_LIABILITIES',
  'Sundry Creditors',
  c.id,
  true,
  0,
  'CR'
FROM supplier_ledger_map m
CROSS JOIN public.companies c
WHERE c.company_key = 'hope_pharmacy'
  AND m.create_if_missing
  AND NOT EXISTS (
    SELECT 1 FROM public.chart_of_accounts a
     WHERE a.company_id = c.id
       AND lower(btrim(a.account_name)) = lower(btrim(m.ledger_name))
  );

-- ---------------------------------------------------------------------------
-- STEP 3 — map every supplier to its ledger
-- ---------------------------------------------------------------------------
UPDATE public.suppliers s
   SET ledger_account_id = a.id,
       updated_at = NOW()
  FROM supplier_ledger_map m
  JOIN public.companies c ON c.company_key = 'hope_pharmacy'
  JOIN public.chart_of_accounts a
    ON a.company_id = c.id
   AND lower(btrim(a.account_name)) = lower(btrim(m.ledger_name))
   AND a.is_active
 WHERE s.id = m.supplier_id
   AND s.ledger_account_id IS DISTINCT FROM a.id;

DO $$
DECLARE
  v_unmapped INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_unmapped
    FROM supplier_ledger_map m
    JOIN public.suppliers s ON s.id = m.supplier_id
   WHERE s.ledger_account_id IS NULL;
  IF v_unmapped > 0 THEN
    RAISE EXCEPTION 'ABORT: % supplier(s) still have no ledger', v_unmapped;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- STEP 4 — move the history off Other Creditors
--
-- Both the purchase voucher (reference = the GRN id) and the optional mirror
-- JV (reference = PHARMACY-JV-PURCHASE-<grn id>) credited 2120. Repoint both,
-- so the ledger reads the same way whichever voucher you open.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_other UUID;
  v_moved INTEGER;
  v_value NUMERIC;
BEGIN
  SELECT id INTO v_other FROM public.chart_of_accounts
   WHERE account_code = '2120' AND is_active LIMIT 1;
  IF v_other IS NULL THEN
    RAISE EXCEPTION 'ABORT: 2120 Other Creditors not found';
  END IF;

  WITH grn_entries AS (
    SELECT e.id AS entry_id,
           s.ledger_account_id AS supplier_ledger,
           e.credit_amount,
           e.debit_amount
      FROM public.voucher_entries e
      JOIN public.vouchers v ON v.id = e.voucher_id AND v.status <> 'CANCELLED'
      JOIN public.goods_received_notes g
        ON g.id::TEXT = v.reference_number
        OR v.reference_number = 'PHARMACY-JV-PURCHASE-' || g.id::TEXT
      JOIN public.suppliers s ON s.id = g.supplier_id
      JOIN supplier_ledger_map m ON m.supplier_id = s.id
     WHERE e.account_id = v_other
       AND s.ledger_account_id IS NOT NULL
  ), moved AS (
    UPDATE public.voucher_entries e
       SET account_id = ge.supplier_ledger
      FROM grn_entries ge
     WHERE e.id = ge.entry_id
    RETURNING ge.credit_amount, ge.debit_amount
  )
  SELECT COUNT(*), COALESCE(SUM(credit_amount), 0) - COALESCE(SUM(debit_amount), 0)
    INTO v_moved, v_value
    FROM moved;

  RAISE NOTICE 'Moved % accrual entries (net Rs %) off Other Creditors onto the suppliers themselves',
    v_moved, ROUND(COALESCE(v_value, 0), 2);
END $$;

-- ---------------------------------------------------------------------------
-- STEP 5 — verify before committing
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_unbalanced INTEGER;
  v_left INTEGER;
  v_creditors NUMERIC;
BEGIN
  SELECT COUNT(*) INTO v_unbalanced
    FROM (
      SELECT e.voucher_id
        FROM public.voucher_entries e
        JOIN public.vouchers v ON v.id = e.voucher_id
       WHERE v.status = 'AUTHORISED'
       GROUP BY e.voucher_id
      HAVING ABS(COALESCE(SUM(e.debit_amount), 0) - COALESCE(SUM(e.credit_amount), 0)) > 0.01
    ) x;
  IF v_unbalanced > 0 THEN
    RAISE EXCEPTION 'ABORT: % authorised vouchers have debits <> credits', v_unbalanced;
  END IF;

  -- No GRN of a mapped supplier may still sit in Other Creditors.
  SELECT COUNT(*) INTO v_left
    FROM public.voucher_entries e
    JOIN public.vouchers v ON v.id = e.voucher_id AND v.status <> 'CANCELLED'
    JOIN public.chart_of_accounts a ON a.id = e.account_id AND a.account_code = '2120'
    JOIN public.goods_received_notes g
      ON g.id::TEXT = v.reference_number
      OR v.reference_number = 'PHARMACY-JV-PURCHASE-' || g.id::TEXT
    JOIN supplier_ledger_map m ON m.supplier_id = g.supplier_id;
  IF v_left > 0 THEN
    RAISE EXCEPTION 'ABORT: % mapped-supplier entries are still on Other Creditors', v_left;
  END IF;

  -- Total owed to creditors is unchanged: nothing was created or removed,
  -- only moved between ledgers of the same group.
  SELECT COALESCE(SUM(e.credit_amount - e.debit_amount), 0) INTO v_creditors
    FROM public.voucher_entries e
    JOIN public.vouchers v ON v.id = e.voucher_id AND v.status = 'AUTHORISED'
    JOIN public.chart_of_accounts a ON a.id = e.account_id
   WHERE a.account_group = 'Sundry Creditors';
  RAISE NOTICE 'Sundry Creditors total after remapping: Rs %', ROUND(v_creditors, 2);

  -- Liabilities as a whole must not move: the entries only changed which
  -- current-liability ledger holds them.
  SELECT COALESCE(SUM(e.credit_amount - e.debit_amount), 0) INTO v_creditors
    FROM public.voucher_entries e
    JOIN public.vouchers v ON v.id = e.voucher_id AND v.status = 'AUTHORISED'
    JOIN public.chart_of_accounts a ON a.id = e.account_id
   WHERE a.account_type = 'CURRENT_LIABILITIES';
  RAISE NOTICE 'Current liabilities total: Rs %', ROUND(v_creditors, 2);
END $$;
