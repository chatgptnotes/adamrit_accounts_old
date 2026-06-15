# Skill Factory / Task Optimizer — Rebuild Blueprint

> **Purpose of this file.** This is a self-contained specification of the entire **Skill Factory /
> Task Optimizer** feature stack in the Adamrit HMS. If the feature is removed, handing this single
> file back is enough to regenerate it: it carries the full database schema, TypeScript types, API
> contracts, the automation engine's safety model and rules, the frontend component map, the
> billing-email automation, every environment variable, and an ordered rebuild checklist.
>
> Written 2026-06-15 against the `main` branch of `D:\office\Adam\adamrit`. RLS is disabled on the
> feature tables by design — the browser talks to Supabase with the anon key under the app's custom
> auth and scopes every query by `user_email` / `hospital_type` at the query layer.

---

## 1. Overview & routes

The feature is a staff-productivity + automation suite with three layers that share one DB and one
automation engine:

1. **Skill Factory** — the staff-facing UI shell. Two generations:
   - **v2** (`SkillFactoryV2.tsx`, primary): a no-left-rail, 5-column resizable workspace —
     Staff → Tasks → Steps → Workflow (React Flow canvas) → AI chatbot.
   - **v1 legacy** (`SkillFactory.tsx`): in-memory subagent builder (photo-trigger → document
     rules + workflow), backed by the `skill_factory_subagents` table.
2. **Task Optimizer** — `TaskOptimizer.tsx` → `TaskOptimizerDashboard` tabbed dashboard
   (New Entry / View Submissions / Automations / Billing / Insights). Staff log daily tasks, AI
   returns automate/reduce/delegate/keep suggestions, statuses are tracked.
3. **Automation engine + Deadline tracking + Billing email** — the runtime that evaluates visual
   trigger/condition/action flows, the utility-bill deadline dashboard, and the Gmail inbox
   drafting workflow.

**Routes** (registered in `src/components/AppRoutes.tsx`, all lazy-loaded under `<Suspense>`):

| Path | Component | Notes |
|------|-----------|-------|
| `/skill-factory` | `SkillFactoryV2` | Primary Skill Factory tab target |
| `/skill-factory/v2` | `SkillFactoryV2` | Stable alias |
| `/skill-factory/legacy` | `SkillFactory` | v1 in-memory builder fallback |
| `/task-optimizer` | `TaskOptimizer` | Dashboard |
| `/deadline-tracking` | `DeadlineDashboard` (wrapped in `DeadlineTrackingRoute`, passes `onBack`) | Open/Deadline dashboard |
| `/vps-claude-usage` | `VpsClaudeUsage` | Admin token-spend monitor (shared infra, not SF-exclusive) |

**Sidebar** (`src/components/sidebar/menuItems.ts`): one entry
`{ title: "Skill Factory", url: "/skill-factory", icon: Boxes }`, grouped under **Overview** via
`src/components/sidebar/sidebarGroups.ts`: `'Skill Factory': 'Overview'`.

**FAB suppression** (`src/App.tsx`): `/skill-factory` and `/skill-factory/v2` are listed in
`ROUTES_WITHOUT_FLOATERS` so floating action buttons are hidden on those pages.

---

## 2. Database schema (full SQL, verbatim)

All tables live in `public`. Recreate by running these in order (they are idempotent). Source
migration filenames are noted per block.

### 2.1 `task_optimizer_logs` — `20260530130000_create_task_optimizer_logs.sql`
```sql
CREATE TABLE IF NOT EXISTS public.task_optimizer_logs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email     text NOT NULL,
  hospital_type  text,
  staff_name     text NOT NULL,
  designation    text NOT NULL,
  log_date       date NOT NULL DEFAULT CURRENT_DATE,
  tasks          jsonb NOT NULL,          -- string[] of raw task descriptions
  ai_suggestions jsonb,                   -- TaskSuggestion[] returned by Gemini
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_task_optimizer_logs_email    ON public.task_optimizer_logs (user_email);
CREATE INDEX IF NOT EXISTS idx_task_optimizer_logs_hospital ON public.task_optimizer_logs (hospital_type);
COMMENT ON TABLE public.task_optimizer_logs IS
  'Staff daily task logs + AI reduction/automation suggestions for productivity analysis.';
ALTER TABLE public.task_optimizer_logs DISABLE ROW LEVEL SECURITY;
```
Plus `20260610140000_add_task_attachments.sql` (per-task scanned documents, keyed by task label):
```sql
ALTER TABLE public.task_optimizer_logs
  ADD COLUMN IF NOT EXISTS task_attachments jsonb NOT NULL DEFAULT '{}'::jsonb;
-- value shape: { [taskLabel]: [{ title, summary, fields:[{label,value}], fileUrl, createdAt }] }
```

### 2.2 `task_optimizer_actions` — `20260530160000_task_optimizer_actions.sql`
```sql
CREATE TABLE IF NOT EXISTS public.task_optimizer_actions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  log_id          uuid NOT NULL REFERENCES public.task_optimizer_logs (id) ON DELETE CASCADE,
  hospital_type   text,
  task_text       text NOT NULL,          -- the suggestion's task, copied for stable display
  suggestion_type text NOT NULL,          -- automate | reduce | delegate | keep
  status          text NOT NULL DEFAULT 'suggested',  -- suggested | in_progress | done | dismissed
  owner           text,
  note            text,
  time_saved_mins integer,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_task_optimizer_actions_log_task ON public.task_optimizer_actions (log_id, task_text);
CREATE INDEX IF NOT EXISTS idx_task_optimizer_actions_hospital ON public.task_optimizer_actions (hospital_type);
CREATE INDEX IF NOT EXISTS idx_task_optimizer_actions_status   ON public.task_optimizer_actions (status);
COMMENT ON TABLE public.task_optimizer_actions IS
  'Status lifecycle for Skill Factory AI suggestions — the productivity workflow loop.';
ALTER TABLE public.task_optimizer_actions DISABLE ROW LEVEL SECURITY;
```

### 2.3 `task_optimizer_flows` — `20260530170000_task_optimizer_flows.sql` (+ `role` from `20260601100000`)
```sql
CREATE TABLE IF NOT EXISTS public.task_optimizer_flows (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_type  text,
  role           text,                                 -- staff role/persona this is for (added in 20260601100000)
  name           text NOT NULL DEFAULT 'Untitled automation',
  enabled        boolean NOT NULL DEFAULT true,
  nodes          jsonb NOT NULL DEFAULT '[]'::jsonb,   -- React Flow StoredNode[]
  edges          jsonb NOT NULL DEFAULT '[]'::jsonb,   -- React Flow StoredEdge[]
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_task_optimizer_flows_hospital ON public.task_optimizer_flows (hospital_type);
CREATE INDEX IF NOT EXISTS idx_task_optimizer_flows_enabled  ON public.task_optimizer_flows (enabled);
CREATE INDEX IF NOT EXISTS idx_task_optimizer_flows_role     ON public.task_optimizer_flows (role);
COMMENT ON TABLE public.task_optimizer_flows IS
  'Visual trigger/condition/action automations for the Skill Factory workflow loop.';
ALTER TABLE public.task_optimizer_flows DISABLE ROW LEVEL SECURITY;
```

### 2.4 `skill_factory_subagents` — `20260605120000_skill_factory_subagents.sql`
```sql
CREATE TABLE IF NOT EXISTS public.skill_factory_subagents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email   text NOT NULL,
  name         text NOT NULL,
  description  text,
  icon         text DEFAULT 'box',
  rules        jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{id, trigger, action}]
  workflow     jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{label, type}]
  sort_order   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_skill_factory_subagents_user ON public.skill_factory_subagents (user_email, sort_order);
COMMENT ON TABLE public.skill_factory_subagents IS
  'Per-user Skill Factory subagents (rules + workflow), scoped by user_email.';
ALTER TABLE public.skill_factory_subagents DISABLE ROW LEVEL SECURITY;
```

### 2.5 `skill_factory_tasks` — `20260606120000_skill_factory_tasks.sql`
```sql
CREATE TABLE IF NOT EXISTS public.skill_factory_tasks (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email         text NOT NULL,
  hospital_type      text,
  owner_role         text,
  title              text NOT NULL,
  description        text,
  category           text,
  status             text NOT NULL DEFAULT 'capturing',   -- capturing | designed | active | archived
  interview          jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{role, content}] chat transcript
  steps              jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{id,label,type,mode,actionType,config,how,assignee}]
  automation_summary text,
  automation_score   integer NOT NULL DEFAULT 0,          -- 0-100
  sort_order         integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_skill_factory_tasks_user     ON public.skill_factory_tasks (user_email, sort_order);
CREATE INDEX IF NOT EXISTS idx_skill_factory_tasks_hospital ON public.skill_factory_tasks (hospital_type);
COMMENT ON TABLE public.skill_factory_tasks IS
  'Per-staff Skill Factory tasks (interview + automatable steps), scoped by user_email; admins read by hospital_type.';
ALTER TABLE public.skill_factory_tasks DISABLE ROW LEVEL SECURITY;
```

### 2.6 `skill_factory_runs` — `20260606120001_skill_factory_runs.sql`
```sql
CREATE TABLE IF NOT EXISTS public.skill_factory_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id       uuid NOT NULL,
  user_email    text NOT NULL,
  hospital_type text,
  status        text NOT NULL DEFAULT 'running',    -- running | done | failed
  step_results  jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{stepId,label,mode,actionType,ok,message}]
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);
CREATE INDEX IF NOT EXISTS idx_skill_factory_runs_task ON public.skill_factory_runs (task_id, started_at DESC);
COMMENT ON TABLE public.skill_factory_runs IS
  'Skill Factory task execution log (per-step results), scoped by user_email/hospital_type.';
ALTER TABLE public.skill_factory_runs DISABLE ROW LEVEL SECURITY;
```

### 2.7 `utility_deadlines` — `20260605130000_create_utility_deadlines.sql` (+ notify cols + recipient + important)
```sql
create table if not exists public.utility_deadlines (
  id uuid primary key default gen_random_uuid(),
  hospital_type text,
  name text not null,
  bill_type text not null default 'other',
  amount numeric(12, 2) not null default 0,
  due_date date not null,
  status text not null default 'pending' check (status in ('pending', 'paid')),
  recurring boolean not null default true,
  notes text,
  attachment_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists utility_deadlines_hospital_due_idx on public.utility_deadlines (hospital_type, due_date);
alter table public.utility_deadlines enable row level security;
drop policy if exists "utility_deadlines anon all" on public.utility_deadlines;
create policy "utility_deadlines anon all" on public.utility_deadlines
  for all to anon, authenticated using (true) with check (true);
grant select, insert, update, delete on public.utility_deadlines to anon, authenticated;

-- 20260610120000_add_notify_at_to_utility_deadlines.sql
alter table public.utility_deadlines
  add column if not exists notify_at      timestamptz,
  add column if not exists notify_sent_at timestamptz;
create index if not exists idx_utility_deadlines_notify_at on public.utility_deadlines (notify_at)
  where notify_at is not null and notify_sent_at is null;

-- 20260611000000 (recipient link) + 20260611010000 (important)
alter table public.utility_deadlines add column if not exists recipient_id uuid references public.slack_recipients(id);
create index if not exists utility_deadlines_recipient_idx on public.utility_deadlines (recipient_id);
alter table public.utility_deadlines add column if not exists important boolean not null default false;
```

### 2.8 `slack_recipients` — `20260611000000_create_slack_recipients_and_deadline_recipient.sql` (+ `is_director`)
```sql
create table if not exists public.slack_recipients (
  id uuid primary key default gen_random_uuid(),
  name text not null,                       -- display, e.g. 'Murli sir'
  aliases text[] not null default '{}',     -- match tokens, e.g. {murli,murali}
  slack_target text,                        -- Slack user ID (U…) or channel ID (C…); null = name-only
  kind text not null default 'dm' check (kind in ('dm', 'channel')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.slack_recipients enable row level security;
drop policy if exists "slack_recipients anon all" on public.slack_recipients;
create policy "slack_recipients anon all" on public.slack_recipients
  for all to anon, authenticated using (true) with check (true);
grant select, insert, update, delete on public.slack_recipients to anon, authenticated;
-- 20260611010000_add_director_and_important_flags.sql
alter table public.slack_recipients add column if not exists is_director boolean not null default false;
```

### 2.9 `email_inbox` — `20260602200001_create_email_inbox.sql` (+ grants `20260605000001`)
```sql
CREATE TABLE IF NOT EXISTS email_inbox (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_email   TEXT NOT NULL,
  from_name    TEXT,
  subject      TEXT,
  body_preview TEXT,
  category     TEXT CHECK (category IN ('billing','corporate','tpa','appointment','general','urgent')),
  urgency      TEXT CHECK (urgency IN ('high','medium','low')),
  received_at  TIMESTAMPTZ,
  check_run    TEXT CHECK (check_run IN ('morning','evening')),
  check_date   DATE,
  draft_reply  TEXT,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','sent')),
  approved_by  TEXT,                          -- stores 'gmailid:MSG_ID' for dedup; becomes staff name on approval
  approved_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE email_inbox DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_email_inbox_check_date ON email_inbox (check_date DESC);
CREATE INDEX IF NOT EXISTS idx_email_inbox_status     ON email_inbox (status);
CREATE INDEX IF NOT EXISTS idx_email_inbox_category   ON email_inbox (category);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE email_inbox TO anon, authenticated;
```

> Also referenced by the runtime but **owned by other features (do not recreate here):**
> `user_activity_log` (automation audit trail / fire-count source) and the `/api/slack` endpoint.

---

## 3. TypeScript types

Domain types live alongside the libs; the Supabase `Row/Insert/Update` shapes mirror §2 and live in
`src/integrations/supabase/types.ts` (one block per table in §2).

### Automation graph (`src/lib/taskOptimizerFlows.ts`)
```ts
export const FLOW_EVENT_TYPES = ['status_changed','bill_added','deadline_due','deadline_overdue',
  'deadline_paid','task_added','scheduled'] as const;
export type FlowEventType = (typeof FLOW_EVENT_TYPES)[number];

export const SCHEDULED_CADENCES = ['15m','hourly','daily'] as const;
export type ScheduledCadence = (typeof SCHEDULED_CADENCES)[number];

export type TriggerConfig =
  | { event: 'status_changed'; toStatus: ActionStatus | 'any' }
  | { event: 'bill_added'; billType?: string | 'any' }
  | { event: 'deadline_due'; withinDays?: number }
  | { event: 'deadline_overdue' }
  | { event: 'deadline_paid' }
  | { event: 'task_added'; textContains?: string; designationContains?: string }
  | { event: 'scheduled'; cadence: ScheduledCadence };

export type ConditionField = 'designation' | 'suggestion_type' | 'time_saved_mins';
export type ConditionOp = 'eq' | 'contains' | 'gte';
export interface ConditionConfig { field: ConditionField; op: ConditionOp; value: string; }

export type ActionType = 'notify'|'tag'|'set_status'|'whatsapp'|'email'|'gmail_check'|'slack'|'guide';
export interface ActionConfig {
  type: ActionType; message?: string; setStatus?: ActionStatus; enabled?: boolean;
  to?: string; subject?: string; query?: string; url?: string; label?: string;
}
export interface StoredNode { id: string; type: 'trigger'|'condition'|'action';
  position: { x: number; y: number }; data: { kind; label; config; [k:string]:unknown }; }
export interface StoredEdge { id: string; source: string; target: string; }
export interface TaskFlow { id; hospital_type: string|null; role: string|null; name: string;
  enabled: boolean; nodes: StoredNode[]; edges: StoredEdge[]; created_at: string; updated_at: string; }
```
Flow CRUD exports: `fetchTaskFlows(hospitalType)`, `fetchEnabledFlows(hospitalType)`,
`saveTaskFlow(input)`, `deleteTaskFlow(id)`, `makeStarterFlow(...)`. Table const: `task_optimizer_flows`.

### Suggestions (`src/lib/optimizeTasks.ts`)
```ts
export type SuggestionType = 'automate'|'reduce'|'delegate'|'keep';
export type ActionStatus = 'suggested'|'in_progress'|'done'|'dismissed';
export const ACTION_STATUSES: readonly ActionStatus[] = ['suggested','in_progress','done','dismissed'];
export interface TaskSuggestion { task: string; type: SuggestionType; suggestion: string;
  rationale: string; tool?: string; existsInAdamrit?: boolean; }
export interface OptimizeTasksInput { name: string; designation: string; tasks: string[]; }
```

### Skill Factory v2 task model (`src/lib/skillFactory.ts`)
```ts
type StepType = 'step'|'decision'|'output';
type StepMode = 'manual'|'auto';
type SkillActionType = 'notify'|'create_task'|'generate_document'|'reminder'|'send_email'
  |'whatsapp'|'update_record'|'fetch_data';
interface SkillStep { id; label; type: StepType; mode: StepMode; actionType?: SkillActionType;
  config?: Record<string,unknown>; how?: string; assignee?: string; }
interface SkillTask { id; user_email; hospital_type: string|null; owner_role: string|null;
  title; description; category; status: 'capturing'|'designed'|'active'|'archived';
  interview: ChatMsg[]; steps: SkillStep[]; automation_summary: string; automation_score: number;
  sort_order: number; created_at?; updated_at?; }
// SKILL_ACTIONS catalog marks which actionTypes are executable today: notify, generate_document,
// create_task are executable; reminder/send_email/whatsapp/update_record/fetch_data are placeholders.
// Max 8 steps per task.
```

### Other domain interfaces (chatbot, deadline, billing)
- `GeneratedFlow`, `TaskChange`, `StepChange` — `src/lib/generateFlowFromPrompt.ts`
- `ScanAttachment`, `ScanField` — `src/lib/scanForTask.ts`
- `ParsedReminder` (extends `UpsertUtilityDeadline` with `dueLabel`, `recipient_hint`) — `src/lib/parseReminderFromPrompt.ts`
- `AutomationSuggestion` — `src/lib/suggestAutomations.ts`
- `UtilityDeadline`, `UtilityStatus`, `UtilityBillType`, `UpsertUtilityDeadline` — `src/hooks/useUtilityDeadlines.ts`
- `SlackRecipient`, `SlackRecipientKind` — `src/lib/slackRecipients.ts`
- `InboxMail`, `CheckMailResult`, `ReplyStyle`, `REPLY_STYLES`, `STYLE_LABELS` — `src/components/task-optimizer/useGmailChecker.ts`

---

## 4. Backend / API contracts

### 4.1 `api/skill-factory-claude.ts` — VPS Claude relay (**shared infra, kept**)
`POST /api/skill-factory-claude`. Relays a prompt to the VPS Claude sidecar, keeping the token
server-side. No fallback — upstream errors surface verbatim with the upstream status.
```jsonc
// request
{ "prompt": "string (required)",
  "model": "sonnet|opus|haiku (optional, default sonnet)",
  "images": [{ "base64": "...", "mimeType": "..." }],   // optional vision
  "feature": "string (optional, ≤80 chars; else derived from Referer) — usage attribution" }
// response: upstream Claude CLI JSON envelope, e.g. { "result": "<text>", "usage": {...} }
```
Env: `VPS_CLAUDE_URL`, `VPS_CLAUDE_TOKEN` (sent as `Authorization: Bearer`). `maxDuration: 120`
in `vercel.json`. Browser helper: `src/lib/vpsClaude.ts` — `callVpsClaude(prompt, model?, images?)`,
`LLM_BACKEND` (`'vps'|'gemini'` from `VITE_LLM_BACKEND`). **This relay + helper are used by many
non-SF features (ChatWidget, CameraUpload, FinalBill, IPD/Discharge, Marketing, drug-interactions),
so they must always be preserved.**

### 4.2 `api/vps-claude-usage.ts` — token spend report (**shared, kept**)
`GET /api/vps-claude-usage` → `{ generated_at, combined:{ all_time, today, this_month }, sidecars:[…] }`.
Env: `VPS_CLAUDE_USAGE_URL` (comma-separated; if unset, derived from `VPS_CLAUDE_URL` by swapping the
final `claude` → `usage`), `VPS_CLAUDE_TOKEN`. Consumed by `src/pages/VpsClaudeUsage.tsx`.

### 4.3 `api/deadline-reminders.ts` — daily digest cron
Vercel cron `{ "path": "/api/deadline-reminders", "schedule": "30 3 * * *" }` (3:30 AM UTC). Posts an
overdue / due-soon utility-bill digest to Slack. Env: `SUPABASE_SERVICE_ROLE_KEY`, `SLACK_WEBHOOK_URL`,
`CRON_SECRET` (optional bearer).

### 4.4 `api/fire-due-reminders.ts` — exact-time reminder firer
Polled ~every 15 min (VPS cron). Sends one-off reminders for `utility_deadlines.notify_at` rows where
`notify_sent_at IS NULL`, then stamps `notify_sent_at`. Same env as 4.3.

### 4.5 `api/jotform-webhook.ts` — JotForm → flow intake (SF-exclusive)
Receives JotForm submissions (shared secret `JOTFORM_WEBHOOK_SECRET`) and feeds the flow engine.
Referenced from `flow/FlowCanvas.tsx` and the `task_optimizer_flows` migration. Tests:
`e2e/jotform-webhook.test.ts`, `e2e/jotflow-local-check.mjs`.

### 4.6 Supabase edge fn `supabase/functions/run-deadline-automations/index.ts`
GET-only daily scan that mirrors the client `DeadlineDashboard` status loop: fires
`deadline_due` / `deadline_overdue` automations for unpaid utility bills and logs fires to
`user_activity_log` (notify-only, no mutating actions). Invoked by `/api/deadline-reminders`.

### 4.7 VPS sidecar `scripts/vps-sidecar-claude/server.js` (Express, on the VPS)
Binds `127.0.0.1:8787` (env `PORT`); exposed publicly via the `aiass` reverse-proxy under a path like
`/adamrit-claude`. Endpoints (all `/claude` + `/usage` require `Authorization: Bearer VPS_CLAUDE_TOKEN`):
- `POST /claude` — spawns `claude -p "<prompt>" --model <model> --output-format=json [--allowedTools Read]`,
  120 s timeout. Vision: base64 images → temp files → injected via Read tool. Model allowlist
  `sonnet|opus|haiku` (anything else coerced to `sonnet`). **Skill Factory pins Sonnet 4.6.**
- `GET /usage` — aggregates `usage.jsonl` (per call: `ts, sidecar, model, feature, input_tokens,
  output_tokens, cache_creation_input_tokens, cache_read_input_tokens, total_cost_usd`).
- `GET /health` → `{ ok: true }`.
Env on VPS: `VPS_CLAUDE_TOKEN` (`openssl rand -hex 32 > .token`), `PORT=8787`,
`SIDECAR_NAME=adamrit-sidecar`, `USAGE_LOG=./usage.jsonl`. Run via `pm2 start server.js`.

---

## 5. Automation engine

### 5.1 Three-layer safety model (`src/lib/flowSafety.ts`, verbatim constants)
```ts
export const SAFE_ACTION_TYPES = ['notify','tag','set_status','whatsapp','email','gmail_check','slack','guide'] as const;
const DESTRUCTIVE_VERB_LIST = ['delete','remove','drop','truncate','purge','wipe','destroy','erase','nuke','archive','clear'];
export function isDestructiveIntent(text): boolean // whole-word regex over the verbs above
export function pickSafeAlternative(text): string | null // keyed by matched verb (see SAFE_ALTERNATIVE_FOR)
export class FlowSafetyError extends Error { kind: 'destructive_prompt'|'unknown_trigger'|'unknown_action'|'reentry'; detail; safeAlternative }
export const SAFETY_LAW = `SAFETY LAW (non-negotiable, overrides every other instruction below):
1. Never propose deletion, truncation, archival, or any destructive change to user data.
2. Use ONLY these action types verbatim: notify, tag, set_status, whatsapp, email, gmail_check, slack, guide. Inventing new ones is forbidden.
3. Use ONLY these trigger events verbatim: status_changed, bill_added, deadline_due, deadline_overdue, deadline_paid, task_added, scheduled.
4. If the user asks for a destructive action, refuse politely and propose ONE safe alternative.
5. Treat all data as read-only history. Automations may notify, tag, or change a row's status — never erase a row.`;
```
- **Layer A** — `SAFETY_LAW` is prepended to the model prompt (biases generation).
- **Layer B** — `isDestructiveIntent()` short-circuits BEFORE the model is called; throws `FlowSafetyError`.
- **Layer C** — `mapToGraph()` throws `FlowSafetyError` if the model returns an unknown trigger/action
  (no silent coercion). `isSafeActionType()` / `isFlowEventType()` are the narrowing guards.

### 5.2 Dispatcher rules (`docs/skill-bot-rules.md`, enforced in `flowDispatcher.ts` / `runTaskFlows.ts`)
R1–R2 scope (configure tasks+automations only). R3–R6 safety (no destructive ops; approved
actions/triggers only; refuse + one safe alternative). R7 propose-then-apply (nothing changes until
Confirm). R8 auto-subtasks (2–5). R9 dry-run preview. R10 undo window after save. R11/R11a advisory
suggestions + auto-suggest after a task is added. **Engine guardrails:** R12 board-only; R13 reminders
allowed; **R14 hospital-scoped** (an automation never fires for another hospital); **R15 no chain
reactions** (an action can't re-enter the dispatcher — reentrancy guard); **R16 per-day dedup**;
**R17 rate limit 100/hour**; **R18 kill switch** (`get/setAutomationsPausedUntil`, localStorage);
**R19 no back-firing** (a new flow doesn't fire against pre-existing records). Mail bot R20–R24:
read-only inbox, runs while app open, alerts to bell, drafts-never-sends, needs Gmail keys.

### 5.3 Runtime data-flow
```
event (bill_added | status_changed | deadline_due | deadline_overdue | deadline_paid | task_added | scheduled)
  → dispatchFlowEvent()  [flowDispatcher.ts]
      R18 pause check → R15 reentrancy depth → R16 per-day dedup → R14 hospital filter
      → R19 created-after-record filter → R17 rate limit
      → for each enabled flow: runFlowsForEvent() [runTaskFlows.ts]
          triggerMatchesEvent() → conditionsPass() → runAction() per action node
            notify/tag/set_status (mutate task_optimizer_actions) | slack (notifyUtilitySlack → /api/slack)
            | whatsapp/email/gmail_check/guide ; every fire → user_activity_log (audit)
  → FlowActionResult[] → toasts (dispatchFlowEventWithToasts) or silent audit
```
`automationFireStats.ts` reads `user_activity_log` for the chatbot's "Fired N times this week" footer
(60 s cache). `notifySlack.ts` (`notifyUtilitySlack`) posts to `/api/slack`; kept separate to avoid the
`useUtilityDeadlines → flowDispatcher → runTaskFlows` import cycle.

### 5.4 Model output JSON (what the LLM emits for `generateFlowFromPrompt`)
```jsonc
{ "name": "...", "explanation": "...", "questions": ["…?"],
  "trigger": { "event": "<FLOW_EVENT_TYPE>", "toStatus|billType|withinDays|cadence": "…" },
  "conditions": [{ "field": "designation|suggestion_type|time_saved_mins", "op": "eq|contains|gte", "value": "…" }],
  "actions": [{ "type": "<SAFE_ACTION_TYPE>", "message": "may use {staff} {task} {status}",
               "setStatus": "…", "to": "…", "subject": "…", "url": "/route", "label": "…" }],
  "taskChanges": [{ "action": "add|remove", "task": "…" }],
  "stepChanges": [{ "action": "add|remove", "task": "owning task", "step": "…" }] }
```

---

## 6. Frontend components

### 6.1 Pages
- **`src/pages/SkillFactoryV2.tsx`** (~2760 lines). 5-column resizable workspace
  (`ResizablePanelGroup` with `autoSaveId`): **Staff** (collapsible roster; admins see all staff from
  `task_optimizer_logs`, others see only themselves + a "Front Desk" demo persona; role→designation
  map; role-based email account picker `info@`/`cmd@hopehospital.com`) → **Tasks** → **Steps**
  (violet sub-panel, only when a task is selected) → **Workflow** (`SkillFactoryFlow` canvas; synthetic
  task-overview flow with AI-verdict dots when no task selected; special hardcoded 5-step "Deadline
  Tracking" flow) → **AI** (`SkillFactoryChatbot`). Cross-column drag (dnd-kit) promotes/demotes
  tasks↔steps. State synced to `subtasksMap` (localStorage `sf-v2:*` + DB). Verdict→action map:
  automate→notify, reduce→tag, delegate→set_status, keep→notify. When `activeMailbox` set, swaps
  Tasks/Workflow for `BillingPanel`.
- **`src/pages/SkillFactory.tsx`** (~1254 lines, legacy v1). Rail (My Subagents / Templates / Insights /
  Settings) → Subagents → Rules (photo-trigger → document action) → Workflow rows → Gemini AI assistant
  ("Head of Hospital" prompt; emits a fenced ```skillfactory `{kind:"workflow"|"breakdown",…}``` block).
  Seeds `DEFAULT_SUBAGENTS` (Discharge, IPD Registration, Lab Orders, Pharmacy, Radiology) into
  `skill_factory_subagents` on first load. Uses `gemini` + `vpsClaude`.
- **`src/pages/TaskOptimizer.tsx`** → renders `TaskOptimizerDashboard` (tabs: New Entry / View
  Submissions / Automations / Billing / Insights).

### 6.2 `src/components/task-optimizer/**`
- **`SkillFactoryChatbot.tsx`** (~1397 lines). The AI workflow designer. Props include `task`,
  `subtasks`, `designation`, `allTasks`, `stepsByTask`, `currentFlow`, callbacks `onApply`,
  `onCreateAutomation`, `listExistingFlows`, `onLoadExistingFlow`, `onAttachScan`,
  `taskAttachments`, `showComposer`. Branches: NL reminder (`looksLikeCreateReminder` →
  `parseReminderFromPrompt` → `createDeadline` → green card), `classifyChatIntent` → `suggestAutomations`
  cards or existing-flows picker, else `generateFlowFromPrompt` → ProposalCard (Confirm/Discard) →
  `onApply`. Rules: propose-then-apply, dry-run toggle (captured at generation time), undo, fire-count
  footer (`automationFireStats`), starter prompts + quick-refinement chips (Simpler / Add reminder /
  Add tagging), safety-blocked red bubble with one safe alternative, document scan (`scanForTask`),
  recipient resolution (`slackRecipients` / `useSlackRecipients`).
- **`SkillFactoryFlow.tsx`** — React Flow (`@xyflow/react`) canvas wrapper. Props `nodes`, `edges`,
  `onChange`, `readOnly`, `topRightPanel`. Palette (trigger/condition/action), animated edges,
  delete-selected, `fitView` on node-id change. dnd sensors (Pointer 3px / Mouse / Touch 100ms / Keyboard).
- **`NotificationBell.tsx`** — new-task/deadline bell; `compact`/`inline` variants; creates deadlines
  via `parseRemindersFromPrompt`.
- **`SkillInsightChip.tsx`** — per-task insight chip.
- **`TaskOptimizerDashboard.tsx`**, **`SubmissionsList.tsx`**, **`InsightsPanel.tsx`**,
  **`AutomationsPanel.tsx`** (lists flows by role + master kill switch), **`BillingPanel.tsx`**,
  **`commonTasks.ts`** (`ADAMRIT_MODULES`, `COMMON_TASKS`), **`DocumentScanMenu.tsx`**,
  **`useGmailChecker.ts`** (see §7).
- **`flow/`** — `FlowCanvas.tsx`, `nodeTypes.tsx` (TriggerNode/ConditionNode/ActionNode),
  `FlowInspector.tsx`, `FlowChatbot.tsx` (calls `generateFlowFromPrompt`), `DeadlineDashboard.tsx`,
  `DeadlineNotificationBell.tsx`, `DeadlineBillReminder.tsx`, `BillScanMenu.tsx`,
  `SlackRecipientsManager.tsx`.

### 6.3 Libs by area (`src/lib/`)
Automation: `taskOptimizerFlows`, `taskOptimizerActions`, `flowDispatcher`, `runTaskFlows`,
`flowSafety`, `automationFireStats`, `notifySlack`, `automationCapabilities` (`APP_AUTOMATION_CONTEXT`).
Chatbot/AI: `generateFlowFromPrompt`, `optimizeTasks`, `suggestAutomations`, `classifyChatIntent`,
`parseReminderFromPrompt`, `generateSubtasks`, `scanForTask`, `skillFactory`, `skillFactoryExecutors`.
Deadline/Slack: `src/hooks/useUtilityDeadlines.ts`, `src/hooks/useSlackRecipients.ts`,
`src/lib/slackRecipients.ts`. Shared (kept regardless): `vpsClaude.ts`, `drug-interactions.ts`,
`extractMedicationChart.ts`, `gemini.ts`.

---

## 7. Billing-email automation (full spec)

> Reproduced from `docs/billing-email-automation.md` (built 2026-06-05).

Connects the `info@hopehospital.com` Gmail inbox into the app — no server; OAuth2 from the browser.
Flow: **Start Checking Mail** → fetch ≤50 messages → keyword-classify → build per-category draft →
store in `email_inbox` (admin client, bypasses RLS) → review/edit → **Re-phrase ▾** (Gemini: Standard
/ Formal / Brief / Friendly) → **Approve & Send** (opens Gmail compose; never auto-sends) or Reject.

Key files: `BillingPanel.tsx` (UI), `useGmailChecker.ts` (fetch/dedup/draft/rephrase),
`src/integrations/supabase/adminClient.ts` (service-role client),
`scripts/email-automation/setup-oauth.js` (one-time OAuth, writes refresh token to `.env`).

Architecture:
```
Browser
 ├ OAuth2 silent exchange: VITE_GMAIL_REFRESH_TOKEN → Google → access_token (55-min cache)
 ├ Gmail read: GET /gmail/v1/users/me/messages?maxResults=50 ; GET …/messages/{id}?format=full
 ├ keyword classifier → draft template
 ├ Gmail draft: POST /gmail/v1/users/me/drafts (threaded reply in Drafts)
 └ Supabase admin client → email_inbox (stores email + draft for app display)
```
Classification (subject/body keyword → category): tpa/insurance/claim/cashless/mediclaim/echs/cghs/esic
→ `tpa`; corporate/company/empanelled/tie-up → `corporate`; bill/invoice/payment/dues/outstanding/
discharge → `billing`; urgent/emergency/asap/critical → `urgent`; else `general`. Urgency high/medium/low.
**Dedup:** Gmail `msg.id` stored as `gmailid:MSG_ID` in `approved_by`; on re-check: found → skip; shorter
stored body → update; not found → insert. Templates per category, all signed
*Hope Hospital Billing Team · info@hopehospital.com*. `useGmailChecker` exports: `getGmailAccessToken()`,
`checkMail()`, `regenerateDraft()`, `rephraseDraft()`, and `REPLY_STYLES`/`STYLE_LABELS`/`ReplyStyle`.

---

## 8. Environment variables

| Var | Where | Purpose |
|-----|-------|---------|
| `VITE_LLM_BACKEND` | client | `vps` (Skill Factory) or `gemini` |
| `VPS_CLAUDE_URL` | server | sidecar `/claude` URL (e.g. `https://aiass.<domain>/adamrit-claude`) |
| `VPS_CLAUDE_TOKEN` | server | bearer for sidecar (`openssl rand -hex 32`) |
| `VPS_CLAUDE_USAGE_URL` | server | comma-sep `/usage` URLs; derived from `VPS_CLAUDE_URL` if blank |
| `VITE_GEMINI_API_KEY` | client | presence sentinel; real key is server-side `GEMINI_API_KEY` (Supabase secret) |
| `VITE_GMAIL_CLIENT_ID` / `_SECRET` / `_REFRESH_TOKEN` / `_USER_EMAIL` | client | Gmail OAuth for billing email |
| `VITE_SUPABASE_SERVICE_ROLE_KEY` | client | admin writes to `email_inbox` (bypass RLS) |
| `VITE_RESEND_API_KEY` | client | Skill Factory email sends (Resend, 100/day free) |
| `VITE_REPHRASE_SIDECAR_URL` / `_KEY` | client | optional VPS rephrase sidecar (`x-sidecar-key`) |
| `JOTFORM_WEBHOOK_SECRET` | server | `/api/jotform-webhook` shared secret |
| `SLACK_WEBHOOK_URL` | server | deadline digests / fire-due reminders |
| `CRON_SECRET` | server | optional bearer guarding the crons |
| `SUPABASE_SERVICE_ROLE_KEY` | server | crons + edge fn DB access |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | client | base Supabase access |

---

## 9. Seed data

`supabase/seed_task_optimizer_demo.sql` (NOT auto-applied; run in SQL Editor). 8 demo staff
submissions across Nursing, Reception, Billing, Lab, Pharmacy, Admin, Marketing, IT — each with 4
`type ∈ {automate,reduce,delegate,keep}` suggestions + a recommended tool. Remove with
`DELETE FROM public.task_optimizer_logs WHERE user_email LIKE '%@demo.hope';`

---

## 10. Tests & scripts

| File | Covers |
|------|--------|
| `e2e/skill-factory-smoke.mjs` | SF page load, staff roster scope, designation grouping, no console errors (mocks REST for logs+flows) |
| `e2e/task-optimizer-local-check.mjs` | pre-fill chips → textarea; status + time-saved inputs; insights charts (mocks logs+actions) |
| `e2e/run-task-flows.test.ts` | flow evaluation/action execution unit tests (`npm run test:automations`) |
| `e2e/jotform-webhook.test.ts`, `e2e/jotflow-local-check.mjs` | JotForm intake |
| `scripts/smoke-automations.cjs` | seed flow → insert bill → assert `automation_fired` in `user_activity_log` → cleanup (`npm run smoke:automations`; exit 0/1/2/3) |
| `scripts/check-automation-table-access.cjs` | anon-key access to automation tables (`npm run check:automation-tables`) |
| `scripts/diag-sf.cjs` | Skill Factory diagnostics |

`package.json` scripts: `check:automation-tables`, `smoke:automations`, `test:automations`.
`vite.config.ts` dev proxies (when `DEV_API_PROXY` set): `/api/skill-factory-claude`,
`/api/vps-claude-usage`. Path alias `@ → ./src`.

---

## 11. Rebuild checklist (ordered)

1. **DB** — run the §2 SQL blocks (in filename order); optionally run §9 seed.
2. **Types** — regenerate `src/integrations/supabase/types.ts` (or paste the §3 Row/Insert/Update blocks).
3. **Shared infra** — ensure `src/lib/vpsClaude.ts`, `api/skill-factory-claude.ts`,
   `api/vps-claude-usage.ts`, the VPS sidecar (§4.7), and `gemini.ts` exist.
4. **Libs** — add automation libs (§6.3) then AI/chatbot libs; `flowSafety` depends on
   `taskOptimizerFlows`; `optimizeTasks` depends on `commonTasks` (`ADAMRIT_MODULES`).
5. **Hooks** — `useUtilityDeadlines`, `useSlackRecipients`.
6. **Components** — `src/components/task-optimizer/**` incl. `flow/**`, `useGmailChecker`, panels.
7. **Pages** — `SkillFactory.tsx`, `SkillFactoryV2.tsx`, `TaskOptimizer.tsx`.
8. **Wire** — add the §1 routes to `AppRoutes.tsx`, the sidebar entry to `menuItems.ts`, the group to
   `sidebarGroups.ts`, and the FAB suppression to `App.tsx`.
9. **API + cron** — add `api/deadline-reminders.ts`, `api/fire-due-reminders.ts`,
   `api/jotform-webhook.ts`, the `supabase/functions/run-deadline-automations` edge fn, and the
   `vercel.json` cron `{ "/api/deadline-reminders", "30 3 * * *" }` + `skill-factory-claude` maxDuration.
10. **Env** — set the §8 variables (client + server + VPS sidecar).
11. **Deploy** — VPS sidecar via pm2 behind the `aiass` proxy; run OAuth setup for billing email;
    verify with `npm run smoke:automations` and the e2e checks in §10.
```
```
