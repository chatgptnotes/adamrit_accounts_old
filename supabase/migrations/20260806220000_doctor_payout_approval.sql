-- Approval before a doctor payout leaves the tile.
--
-- Akshay's tile already totals several patients' services into one payment.
-- What it had no record of was anyone agreeing to that total: the person
-- holding the phone selected the services and paid in the same motion. This
-- adds the missing step — the total is approved, by name and timestamp,
-- against the exact set of services it covers.
--
-- Keyed on the service rows themselves (rupali_visit_logs ids), not on the
-- doctor and the day: adding one more patient after approval changes the
-- total, so that approval must no longer count.
--
-- Applied with scripts/apply-migration.py, which supplies the transaction.

CREATE TABLE IF NOT EXISTS public.doctor_payout_approvals (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_name  TEXT NOT NULL,
  log_ids      UUID[] NOT NULL,
  -- Sorted fingerprint of log_ids — what an approval is matched on. A
  -- generated column cannot hold a subquery, so a trigger keeps it true.
  log_key      TEXT,
  total_amount NUMERIC(15, 2) NOT NULL CHECK (total_amount > 0),
  service_count INT NOT NULL CHECK (service_count > 0),
  approved_by  TEXT NOT NULL,
  approved_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_doctor_payout_approvals_key
  ON public.doctor_payout_approvals (log_key);

CREATE OR REPLACE FUNCTION public.doctor_payout_approval_key()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  -- Order-independent: ticking the same services in another order is the
  -- same approval, and one more service is a different one.
  NEW.log_key := (
    SELECT string_agg(id::text, ',' ORDER BY id::text)
      FROM unnest(NEW.log_ids) AS id
  );
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS set_doctor_payout_approval_key ON public.doctor_payout_approvals;
CREATE TRIGGER set_doctor_payout_approval_key
  BEFORE INSERT OR UPDATE OF log_ids ON public.doctor_payout_approvals
  FOR EACH ROW EXECUTE FUNCTION public.doctor_payout_approval_key();

ALTER TABLE public.doctor_payout_approvals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all operations on doctor_payout_approvals"
  ON public.doctor_payout_approvals;
CREATE POLICY "Allow all operations on doctor_payout_approvals"
  ON public.doctor_payout_approvals FOR ALL USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';

DO $verify$
DECLARE
  v_a UUID := gen_random_uuid();
  v_b UUID := gen_random_uuid();
  v_key_1 TEXT;
  v_key_2 TEXT;
BEGIN
  -- The fingerprint must not depend on the order the services were ticked.
  INSERT INTO public.doctor_payout_approvals
    (doctor_name, log_ids, total_amount, service_count, approved_by)
  VALUES ('__verify__', ARRAY[v_a, v_b], 100, 2, '__verify__')
  RETURNING log_key INTO v_key_1;

  INSERT INTO public.doctor_payout_approvals
    (doctor_name, log_ids, total_amount, service_count, approved_by)
  VALUES ('__verify__', ARRAY[v_b, v_a], 100, 2, '__verify__')
  RETURNING log_key INTO v_key_2;

  IF v_key_1 IS DISTINCT FROM v_key_2 THEN
    RAISE EXCEPTION 'the approval fingerprint depends on tick order: % vs %', v_key_1, v_key_2;
  END IF;

  DELETE FROM public.doctor_payout_approvals WHERE doctor_name = '__verify__';
  RAISE NOTICE 'OK — approvals are matched on the service set, whatever the order';
END;
$verify$;
