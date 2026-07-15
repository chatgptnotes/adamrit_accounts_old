-- Advance Statement Report shows the same patient more than once when staff
-- accidentally submit the Visit Registration form twice for one admission
-- (same patient_id + same discharge_date, created minutes apart). These are
-- read-only queries — nothing here modifies the `visits` table.

-- 1a. Finder: list every duplicate group (same patient, same discharge date).
SELECT v.patient_id, v.discharge_date, count(*) AS dup_count,
       array_agg(v.visit_id ORDER BY v.created_at) AS visit_ids
FROM visits v
WHERE v.patient_type = 'IPD' AND v.discharge_date IS NOT NULL
GROUP BY v.patient_id, v.discharge_date
HAVING count(*) > 1;

-- 1b. Deduped view of the report data: one row per (patient_id, discharge_date).
-- Prefers whichever side actually has money moving through it (an
-- advance_payment row, or a bill_preparation row with received_amount > 0);
-- falls back to the earliest-created row when neither side has financial
-- activity. Currently-admitted patients (discharge_date IS NULL) pass through
-- unchanged since no duplicates exist there today.
SELECT * FROM (
  (
    SELECT DISTINCT ON (v.patient_id, v.discharge_date) v.*
    FROM visits v
    WHERE v.patient_type = 'IPD' AND v.admission_date IS NOT NULL AND v.discharge_date IS NOT NULL
    ORDER BY v.patient_id, v.discharge_date,
      (
        EXISTS (SELECT 1 FROM advance_payment ap WHERE ap.visit_id = v.visit_id)
        OR EXISTS (SELECT 1 FROM bill_preparation bp WHERE bp.visit_id = v.visit_id AND bp.received_amount > 0)
      ) DESC,
      v.created_at ASC
  )
  UNION ALL
  (
    SELECT v.* FROM visits v
    WHERE v.patient_type = 'IPD' AND v.admission_date IS NOT NULL AND v.discharge_date IS NULL
  )
) deduped
ORDER BY admission_date DESC;
