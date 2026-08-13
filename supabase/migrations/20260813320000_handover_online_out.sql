-- Vendor payments belong on the handover too.
--
-- The handover showed cash in, cash out and money taken online. It did not
-- show money going OUT online -- vendor payments made by bank transfer or UPI
-- -- so a shift could never be read as a complete picture of what moved.
--
-- Those payments credit a BANK ledger rather than a cash one, which is exactly
-- why the cash pool could not see them. They never touch the drawer and are
-- never counted; they are reported so the register shows every movement.

CREATE OR REPLACE FUNCTION public.online_out_pool(p_hospital_type TEXT DEFAULT NULL)
RETURNS TABLE (
  id UUID, amount NUMERIC, at TIMESTAMPTZ, entry_date DATE,
  label TEXT, ledger TEXT, voucher_no TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH cutover AS (SELECT cutover_at FROM cash_handover_settings WHERE id),
  scope AS (SELECT lower(btrim(COALESCE(p_hospital_type, ''))) AS h)
  SELECT v.id,
         sum(ve.credit_amount),
         min(v.created_at),
         min(v.voucher_date),
         COALESCE(NULLIF(btrim(min(v.narration)), ''), 'Payment'),
         min(a.account_name),
         min(v.voucher_number)
    FROM voucher_entries ve
    JOIN vouchers v ON v.id = ve.voucher_id
    JOIN chart_of_accounts a ON a.id = ve.account_id
    LEFT JOIN companies c ON c.id = v.company_id,
         cutover cut, scope s
   WHERE ve.credit_amount > 0
     AND v.status = 'AUTHORISED'
     AND COALESCE(v.is_optional, false) = false
     AND v.created_at >= cut.cutover_at
     -- Bank, not cash. The cash side is already covered by cash_payouts_pool.
     AND a.account_group IN ('BANK', 'Bank Accounts')
     AND (s.h = ''
          OR (s.h = 'hope'     AND c.company_key = 'drm_pvt_ltd')
          OR (s.h = 'ayushman' AND c.company_key = 'ayushman_nagpur')
          OR (s.h = 'pharmacy' AND c.company_key = 'hope_pharmacy'))
   GROUP BY v.id;
$$;

ALTER TABLE public.cash_handovers
  ADD COLUMN IF NOT EXISTS software_online_out NUMERIC(15,2);

COMMENT ON COLUMN public.cash_handovers.software_online_out IS
  'Money paid out by bank or UPI at this counter. Reported, never counted.';

REVOKE ALL ON FUNCTION public.online_out_pool(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.online_out_pool(TEXT) TO anon, authenticated;

DO $verify$
DECLARE v_bank NUMERIC; v_cash NUMERIC;
BEGIN
  -- A bank payment must never be mistaken for cash leaving the drawer.
  SELECT COALESCE(sum(amount), 0) INTO v_bank FROM online_out_pool(NULL);
  SELECT COALESCE(sum(amount), 0) INTO v_cash FROM cash_payouts_pool(NULL);
  IF EXISTS (
    SELECT 1 FROM online_out_pool(NULL) o
    JOIN cash_payouts_pool(NULL) c ON c.id = o.id
  ) THEN
    RAISE EXCEPTION 'ABORT: a payment appears as both cash and bank';
  END IF;
  RAISE NOTICE 'online out %, cash out %', v_bank, v_cash;
END
$verify$;

NOTIFY pgrst, 'reload schema';
