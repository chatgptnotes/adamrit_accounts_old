-- Voucher anomaly guard (AI automation 1).
--
-- run_anomaly_scan() sweeps the last N days for:
--   * DUPLICATE  - two+ non-cancelled vouchers, same company, same credited
--                  party, same amount, same date (the Rehan/316 pattern)
--   * OUTSIZED   - a payment over 3x the party's 90-day average (5+ priors)
--   * NEAR_CEILING - spot approvals at 7,500+ against the 8,000 cap
--   * ODD_HOURS  - vouchers created 23:00-06:00 IST
-- Findings dedupe on a fingerprint; the Director Dashboard card lists OPEN
-- ones and an AI line explains what to check first.
--
-- Applied automatically via apply_migration.

CREATE TABLE IF NOT EXISTS public.voucher_anomalies (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        TEXT NOT NULL,
  fingerprint TEXT NOT NULL UNIQUE,
  detail      TEXT NOT NULL,
  amount      NUMERIC(15,2) NOT NULL DEFAULT 0,
  voucher_numbers TEXT,
  status      TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','REVIEWED')),
  reviewed_by TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_voucher_anomalies_status
  ON public.voucher_anomalies (status, created_at DESC);
ALTER TABLE public.voucher_anomalies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all operations on voucher_anomalies" ON public.voucher_anomalies;
CREATE POLICY "Allow all operations on voucher_anomalies"
  ON public.voucher_anomalies FOR ALL USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.run_anomaly_scan(p_days INT DEFAULT 3)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_since DATE := current_date - GREATEST(COALESCE(p_days,3),1);
  v_new INT := 0; v_row RECORD;
BEGIN
  -- DUPLICATE: same company + credited account + amount + date, 2+ vouchers.
  FOR v_row IN
    SELECT v.company_id, e.account_id, a.account_name, v.voucher_date,
           e.credit_amount AS amount,
           string_agg(DISTINCT v.voucher_number, ', ') AS numbers,
           count(DISTINCT v.id) AS n
      FROM vouchers v
      JOIN voucher_entries e ON e.voucher_id = v.id AND e.credit_amount > 0
      JOIN chart_of_accounts a ON a.id = e.account_id
     WHERE v.voucher_date >= v_since AND v.status <> 'CANCELLED'
       AND lower(a.account_name) NOT IN ('cash') AND a.account_group NOT ILIKE '%bank%'
     GROUP BY v.company_id, e.account_id, a.account_name, v.voucher_date, e.credit_amount
    HAVING count(DISTINCT v.id) > 1 AND e.credit_amount >= 500
  LOOP
    INSERT INTO voucher_anomalies (kind, fingerprint, detail, amount, voucher_numbers)
    VALUES ('DUPLICATE',
            md5('dup' || v_row.account_id || v_row.voucher_date || v_row.amount),
            v_row.n || ' vouchers pay ' || v_row.account_name || ' the same Rs '
              || v_row.amount || ' on ' || v_row.voucher_date,
            v_row.amount, v_row.numbers)
    ON CONFLICT (fingerprint) DO NOTHING;
    IF FOUND THEN v_new := v_new + 1; END IF;
  END LOOP;

  -- OUTSIZED: payment far above the party's own history.
  FOR v_row IN
    SELECT v.id, v.voucher_number, v.voucher_date, e.credit_amount AS amount,
           a.account_name, hist.avg_amount
      FROM vouchers v
      JOIN voucher_types t ON t.id = v.voucher_type_id AND t.voucher_category = 'PAYMENT'
      JOIN voucher_entries e ON e.voucher_id = v.id AND e.credit_amount > 0
      JOIN chart_of_accounts a ON a.id = e.account_id
      JOIN LATERAL (
        SELECT avg(e2.credit_amount) AS avg_amount, count(*) AS n
          FROM voucher_entries e2
          JOIN vouchers v2 ON v2.id = e2.voucher_id AND v2.status <> 'CANCELLED'
         WHERE e2.account_id = e.account_id AND e2.credit_amount > 0
           AND v2.voucher_date BETWEEN v_since - 90 AND v_since - 1
      ) hist ON hist.n >= 5
     WHERE v.voucher_date >= v_since AND v.status <> 'CANCELLED'
       AND e.credit_amount > hist.avg_amount * 3
       AND lower(a.account_name) NOT IN ('cash') AND a.account_group NOT ILIKE '%bank%'
  LOOP
    INSERT INTO voucher_anomalies (kind, fingerprint, detail, amount, voucher_numbers)
    VALUES ('OUTSIZED', md5('out' || v_row.id),
            v_row.voucher_number || ' pays ' || v_row.account_name || ' Rs ' || v_row.amount
              || ' vs their usual Rs ' || round(v_row.avg_amount),
            v_row.amount, v_row.voucher_number)
    ON CONFLICT (fingerprint) DO NOTHING;
    IF FOUND THEN v_new := v_new + 1; END IF;
  END LOOP;

  -- NEAR_CEILING spots.
  FOR v_row IN
    SELECT id, referee_ledger_name, patient_name, max_spot
      FROM spot_payment_approvals
     WHERE created_at::date >= v_since AND max_spot >= 7500
  LOOP
    INSERT INTO voucher_anomalies (kind, fingerprint, detail, amount, voucher_numbers)
    VALUES ('NEAR_CEILING', md5('ceil' || v_row.id),
            'Spot of Rs ' || v_row.max_spot || ' (cap 8,000) to ' || v_row.referee_ledger_name
              || ' for ' || v_row.patient_name,
            v_row.max_spot, NULL)
    ON CONFLICT (fingerprint) DO NOTHING;
    IF FOUND THEN v_new := v_new + 1; END IF;
  END LOOP;

  -- ODD_HOURS: created 23:00-06:00 IST.
  FOR v_row IN
    SELECT id, voucher_number, total_amount, created_by,
           to_char(created_at AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS at_time
      FROM vouchers
     WHERE voucher_date >= v_since AND status <> 'CANCELLED' AND total_amount >= 5000
       AND (extract(hour FROM created_at AT TIME ZONE 'Asia/Kolkata') >= 23
            OR extract(hour FROM created_at AT TIME ZONE 'Asia/Kolkata') < 6)
  LOOP
    INSERT INTO voucher_anomalies (kind, fingerprint, detail, amount, voucher_numbers)
    VALUES ('ODD_HOURS', md5('odd' || v_row.id),
            v_row.voucher_number || ' (Rs ' || v_row.total_amount || ') entered at '
              || v_row.at_time || ' by ' || COALESCE(v_row.created_by, 'unknown'),
            v_row.total_amount, v_row.voucher_number)
    ON CONFLICT (fingerprint) DO NOTHING;
    IF FOUND THEN v_new := v_new + 1; END IF;
  END LOOP;

  RETURN jsonb_build_object('new', v_new,
    'open', (SELECT count(*) FROM voucher_anomalies WHERE status = 'OPEN'));
END;
$function$;

REVOKE ALL ON FUNCTION public.run_anomaly_scan(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_anomaly_scan(INT) TO anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
