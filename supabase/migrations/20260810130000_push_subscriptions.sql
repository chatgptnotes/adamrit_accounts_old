-- Phone push notifications, part 1 of 2: where each person's phone lives.
--
-- One row per browser/device that tapped "Enable phone alerts" in the app.
-- The endpoint is the per-device URL Google/Apple hand out for Web Push; the
-- p256dh/auth pair encrypts each message so only that phone can read it.
--
-- Written and read EXCLUSIVELY by the Vercel API routes using the service
-- role (api/push-subscribe.ts, api/push-send.ts). RLS is enabled with no
-- anon/authenticated policy on purpose: a push endpoint is a capability URL —
-- anyone holding it can spam that phone — so the browser must never be able
-- to read other people's rows.
--
-- Applied through apply_migration(): one transaction, rolls back on failure.
-- Idempotent, and it verifies itself before committing.

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- References public."User".id (the custom auth table, not auth.users). No FK
  -- on purpose: "User" rows are managed by api/admin-users.ts and a deleted
  -- account must not orphan-block cleanup here; the sender simply pushes to
  -- whatever endpoints remain and dead ones self-delete on 404/410.
  user_id UUID,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  failed_at TIMESTAMPTZ,
  failure_count INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT push_subscriptions_endpoint_unique UNIQUE (endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id
  ON public.push_subscriptions (user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- No policies: anon and authenticated get nothing; service_role bypasses RLS.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'push_subscriptions'
  ) THEN
    RAISE EXCEPTION 'ABORT: push_subscriptions was not created';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'push_subscriptions'
  ) THEN
    RAISE EXCEPTION 'ABORT: push_subscriptions must have no RLS policies';
  END IF;
  IF NOT (
    SELECT relrowsecurity FROM pg_class
     WHERE oid = 'public.push_subscriptions'::regclass
  ) THEN
    RAISE EXCEPTION 'ABORT: RLS is not enabled on push_subscriptions';
  END IF;
  RAISE NOTICE 'OK — push_subscriptions exists, RLS locked to service role';
END $$;
