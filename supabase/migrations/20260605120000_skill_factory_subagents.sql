-- Per-user Skill Factory subagents.
-- Each row is one subagent a user has built on the /skill-factory page: a name,
-- description, an icon key, the rules that map uploaded photos to documents, and
-- the workflow steps. Rules and workflow are stored as JSONB so a subagent can
-- carry any number of rules/steps without extra tables.
--
-- Custom-auth app pattern: the browser uses the anon key and scopes every query
-- by the logged-in user's email at the query layer, so RLS is disabled (matching
-- task_optimizer_flows and the rest of the app).
CREATE TABLE IF NOT EXISTS public.skill_factory_subagents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email   text NOT NULL,                          -- owner (scoping key)
  name         text NOT NULL,
  description  text,
  icon         text DEFAULT 'box',                     -- key resolved to an icon in the UI
  rules        jsonb NOT NULL DEFAULT '[]'::jsonb,      -- [{id, trigger, action}]
  workflow     jsonb NOT NULL DEFAULT '[]'::jsonb,      -- [{label, type}]
  sort_order   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_skill_factory_subagents_user
  ON public.skill_factory_subagents (user_email, sort_order);

COMMENT ON TABLE public.skill_factory_subagents IS
  'Per-user Skill Factory subagents (rules + workflow), scoped by user_email.';

-- Matches the app pattern: browser uses the anon key under custom auth.
ALTER TABLE public.skill_factory_subagents DISABLE ROW LEVEL SECURITY;
