-- Show what HAS been handed over, not only what has not.
--
-- Every list in the module shows unclaimed receipts, which is what a cashier
-- needs. A verifier is asking a different question: of everything taken at
-- this counter, what has been passed on and what is still sitting there. Right
-- now they can see the second half and have to assume the first.
--
-- Receipts already carry cash_handover_id, so the answer is there. This puts
-- both halves in one place, each line naming the handover it went out on and
-- where that handover has got to.

CREATE OR REPLACE FUNCTION public.counter_cash_ledger(
  p_hospital_type TEXT DEFAULT NULL,
  p_days INT DEFAULT 7
)
RETURNS TABLE (
  source_table TEXT, source_id TEXT, amount NUMERIC, at TIMESTAMPTZ,
  collected_by TEXT, patient TEXT,
  handed_over BOOLEAN, handover_no TEXT, handover_status TEXT, handed_to TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH cutover AS (SELECT cutover_at FROM cash_handover_settings WHERE id),
  scope AS (SELECT lower(btrim(COALESCE(p_hospital_type, ''))) AS h),
  rows AS (
    SELECT 'advance_payment'::TEXT AS src, a.id::TEXT AS sid,
           COALESCE(a.advance_amount, 0) AS amt, a.payment_date AS at,
           COALESCE(
             (SELECT COALESCE(u.full_name, u.email) FROM "User" u WHERE u.id = a.collected_by_user_id),
             NULLIF(btrim(a.billing_executive), '')) AS who,
           a.patient_name AS pat, a.cash_handover_id AS hid
      FROM advance_payment a
      LEFT JOIN patients pt ON pt.id = a.patient_id, cutover c, scope s
     WHERE upper(btrim(COALESCE(a.payment_mode, ''))) = 'CASH'
       AND COALESCE(a.is_refund, false) = false
       AND COALESCE(a.status, 'ACTIVE') = 'ACTIVE'
       AND COALESCE(a.advance_amount, 0) > 0
       AND a.payment_date >= greatest(c.cutover_at, now() - make_interval(days => p_days))
       AND (s.h = '' OR s.h = 'pharmacy' IS NOT TRUE)
       AND (s.h = '' OR lower(btrim(COALESCE(pt.hospital_name, ''))) = s.h)
    UNION ALL
    SELECT 'pharmacy_sales', ps.sale_id::TEXT,
           COALESCE(ps.total_amount, 0), ps.created_at,
           (SELECT COALESCE(u.full_name, u.email) FROM "User" u
             WHERE u.id = COALESCE(ps.collected_by_user_id, ps.created_by)),
           ps.patient_name, ps.cash_handover_id
      FROM pharmacy_sales ps, cutover c, scope s
     WHERE upper(btrim(COALESCE(ps.payment_method, ''))) = 'CASH'
       AND COALESCE(ps.total_amount, 0) > 0
       AND upper(btrim(COALESCE(ps.status, 'COMPLETED'))) <> 'CANCELLED'
       AND ps.created_at >= greatest(c.cutover_at, now() - make_interval(days => p_days))
       AND s.h IN ('', 'pharmacy')
  )
  SELECT r.src, r.sid, r.amt, r.at,
         COALESCE(r.who, 'Not recorded'), r.pat,
         (r.hid IS NOT NULL),
         h.handover_no, h.status, h.to_user_name
    FROM rows r
    LEFT JOIN cash_handovers h ON h.id = r.hid
   ORDER BY (r.hid IS NOT NULL), r.at DESC;
$$;

-- The one-line answer a verifier wants: how much is still sitting there.
CREATE OR REPLACE FUNCTION public.counter_cash_summary(p_hospital_type TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'notHandedOver',      COALESCE(sum(amount) FILTER (WHERE NOT handed_over), 0),
    'notHandedOverCount', COALESCE(count(*)    FILTER (WHERE NOT handed_over), 0),
    'oldestNotHandedOver', min(at)              FILTER (WHERE NOT handed_over),
    'handedOver',         COALESCE(sum(amount) FILTER (WHERE handed_over), 0),
    'handedOverCount',    COALESCE(count(*)    FILTER (WHERE handed_over), 0),
    'awaitingVerify',     COALESCE(sum(amount) FILTER (WHERE handed_over AND handover_status <> 'VERIFIED'), 0)
  ) FROM counter_cash_ledger(p_hospital_type, 30);
$$;

REVOKE ALL ON FUNCTION public.counter_cash_ledger(TEXT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.counter_cash_summary(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.counter_cash_ledger(TEXT, INT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.counter_cash_summary(TEXT) TO anon, authenticated;

DO $verify$
DECLARE v_sum JSONB; v_pos NUMERIC;
BEGIN
  v_sum := counter_cash_summary('pharmacy');
  -- What the ledger calls "not handed over" must be the same money the drawer
  -- screen shows, or the two views would quietly disagree.
  SELECT COALESCE(sum(amount), 0) INTO v_pos FROM pharmacy_cash_pool() WHERE mode = 'CASH';
  IF round((v_sum->>'notHandedOver')::NUMERIC, 2) <> round(v_pos, 2) THEN
    RAISE EXCEPTION 'ABORT: not-handed-over % disagrees with the pharmacy drawer %',
      v_sum->>'notHandedOver', v_pos;
  END IF;
  PERFORM 1 FROM counter_cash_ledger('hope', 7);
END
$verify$;

NOTIFY pgrst, 'reload schema';
