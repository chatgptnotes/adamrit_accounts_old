-- Name whoever made each bank payment.
--
-- The vendor breakdown showed the voucher, the payee and the bank account but
-- not the person, so Rs 23,200 left the bank with nobody's name against it on
-- the handover.
--
-- The books already know: vouchers.created_by carries the login that posted
-- each one -- superadmin@hospital.com, sp@gmail.com, santoshi@gmail.com among
-- today's. It is resolved to a real name where the login maps to a user, and
-- shown as typed where it does not. Nothing is invented: a voucher posted by
-- an automatic routine says so rather than borrowing somebody's name.

DROP FUNCTION IF EXISTS public.online_out_pool(TEXT);

CREATE OR REPLACE FUNCTION public.online_out_pool(p_hospital_type TEXT DEFAULT NULL)
RETURNS TABLE (
  id UUID, amount NUMERIC, at TIMESTAMPTZ, entry_date DATE,
  label TEXT, ledger TEXT, voucher_no TEXT, paid_by TEXT
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
         min(v.voucher_number),
         -- The books' own record of who posted it, shown as a person where the
         -- login is one, and left as written where it is a routine.
         COALESCE(
           (SELECT COALESCE(u.full_name, u.email) FROM public."User" u
             WHERE lower(u.email) = lower(btrim(COALESCE(min(v.created_by), ''))) LIMIT 1),
           NULLIF(btrim(min(v.created_by)), '')
         )
    FROM voucher_entries ve
    JOIN vouchers v ON v.id = ve.voucher_id
    JOIN chart_of_accounts a ON a.id = ve.account_id
    LEFT JOIN companies c ON c.id = v.company_id,
         cutover cut, scope s
   WHERE ve.credit_amount > 0
     AND v.status = 'AUTHORISED'
     AND COALESCE(v.is_optional, false) = false
     AND v.created_at >= cut.cutover_at
     AND a.account_group IN ('BANK', 'Bank Accounts')
     AND (s.h = ''
          OR (s.h = 'hope'     AND c.company_key = 'drm_pvt_ltd')
          OR (s.h = 'ayushman' AND c.company_key = 'ayushman_nagpur')
          OR (s.h = 'pharmacy' AND c.company_key = 'hope_pharmacy'))
   GROUP BY v.id;
$$;

REVOKE ALL ON FUNCTION public.online_out_pool(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.online_out_pool(TEXT) TO anon, authenticated;

DO $verify$
DECLARE v_named INT; v_total INT;
BEGIN
  SELECT count(*) FILTER (WHERE paid_by IS NOT NULL), count(*)
    INTO v_named, v_total
  FROM online_out_pool(NULL);

  IF v_total > 0 AND v_named = 0 THEN
    RAISE EXCEPTION 'ABORT: no bank payment could be attributed, the lookup is wrong';
  END IF;
  RAISE NOTICE '% of % bank payments carry a name', v_named, v_total;
END
$verify$;

NOTIFY pgrst, 'reload schema';
