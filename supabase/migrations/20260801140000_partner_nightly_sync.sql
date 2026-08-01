-- Nightly full-stock sync for partner systems.
--
-- The partner API already gives a partner two things: a catalogue of what can be
-- ordered (GET /stock) and a change feed (GET /stock?since=...). This migration
-- adds the third: a complete snapshot, delivered once a night, that the partner
-- applies as a HARD REFRESH — they replace their whole stock table with it.
--
-- WHY A NIGHTLY REFRESH EXISTS AT ALL WHEN THERE IS A CHANGE FEED
-- A change feed is only ever as correct as its worst missed message. If the
-- partner's process is down for an hour, or a poll fails and they advance their
-- watermark anyway, they drift and nothing ever tells them. A full snapshot at a
-- quiet hour bounds that drift to one day, whatever went wrong. It is a safety
-- net, not the primary path: the change feed is what keeps them accurate during
-- trading hours.
--
-- Safe to run twice. Requires 20260801120000_partner_stock_api.sql.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
SET search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Push configuration on the partner record
-- ---------------------------------------------------------------------------
--
-- sync_url null means push is off for this partner. That is not the same as
-- sync being off: they can still PULL the same snapshot from
-- /api/partner/stock-snapshot whenever they like. Push is a convenience, not
-- the only route, so a partner who cannot host an inbound endpoint is not stuck.
ALTER TABLE public.partner_api_clients
  ADD COLUMN IF NOT EXISTS sync_url     TEXT,
  ADD COLUMN IF NOT EXISTS sync_secret  TEXT,
  ADD COLUMN IF NOT EXISTS sync_enabled BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.partner_api_clients.sync_url IS
'Where the nightly snapshot is POSTed. NULL disables the push; the partner can still pull /stock-snapshot.';
COMMENT ON COLUMN public.partner_api_clients.sync_secret IS
'Shared secret the nightly push signs its body with, so the partner can verify the POST came from us.';

-- ---------------------------------------------------------------------------
-- Run log
-- ---------------------------------------------------------------------------
--
-- One row per partner per attempt. This is the answer to "did last night's sync
-- go out?", which is otherwise unanswerable — a cron that fails silently at 2 AM
-- is indistinguishable from one that never ran.
CREATE TABLE IF NOT EXISTS public.partner_sync_runs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id  UUID NOT NULL REFERENCES public.partner_api_clients(id) ON DELETE CASCADE,
  snapshot_id UUID NOT NULL,
  status      TEXT NOT NULL DEFAULT 'RUNNING'
              CHECK (status IN ('RUNNING','SUCCESS','FAILED','SKIPPED')),
  trigger     TEXT NOT NULL DEFAULT 'cron' CHECK (trigger IN ('cron','manual')),
  pages_sent  INTEGER NOT NULL DEFAULT 0,
  items_sent  INTEGER NOT NULL DEFAULT 0,
  http_status INTEGER,
  error       TEXT,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS partner_sync_runs_partner_idx
  ON public.partner_sync_runs (partner_id, started_at DESC);

ALTER TABLE public.partner_sync_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.partner_sync_runs FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- partner_create_api_key — now mints the sync secret too
-- ---------------------------------------------------------------------------
--
-- Replaces the version in 20260801120000_partner_stock_api.sql. Same signature
-- plus p_sync_url on the end, so existing calls keep working. Both plaintext
-- values are returned exactly once and stored... well, the API key is stored
-- only as a hash; the sync secret has to be kept in full because we sign
-- outbound requests with it. It is readable only by service_role.
--
-- The old five-argument version must be DROPPED, not replaced: adding a
-- defaulted parameter creates an overload, and a three-argument call would then
-- match both and fail with "function is not unique".
DROP FUNCTION IF EXISTS public.partner_create_api_key(TEXT, TEXT, TEXT, TEXT[], INTEGER);

CREATE OR REPLACE FUNCTION public.partner_create_api_key(
  p_partner_name  TEXT,
  p_hospital_name TEXT,
  p_contact_email TEXT DEFAULT NULL,
  p_scopes        TEXT[] DEFAULT ARRAY['stock:read','orders:write'],
  p_rate_limit    INTEGER DEFAULT 60,
  p_sync_url      TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_key    TEXT;
  v_secret TEXT;
  v_id     UUID;
BEGIN
  v_key    := 'adk_' || encode(gen_random_bytes(32), 'hex');
  v_secret := 'ads_' || encode(gen_random_bytes(32), 'hex');

  INSERT INTO public.partner_api_clients
    (partner_name, contact_email, key_prefix, api_key_hash, hospital_name,
     scopes, rate_limit_per_min, sync_url, sync_secret)
  VALUES
    (p_partner_name, p_contact_email, left(v_key, 12),
     encode(digest(v_key, 'sha256'), 'hex'), p_hospital_name, p_scopes,
     p_rate_limit, NULLIF(btrim(COALESCE(p_sync_url, '')), ''), v_secret)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'ok', true,
    'partner_id', v_id,
    'partner_name', p_partner_name,
    'hospital_name', p_hospital_name,
    'api_key', v_key,
    'sync_secret', v_secret,
    'sync_url', p_sync_url,
    'warning', 'Copy the api_key now — it is stored only as a hash and cannot be shown again. Give the partner both values.'
  );
END;
$$;

COMMENT ON FUNCTION public.partner_create_api_key(TEXT, TEXT, TEXT, TEXT[], INTEGER, TEXT) IS
'Issues a partner API key and nightly-sync secret, returning both plaintexts once. service_role ONLY.';

REVOKE ALL ON FUNCTION public.partner_create_api_key(TEXT, TEXT, TEXT, TEXT[], INTEGER, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.partner_create_api_key(TEXT, TEXT, TEXT, TEXT[], INTEGER, TEXT)
  TO service_role;

NOTIFY pgrst, 'reload schema';
