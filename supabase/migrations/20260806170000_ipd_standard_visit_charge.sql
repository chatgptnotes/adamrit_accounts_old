-- The standard IPD visit charge is Rs. 1,000, for every doctor.
--
-- rupali_charge_rules is per doctor, so a flat rule could only have been kept
-- by adding a row for each consultant and remembering to add one for every
-- new consultant. This makes the standard a property of the CATEGORY, which
-- applies to any doctor with no rule of their own — including doctors added
-- tomorrow.
--
-- Locked categories are enforced, not merely defaulted: while IPD is locked
-- no charge rule and no register entry can carry any other amount. Unlock by
-- setting is_locked = false on the row (the amount then behaves as a default
-- the tile pre-fills but the user can change).
--
-- Applied with scripts/apply-migration.py, which supplies the transaction.

-- ------------------------------------------------------------------
-- 1. The standard, per category
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rupali_category_defaults (
  category   TEXT PRIMARY KEY
             CHECK (category IN ('OPD', 'IPD', 'Procedure', 'Day Care')),
  amount     NUMERIC(15, 2) NOT NULL CHECK (amount >= 0),
  is_locked  BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.rupali_category_defaults ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read rupali_category_defaults" ON public.rupali_category_defaults;
CREATE POLICY "Read rupali_category_defaults"
  ON public.rupali_category_defaults FOR SELECT USING (true);

DROP TRIGGER IF EXISTS update_rupali_category_defaults_updated_at ON public.rupali_category_defaults;
CREATE TRIGGER update_rupali_category_defaults_updated_at
  BEFORE UPDATE ON public.rupali_category_defaults
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.rupali_category_defaults (category, amount, is_locked)
VALUES ('IPD', 1000, true)
ON CONFLICT (category) DO UPDATE
  SET amount = EXCLUDED.amount, is_locked = EXCLUDED.is_locked;

-- ------------------------------------------------------------------
-- 2. Enforcement — a locked category admits one amount
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_rupali_category_standard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_amount NUMERIC;
BEGIN
  SELECT amount INTO v_amount
    FROM public.rupali_category_defaults
   WHERE category = NEW.category AND is_locked;
  IF v_amount IS NOT NULL AND NEW.amount <> v_amount THEN
    RAISE EXCEPTION 'The standard % charge is Rs. % — % is not allowed',
      NEW.category, trim(to_char(v_amount, 'FM999999990')), trim(to_char(NEW.amount, 'FM999999990'));
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_rupali_rule_standard ON public.rupali_charge_rules;
CREATE TRIGGER enforce_rupali_rule_standard
  BEFORE INSERT OR UPDATE OF category, amount ON public.rupali_charge_rules
  FOR EACH ROW EXECUTE FUNCTION public.enforce_rupali_category_standard();

DROP TRIGGER IF EXISTS enforce_rupali_log_standard ON public.rupali_visit_logs;
CREATE TRIGGER enforce_rupali_log_standard
  BEFORE INSERT ON public.rupali_visit_logs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_rupali_category_standard();

-- ------------------------------------------------------------------
-- 3. Proof
-- ------------------------------------------------------------------
DO $verify$
DECLARE
  v_amount NUMERIC;
BEGIN
  SELECT amount INTO v_amount FROM public.rupali_category_defaults
   WHERE category = 'IPD' AND is_locked;
  IF v_amount IS DISTINCT FROM 1000 THEN
    RAISE EXCEPTION 'the IPD standard is not locked at 1000 (got %)', v_amount;
  END IF;

  -- An off-standard IPD entry must be refused.
  BEGIN
    INSERT INTO public.rupali_visit_logs
      (category, doctor_name, patient_name, purpose_reason, amount, created_by)
    VALUES ('IPD', 'verify', 'verify', 'IPD', 750, 'migration-verify');
    RAISE EXCEPTION 'verification did not reach the IPD standard guard';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      IF SQLERRM NOT LIKE '%standard IPD charge is Rs. 1000%' THEN
        RAISE EXCEPTION 'unexpected guard: %', SQLERRM;
      END IF;
  END;

  -- The standard itself must go through. The register is append-only, so the
  -- probe row is discarded by raising inside its own subtransaction.
  BEGIN
    INSERT INTO public.rupali_visit_logs
      (category, doctor_name, patient_name, purpose_reason, amount, created_by)
    VALUES ('IPD', '__verify__', '__verify__', 'IPD', 1000, 'migration-verify');
    RAISE EXCEPTION 'discard-the-probe';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      IF SQLERRM <> 'discard-the-probe' THEN
        RAISE EXCEPTION 'the standard IPD amount was refused: %', SQLERRM;
      END IF;
  END;

  RAISE NOTICE 'OK — IPD visits are locked to the Rs. 1,000 standard';
END;
$verify$;
