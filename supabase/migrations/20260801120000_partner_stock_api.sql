-- Partner pharmacy stock & ordering API.
--
-- An outside piece of software (a buyer — clinic, ward, branch, another
-- hospital) needs to see our medicine stock and place orders against it. This
-- migration creates the machinery it talks to. It is ADDITIVE: no existing
-- table is altered except for one new index, and nothing in the pharmacy
-- screens changes behaviour until a partner key is issued.
--
-- WHY THE STOCK MATHS LIVES HERE AND NOT IN THE API LAYER
-- Every stock write in the app today is a browser read-modify-write: SELECT the
-- batch, compute a new number in JavaScript, UPDATE it (PharmacyBilling.tsx,
-- DirectSaleBill.tsx, PrescriptionQueue.tsx, src/lib/batch-inventory-service.ts).
-- Two concurrent sales of the same batch lose one update. That is survivable
-- when the only writers are a handful of staff on one counter; it is not
-- survivable once a machine can call it in a loop. So the partner path does its
-- allocation inside one transaction with FOR UPDATE row locks, and an order
-- that cannot be filled in full changes nothing at all.
--
-- WHY RESERVING IS ENOUGH TO MAKE STOCK CORRECT EVERYWHERE ELSE
-- medicine_batch_inventory carries a CHECK tying the quantity columns together:
--
--   current_stock = received_quantity + free_quantity ( + adjustment_quantity )
--                 - sold_quantity - reserved_stock
--
-- Every move below shifts two columns in opposite directions, so the invariant
-- holds under either version of that constraint (the adjustment_quantity column
-- exists in the live database but in no migration file — see the schema-drift
-- note at the bottom):
--
--   reserve  current_stock -N   reserved_stock +N
--   confirm  reserved_stock -N  sold_quantity  +N
--   cancel   reserved_stock -N  current_stock  +N
--
-- current_stock already *means* "available to sell" and is what every existing
-- screen reads, so a partner reservation immediately hides that quantity from
-- the pharmacy counter without one line of frontend change.
--
-- ISOLATION IS ENFORCED IN CODE, NOT RLS. App traffic reaches PostgREST as the
-- anon role (auth is a custom User table, so auth.uid() is NULL), policies
-- across pharmacy tables are inconsistent and several tables have none at all.
-- The tables below therefore have RLS on and DELIBERATELY NO POLICIES: anon and
-- authenticated cannot touch them, and every read or write goes through the
-- service-role key in api/partner/*.ts or the SECURITY DEFINER functions here.
--
-- Safe to run twice.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
SET search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- One row per external system we have issued a key to. The plaintext key is
-- returned once by partner_create_api_key() and never stored; reading this
-- whole table gives an attacker nothing but prefixes.
--
-- hospital_name is the tenant scope and is read from HERE, never from the
-- request — a partner cannot ask for another hospital's stock by changing a
-- query parameter.
CREATE TABLE IF NOT EXISTS public.partner_api_clients (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_name      TEXT NOT NULL,
  contact_email     TEXT,
  key_prefix        TEXT NOT NULL,              -- first 8 chars, for display only
  api_key_hash      TEXT NOT NULL UNIQUE,       -- sha256(plaintext key)
  hospital_name     VARCHAR(100) NOT NULL,
  scopes            TEXT[] NOT NULL DEFAULT ARRAY['stock:read','orders:write'],
  rate_limit_per_min INTEGER NOT NULL DEFAULT 60,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  last_used_at      TIMESTAMPTZ,
  revoked_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes             TEXT
);

CREATE INDEX IF NOT EXISTS partner_api_clients_hash_idx ON public.partner_api_clients (api_key_hash);

-- partner_ref is the partner's own order id. The UNIQUE below is what makes
-- POST /orders idempotent: a retried request after a network timeout returns
-- the first order instead of deducting stock twice.
CREATE TABLE IF NOT EXISTS public.partner_orders (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number  TEXT NOT NULL UNIQUE,
  partner_id    UUID NOT NULL REFERENCES public.partner_api_clients(id) ON DELETE RESTRICT,
  partner_ref   TEXT,
  hospital_name VARCHAR(100) NOT NULL,
  status        TEXT NOT NULL DEFAULT 'PENDING'
                CHECK (status IN ('PENDING','DISPATCHED','CANCELLED','REJECTED')),
  total_amount  NUMERIC(15,2) NOT NULL DEFAULT 0,
  notes         TEXT,
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_by  TEXT,
  confirmed_at  TIMESTAMPTZ,
  closed_reason TEXT,
  closed_at     TIMESTAMPTZ,
  CONSTRAINT partner_orders_ref_unique UNIQUE (partner_id, partner_ref)
);

CREATE INDEX IF NOT EXISTS partner_orders_status_idx  ON public.partner_orders (hospital_name, status, requested_at DESC);
CREATE INDEX IF NOT EXISTS partner_orders_partner_idx ON public.partner_orders (partner_id, requested_at DESC);

-- One row per allocated batch, not per requested medicine: asking for 100 of a
-- drug that sits in three batches produces three rows. The partner needs this —
-- batch number and expiry are what they print on their own label.
CREATE TABLE IF NOT EXISTS public.partner_order_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            UUID NOT NULL REFERENCES public.partner_orders(id) ON DELETE CASCADE,
  medicine_id         UUID NOT NULL,
  medicine_name       TEXT,
  batch_inventory_id  UUID NOT NULL REFERENCES public.medicine_batch_inventory(id) ON DELETE RESTRICT,
  batch_number        VARCHAR(100),
  expiry_date         DATE,
  quantity            INTEGER NOT NULL CHECK (quantity > 0),
  unit_price          NUMERIC(10,2),
  mrp                 NUMERIC(10,2),
  line_amount         NUMERIC(15,2),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS partner_order_items_order_idx ON public.partner_order_items (order_id);
CREATE INDEX IF NOT EXISTS partner_order_items_batch_idx ON public.partner_order_items (batch_inventory_id);

-- Request log. Exists so that "the partner says they called us" is answerable,
-- and so an abusive key can be spotted. Written by api/partner/_client.ts.
CREATE TABLE IF NOT EXISTS public.partner_api_log (
  id          BIGSERIAL PRIMARY KEY,
  partner_id  UUID REFERENCES public.partner_api_clients(id) ON DELETE SET NULL,
  key_prefix  TEXT,
  endpoint    TEXT NOT NULL,
  method      TEXT,
  status_code INTEGER,
  request_id  TEXT,
  ip          TEXT,
  duration_ms INTEGER,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS partner_api_log_partner_idx ON public.partner_api_log (partner_id, created_at DESC);

ALTER TABLE public.partner_api_clients  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_orders       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_order_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_api_log      ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.partner_api_clients FROM anon, authenticated;
REVOKE ALL ON public.partner_orders      FROM anon, authenticated;
REVOKE ALL ON public.partner_order_items FROM anon, authenticated;
REVOKE ALL ON public.partner_api_log     FROM anon, authenticated;

-- The one change to an existing table: the index behind ?since=<watermark>
-- polling. Without it every partner poll sequential-scans the batch table.
CREATE INDEX IF NOT EXISTS idx_batch_inventory_hospital_updated
  ON public.medicine_batch_inventory (hospital_name, updated_at DESC);

-- Order numbers: PORD-YYMMDD-0001
CREATE SEQUENCE IF NOT EXISTS public.partner_order_seq;

-- ---------------------------------------------------------------------------
-- partner_create_api_key — service_role ONLY
-- ---------------------------------------------------------------------------
--
-- Returns the PLAINTEXT key, once. That is why it is not granted to anon: a
-- browser that could call this could mint itself a key. Run it from the
-- Supabase SQL editor when onboarding a partner, copy the key out of the
-- result, hand it over, and never look for it again — it is not recoverable.
CREATE OR REPLACE FUNCTION public.partner_create_api_key(
  p_partner_name  TEXT,
  p_hospital_name TEXT,
  p_contact_email TEXT DEFAULT NULL,
  p_scopes        TEXT[] DEFAULT ARRAY['stock:read','orders:write'],
  p_rate_limit    INTEGER DEFAULT 60
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_key TEXT;
  v_id  UUID;
BEGIN
  -- 32 random bytes. The 'adk_' prefix makes a leaked key greppable in logs.
  v_key := 'adk_' || encode(gen_random_bytes(32), 'hex');

  INSERT INTO public.partner_api_clients
    (partner_name, contact_email, key_prefix, api_key_hash, hospital_name, scopes, rate_limit_per_min)
  VALUES
    (p_partner_name, p_contact_email, left(v_key, 12),
     encode(digest(v_key, 'sha256'), 'hex'), p_hospital_name, p_scopes, p_rate_limit)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'ok', true,
    'partner_id', v_id,
    'partner_name', p_partner_name,
    'hospital_name', p_hospital_name,
    'api_key', v_key,
    'warning', 'Copy this key now. It is stored only as a hash and cannot be shown again.'
  );
END;
$$;

COMMENT ON FUNCTION public.partner_create_api_key(TEXT, TEXT, TEXT, TEXT[], INTEGER) IS
'Issues a partner API key and returns the plaintext exactly once. service_role ONLY.';

-- ---------------------------------------------------------------------------
-- partner_reserve_order — service_role ONLY
-- ---------------------------------------------------------------------------
--
-- p_items: [{"medicine_id": "<uuid>", "quantity": 10}, ...]
--
-- Two passes on purpose. The first pass locks and allocates batches FEFO but
-- writes nothing; if any line is short it returns a per-line shortfall and the
-- transaction has made no change to roll back. Only once every line is covered
-- does the second pass write. So a partner asking for more than we have gets a
-- useful answer AND an untouched shelf — unlike PharmacyBilling.tsx:770, which
-- clamps the deduction to zero, shows an alert(), and completes the sale.
--
-- Never raises for a business outcome; always returns jsonb, following
-- request_invoice_otp in 20260726100000_invoice_otp_gate.sql.
CREATE OR REPLACE FUNCTION public.partner_reserve_order(
  p_partner_id  UUID,
  p_partner_ref TEXT,
  p_items       JSONB,
  p_notes       TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_partner  public.partner_api_clients%ROWTYPE;
  v_existing UUID;
  v_order_id UUID;
  v_order_no TEXT;
  v_med      UUID;
  v_qty      INTEGER;
  v_need     INTEGER;
  v_take     INTEGER;
  v_batch    RECORD;
  v_name     TEXT;
  v_price    NUMERIC;
  v_alloc    JSONB := '[]'::jsonb;
  v_short    JSONB := '[]'::jsonb;
  v_line     JSONB;
  v_total    NUMERIC := 0;
BEGIN
  SELECT * INTO v_partner
  FROM public.partner_api_clients
  WHERE id = p_partner_id AND is_active AND revoked_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unknown_partner');
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_items');
  END IF;

  -- Idempotency. A retry of the same partner_ref must not deduct twice.
  IF p_partner_ref IS NOT NULL AND btrim(p_partner_ref) <> '' THEN
    SELECT id INTO v_existing
    FROM public.partner_orders
    WHERE partner_id = p_partner_id AND partner_ref = p_partner_ref;

    IF FOUND THEN
      RETURN public.partner_order_json(v_existing) || jsonb_build_object('duplicate', true);
    END IF;
  END IF;

  -- ---- Pass 1: lock and allocate, write nothing ----------------------------
  FOR v_med, v_qty IN
    SELECT (e->>'medicine_id')::UUID, SUM((e->>'quantity')::INTEGER)
    FROM jsonb_array_elements(p_items) e
    WHERE (e->>'medicine_id') IS NOT NULL
    GROUP BY 1
  LOOP
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'bad_quantity', 'medicine_id', v_med);
    END IF;

    SELECT medicine_name INTO v_name FROM public.medicine_master WHERE id = v_med;
    v_need := v_qty;

    -- FEFO, matching get_available_batches() and PrescriptionQueue.tsx.
    -- FOR UPDATE holds these rows until the transaction ends, which is what
    -- makes two simultaneous orders for the last strip resolve to one winner.
    FOR v_batch IN
      SELECT id, batch_number, expiry_date, current_stock, selling_price, mrp
      FROM public.medicine_batch_inventory
      WHERE medicine_id = v_med
        AND hospital_name = v_partner.hospital_name
        AND is_active
        AND current_stock > 0
        AND expiry_date > CURRENT_DATE
      ORDER BY expiry_date ASC, id ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_need <= 0;
      v_take  := LEAST(v_need, v_batch.current_stock);
      v_price := COALESCE(v_batch.selling_price, v_batch.mrp, 0);

      v_alloc := v_alloc || jsonb_build_object(
        'medicine_id',   v_med,
        'medicine_name', v_name,
        'batch_id',      v_batch.id,
        'batch_number',  v_batch.batch_number,
        'expiry_date',   v_batch.expiry_date,
        'quantity',      v_take,
        'unit_price',    v_price,
        'mrp',           v_batch.mrp
      );

      v_need := v_need - v_take;
    END LOOP;

    IF v_need > 0 THEN
      v_short := v_short || jsonb_build_object(
        'medicine_id',   v_med,
        'medicine_name', v_name,
        'requested',     v_qty,
        'available',     v_qty - v_need,
        'short_by',      v_need
      );
    END IF;
  END LOOP;

  -- All-or-nothing. Nothing has been written, so there is nothing to undo.
  IF jsonb_array_length(v_short) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'insufficient_stock', 'shortfalls', v_short);
  END IF;

  IF jsonb_array_length(v_alloc) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_items');
  END IF;

  -- ---- Pass 2: write ------------------------------------------------------
  v_order_no := 'PORD-' || to_char(now(), 'YYMMDD') || '-' ||
                lpad(nextval('public.partner_order_seq')::TEXT, 4, '0');

  INSERT INTO public.partner_orders
    (order_number, partner_id, partner_ref, hospital_name, status, notes)
  VALUES
    (v_order_no, p_partner_id, NULLIF(btrim(COALESCE(p_partner_ref, '')), ''),
     v_partner.hospital_name, 'PENDING', p_notes)
  RETURNING id INTO v_order_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_alloc)
  LOOP
    v_take  := (v_line->>'quantity')::INTEGER;
    v_price := COALESCE((v_line->>'unit_price')::NUMERIC, 0);

    -- current_stock down, reserved_stock up: the shelf figure drops now, the
    -- sale is not booked until staff confirm.
    UPDATE public.medicine_batch_inventory
       SET current_stock   = current_stock - v_take,
           reserved_stock  = reserved_stock + v_take
     WHERE id = (v_line->>'batch_id')::UUID;

    INSERT INTO public.partner_order_items
      (order_id, medicine_id, medicine_name, batch_inventory_id, batch_number,
       expiry_date, quantity, unit_price, mrp, line_amount)
    VALUES
      (v_order_id, (v_line->>'medicine_id')::UUID, v_line->>'medicine_name',
       (v_line->>'batch_id')::UUID, v_line->>'batch_number',
       NULLIF(v_line->>'expiry_date','')::DATE, v_take, v_price,
       NULLIF(v_line->>'mrp','')::NUMERIC, v_price * v_take);

    v_total := v_total + (v_price * v_take);

    -- The AFTER UPDATE trigger log_batch_stock_movement() has just written a
    -- movement row for us, but with reason 'Auto-logged stock change' and no
    -- reference. Enrich that row rather than inserting a second one — two rows
    -- per movement is the existing mess in GRN posting and direct sales, and
    -- there is no reason to add to it. We hold the batch lock, so the newest
    -- movement row for this batch is unambiguously ours.
    UPDATE public.batch_stock_movements
       SET reference_type   = 'PARTNER_ORDER',
           reference_id     = v_order_id,
           reference_number = v_order_no,
           reason           = 'Reserved for partner order ' || v_order_no
     WHERE id = (
       SELECT id FROM public.batch_stock_movements
       WHERE batch_inventory_id = (v_line->>'batch_id')::UUID
       ORDER BY movement_date DESC, id DESC LIMIT 1
     )
       AND reason = 'Auto-logged stock change';
  END LOOP;

  UPDATE public.partner_orders SET total_amount = v_total WHERE id = v_order_id;

  RETURN public.partner_order_json(v_order_id);
END;
$$;

COMMENT ON FUNCTION public.partner_reserve_order(UUID, TEXT, JSONB, TEXT) IS
'Allocates batches FEFO and moves current_stock into reserved_stock in one transaction. All-or-nothing. service_role ONLY.';

-- ---------------------------------------------------------------------------
-- partner_confirm_order — staff action
-- ---------------------------------------------------------------------------
--
-- The stock left the shelf at reserve time; this books it as sold.
-- Deliberately writes NO batch_stock_movements row: current_stock does not
-- change here, so a movement row would have to claim a quantity change of zero.
-- The movement written at reserve time already records the stock leaving, and
-- partner_orders.confirmed_by / confirmed_at records who released it.
CREATE OR REPLACE FUNCTION public.partner_confirm_order(
  p_order_id UUID,
  p_user     TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_status TEXT;
  v_item   RECORD;
BEGIN
  SELECT status INTO v_status FROM public.partner_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found');
  END IF;
  IF v_status <> 'PENDING' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_pending', 'status', v_status);
  END IF;

  FOR v_item IN
    SELECT batch_inventory_id, quantity FROM public.partner_order_items WHERE order_id = p_order_id
  LOOP
    UPDATE public.medicine_batch_inventory
       SET reserved_stock = reserved_stock - v_item.quantity,
           sold_quantity  = sold_quantity  + v_item.quantity
     WHERE id = v_item.batch_inventory_id;
  END LOOP;

  UPDATE public.partner_orders
     SET status = 'DISPATCHED', confirmed_by = p_user, confirmed_at = now()
   WHERE id = p_order_id;

  RETURN public.partner_order_json(p_order_id);
END;
$$;

COMMENT ON FUNCTION public.partner_confirm_order(UUID, TEXT) IS
'Books a reserved partner order as sold (reserved_stock -> sold_quantity).';

-- ---------------------------------------------------------------------------
-- partner_cancel_order — staff reject or partner cancel
-- ---------------------------------------------------------------------------
--
-- Puts the reserved quantity back on the shelf. p_status separates a partner
-- pulling their own order from us refusing it; both restore identically.
CREATE OR REPLACE FUNCTION public.partner_cancel_order(
  p_order_id UUID,
  p_reason   TEXT DEFAULT NULL,
  p_status   TEXT DEFAULT 'CANCELLED',
  p_user     TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_status TEXT;
  v_item   RECORD;
BEGIN
  IF p_status NOT IN ('CANCELLED','REJECTED') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_status');
  END IF;

  SELECT status INTO v_status FROM public.partner_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found');
  END IF;
  IF v_status <> 'PENDING' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_pending', 'status', v_status);
  END IF;

  FOR v_item IN
    SELECT batch_inventory_id, quantity FROM public.partner_order_items WHERE order_id = p_order_id
  LOOP
    UPDATE public.medicine_batch_inventory
       SET reserved_stock = reserved_stock - v_item.quantity,
           current_stock  = current_stock  + v_item.quantity
     WHERE id = v_item.batch_inventory_id;

    -- Same enrich-the-auto-row treatment as the reserve path.
    UPDATE public.batch_stock_movements
       SET reference_type   = 'PARTNER_ORDER',
           reference_id     = p_order_id,
           reason           = 'Partner order released (' || lower(p_status) || ')'
     WHERE id = (
       SELECT id FROM public.batch_stock_movements
       WHERE batch_inventory_id = v_item.batch_inventory_id
       ORDER BY movement_date DESC, id DESC LIMIT 1
     )
       AND reason = 'Auto-logged stock change';
  END LOOP;

  UPDATE public.partner_orders
     SET status = p_status, closed_reason = p_reason, closed_at = now(),
         confirmed_by = COALESCE(p_user, confirmed_by)
   WHERE id = p_order_id;

  RETURN public.partner_order_json(p_order_id);
END;
$$;

COMMENT ON FUNCTION public.partner_cancel_order(UUID, TEXT, TEXT, TEXT) IS
'Releases a pending partner order, returning reserved_stock to current_stock.';

-- ---------------------------------------------------------------------------
-- partner_order_json — one shape for every caller
-- ---------------------------------------------------------------------------
--
-- Declared last but referenced above; plpgsql resolves function calls at run
-- time, so the forward reference is fine.
CREATE OR REPLACE FUNCTION public.partner_order_json(p_order_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT jsonb_build_object(
    'ok',            true,
    'order_id',      o.id,
    'order_number',  o.order_number,
    'partner_ref',   o.partner_ref,
    'status',        o.status,
    'total_amount',  o.total_amount,
    'requested_at',  o.requested_at,
    'confirmed_at',  o.confirmed_at,
    'notes',         o.notes,
    'closed_reason', o.closed_reason,
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'medicine_id',   i.medicine_id,
        'medicine_name', i.medicine_name,
        'batch_number',  i.batch_number,
        'expiry_date',   i.expiry_date,
        'quantity',      i.quantity,
        'unit_price',    i.unit_price,
        'mrp',           i.mrp,
        'line_amount',   i.line_amount
      ) ORDER BY i.medicine_name, i.expiry_date)
      FROM public.partner_order_items i WHERE i.order_id = o.id
    ), '[]'::jsonb)
  )
  FROM public.partner_orders o WHERE o.id = p_order_id;
$$;

COMMENT ON FUNCTION public.partner_order_json(UUID) IS
'Canonical JSON shape for a partner order and its allocated batches.';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
--
-- Every one of these is service_role only. The browser never calls them
-- directly: partner traffic arrives at api/partner/*.ts and staff actions at
-- api/partner/admin-order.ts, both of which hold the service key server-side.
REVOKE ALL ON FUNCTION public.partner_create_api_key(TEXT, TEXT, TEXT, TEXT[], INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.partner_reserve_order(UUID, TEXT, JSONB, TEXT)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.partner_confirm_order(UUID, TEXT)                          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.partner_cancel_order(UUID, TEXT, TEXT, TEXT)               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.partner_order_json(UUID)                                   FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.partner_create_api_key(TEXT, TEXT, TEXT, TEXT[], INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.partner_reserve_order(UUID, TEXT, JSONB, TEXT)            TO service_role;
GRANT EXECUTE ON FUNCTION public.partner_confirm_order(UUID, TEXT)                          TO service_role;
GRANT EXECUTE ON FUNCTION public.partner_cancel_order(UUID, TEXT, TEXT, TEXT)               TO service_role;
GRANT EXECUTE ON FUNCTION public.partner_order_json(UUID)                                   TO service_role;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Schema-drift note
-- ---------------------------------------------------------------------------
-- medicine_batch_inventory.adjustment_quantity and pieces_per_pack exist in the
-- live database but in no migration file, and check_current_stock_valid has been
-- widened out-of-band to include adjustment_quantity. Nothing above depends on
-- either fact: each function moves two quantity columns in opposite directions,
-- which satisfies the constraint in both its narrow and widened form. If that
-- constraint is ever changed to something that is not a simple sum, revisit
-- partner_reserve_order, partner_confirm_order and partner_cancel_order.
--
-- Quantities here are in whatever unit medicine_batch_inventory holds, which
-- postGRN() (src/lib/grn-service.ts) fills in PIECES, not packs. The API
-- documents this and exposes pieces_per_pack so the partner can convert.
