-- Self-service password reset by emailed one-time code.
--
-- WHY THIS EXISTS
-- Until now the only way back into a forgotten account was to ask an admin to
-- set a new password by hand. This lets a staff member prove they hold the
-- mailbox on their account and set their own password.
--
-- WHAT IS NEVER STORED
-- The code itself. Only sha256(salt || code) is written, so reading this whole
-- table gives an attacker nothing they can use. Same shape as
-- 20260726100000_invoice_otp_gate.sql, which these functions deliberately echo.
--
-- WHY THESE ARE service_role ONLY
-- request_password_reset RETURNS THE PLAINTEXT CODE so the Vercel function can
-- email it. A browser able to call this directly would simply read the code out
-- of the response and reset anyone's password. It is granted to service_role and
-- nothing else; api/password-reset.ts is the only caller, and it is also the
-- only layer that can see the caller's real IP for the lockout.
--
-- WHY IT NEVER SAYS WHETHER AN EMAIL EXISTS
-- request_password_reset returns the same shape for a known and an unknown
-- address. Otherwise this endpoint becomes a way to enumerate every staff email
-- at the hospital, which is exactly what an attacker wants before phishing.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
SET search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.password_reset_challenges (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES public."User"(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  code_hash     TEXT NOT NULL,
  salt          TEXT NOT NULL,
  attempts      INTEGER NOT NULL DEFAULT 0,
  expires_at    TIMESTAMPTZ NOT NULL,
  consumed_at   TIMESTAMPTZ,
  requester_ip  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS password_reset_challenges_email_idx
  ON public.password_reset_challenges (lower(email), created_at DESC);

-- Backs the brute-force lockout. A 6-digit code is a million possibilities,
-- which is minutes of scripted guessing without one.
CREATE TABLE IF NOT EXISTS public.password_reset_attempts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT,
  ip         TEXT,
  failed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS password_reset_attempts_email_idx
  ON public.password_reset_attempts (lower(email), failed_at DESC);
CREATE INDEX IF NOT EXISTS password_reset_attempts_ip_idx
  ON public.password_reset_attempts (ip, failed_at DESC);

-- RLS on, and DELIBERATELY NO POLICIES: anon and authenticated cannot touch
-- either table at all. Only the SECURITY DEFINER functions below do.
ALTER TABLE public.password_reset_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.password_reset_attempts   ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.password_reset_challenges FROM anon, authenticated;
REVOKE ALL ON public.password_reset_attempts   FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- request_password_reset — service_role ONLY
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_password_reset(
  p_email TEXT,
  p_ip    TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user     public."User"%ROWTYPE;
  v_recent   INTEGER;
  v_code     TEXT;
  v_salt     TEXT;
  v_ttl      INTEGER := 10;   -- minutes
BEGIN
  SELECT * INTO v_user
  FROM public."User"
  WHERE lower(email) = lower(btrim(p_email))
  LIMIT 1;

  -- Unknown address, or one whose account is switched off: answer exactly as if
  -- the mail had been sent. The caller cannot tell the difference, so this
  -- endpoint reveals nothing about who works here.
  IF v_user.id IS NULL OR v_user.is_active IS FALSE THEN
    RETURN jsonb_build_object('ok', TRUE, 'sent', FALSE);
  END IF;

  -- Throttle per address so a mailbox cannot be flooded with reset codes.
  SELECT count(*) INTO v_recent
  FROM public.password_reset_challenges
  WHERE lower(email) = lower(btrim(p_email))
    AND created_at > now() - interval '1 hour';

  IF v_recent >= 5 THEN
    RETURN jsonb_build_object('ok', TRUE, 'sent', FALSE);
  END IF;

  -- Any still-valid code for this address is retired, so the newest mail is the
  -- only one that works and an older intercepted mail becomes useless.
  UPDATE public.password_reset_challenges
  SET consumed_at = now()
  WHERE lower(email) = lower(btrim(p_email))
    AND consumed_at IS NULL;

  v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
  v_salt := encode(gen_random_bytes(16), 'hex');

  INSERT INTO public.password_reset_challenges (user_id, email, code_hash, salt, expires_at, requester_ip)
  VALUES (
    v_user.id,
    lower(btrim(p_email)),
    encode(digest(v_salt || v_code, 'sha256'), 'hex'),
    v_salt,
    now() + (v_ttl || ' minutes')::interval,
    p_ip
  );

  RETURN jsonb_build_object(
    'ok', TRUE,
    'sent', TRUE,
    'code', v_code,               -- emailed by the caller, then discarded
    'email', v_user.email,
    'name', COALESCE(v_user.full_name, split_part(v_user.email, '@', 1)),
    'ttl_minutes', v_ttl
  );
END;
$$;

COMMENT ON FUNCTION public.request_password_reset(TEXT, TEXT) IS
'Mints a 6-digit reset code and returns the plaintext ONCE so the caller can email it. service_role only. Answers identically for unknown addresses so staff emails cannot be enumerated.';

-- ---------------------------------------------------------------------------
-- verify_password_reset — service_role ONLY
-- ---------------------------------------------------------------------------
--
-- Takes an ALREADY-HASHED password. Hashing stays in the Node layer with
-- bcryptjs so there is exactly one hashing implementation in the system and it
-- matches what api/auth-session.ts compares against at login.
CREATE OR REPLACE FUNCTION public.verify_password_reset(
  p_email             TEXT,
  p_code              TEXT,
  p_new_password_hash TEXT,
  p_ip                TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_challenge public.password_reset_challenges%ROWTYPE;
  v_failures  INTEGER;
BEGIN
  IF p_new_password_hash IS NULL OR btrim(p_new_password_hash) = '' THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'password_required');
  END IF;

  -- Lockout first, so a wrong guess costs the attacker their remaining budget
  -- whether or not the address exists.
  SELECT count(*) INTO v_failures
  FROM public.password_reset_attempts
  WHERE (lower(email) = lower(btrim(p_email)) OR (p_ip IS NOT NULL AND ip = p_ip))
    AND failed_at > now() - interval '15 minutes';

  IF v_failures >= 5 THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'too_many_attempts');
  END IF;

  SELECT * INTO v_challenge
  FROM public.password_reset_challenges
  WHERE lower(email) = lower(btrim(p_email))
    AND consumed_at IS NULL
    AND expires_at > now()
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_challenge.id IS NULL THEN
    INSERT INTO public.password_reset_attempts (email, ip) VALUES (lower(btrim(p_email)), p_ip);
    RETURN jsonb_build_object('ok', FALSE, 'error', 'code_expired_or_missing');
  END IF;

  IF encode(digest(v_challenge.salt || btrim(p_code), 'sha256'), 'hex') <> v_challenge.code_hash THEN
    UPDATE public.password_reset_challenges SET attempts = attempts + 1 WHERE id = v_challenge.id;
    INSERT INTO public.password_reset_attempts (email, ip) VALUES (lower(btrim(p_email)), p_ip);
    RETURN jsonb_build_object('ok', FALSE, 'error', 'invalid_code');
  END IF;

  -- Consumed before the password is written, so the same code can never be
  -- replayed even if the update below fails.
  UPDATE public.password_reset_challenges
  SET consumed_at = now()
  WHERE id = v_challenge.id;

  UPDATE public."User"
  SET password = p_new_password_hash,
      must_change_password = FALSE,
      password_changed_at = now()
  WHERE id = v_challenge.user_id;

  -- A successful reset clears the lockout counter for this address; the person
  -- has proved they hold the mailbox.
  DELETE FROM public.password_reset_attempts WHERE lower(email) = lower(btrim(p_email));

  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

COMMENT ON FUNCTION public.verify_password_reset(TEXT, TEXT, TEXT, TEXT) IS
'Checks a reset code and sets an already-bcrypt-hashed password. service_role only. Locks out after 5 failures in 15 minutes, per email and per IP.';

-- Explicitly service_role only. Without these revokes, PostgREST would happily
-- let the browser call request_password_reset and read the code from the reply.
REVOKE ALL ON FUNCTION public.request_password_reset(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verify_password_reset(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_password_reset(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_password_reset(TEXT, TEXT, TEXT, TEXT) TO service_role;
