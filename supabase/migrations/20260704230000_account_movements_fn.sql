-- Instant accounting reports: aggregate voucher movements in the database
-- instead of paging 16k+ voucher_entries rows to the browser.
--
-- account_movements(p_from, p_upto, p_company) returns one row per account
-- with total AUTHORISED debits/credits in the window. Used by Trial Balance,
-- Balance Sheet, P&L, Cash/Bank Summary and the voucher-entry Cur Bal lookup.

CREATE OR REPLACE FUNCTION public.account_movements(
  p_from date DEFAULT NULL,
  p_upto date DEFAULT NULL,
  p_company uuid DEFAULT NULL
)
RETURNS TABLE(account_id uuid, total_debit numeric, total_credit numeric)
LANGUAGE sql
STABLE
AS $$
  SELECT
    ve.account_id,
    COALESCE(SUM(ve.debit_amount), 0)  AS total_debit,
    COALESCE(SUM(ve.credit_amount), 0) AS total_credit
  FROM public.voucher_entries ve
  JOIN public.vouchers v ON v.id = ve.voucher_id
  WHERE v.status = 'AUTHORISED'
    AND (p_from    IS NULL OR v.voucher_date >= p_from)
    AND (p_upto    IS NULL OR v.voucher_date <= p_upto)
    AND (p_company IS NULL OR v.company_id = p_company)
    AND ve.account_id IS NOT NULL
  GROUP BY ve.account_id;
$$;

GRANT EXECUTE ON FUNCTION public.account_movements(date, date, uuid) TO anon, authenticated;

-- Supporting indexes (FK columns are not auto-indexed in Postgres)
CREATE INDEX IF NOT EXISTS idx_voucher_entries_voucher_id ON public.voucher_entries (voucher_id);
CREATE INDEX IF NOT EXISTS idx_voucher_entries_account_id ON public.voucher_entries (account_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_status_date ON public.vouchers (status, voucher_date);

NOTIFY pgrst, 'reload schema';
