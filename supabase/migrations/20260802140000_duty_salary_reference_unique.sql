-- One bill per party per RMO-duty day / salary month, enforced by the database.
--
-- Both the RMO duty roster (reference RMO-DUTY-<date>) and the Salary Sheet
-- (reference SALARY-<yyyy-mm>) guard against duplicates with a check-then-
-- insert, and both handle a 23505 by reusing the existing row. But the only
-- unique index on approval_queue is partial on (ot_schedule_id, party_name)
-- WHERE ot_schedule_id IS NOT NULL, which these rows never satisfy — so two
-- concurrent taps (two tablets, or Pay racing Approve-sheet) could insert two
-- bills for the same duty or the same month's salary, and both would be
-- approved and paid.
--
-- Scoped to those two reference families only: other categories legitimately
-- repeat a reference_no across bills. REJECTED rows are excluded so a
-- rejected entry never blocks the corrected one.

CREATE UNIQUE INDEX IF NOT EXISTS approval_queue_duty_salary_reference_uniq
  ON public.approval_queue (reference_no, lower(party_name), COALESCE(company_id::text, ''))
  WHERE (reference_no LIKE 'RMO-DUTY-%' OR reference_no LIKE 'SALARY-%')
    AND status <> 'REJECTED';
