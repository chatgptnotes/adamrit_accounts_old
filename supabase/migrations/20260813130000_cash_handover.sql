-- Cashier cash handover: chain of custody for physical cash.
--
-- A cashier counts the drawer note by note, names who is receiving it, and a
-- nominated verifier confirms the count against what the software says was
-- collected. No vouchers are posted anywhere -- this is an operational record
-- and the accounting module stays frozen.
--
-- The figure is built by CLAIMING receipts, not by summing a person's balance.
-- Each cash receipt carries cash_handover_id and can be claimed exactly once
-- (unique index below), which means:
--   * the total is right even for receipts where nobody was recorded,
--   * two cashiers cannot both hand over the same money,
--   * the slip can print the exact receipts behind the figure.
--
-- Receipts carry no hospital column, so the pool is separated by WHO collected:
-- each cashier claims their own, and the unattributed remainder is claimed
-- deliberately by whoever is clearing the counter.

-- ---------------------------------------------------------------- settings

CREATE TABLE IF NOT EXISTS public.cash_handover_settings (
  id           BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  cutover_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Without a cutover the first handover would try to claim every cash receipt
-- ever taken. Nothing before this instant is ever claimable.
INSERT INTO public.cash_handover_settings (id, cutover_at)
VALUES (true, now())
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------- the named verifiers

CREATE TABLE IF NOT EXISTS public.cash_handover_verifiers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL UNIQUE REFERENCES public."User"(id) ON DELETE CASCADE,
  -- Denormalised: public."User" is column-locked to anon, so the tablet and the
  -- printed slip must render a name without joining that table.
  display_name  TEXT NOT NULL,
  can_receive   BOOLEAN NOT NULL DEFAULT true,
  can_verify    BOOLEAN NOT NULL DEFAULT true,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  added_by      TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cash_handover_verifiers_use_ck CHECK (can_receive OR can_verify)
);

-- ------------------------------------------------------------- the handover

CREATE SEQUENCE IF NOT EXISTS public.cash_handover_no_seq;

CREATE TABLE IF NOT EXISTS public.cash_handovers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  handover_no       TEXT NOT NULL UNIQUE,
  hospital_type     TEXT,

  from_user_id      UUID NOT NULL REFERENCES public."User"(id),
  from_user_name    TEXT NOT NULL,
  to_user_id        UUID NOT NULL REFERENCES public."User"(id),
  to_user_name      TEXT NOT NULL,

  period_from       TIMESTAMPTZ NOT NULL,
  period_to         TIMESTAMPTZ NOT NULL,

  expected_cash     NUMERIC(15,2) NOT NULL DEFAULT 0,
  counted_cash      NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (counted_cash >= 0),
  variance          NUMERIC(15,2) GENERATED ALWAYS AS (counted_cash - expected_cash) STORED,
  variance_reason   TEXT,

  -- Shown on the slip for reference only. Never counted, never claimed.
  ref_upi_total     NUMERIC(15,2) NOT NULL DEFAULT 0,
  ref_card_total    NUMERIC(15,2) NOT NULL DEFAULT 0,

  included_unattributed BOOLEAN NOT NULL DEFAULT false,
  source_count      INTEGER NOT NULL DEFAULT 0,

  status            TEXT NOT NULL DEFAULT 'SUBMITTED'
                    CHECK (status IN ('SUBMITTED','ACCEPTED','VERIFIED','CANCELLED')),
  submitted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at       TIMESTAMPTZ,
  accepted_by_name  TEXT,
  accept_note       TEXT,
  verified_at       TIMESTAMPTZ,
  verified_by_user_id UUID REFERENCES public."User"(id),
  verified_by_name  TEXT,
  verify_note       TEXT,
  cancelled_at      TIMESTAMPTZ,
  cancel_reason     TEXT,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- The mandatory-reason rule lives here, not on the screen, so no client can
  -- skip it. Note a CHECK cannot reference the generated column, so the
  -- arithmetic is repeated on the base columns.
  CONSTRAINT cash_handovers_variance_reason_ck CHECK (
    round(counted_cash - expected_cash, 2) = 0
    OR btrim(COALESCE(variance_reason, '')) <> ''
  ),
  CONSTRAINT cash_handovers_parties_ck CHECK (from_user_id <> to_user_id)
);

CREATE INDEX IF NOT EXISTS cash_handovers_status_idx
  ON public.cash_handovers (status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS cash_handovers_from_user_idx
  ON public.cash_handovers (from_user_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS cash_handovers_variance_idx
  ON public.cash_handovers (submitted_at DESC)
  WHERE round(counted_cash - expected_cash, 2) <> 0 AND status <> 'CANCELLED';

-- ---------------------------------------------------------- the note count

CREATE TABLE IF NOT EXISTS public.cash_handover_denominations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  handover_id  UUID NOT NULL REFERENCES public.cash_handovers(id) ON DELETE CASCADE,
  denomination INTEGER NOT NULL CHECK (denomination IN (2000,500,200,100,50,20,10,5,2,1)),
  qty          INTEGER NOT NULL CHECK (qty >= 0),
  line_total   NUMERIC(15,2) GENERATED ALWAYS AS (denomination::NUMERIC * qty) STORED,
  UNIQUE (handover_id, denomination)
);

CREATE INDEX IF NOT EXISTS cash_handover_denominations_h_idx
  ON public.cash_handover_denominations (handover_id);

-- ------------------------------------------------- the claimed receipt set

CREATE TABLE IF NOT EXISTS public.cash_handover_sources (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  handover_id   UUID NOT NULL REFERENCES public.cash_handovers(id) ON DELETE CASCADE,
  source_table  TEXT NOT NULL CHECK (source_table IN ('advance_payment','final_payments','pharmacy_sales')),
  source_id     TEXT NOT NULL,
  amount        NUMERIC(15,2) NOT NULL,
  collected_at  TIMESTAMPTZ,
  collected_by_user_id UUID,
  collected_by_label   TEXT,
  patient_name  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A receipt belongs to one handover for ever. This is both the correctness
-- backstop and the concurrency guard: a second cashier submitting the same
-- receipts at the same moment hits this and rolls back whole.
CREATE UNIQUE INDEX IF NOT EXISTS cash_handover_sources_uidx
  ON public.cash_handover_sources (source_table, source_id);
CREATE INDEX IF NOT EXISTS cash_handover_sources_h_idx
  ON public.cash_handover_sources (handover_id);

-- ---------------------------------------------------------------------- RLS

ALTER TABLE public.cash_handover_settings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_handover_verifiers     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_handovers              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_handover_denominations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_handover_sources       ENABLE ROW LEVEL SECURITY;

DO $policies$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['cash_handover_settings','cash_handover_verifiers','cash_handovers',
                           'cash_handover_denominations','cash_handover_sources'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname=t||'_all') THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL USING (true) WITH CHECK (true)', t||'_all', t);
    END IF;
  END LOOP;
END
$policies$;

-- ============================================================ read the drawer

-- What a handover would claim right now for this person. Read-only.
CREATE OR REPLACE FUNCTION public.cash_handover_preview(
  p_user_id UUID,
  p_include_unattributed BOOLEAN DEFAULT false
) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cutover TIMESTAMPTZ;
  v_mine NUMERIC := 0; v_mine_n INT := 0;
  v_uatt NUMERIC := 0; v_uatt_n INT := 0;
  v_upi NUMERIC := 0; v_card NUMERIC := 0;
  v_lines JSONB;
BEGIN
  SELECT cutover_at INTO v_cutover FROM cash_handover_settings WHERE id;

  WITH pool AS (
    SELECT a.id::text AS sid, 'advance_payment' AS tbl,
           COALESCE(a.advance_amount,0) AS amount, a.payment_date AS at,
           a.collected_by_user_id AS uid,
           COALESCE(NULLIF(btrim(a.billing_executive),''),'Not recorded') AS who,
           a.patient_name
      FROM advance_payment a
     WHERE a.cash_handover_id IS NULL
       AND upper(btrim(COALESCE(a.payment_mode,''))) = 'CASH'
       AND COALESCE(a.is_refund,false) = false
       AND COALESCE(a.status,'ACTIVE') = 'ACTIVE'
       AND COALESCE(a.advance_amount,0) > 0
       AND a.payment_date >= v_cutover
    UNION ALL
    SELECT f.id::text, 'final_payments', COALESCE(f.amount,0), f.payment_date,
           f.collected_by_user_id, 'Final bill counter', NULL
      FROM final_payments f
     WHERE f.cash_handover_id IS NULL
       AND upper(btrim(COALESCE(f.mode_of_payment,''))) = 'CASH'
       AND COALESCE(f.amount,0) > 0
       AND f.payment_date >= v_cutover
  )
  SELECT
    COALESCE(sum(amount) FILTER (WHERE uid = p_user_id), 0),
    COALESCE(count(*)    FILTER (WHERE uid = p_user_id), 0),
    COALESCE(sum(amount) FILTER (WHERE uid IS NULL), 0),
    COALESCE(count(*)    FILTER (WHERE uid IS NULL), 0),
    COALESCE(jsonb_agg(jsonb_build_object(
      'table', tbl, 'id', sid, 'amount', amount, 'at', at,
      'who', who, 'patient', patient_name, 'mine', (uid = p_user_id)
    ) ORDER BY at DESC) FILTER (WHERE uid = p_user_id OR (p_include_unattributed AND uid IS NULL)), '[]'::jsonb)
  INTO v_mine, v_mine_n, v_uatt, v_uatt_n, v_lines
  FROM pool;

  -- Reference only: today's digital collections, never part of expected cash.
  SELECT COALESCE(sum(COALESCE(advance_amount,0)) FILTER (WHERE upper(btrim(COALESCE(payment_mode,''))) IN ('UPI','ONLINE','NEFT','RTGS','PHONEPE','GPAY')), 0),
         COALESCE(sum(COALESCE(advance_amount,0)) FILTER (WHERE upper(btrim(COALESCE(payment_mode,''))) IN ('CARD','CREDIT CARD','DEBIT CARD')), 0)
    INTO v_upi, v_card
  FROM advance_payment
  WHERE COALESCE(is_refund,false) = false
    AND COALESCE(status,'ACTIVE') = 'ACTIVE'
    AND payment_date >= date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata')
    AND (collected_by_user_id = p_user_id OR collected_by_user_id IS NULL);

  RETURN jsonb_build_object(
    'cutoverAt', v_cutover,
    'mineAmount', v_mine, 'mineCount', v_mine_n,
    'unattributedAmount', v_uatt, 'unattributedCount', v_uatt_n,
    'includeUnattributed', COALESCE(p_include_unattributed,false),
    'expectedCash', v_mine + CASE WHEN COALESCE(p_include_unattributed,false) THEN v_uatt ELSE 0 END,
    'refUpiTotal', v_upi, 'refCardTotal', v_card,
    'lines', v_lines
  );
END $$;

-- ================================================================== submit

CREATE OR REPLACE FUNCTION public.submit_cash_handover(
  p_from_user_id UUID,
  p_to_user_id   UUID,
  p_denominations JSONB,
  p_hospital_type TEXT DEFAULT NULL,
  p_variance_reason TEXT DEFAULT NULL,
  p_include_unattributed BOOLEAN DEFAULT false,
  p_notes TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cutover TIMESTAMPTZ; v_from TEXT; v_to TEXT;
  v_expected NUMERIC := 0; v_counted NUMERIC := 0; v_count INT := 0;
  v_upi NUMERIC := 0; v_card NUMERIC := 0;
  v_id UUID; v_no TEXT; v_preview JSONB; v_since TIMESTAMPTZ;
BEGIN
  IF p_from_user_id IS NULL OR p_to_user_id IS NULL THEN
    RAISE EXCEPTION 'Both the person handing over and the person receiving are required';
  END IF;
  IF p_from_user_id = p_to_user_id THEN
    RAISE EXCEPTION 'Cash cannot be handed over to yourself';
  END IF;

  -- Serialise submissions so two cashiers cannot build a claim set from the
  -- same pool at the same instant. Transaction-scoped; releases on commit.
  PERFORM pg_advisory_xact_lock(hashtextextended('cash_handover_submit', 0));

  SELECT cutover_at INTO v_cutover FROM cash_handover_settings WHERE id;

  SELECT COALESCE(full_name, email) INTO v_from FROM "User" WHERE id = p_from_user_id;
  IF v_from IS NULL THEN RAISE EXCEPTION 'The person handing over is not a known user'; END IF;

  SELECT COALESCE(v.display_name, u.full_name, u.email) INTO v_to
    FROM "User" u LEFT JOIN cash_handover_verifiers v ON v.user_id = u.id
   WHERE u.id = p_to_user_id;
  IF v_to IS NULL THEN RAISE EXCEPTION 'The person receiving is not a known user'; END IF;

  IF NOT EXISTS (SELECT 1 FROM cash_handover_verifiers
                  WHERE user_id = p_to_user_id AND is_active AND can_receive) THEN
    RAISE EXCEPTION 'Cash can only be handed to a nominated receiver. Ask a director to add this person to the cash handover list.';
  END IF;

  -- Count the notes. The client sends the grid; the total is computed here.
  SELECT COALESCE(sum((d->>'denomination')::INT * (d->>'qty')::INT), 0)
    INTO v_counted
  FROM jsonb_array_elements(COALESCE(p_denominations, '[]'::jsonb)) d
  WHERE COALESCE((d->>'qty')::INT, 0) > 0;

  v_preview := cash_handover_preview(p_from_user_id, p_include_unattributed);
  v_expected := (v_preview->>'expectedCash')::NUMERIC;
  v_upi := (v_preview->>'refUpiTotal')::NUMERIC;
  v_card := (v_preview->>'refCardTotal')::NUMERIC;

  IF round(v_counted - v_expected, 2) <> 0 AND btrim(COALESCE(p_variance_reason,'')) = '' THEN
    RAISE EXCEPTION 'The counted cash differs from the software figure by %. Give a reason and the handover will still go through.',
      to_char(abs(v_counted - v_expected), 'FM9,99,99,990.00');
  END IF;

  SELECT COALESCE(min(at), now()) INTO v_since
    FROM jsonb_to_recordset(v_preview->'lines') AS x(at TIMESTAMPTZ);

  v_no := 'CH-' || to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYMMDD') || '-' ||
          lpad(nextval('cash_handover_no_seq')::TEXT, 4, '0');

  INSERT INTO cash_handovers (
    handover_no, hospital_type, from_user_id, from_user_name, to_user_id, to_user_name,
    period_from, period_to, expected_cash, counted_cash, variance_reason,
    ref_upi_total, ref_card_total, included_unattributed, notes
  ) VALUES (
    v_no, p_hospital_type, p_from_user_id, v_from, p_to_user_id, v_to,
    COALESCE(v_since, v_cutover), now(), v_expected, v_counted,
    NULLIF(btrim(COALESCE(p_variance_reason,'')), ''),
    v_upi, v_card, COALESCE(p_include_unattributed,false), NULLIF(btrim(COALESCE(p_notes,'')), '')
  ) RETURNING id INTO v_id;

  INSERT INTO cash_handover_denominations (handover_id, denomination, qty)
  SELECT v_id, (d->>'denomination')::INT, (d->>'qty')::INT
    FROM jsonb_array_elements(COALESCE(p_denominations, '[]'::jsonb)) d
   WHERE COALESCE((d->>'qty')::INT, 0) > 0;

  -- Claim the receipts. The unique index makes a double claim impossible; the
  -- whole transaction rolls back rather than claiming half a drawer.
  INSERT INTO cash_handover_sources (handover_id, source_table, source_id, amount,
                                     collected_at, collected_by_user_id, collected_by_label, patient_name)
  SELECT v_id, x.tbl, x.id, x.amount, x.at, p_from_user_id, x.who, x.patient
    FROM jsonb_to_recordset(v_preview->'lines')
      AS x(tbl TEXT, id TEXT, amount NUMERIC, at TIMESTAMPTZ, who TEXT, patient TEXT, mine BOOLEAN);
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE advance_payment SET cash_handover_id = v_id
   WHERE id::text IN (SELECT source_id FROM cash_handover_sources
                       WHERE handover_id = v_id AND source_table = 'advance_payment');
  UPDATE final_payments SET cash_handover_id = v_id
   WHERE id::text IN (SELECT source_id FROM cash_handover_sources
                       WHERE handover_id = v_id AND source_table = 'final_payments');

  UPDATE cash_handovers SET source_count = v_count WHERE id = v_id;

  RETURN jsonb_build_object(
    'handoverId', v_id, 'handoverNo', v_no,
    'expectedCash', v_expected, 'countedCash', v_counted,
    'variance', v_counted - v_expected, 'sourceCount', v_count
  );
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Someone handed over these receipts a moment ago. Reopen the screen and count again.';
END $$;

-- ================================================= accept / verify / cancel

CREATE OR REPLACE FUNCTION public.accept_cash_handover(
  p_handover_id UUID, p_user_id UUID, p_note TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_no TEXT; v_status TEXT; v_name TEXT;
BEGIN
  SELECT COALESCE(full_name, email) INTO v_name FROM "User" WHERE id = p_user_id;
  IF v_name IS NULL THEN RAISE EXCEPTION 'Unknown user'; END IF;

  -- Claim-then-act: only the caller that actually flipped the row proceeds.
  UPDATE cash_handovers
     SET status = 'ACCEPTED', accepted_at = now(), accepted_by_name = v_name,
         accept_note = NULLIF(btrim(COALESCE(p_note,'')), ''), updated_at = now()
   WHERE id = p_handover_id AND status = 'SUBMITTED' AND to_user_id = p_user_id
   RETURNING handover_no INTO v_no;

  IF v_no IS NULL THEN
    SELECT status INTO v_status FROM cash_handovers WHERE id = p_handover_id;
    IF v_status IS NULL THEN RAISE EXCEPTION 'That handover no longer exists'; END IF;
    IF v_status <> 'SUBMITTED' THEN RAISE EXCEPTION 'This handover was already %', lower(v_status); END IF;
    RAISE EXCEPTION 'Only the person named as receiving this cash can accept it';
  END IF;

  RETURN jsonb_build_object('handoverNo', v_no, 'status', 'ACCEPTED');
END $$;

CREATE OR REPLACE FUNCTION public.verify_cash_handover(
  p_handover_id UUID, p_user_id UUID, p_note TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_no TEXT; v_status TEXT; v_name TEXT; v_from UUID;
BEGIN
  SELECT COALESCE(v.display_name, u.full_name, u.email) INTO v_name
    FROM "User" u LEFT JOIN cash_handover_verifiers v ON v.user_id = u.id
   WHERE u.id = p_user_id;
  IF v_name IS NULL THEN RAISE EXCEPTION 'Unknown user'; END IF;

  IF NOT EXISTS (SELECT 1 FROM cash_handover_verifiers
                  WHERE user_id = p_user_id AND is_active AND can_verify) THEN
    RAISE EXCEPTION 'Only a nominated verifier can confirm a cash count';
  END IF;

  SELECT from_user_id INTO v_from FROM cash_handovers WHERE id = p_handover_id;
  IF v_from = p_user_id THEN
    RAISE EXCEPTION 'The person who handed the cash over cannot verify their own count';
  END IF;

  UPDATE cash_handovers
     SET status = 'VERIFIED', verified_at = now(), verified_by_user_id = p_user_id,
         verified_by_name = v_name, verify_note = NULLIF(btrim(COALESCE(p_note,'')), ''),
         updated_at = now()
   WHERE id = p_handover_id AND status = 'ACCEPTED'
   RETURNING handover_no INTO v_no;

  IF v_no IS NULL THEN
    SELECT status INTO v_status FROM cash_handovers WHERE id = p_handover_id;
    IF v_status IS NULL THEN RAISE EXCEPTION 'That handover no longer exists'; END IF;
    RAISE EXCEPTION 'A handover must be accepted by the receiver before it can be verified (this one is %)', lower(v_status);
  END IF;

  RETURN jsonb_build_object('handoverNo', v_no, 'status', 'VERIFIED');
END $$;

CREATE OR REPLACE FUNCTION public.cancel_cash_handover(
  p_handover_id UUID, p_user_id UUID, p_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_no TEXT;
BEGIN
  IF btrim(COALESCE(p_reason,'')) = '' THEN RAISE EXCEPTION 'Give a reason for cancelling'; END IF;

  UPDATE cash_handovers
     SET status = 'CANCELLED', cancelled_at = now(), cancel_reason = btrim(p_reason), updated_at = now()
   WHERE id = p_handover_id AND status = 'SUBMITTED' AND from_user_id = p_user_id
   RETURNING handover_no INTO v_no;

  IF v_no IS NULL THEN
    RAISE EXCEPTION 'Only the person who submitted it can cancel, and only before it is accepted';
  END IF;

  -- Release the receipts back into the drawer.
  UPDATE advance_payment SET cash_handover_id = NULL WHERE cash_handover_id = p_handover_id;
  UPDATE final_payments  SET cash_handover_id = NULL WHERE cash_handover_id = p_handover_id;
  DELETE FROM cash_handover_sources WHERE handover_id = p_handover_id;

  RETURN jsonb_build_object('handoverNo', v_no, 'status', 'CANCELLED');
END $$;

-- ============================================== who is holding cash right now

CREATE OR REPLACE FUNCTION public.cash_position_by_holder()
RETURNS TABLE (
  holder_user_id UUID, holder_name TEXT, net_cash NUMERIC,
  receipt_count INTEGER, oldest_uncollected TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH cutover AS (SELECT cutover_at FROM cash_handover_settings WHERE id),
  pool AS (
    SELECT a.collected_by_user_id AS uid, COALESCE(a.advance_amount,0) AS amount, a.payment_date AS at
      FROM advance_payment a, cutover c
     WHERE a.cash_handover_id IS NULL
       AND upper(btrim(COALESCE(a.payment_mode,''))) = 'CASH'
       AND COALESCE(a.is_refund,false) = false
       AND COALESCE(a.status,'ACTIVE') = 'ACTIVE'
       AND COALESCE(a.advance_amount,0) > 0
       AND a.payment_date >= c.cutover_at
    UNION ALL
    SELECT f.collected_by_user_id, COALESCE(f.amount,0), f.payment_date
      FROM final_payments f, cutover c
     WHERE f.cash_handover_id IS NULL
       AND upper(btrim(COALESCE(f.mode_of_payment,''))) = 'CASH'
       AND COALESCE(f.amount,0) > 0
       AND f.payment_date >= c.cutover_at
  )
  SELECT p.uid,
         COALESCE(u.full_name, u.email, 'Not recorded') AS holder_name,
         sum(p.amount)::NUMERIC, count(*)::INT, min(p.at)
    FROM pool p LEFT JOIN "User" u ON u.id = p.uid
   GROUP BY p.uid, COALESCE(u.full_name, u.email, 'Not recorded')
   ORDER BY sum(p.amount) DESC;
$$;

-- ==================================================== verifier master write

CREATE OR REPLACE FUNCTION public.set_cash_handover_verifier(
  p_user_id UUID,
  p_can_receive BOOLEAN DEFAULT true,
  p_can_verify BOOLEAN DEFAULT true,
  p_is_active BOOLEAN DEFAULT true,
  p_actor TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_name TEXT;
BEGIN
  SELECT COALESCE(full_name, email) INTO v_name FROM "User" WHERE id = p_user_id;
  IF v_name IS NULL THEN RAISE EXCEPTION 'Unknown user'; END IF;
  IF NOT (p_can_receive OR p_can_verify) THEN
    RAISE EXCEPTION 'A nominated person must be able to receive cash, verify it, or both';
  END IF;

  INSERT INTO cash_handover_verifiers (user_id, display_name, can_receive, can_verify, is_active, added_by)
  VALUES (p_user_id, v_name, p_can_receive, p_can_verify, p_is_active, p_actor)
  ON CONFLICT (user_id) DO UPDATE
    SET display_name = EXCLUDED.display_name, can_receive = EXCLUDED.can_receive,
        can_verify = EXCLUDED.can_verify, is_active = EXCLUDED.is_active,
        added_by = COALESCE(EXCLUDED.added_by, cash_handover_verifiers.added_by),
        updated_at = now();

  RETURN jsonb_build_object('userId', p_user_id, 'name', v_name);
END $$;

REVOKE ALL ON FUNCTION public.cash_handover_preview(UUID, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_cash_handover(UUID, UUID, JSONB, TEXT, TEXT, BOOLEAN, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_cash_handover(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_cash_handover(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_cash_handover(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cash_position_by_holder() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_cash_handover_verifier(UUID, BOOLEAN, BOOLEAN, BOOLEAN, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.cash_handover_preview(UUID, BOOLEAN) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_cash_handover(UUID, UUID, JSONB, TEXT, TEXT, BOOLEAN, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_cash_handover(UUID, UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_cash_handover(UUID, UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_cash_handover(UUID, UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cash_position_by_holder() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_cash_handover_verifier(UUID, BOOLEAN, BOOLEAN, BOOLEAN, TEXT) TO anon, authenticated;

-- ================================================================== verify

DO $verify$
DECLARE
  v_u1 UUID; v_u2 UUID; v_h UUID; v_ok BOOLEAN;
BEGIN
  SELECT id INTO v_u1 FROM "User" WHERE is_active IS NOT false ORDER BY created_at LIMIT 1;
  SELECT id INTO v_u2 FROM "User" WHERE id <> v_u1 ORDER BY created_at LIMIT 1;
  IF v_u1 IS NULL OR v_u2 IS NULL THEN
    RAISE EXCEPTION 'ABORT: need two users to self-test';
  END IF;

  -- (a) a mismatch with NO reason must be rejected by the database itself
  v_ok := false;
  BEGIN
    INSERT INTO cash_handovers (handover_no, from_user_id, from_user_name, to_user_id, to_user_name,
                                period_from, period_to, expected_cash, counted_cash)
    VALUES ('CH-SELFTEST-A', v_u1, 'a', v_u2, 'b', now(), now(), 1000, 900);
  EXCEPTION WHEN check_violation THEN v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'ABORT: a shortage without a reason was accepted'; END IF;

  -- (b) the same mismatch WITH a reason must go through
  INSERT INTO cash_handovers (handover_no, from_user_id, from_user_name, to_user_id, to_user_name,
                              period_from, period_to, expected_cash, counted_cash, variance_reason)
  VALUES ('CH-SELFTEST-B', v_u1, 'a', v_u2, 'b', now(), now(), 1000, 900, 'short by 100, counted twice')
  RETURNING id INTO v_h;
  IF (SELECT variance FROM cash_handovers WHERE id = v_h) <> -100 THEN
    RAISE EXCEPTION 'ABORT: variance did not compute';
  END IF;

  -- (c) the same receipt cannot be claimed twice
  INSERT INTO cash_handover_sources (handover_id, source_table, source_id, amount)
  VALUES (v_h, 'advance_payment', 'selftest-receipt', 100);
  v_ok := false;
  BEGIN
    INSERT INTO cash_handover_sources (handover_id, source_table, source_id, amount)
    VALUES (v_h, 'advance_payment', 'selftest-receipt', 100);
  EXCEPTION WHEN unique_violation THEN v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'ABORT: the same receipt was claimed twice'; END IF;

  -- (d) handing over to yourself is impossible
  v_ok := false;
  BEGIN
    INSERT INTO cash_handovers (handover_no, from_user_id, from_user_name, to_user_id, to_user_name,
                                period_from, period_to, expected_cash, counted_cash)
    VALUES ('CH-SELFTEST-D', v_u1, 'a', v_u1, 'a', now(), now(), 0, 0);
  EXCEPTION WHEN check_violation THEN v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'ABORT: a self-handover was accepted'; END IF;

  DELETE FROM cash_handovers WHERE handover_no LIKE 'CH-SELFTEST-%';

  IF EXISTS (SELECT 1 FROM cash_handovers WHERE handover_no LIKE 'CH-SELFTEST-%') THEN
    RAISE EXCEPTION 'ABORT: self-test rows were left behind';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
