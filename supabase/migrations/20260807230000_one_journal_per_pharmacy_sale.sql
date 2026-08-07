-- One journal per pharmacy sale, not three.
--
-- Two older triggers on pharmacy_sales were still posting alongside the
-- invoice JV added in 20260807100000, so a single bill produced three
-- vouchers in the Day Book:
--
--   SV009x  PHARM-CR-<sale>        accrue_pharmacy_credit_sale
--                                  Dr Pharmacy Debtors / Cr Medicine Sales
--                                  — a real voucher, so the income and the
--                                    debtor were counted TWICE
--   JV08xx  PHARMACY-JV-SALE-<sale> create_optional_pharmacy_sale_jv
--                                  the same entry again, flagged optional, so
--                                  it stays out of the balances but doubles
--                                  every line on screen
--   JV08xx  PHARMACY-INV-<sale>    the invoice JV, which is the one to keep
--
-- The invoice rail now covers every sale — paid, credit or unpaid — and the
-- receipt covers the money, so both older triggers are retired. Their
-- functions are left in place, unused, in case anything else references them.
--
-- Then the duplicates are withdrawn: the 5 real PHARM-CR accruals worth
-- Rs 2,197 that overstated Pharmacy Debtors and Medicine Sales, and the 198
-- optional mirrors of bills that already have an invoice JV. Optional mirrors
-- for older bills with no invoice JV are left alone — they are the only record
-- of those and they never counted in a balance.
--
-- Applied through apply_migration(): one transaction, rolls back on failure.
-- Idempotent, and it verifies itself before committing.

-- ---------------------------------------------------------------------------
-- STEP 1 — stop the two older rails
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_accrue_pharmacy_credit_sale ON public.pharmacy_sales;
DROP TRIGGER IF EXISTS trg_optional_pharmacy_sale_jv ON public.pharmacy_sales;

-- ---------------------------------------------------------------------------
-- STEP 2 — withdraw what they already double-posted
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_real INTEGER;
  v_value NUMERIC;
  v_optional INTEGER;
BEGIN
  WITH dup AS (
    SELECT v.id, v.total_amount
      FROM public.vouchers v
      JOIN public.vouchers inv
        ON inv.reference_number = 'PHARMACY-INV-' || split_part(v.reference_number, '-', 3)
       AND inv.status <> 'CANCELLED'
     WHERE v.status <> 'CANCELLED'
       AND v.reference_number LIKE 'PHARM-CR-%'
  ), done AS (
    UPDATE public.vouchers v
       SET status = 'CANCELLED',
           last_modified_by = 'one-journal-per-sale',
           narration = narration || ' [cancelled: the invoice JV books this sale — this accrual double-counted it]',
           updated_at = NOW()
      FROM dup
     WHERE v.id = dup.id
    RETURNING dup.total_amount
  )
  SELECT COUNT(*), COALESCE(SUM(total_amount), 0) INTO v_real, v_value FROM done;

  WITH dup AS (
    SELECT v.id
      FROM public.vouchers v
      JOIN public.vouchers inv
        ON inv.reference_number =
           'PHARMACY-INV-' || replace(v.reference_number, 'PHARMACY-JV-SALE-', '')
       AND inv.status <> 'CANCELLED'
     WHERE v.status <> 'CANCELLED'
       AND v.reference_number LIKE 'PHARMACY-JV-SALE-%'
  ), done AS (
    UPDATE public.vouchers v
       SET status = 'CANCELLED',
           last_modified_by = 'one-journal-per-sale',
           narration = narration || ' [cancelled: mirror of a sale the invoice JV already books]',
           updated_at = NOW()
      FROM dup
     WHERE v.id = dup.id
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_optional FROM done;

  RAISE NOTICE 'Withdrew % real accruals worth Rs % and % optional mirrors',
    v_real, ROUND(v_value, 2), v_optional;
END $$;

-- ---------------------------------------------------------------------------
-- STEP 3 — verify before committing
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_left INTEGER;
  v_unbalanced INTEGER;
  v_debtor NUMERIC;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE NOT tgisinternal
       AND tgname IN ('trg_accrue_pharmacy_credit_sale', 'trg_optional_pharmacy_sale_jv')
  ) THEN
    RAISE EXCEPTION 'ABORT: an older pharmacy-sale voucher trigger is still attached';
  END IF;

  -- No sale may have both an invoice JV and one of the older vouchers live.
  SELECT COUNT(*) INTO v_left
    FROM public.vouchers v
    JOIN public.vouchers inv
      ON inv.reference_number IN (
           'PHARMACY-INV-' || split_part(v.reference_number, '-', 3),
           'PHARMACY-INV-' || replace(v.reference_number, 'PHARMACY-JV-SALE-', ''))
     AND inv.status <> 'CANCELLED'
   WHERE v.status <> 'CANCELLED'
     AND (v.reference_number LIKE 'PHARM-CR-%' OR v.reference_number LIKE 'PHARMACY-JV-SALE-%');
  IF v_left > 0 THEN
    RAISE EXCEPTION 'ABORT: % duplicate voucher(s) are still live', v_left;
  END IF;

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

  SELECT COALESCE(SUM(e.debit_amount - e.credit_amount), 0) INTO v_debtor
    FROM public.voucher_entries e
    JOIN public.vouchers v ON v.id = e.voucher_id
     AND v.status = 'AUTHORISED' AND COALESCE(v.is_optional, false) = false
    JOIN public.chart_of_accounts a ON a.id = e.account_id
   WHERE a.account_name = 'Pharmacy Debtors';
  RAISE NOTICE 'Pharmacy Debtors after removing the duplicates: Rs %', ROUND(v_debtor, 2);
END $$;
