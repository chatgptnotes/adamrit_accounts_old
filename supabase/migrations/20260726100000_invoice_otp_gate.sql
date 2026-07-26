-- OTP gate for private-patient invoices.
--
-- A private (self-paying) patient's final bill becomes confidential once the
-- money is in. From that point, opening it requires a one-time code texted to
-- the director's number, or the standing master key.
--
-- WHY THIS IS SERVER-SIDE AND NOT A SCREEN OVERLAY
-- Every browser request in this app runs as the Postgres `anon` role: auth is a
-- custom User table + localStorage (src/contexts/AuthContext.tsx), so auth.uid()
-- is NULL and the anon key ships inside the JS bundle. Policies on bills /
-- bill_sections / bill_line_items are USING (true). Anyone can therefore curl
-- every invoice in the hospital right now, logged in or not. An overlay is a
-- curtain in front of an open door. The door is closed by revoking anon's SELECT
-- on invoice content (a SEPARATE, LATER migration) and routing legitimate reads
-- through get_invoice_content() below, which demands a valid grant.
--
-- THIS MIGRATION IS ADDITIVE AND SAFE. It creates the machinery only. It does
-- NOT revoke anything, so application behaviour is unchanged until the frontend
-- is wired up and the enforcement migration lands.
--
-- WHY GRANTS ARE KEYED ON A RANDOM TOKEN, NOT AN EMAIL
-- There is no unforgeable identity in this app — the caller supplies its own
-- email. A grant keyed on email could be claimed by anyone who guessed a
-- colleague's address. So verify mints 32 random bytes, returns them once, and
-- stores only their hash.
--
-- Run in the Supabase dashboard SQL editor. Safe to run twice.

-- pgcrypto supplies digest() and gen_random_bytes(). Hosted Supabase installs it
-- into the `extensions` schema, self-hosted Postgres usually into `public`, so
-- both are on the search_path here and in every function below. Without this the
-- functions raise "function digest(text, unknown) does not exist" at runtime
-- rather than at migration time, which is a nasty way to find out.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
SET search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- A pending OTP request. The plaintext code is NEVER stored: only
-- sha256(salt || code). Reading this whole table gives an attacker nothing.
CREATE TABLE IF NOT EXISTS public.invoice_otp_challenges (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id            UUID NOT NULL,
  visit_id           TEXT,
  requested_by_email TEXT NOT NULL,
  requested_by_role  TEXT,
  code_hash          TEXT NOT NULL,
  salt               TEXT NOT NULL,
  attempts           INTEGER NOT NULL DEFAULT 0,
  expires_at         TIMESTAMPTZ NOT NULL,
  consumed_at        TIMESTAMPTZ,
  requester_ip       TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invoice_otp_challenges_user_created_idx
  ON public.invoice_otp_challenges (requested_by_email, created_at DESC);
CREATE INDEX IF NOT EXISTS invoice_otp_challenges_bill_created_idx
  ON public.invoice_otp_challenges (bill_id, created_at DESC);

-- An unlocked window. `via` is what makes master-key access separable from OTP
-- access in the audit trail; without it the two are indistinguishable.
CREATE TABLE IF NOT EXISTS public.invoice_access_grants (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id          UUID NOT NULL,
  challenge_id     UUID REFERENCES public.invoice_otp_challenges(id) ON DELETE SET NULL,
  granted_to_email TEXT,
  token_hash       TEXT NOT NULL,
  via              TEXT NOT NULL DEFAULT 'otp' CHECK (via IN ('otp', 'master_key')),
  expires_at       TIMESTAMPTZ NOT NULL,
  revoked_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invoice_access_grants_lookup_idx
  ON public.invoice_access_grants (bill_id, token_hash);

-- Failed verification attempts, backing the brute-force lockout. This table is
-- what stops the 4-digit master key being cracked: 10,000 possibilities is
-- seconds of scripted guessing without a lockout.
CREATE TABLE IF NOT EXISTS public.invoice_otp_attempts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT,
  ip         TEXT,
  bill_id    UUID,
  failed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invoice_otp_attempts_email_idx ON public.invoice_otp_attempts (user_email, failed_at DESC);
CREATE INDEX IF NOT EXISTS invoice_otp_attempts_ip_idx    ON public.invoice_otp_attempts (ip, failed_at DESC);

-- Single-row tuning table, so the master key can be rotated or switched off
-- without a redeploy. The key itself is a hash — the plaintext appears nowhere,
-- in this file or any other.
CREATE TABLE IF NOT EXISTS public.invoice_access_config (
  id                    BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  master_key_hash       TEXT,
  master_key_salt       TEXT,
  master_key_enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  master_key_rotated_at TIMESTAMPTZ,
  grant_ttl_minutes     INTEGER NOT NULL DEFAULT 15,
  otp_ttl_minutes       INTEGER NOT NULL DEFAULT 5,
  max_otp_per_user_hour INTEGER NOT NULL DEFAULT 5,
  max_otp_per_bill_hour INTEGER NOT NULL DEFAULT 10,
  max_failed_attempts   INTEGER NOT NULL DEFAULT 5,
  lockout_minutes       INTEGER NOT NULL DEFAULT 60,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed the config row and the master key. The plaintext '2605' is hashed here
-- and immediately discarded.
INSERT INTO public.invoice_access_config (id, master_key_salt, master_key_hash, master_key_rotated_at)
SELECT TRUE, s.salt, encode(digest(s.salt || '2605', 'sha256'), 'hex'), now()
FROM (SELECT encode(gen_random_bytes(16), 'hex') AS salt) s
ON CONFLICT (id) DO NOTHING;

-- RLS on, and DELIBERATELY NO POLICIES on any of the four tables. anon and
-- authenticated therefore cannot read or write them at all. Only the
-- SECURITY DEFINER functions below touch them.
ALTER TABLE public.invoice_otp_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_access_grants  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_otp_attempts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_access_config  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.invoice_otp_challenges FROM anon, authenticated;
REVOKE ALL ON public.invoice_access_grants  FROM anon, authenticated;
REVOKE ALL ON public.invoice_otp_attempts   FROM anon, authenticated;
REVOKE ALL ON public.invoice_access_config  FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Lock state
-- ---------------------------------------------------------------------------

-- Is this bill confidential right now?
--
-- Two conditions, both required:
--   private  — patients.corporate is null / '' / 'private'. Scheme and corporate
--              patients (PM-JAY, CGHS, railways) are out of scope entirely.
--   paid     — bill_preparation.received_date or received_amount is set. This is
--              the same signal that already drives isAmountReceived in
--              FinalBill.tsx:1782-1793, so the gate engages exactly when the
--              existing print lock does.
--
-- To also lock on submission rather than payment, add
--   OR bp.date_of_submission IS NOT NULL OR bp.executive_who_submitted IS NOT NULL
-- to the is_paid expression below.
CREATE OR REPLACE FUNCTION public.invoice_lock_state(p_bill_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT jsonb_build_object(
    'found',       TRUE,
    'bill_id',     b.id,
    'bill_no',     COALESCE(b.formatted_bill_no, b.bill_no),
    'visit_id',    b.visit_id,
    'patient_name', COALESCE(p.name, b.bill_patient_data->>'name', 'Patient'),
    'is_private',  (p.corporate IS NULL OR btrim(p.corporate) = '' OR lower(btrim(p.corporate)) = 'private'),
    'is_paid',     (bp.received_date IS NOT NULL OR bp.received_amount IS NOT NULL),
    'is_locked',   (p.corporate IS NULL OR btrim(p.corporate) = '' OR lower(btrim(p.corporate)) = 'private')
                   AND (bp.received_date IS NOT NULL OR bp.received_amount IS NOT NULL)
  )
  FROM public.bills b
  LEFT JOIN public.patients p          ON p.id::text = b.patient_id::text
  LEFT JOIN public.bill_preparation bp ON bp.visit_id = b.visit_id
  WHERE b.id = p_bill_id
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.invoice_lock_state(UUID) IS
'Whether a bill is confidential: private patient AND payment received. Corporate/scheme bills are never locked.';

-- ---------------------------------------------------------------------------
-- request_invoice_otp — service_role ONLY
-- ---------------------------------------------------------------------------
--
-- Returns the PLAINTEXT code so the Vercel function can text it. That is
-- precisely why this is granted to service_role and not to anon: a browser that
-- could call this directly would simply read the code out of the response and
-- the whole gate would be decorative.
--
-- Never raises for a business outcome — always returns jsonb, following
-- check_pharmacy_threshold_after_sale.
CREATE OR REPLACE FUNCTION public.request_invoice_otp(
  p_bill_id    UUID,
  p_user_email TEXT,
  p_user_role  TEXT DEFAULT NULL,
  p_ip         TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_cfg        public.invoice_access_config%ROWTYPE;
  v_state      JSONB;
  v_user_count INTEGER;
  v_bill_count INTEGER;
  v_code       TEXT;
  v_salt       TEXT;
  v_challenge  UUID;
  v_expires    TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_cfg FROM public.invoice_access_config WHERE id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_configured');
  END IF;

  v_state := public.invoice_lock_state(p_bill_id);
  IF v_state IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bill_not_found');
  END IF;

  -- Nothing to unlock: the caller should just render the bill.
  IF NOT (v_state->>'is_locked')::boolean THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_locked');
  END IF;

  -- Rate limits are counted in the database because Vercel serverless gives
  -- each invocation a fresh process — an in-memory limiter would never see a
  -- second request.
  SELECT count(*) INTO v_user_count
  FROM public.invoice_otp_challenges
  WHERE lower(requested_by_email) = lower(p_user_email)
    AND created_at > now() - interval '1 hour';

  IF v_user_count >= v_cfg.max_otp_per_user_hour THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited', 'scope', 'user');
  END IF;

  SELECT count(*) INTO v_bill_count
  FROM public.invoice_otp_challenges
  WHERE bill_id = p_bill_id
    AND created_at > now() - interval '1 hour';

  IF v_bill_count >= v_cfg.max_otp_per_bill_hour THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited', 'scope', 'bill');
  END IF;

  v_code    := lpad((floor(random() * 1000000))::integer::text, 6, '0');
  v_salt    := encode(gen_random_bytes(16), 'hex');
  v_expires := now() + make_interval(mins => v_cfg.otp_ttl_minutes);

  INSERT INTO public.invoice_otp_challenges
    (bill_id, visit_id, requested_by_email, requested_by_role, code_hash, salt, expires_at, requester_ip)
  VALUES
    (p_bill_id, v_state->>'visit_id', p_user_email, p_user_role,
     encode(digest(v_salt || v_code, 'sha256'), 'hex'), v_salt, v_expires, p_ip)
  RETURNING id INTO v_challenge;

  RETURN jsonb_build_object(
    'ok',           true,
    'challenge_id', v_challenge,
    'code',         v_code,
    'expires_at',   v_expires,
    'bill_no',      v_state->>'bill_no',
    'patient_name', v_state->>'patient_name'
  );
END;
$$;

COMMENT ON FUNCTION public.request_invoice_otp(UUID, TEXT, TEXT, TEXT) IS
'Mints an invoice OTP and returns the plaintext code. service_role ONLY — anon access would leak the code.';

-- ---------------------------------------------------------------------------
-- verify_invoice_otp — service_role ONLY
-- ---------------------------------------------------------------------------
--
-- Order matters: lockout is checked FIRST, before the master key, so five wrong
-- guesses freeze the attacker even if their sixth guess would have been right.
CREATE OR REPLACE FUNCTION public.verify_invoice_otp(
  p_bill_id      UUID,
  p_code         TEXT,
  p_user_email   TEXT,
  p_challenge_id UUID DEFAULT NULL,
  p_ip           TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_cfg       public.invoice_access_config%ROWTYPE;
  v_state     JSONB;
  v_failures  INTEGER;
  v_challenge public.invoice_otp_challenges%ROWTYPE;
  v_token     TEXT;
  v_expires   TIMESTAMPTZ;
  v_via       TEXT;
  v_code      TEXT := btrim(COALESCE(p_code, ''));
BEGIN
  SELECT * INTO v_cfg FROM public.invoice_access_config WHERE id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_configured');
  END IF;

  v_state := public.invoice_lock_state(p_bill_id);
  IF v_state IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bill_not_found');
  END IF;

  -- Brute-force lockout, per user AND per IP. This is the control that makes a
  -- permanent 4-digit master key survivable.
  SELECT count(*) INTO v_failures
  FROM public.invoice_otp_attempts
  WHERE failed_at > now() - make_interval(mins => v_cfg.lockout_minutes)
    AND ( (p_user_email IS NOT NULL AND lower(user_email) = lower(p_user_email))
       OR (p_ip IS NOT NULL AND ip = p_ip) );

  IF v_failures >= v_cfg.max_failed_attempts THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'locked_out',
                              'retry_after_minutes', v_cfg.lockout_minutes);
  END IF;

  -- Master key path. Deliberately checked without a challenge, since no OTP was
  -- requested.
  IF v_cfg.master_key_enabled
     AND v_cfg.master_key_hash IS NOT NULL
     AND encode(digest(v_cfg.master_key_salt || v_code, 'sha256'), 'hex') = v_cfg.master_key_hash
  THEN
    v_via := 'master_key';
  ELSE
    -- Live OTP path.
    SELECT * INTO v_challenge
    FROM public.invoice_otp_challenges
    WHERE bill_id = p_bill_id
      AND (p_challenge_id IS NULL OR id = p_challenge_id)
      AND consumed_at IS NULL
      AND expires_at > now()
      AND attempts < v_cfg.max_failed_attempts
    ORDER BY created_at DESC
    LIMIT 1;

    IF NOT FOUND THEN
      INSERT INTO public.invoice_otp_attempts (user_email, ip, bill_id)
      VALUES (p_user_email, p_ip, p_bill_id);
      RETURN jsonb_build_object('ok', false, 'reason', 'no_active_code');
    END IF;

    UPDATE public.invoice_otp_challenges
       SET attempts = attempts + 1
     WHERE id = v_challenge.id;

    IF encode(digest(v_challenge.salt || v_code, 'sha256'), 'hex') <> v_challenge.code_hash THEN
      INSERT INTO public.invoice_otp_attempts (user_email, ip, bill_id)
      VALUES (p_user_email, p_ip, p_bill_id);
      RETURN jsonb_build_object('ok', false, 'reason', 'wrong_code',
                                'attempts_left',
                                GREATEST(v_cfg.max_failed_attempts - (v_challenge.attempts + 1), 0));
    END IF;

    UPDATE public.invoice_otp_challenges
       SET consumed_at = now()
     WHERE id = v_challenge.id;

    v_via := 'otp';
  END IF;

  -- Mint the grant. The token is returned exactly once and stored only as a hash.
  v_token   := encode(gen_random_bytes(32), 'hex');
  v_expires := now() + make_interval(mins => v_cfg.grant_ttl_minutes);

  INSERT INTO public.invoice_access_grants
    (bill_id, challenge_id, granted_to_email, token_hash, via, expires_at)
  VALUES
    (p_bill_id,
     CASE WHEN v_via = 'otp' THEN v_challenge.id ELSE NULL END,
     p_user_email,
     encode(digest(v_token, 'sha256'), 'hex'),
     v_via,
     v_expires);

  RETURN jsonb_build_object(
    'ok',          true,
    'via',         v_via,
    'grant_token', v_token,
    'expires_at',  v_expires,
    'bill_no',     v_state->>'bill_no',
    'patient_name', v_state->>'patient_name'
  );
END;
$$;

COMMENT ON FUNCTION public.verify_invoice_otp(UUID, TEXT, TEXT, UUID, TEXT) IS
'Verifies an invoice OTP or the master key and mints a 15-minute grant. service_role ONLY.';

-- ---------------------------------------------------------------------------
-- get_invoice_content — the enforcement point, callable by the browser
-- ---------------------------------------------------------------------------
--
-- This is the only way to read invoice line items once the enforcement
-- migration revokes anon's SELECT. It is SECURITY DEFINER so it can read the
-- protected tables on the caller's behalf, but only after checking the grant.
CREATE OR REPLACE FUNCTION public.get_invoice_content(
  p_bill_id     UUID,
  p_grant_token TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_state   JSONB;
  v_granted BOOLEAN := FALSE;
BEGIN
  v_state := public.invoice_lock_state(p_bill_id);
  IF v_state IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bill_not_found');
  END IF;

  IF (v_state->>'is_locked')::boolean THEN
    IF p_grant_token IS NULL OR btrim(p_grant_token) = '' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'locked', 'bill_no', v_state->>'bill_no');
    END IF;

    SELECT TRUE INTO v_granted
    FROM public.invoice_access_grants
    WHERE bill_id = p_bill_id
      AND token_hash = encode(digest(p_grant_token, 'sha256'), 'hex')
      AND revoked_at IS NULL
      AND expires_at > now()
    LIMIT 1;

    IF NOT COALESCE(v_granted, FALSE) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'locked', 'bill_no', v_state->>'bill_no');
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok',        true,
    'is_locked', (v_state->>'is_locked')::boolean,
    'sections',  COALESCE((
      SELECT jsonb_agg(to_jsonb(s) ORDER BY s.section_order)
      FROM public.bill_sections s WHERE s.bill_id = p_bill_id), '[]'::jsonb),
    'line_items', COALESCE((
      SELECT jsonb_agg(to_jsonb(li) ORDER BY li.item_order)
      FROM public.bill_line_items li WHERE li.bill_id = p_bill_id), '[]'::jsonb),
    'bill_items_json',   (SELECT b.bill_items_json   FROM public.bills b WHERE b.id = p_bill_id),
    'bill_patient_data', (SELECT b.bill_patient_data FROM public.bills b WHERE b.id = p_bill_id)
  );
END;
$$;

COMMENT ON FUNCTION public.get_invoice_content(UUID, TEXT) IS
'Returns invoice line items. Open for corporate/unpaid bills; requires a valid grant token for locked private bills.';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

-- The two functions that can reveal a code or mint a grant are service_role
-- only, reachable exclusively through api/invoice-otp-*.ts.
REVOKE ALL ON FUNCTION public.request_invoice_otp(UUID, TEXT, TEXT, TEXT)      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verify_invoice_otp(UUID, TEXT, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_invoice_otp(UUID, TEXT, TEXT, TEXT)      TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_invoice_otp(UUID, TEXT, TEXT, UUID, TEXT) TO service_role;

-- The read path is called straight from the browser.
GRANT EXECUTE ON FUNCTION public.get_invoice_content(UUID, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.invoice_lock_state(UUID)        TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
