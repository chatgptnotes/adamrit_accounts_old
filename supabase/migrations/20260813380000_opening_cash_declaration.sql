-- Count the drawer once, so every figure afterwards is true.
--
-- The counter reads minus Rs 1.4 lakh. Nothing is missing: counting began at
-- lunchtime on 13 August, and the day's payments came partly out of cash that
-- was already in the drawer and which the system never saw. Every screen has
-- had to carry a paragraph apologising for it.
--
-- One declaration per counter fixes it at the root. Somebody counts what is
-- physically there, records it, and from then on the drawer is
--   opening + cash taken - cash paid out - what has been handed on.
--
-- The opening is claimed exactly like a receipt: the first handover to include
-- it takes it, and it can never be counted twice. That reuses the rule the
-- rest of the module already runs on rather than inventing a second one.

CREATE TABLE IF NOT EXISTS public.cash_opening_declarations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_type  TEXT NOT NULL,
  amount         NUMERIC(15,2) NOT NULL CHECK (amount >= 0),
  declared_by    UUID REFERENCES public."User"(id),
  declared_by_name TEXT,
  note           TEXT,
  cash_handover_id UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One live opening per counter. A second declaration is only allowed once the
-- first has been carried into a handover, so nobody can quietly re-open the
-- drawer at a bigger number.
CREATE UNIQUE INDEX IF NOT EXISTS cash_opening_one_live_per_counter
  ON public.cash_opening_declarations (lower(btrim(hospital_type)))
  WHERE cash_handover_id IS NULL;

ALTER TABLE public.cash_opening_declarations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cash_opening_declarations_read ON public.cash_opening_declarations;
CREATE POLICY cash_opening_declarations_read
  ON public.cash_opening_declarations FOR SELECT USING (true);

CREATE OR REPLACE FUNCTION public.declare_opening_cash(
  p_hospital_type TEXT, p_amount NUMERIC, p_user_id UUID, p_note TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_name TEXT; v_id UUID; v_hosp TEXT;
BEGIN
  v_hosp := lower(btrim(COALESCE(p_hospital_type, '')));
  IF v_hosp = '' THEN RAISE EXCEPTION 'Which counter is this for?'; END IF;
  IF p_amount IS NULL OR p_amount < 0 THEN RAISE EXCEPTION 'Enter the cash counted'; END IF;

  SELECT COALESCE(full_name, email) INTO v_name FROM "User" WHERE id = p_user_id;
  IF v_name IS NULL THEN RAISE EXCEPTION 'Unknown user'; END IF;

  IF EXISTS (SELECT 1 FROM cash_opening_declarations
              WHERE lower(btrim(hospital_type)) = v_hosp AND cash_handover_id IS NULL) THEN
    RAISE EXCEPTION 'This counter already has an opening balance waiting to be handed over. Hand the drawer over first.';
  END IF;

  INSERT INTO cash_opening_declarations (hospital_type, amount, declared_by, declared_by_name, note)
  VALUES (v_hosp, p_amount, p_user_id, v_name, NULLIF(btrim(COALESCE(p_note,'')), ''))
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'hospitalType', v_hosp, 'amount', p_amount, 'by', v_name);
END $$;

-- The unclaimed opening for a counter, or zero.
CREATE OR REPLACE FUNCTION public.cash_opening_for(p_hospital_type TEXT)
RETURNS NUMERIC
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(sum(amount), 0) FROM cash_opening_declarations
   WHERE cash_handover_id IS NULL
     AND lower(btrim(hospital_type)) = lower(btrim(COALESCE(p_hospital_type, '')));
$$;

-- Claiming a handover now also carries the opening across.
CREATE OR REPLACE FUNCTION public.claim_handover_sources(p_handover_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_hosp TEXT;
BEGIN
  UPDATE advance_payment SET cash_handover_id = p_handover_id
   WHERE id::text IN (SELECT source_id FROM cash_handover_sources
                       WHERE handover_id = p_handover_id AND source_table = 'advance_payment');
  UPDATE final_payments SET cash_handover_id = p_handover_id
   WHERE id::text IN (SELECT source_id FROM cash_handover_sources
                       WHERE handover_id = p_handover_id AND source_table = 'final_payments');
  UPDATE pharmacy_sales SET cash_handover_id = p_handover_id
   WHERE sale_id::text IN (SELECT source_id FROM cash_handover_sources
                            WHERE handover_id = p_handover_id AND source_table = 'pharmacy_sales');
  UPDATE pharmacy_credit_payments SET cash_handover_id = p_handover_id
   WHERE id::text IN (SELECT source_id FROM cash_handover_sources
                       WHERE handover_id = p_handover_id AND source_table = 'pharmacy_credit_payments');

  SELECT hospital_type INTO v_hosp FROM cash_handovers WHERE id = p_handover_id;
  UPDATE cash_opening_declarations SET cash_handover_id = p_handover_id
   WHERE cash_handover_id IS NULL
     AND lower(btrim(hospital_type)) = lower(btrim(COALESCE(v_hosp, '')));
END $$;

CREATE OR REPLACE FUNCTION public.release_handover_sources(p_handover_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE advance_payment          SET cash_handover_id = NULL WHERE cash_handover_id = p_handover_id;
  UPDATE final_payments           SET cash_handover_id = NULL WHERE cash_handover_id = p_handover_id;
  UPDATE pharmacy_sales           SET cash_handover_id = NULL WHERE cash_handover_id = p_handover_id;
  UPDATE pharmacy_credit_payments SET cash_handover_id = NULL WHERE cash_handover_id = p_handover_id;
  UPDATE cash_opening_declarations SET cash_handover_id = NULL WHERE cash_handover_id = p_handover_id;
END $$;

REVOKE ALL ON FUNCTION public.declare_opening_cash(TEXT, NUMERIC, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cash_opening_for(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.declare_opening_cash(TEXT, NUMERIC, UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cash_opening_for(TEXT) TO anon, authenticated;

DO $verify$
DECLARE v_u UUID; v_id UUID; v_ok BOOLEAN;
BEGIN
  SELECT id INTO v_u FROM "User" WHERE lower(email) = 'cmd@hopehospital.com';

  PERFORM declare_opening_cash('selftest', 500, v_u, 'self test');
  IF cash_opening_for('selftest') <> 500 THEN
    RAISE EXCEPTION 'ABORT: the opening did not register';
  END IF;

  -- A second live opening on the same counter must be refused.
  v_ok := false;
  BEGIN
    PERFORM declare_opening_cash('selftest', 900, v_u, 'again');
  EXCEPTION WHEN others THEN v_ok := true;
  END;
  IF NOT v_ok THEN
    DELETE FROM cash_opening_declarations WHERE hospital_type = 'selftest';
    RAISE EXCEPTION 'ABORT: a counter was opened twice';
  END IF;

  DELETE FROM cash_opening_declarations WHERE hospital_type = 'selftest';
  IF cash_opening_for('selftest') <> 0 THEN
    RAISE EXCEPTION 'ABORT: self-test opening left behind';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
