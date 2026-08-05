-- Fixes from the 6-Aug books audit.
--
-- 1. account_movements now excludes OPTIONAL vouchers (Tally semantics: an
--    optional voucher never moves the books). The pharmacy GRN flow posts an
--    optional JV alongside the real Purchase for the same GRN; balances were
--    counting both.
-- 2. Two empty AUTHORISED test journals (JV0359 Rs 1, JV0360 Rs 2, no
--    entries) are cancelled.
-- 3. run_anomaly_scan v2: only AUTHORISED non-optional vouchers count, and
--    DUPLICATE looks only at payable-side credits (creditors/consultants) —
--    two different patients paying the same Rs 720 on the same day is normal
--    and was flooding the guard with noise.
-- 4. The four purchase vouchers whose entry debits are exactly double their
--    total (PUR0026 — also future-dated 2026-08-31 — PUR-000012/15/09) are
--    filed as DATA_ISSUE findings for accounts to correct; data untouched.
--
-- Applied automatically via apply_migration.

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
    AND COALESCE(v.is_optional, false) = false
    AND (p_from    IS NULL OR v.voucher_date >= p_from)
    AND (p_upto    IS NULL OR v.voucher_date <= p_upto)
    AND (p_company IS NULL OR v.company_id = p_company)
    AND ve.account_id IS NOT NULL
  GROUP BY ve.account_id;
$$;

-- 2. The empty authorised test journals.
UPDATE public.vouchers
   SET status = 'CANCELLED',
       last_modified_by = 'books-audit-2026-08-06',
       narration = COALESCE(narration, '') || ' [Cancelled: empty voucher, books audit 6-Aug-2026]'
 WHERE voucher_number IN ('JV0359', 'JV0360')
   AND status = 'AUTHORISED'
   AND NOT EXISTS (SELECT 1 FROM public.voucher_entries e WHERE e.voucher_id = vouchers.id);

-- 3. Scanner v2.
CREATE OR REPLACE FUNCTION public.run_anomaly_scan(p_days INT DEFAULT 3)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_since DATE := current_date - GREATEST(COALESCE(p_days,3),1);
  v_new INT := 0; v_row RECORD;
BEGIN
  -- DUPLICATE: payable-side only — same company + credited creditor ledger +
  -- amount + date across 2+ real vouchers.
  FOR v_row IN
    SELECT v.company_id, e.account_id, a.account_name, v.voucher_date,
           e.credit_amount AS amount,
           string_agg(DISTINCT v.voucher_number, ', ') AS numbers,
           count(DISTINCT v.id) AS n
      FROM vouchers v
      JOIN voucher_entries e ON e.voucher_id = v.id AND e.credit_amount > 0
      JOIN chart_of_accounts a ON a.id = e.account_id
     WHERE v.voucher_date >= v_since
       AND v.status = 'AUTHORISED' AND COALESCE(v.is_optional, false) = false
       AND (a.account_type IN ('CURRENT_LIABILITIES', 'LIABILITIES', 'LONG_TERM_LIABILITIES')
            OR a.account_group ILIKE '%creditor%' OR a.account_group ILIKE '%consultant%')
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
          JOIN vouchers v2 ON v2.id = e2.voucher_id AND v2.status = 'AUTHORISED'
           AND COALESCE(v2.is_optional, false) = false
         WHERE e2.account_id = e.account_id AND e2.credit_amount > 0
           AND v2.voucher_date BETWEEN v_since - 90 AND v_since - 1
      ) hist ON hist.n >= 5
     WHERE v.voucher_date >= v_since
       AND v.status = 'AUTHORISED' AND COALESCE(v.is_optional, false) = false
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

  FOR v_row IN
    SELECT id, voucher_number, total_amount, created_by,
           to_char(created_at AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS at_time
      FROM vouchers
     WHERE voucher_date >= v_since AND status = 'AUTHORISED'
       AND COALESCE(is_optional, false) = false AND total_amount >= 5000
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

-- Purge v1's noisy findings and re-scan with v2 rules.
DELETE FROM public.voucher_anomalies WHERE status = 'OPEN';

-- 4. File the doubled-purchase vouchers as findings (data untouched).
INSERT INTO public.voucher_anomalies (kind, fingerprint, detail, amount, voucher_numbers)
SELECT 'DATA_ISSUE', md5('dbl' || v.id),
       v.voucher_number || ': entry debits are exactly double the voucher total (Rs '
         || v.total_amount || ' vs entries)'
         || CASE WHEN v.voucher_date > current_date THEN ' — and dated in the future (' || v.voucher_date || ')' ELSE '' END,
       v.total_amount, v.voucher_number
  FROM public.vouchers v
 WHERE v.voucher_number IN ('PUR0026', 'PUR-000012', 'PUR-000015', 'PUR-000009')
ON CONFLICT (fingerprint) DO NOTHING;

SELECT public.run_anomaly_scan(7);
