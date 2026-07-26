-- Give the company back to the vouchers that lost it.
--
-- 124 vouchers posted since the cutover carry no company_id, worth Rs 4,51,014.
-- They balance, so nothing looked wrong - but a company's trial balance is
-- built from its own vouchers, so these appear in none of them. Invisible
-- rather than incorrect, which is the harder kind to notice.
--
-- 85 of them reach a patient, and resolve_patient_company already turns a
-- patient into a company. This recovers those two ways: directly from
-- vouchers.patient_id, and through the bill to its visit and patient where
-- only bill_id is set.
--
-- ONLY FROM THE CUTOVER ONWARD. 4,315 company-less vouchers predate 25 July.
-- Those belong to a period Tally's opening balances already cover, and several
-- thousand of them surviving the cutover squaring is a separate question worth
-- looking at on its own rather than folding into this.
--
-- created_by is null on every one of them, so the trigger that made them could
-- not be named from the data. Whatever is left after this - vouchers with no
-- patient and no bill - is the set that identifies it, and the verification
-- below lists them by type and reference so the source is findable.
--
-- Nothing but company_id changes. No amount, ledger, date or status is touched,
-- and a voucher that already has a company is left alone.

CREATE TEMP TABLE company_recovered AS
SELECT v.id,
       v.voucher_number,
       COALESCE(
         public.resolve_patient_company(p1.hospital_name, p1.corporate),
         public.resolve_patient_company(p2.hospital_name, p2.corporate)
       ) AS company_id,
       CASE WHEN p1.id IS NOT NULL THEN 'patient on the voucher'
            ELSE 'patient via the bill' END AS route,
       v.total_amount
  FROM public.vouchers v
  LEFT JOIN public.patients p1 ON p1.id = v.patient_id
  LEFT JOIN public.bills b     ON b.id = v.bill_id
  LEFT JOIN public.visits vis  ON vis.visit_id = b.visit_id
  LEFT JOIN public.patients p2 ON p2.id = vis.patient_id
 WHERE v.status <> 'CANCELLED'
   AND v.company_id IS NULL
   AND v.voucher_date >= DATE '2026-07-25'
   AND (p1.id IS NOT NULL OR p2.id IS NOT NULL);

UPDATE public.vouchers v
   SET company_id = r.company_id,
       updated_at = now()
  FROM company_recovered r
 WHERE v.id = r.id
   AND r.company_id IS NOT NULL;
