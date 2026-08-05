-- Rupali operational register (tablet tile).
--
-- Two tables:
--   rupali_charge_rules  — the "Rupali Master": standard charge for a
--                          category + doctor + purpose combination.
--   rupali_visit_logs    — immutable register of submitted entries; rows can
--                          be inserted and read but never updated or deleted.
--
-- Doctors live in two hospital-specific tables (hope_consultants /
-- ayushman_consultants), so doctor_id carries no hard FK; the name is
-- captured alongside it and is what the register displays.
--
-- Run in the Supabase dashboard SQL Editor. Safe to run twice.

BEGIN;

-- ------------------------------------------------------------------
-- 1. Rupali Master
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rupali_charge_rules (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category       TEXT NOT NULL CHECK (category IN ('OPD', 'IPD', 'Procedure')),
  doctor_id      UUID,
  doctor_name    TEXT NOT NULL,
  purpose_reason TEXT NOT NULL,
  amount         NUMERIC(15, 2) NOT NULL CHECK (amount >= 0),
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One live rule per combination; retired rules stay for history.
CREATE UNIQUE INDEX IF NOT EXISTS uq_rupali_rule_combination
  ON public.rupali_charge_rules
     (category, lower(btrim(doctor_name)), lower(btrim(purpose_reason)))
  WHERE is_active;

DROP TRIGGER IF EXISTS update_rupali_charge_rules_updated_at ON public.rupali_charge_rules;
CREATE TRIGGER update_rupali_charge_rules_updated_at
  BEFORE UPDATE ON public.rupali_charge_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.rupali_charge_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all operations on rupali_charge_rules" ON public.rupali_charge_rules;
CREATE POLICY "Allow all operations on rupali_charge_rules"
  ON public.rupali_charge_rules FOR ALL USING (true) WITH CHECK (true);

-- ------------------------------------------------------------------
-- 2. Visit log — append-only
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rupali_visit_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category      TEXT NOT NULL CHECK (category IN ('OPD', 'IPD', 'Procedure')),
  doctor_id     UUID,
  doctor_name   TEXT NOT NULL,
  patient_id    UUID REFERENCES public.patients(id),
  patient_name  TEXT NOT NULL,
  purpose_reason TEXT NOT NULL,
  amount        NUMERIC(15, 2) NOT NULL CHECK (amount >= 0),
  created_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rupali_visit_logs_created_at
  ON public.rupali_visit_logs (created_at DESC);

ALTER TABLE public.rupali_visit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow insert and read on rupali_visit_logs" ON public.rupali_visit_logs;
CREATE POLICY "Allow insert and read on rupali_visit_logs"
  ON public.rupali_visit_logs FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow insert on rupali_visit_logs" ON public.rupali_visit_logs;
CREATE POLICY "Allow insert on rupali_visit_logs"
  ON public.rupali_visit_logs FOR INSERT WITH CHECK (true);

-- The register is a book of record: entries are never edited or removed.
CREATE OR REPLACE FUNCTION public.rupali_visit_logs_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'Rupali register entries are immutable — record a correcting entry instead';
END;
$function$;

DROP TRIGGER IF EXISTS trg_rupali_visit_logs_immutable ON public.rupali_visit_logs;
CREATE TRIGGER trg_rupali_visit_logs_immutable
  BEFORE UPDATE OR DELETE ON public.rupali_visit_logs
  FOR EACH ROW EXECUTE FUNCTION public.rupali_visit_logs_immutable();

NOTIFY pgrst, 'reload schema';

-- ------------------------------------------------------------------
-- 3. Proof
-- ------------------------------------------------------------------
DO $verify$
BEGIN
  -- The nested block is a subtransaction: the DELETE raising rolls back the
  -- verify INSERT with it, so no test row survives in the register.
  BEGIN
    INSERT INTO public.rupali_visit_logs
      (category, doctor_name, patient_name, purpose_reason, amount, created_by)
    VALUES ('OPD', '__verify__', '__verify__', '__verify__', 1, 'migration-verify');
    DELETE FROM public.rupali_visit_logs WHERE created_by = 'migration-verify';
    RAISE EXCEPTION 'register rows were deletable — immutability trigger is not working';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      IF SQLERRM NOT LIKE '%immutable%' THEN RAISE; END IF;
      RAISE NOTICE 'OK — rupali_visit_logs is append-only';
  END;
END;
$verify$;

COMMIT;
