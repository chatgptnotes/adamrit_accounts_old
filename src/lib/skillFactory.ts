// Skill Factory v2 — types, persistence, the "Process Coach" AI prompt, and the
// robust parse/validate of what the AI commits. The page (SkillFactory.tsx) is a
// thin UI shell over this. Mirrors the app's existing patterns:
//   - persistence + per-user/hospital scoping like src/lib/taskOptimizerFlows.ts
//   - robust fenced-JSON parsing like src/lib/optimizeTasks.ts
import { supabase } from '@/integrations/supabase/client';

// ── Domain types ─────────────────────────────────────────────────────────────
export type StepType = 'step' | 'decision' | 'output';
export type StepMode = 'manual' | 'auto';

// Action types an "auto" step can run. The catalog below marks which ones are
// actually executable today vs captured-but-needs-setup (no fake execution).
export type SkillActionType =
  | 'notify'
  | 'create_task'
  | 'generate_document'
  | 'reminder'
  | 'send_email'
  | 'whatsapp'
  | 'update_record'
  | 'fetch_data';

export interface SkillStep {
  id: string;
  label: string;
  type: StepType;
  mode: StepMode;
  actionType?: SkillActionType; // only when mode === 'auto'
  config?: Record<string, unknown>;
  how?: string; // one-line Hinglish: kaise automate/karna hai
  assignee?: string; // '' = unassigned
}

export interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
}

export type TaskStatus = 'capturing' | 'designed' | 'active' | 'archived';

export interface SkillTask {
  id: string;
  user_email: string;
  hospital_type: string | null;
  owner_role: string | null;
  title: string;
  description: string;
  category: string;
  status: TaskStatus;
  interview: ChatMsg[];
  steps: SkillStep[];
  automation_summary: string;
  automation_score: number; // 0-100
  sort_order: number;
  created_at?: string;
  updated_at?: string;
}

// ── Action catalog (shared by AI allowlist, UI picker, executors) ─────────────
export interface ActionMeta {
  type: SkillActionType;
  label: string;
  executable: boolean; // true = real effect today; false = "needs setup"
  hint: string; // Hinglish, shown in the picker
}

export const SKILL_ACTIONS: ActionMeta[] = [
  { type: 'notify', label: 'Notify / alert', executable: true, hint: 'Turant alert/notification dikhao' },
  { type: 'generate_document', label: 'Generate document', executable: true, hint: 'AI se draft/summary/letter banao' },
  { type: 'create_task', label: 'Assign a to-do', executable: true, hint: 'Kisi staff ko ek kaam assign karo' },
  { type: 'reminder', label: 'Set reminder', executable: false, hint: 'Ek time par yaad dilao (setup chahiye)' },
  { type: 'send_email', label: 'Send email', executable: false, hint: 'Email bhejo, approval ke baad (setup chahiye)' },
  { type: 'whatsapp', label: 'Send WhatsApp', executable: false, hint: 'WhatsApp message (setup chahiye)' },
  { type: 'update_record', label: 'Update a record', executable: false, hint: 'Patient/record update (setup chahiye)' },
  { type: 'fetch_data', label: 'Fetch data', executable: false, hint: 'System se data nikalo (setup chahiye)' },
];

const ACTION_TYPES = new Set<SkillActionType>(SKILL_ACTIONS.map((a) => a.type));
export const actionMeta = (t?: SkillActionType): ActionMeta | undefined =>
  SKILL_ACTIONS.find((a) => a.type === t);
export const isExecutable = (t?: SkillActionType): boolean => !!actionMeta(t)?.executable;

// At most this many steps per task; bigger work is split into a "breakdown".
export const MAX_STEPS = 8;
const VALID_TYPES = new Set<StepType>(['step', 'decision', 'output']);
const VALID_MODES = new Set<StepMode>(['manual', 'auto']);

const genId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Math.floor(performance.now() * 1000)}-${Math.floor(performance.timeOrigin)}`;

// ── Supabase persistence ─────────────────────────────────────────────────────
const TABLE = 'skill_factory_tasks';
const SUBAGENTS_TABLE = 'skill_factory_subagents'; // v1 table, read once to import

interface TaskRow {
  id: string;
  user_email: string;
  hospital_type: string | null;
  owner_role: string | null;
  title: string;
  description: string | null;
  category: string | null;
  status: string | null;
  interview: ChatMsg[] | null;
  steps: Partial<SkillStep>[] | null;
  automation_summary: string | null;
  automation_score: number | null;
  sort_order: number | null;
  created_at?: string;
  updated_at?: string;
}

const VALID_STATUS = new Set<TaskStatus>(['capturing', 'designed', 'active', 'archived']);

// Coerce a stored/AI step into a valid SkillStep (defensive — never trust JSONB).
export function normalizeStep(s: Partial<SkillStep> | null | undefined): SkillStep | null {
  if (!s || typeof s !== 'object') return null;
  const label = typeof s.label === 'string' ? s.label.trim() : '';
  if (!label) return null;
  const mode: StepMode = VALID_MODES.has(s.mode as StepMode) ? (s.mode as StepMode) : 'manual';
  const actionType =
    mode === 'auto' && ACTION_TYPES.has(s.actionType as SkillActionType)
      ? (s.actionType as SkillActionType)
      : undefined;
  return {
    id: typeof s.id === 'string' && s.id ? s.id : genId(),
    label,
    type: VALID_TYPES.has(s.type as StepType) ? (s.type as StepType) : 'step',
    mode: mode === 'auto' && !actionType ? 'manual' : mode, // auto needs a known action
    actionType,
    config: s.config && typeof s.config === 'object' ? s.config : undefined,
    how: typeof s.how === 'string' ? s.how.trim() : undefined,
    assignee: typeof s.assignee === 'string' ? s.assignee : '',
  };
}

const normalizeSteps = (raw: Partial<SkillStep>[] | null): SkillStep[] =>
  (Array.isArray(raw) ? raw : []).map(normalizeStep).filter((s): s is SkillStep => s !== null);

const rowToTask = (r: TaskRow): SkillTask => ({
  id: r.id,
  user_email: r.user_email,
  hospital_type: r.hospital_type ?? null,
  owner_role: r.owner_role ?? null,
  title: r.title,
  description: r.description ?? '',
  category: r.category ?? '',
  status: VALID_STATUS.has(r.status as TaskStatus) ? (r.status as TaskStatus) : 'capturing',
  interview: Array.isArray(r.interview) ? r.interview : [],
  steps: normalizeSteps(r.steps),
  automation_summary: r.automation_summary ?? '',
  automation_score: clampScore(r.automation_score),
  sort_order: typeof r.sort_order === 'number' ? r.sort_order : 0,
  created_at: r.created_at,
  updated_at: r.updated_at,
});

const taskToRow = (t: SkillTask) => ({
  id: t.id,
  user_email: t.user_email,
  hospital_type: t.hospital_type,
  owner_role: t.owner_role,
  title: t.title,
  description: t.description,
  category: t.category,
  status: t.status,
  interview: t.interview,
  steps: t.steps,
  automation_summary: t.automation_summary,
  automation_score: t.automation_score,
  sort_order: t.sort_order,
  updated_at: new Date().toISOString(),
});

function clampScore(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : 0;
  return Math.max(0, Math.min(100, v));
}

// One staff member's own tasks.
export async function fetchMyTasks(userEmail: string): Promise<SkillTask[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('user_email', userEmail)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data as TaskRow[]).map(rowToTask);
}

// Admin view: every staff member's tasks in the same hospital.
export async function fetchAllTasks(hospitalType: string | null): Promise<SkillTask[]> {
  let query = supabase.from(TABLE).select('*').order('user_email', { ascending: true }).limit(2000);
  if (hospitalType) query = query.eq('hospital_type', hospitalType);
  const { data, error } = await query;
  if (error) throw error;
  return (data as TaskRow[]).map(rowToTask);
}

export async function createTask(input: {
  userEmail: string;
  hospitalType: string | null;
  ownerRole: string | null;
  title: string;
  description?: string;
  category?: string;
  sortOrder: number;
}): Promise<SkillTask> {
  const row = {
    user_email: input.userEmail,
    hospital_type: input.hospitalType,
    owner_role: input.ownerRole,
    title: input.title,
    description: input.description ?? '',
    category: input.category ?? '',
    status: 'capturing' as TaskStatus,
    interview: [],
    steps: [],
    automation_summary: '',
    automation_score: 0,
    sort_order: input.sortOrder,
  };
  const { data, error } = await supabase.from(TABLE).insert(row).select('*').single();
  if (error) throw error;
  return rowToTask(data as TaskRow);
}

// Persist edits to an existing task (steps, interview, summary, status, etc.).
export async function saveTask(task: SkillTask): Promise<void> {
  const { error } = await supabase.from(TABLE).update(taskToRow(task)).eq('id', task.id);
  if (error) throw error;
}

export async function deleteTask(id: string): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq('id', id);
  if (error) throw error;
}

// One-time import: turn a user's v1 subagents/rules into v2 tasks (category = old
// subagent name). Returns the created tasks, or [] if there's nothing to import /
// the v1 table is gone. Caller only runs this when the user has zero v2 tasks.
export async function importFromSubagents(
  userEmail: string,
  hospitalType: string | null,
  ownerRole: string | null,
): Promise<SkillTask[]> {
  const { data, error } = await supabase
    .from(SUBAGENTS_TABLE)
    .select('name, rules')
    .eq('user_email', userEmail);
  if (error || !data || data.length === 0) return [];

  const rows: ReturnType<typeof buildImportRow>[] = [];
  let order = 0;
  for (const sub of data as { name: string; rules: unknown }[]) {
    const rules = Array.isArray(sub.rules) ? sub.rules : [];
    for (const rule of rules as { trigger?: string; action?: string; workflow?: unknown }[]) {
      const title = (rule.action || rule.trigger || 'Imported task').toString().trim();
      const steps = normalizeSteps(
        (Array.isArray(rule.workflow) ? rule.workflow : []) as Partial<SkillStep>[],
      );
      rows.push(buildImportRow({ userEmail, hospitalType, ownerRole, title, category: sub.name, steps, order: order++ }));
    }
  }
  if (rows.length === 0) return [];

  const { data: inserted, error: insErr } = await supabase.from(TABLE).insert(rows).select('*');
  if (insErr || !inserted) return [];
  return (inserted as TaskRow[]).map(rowToTask);
}

function buildImportRow(p: {
  userEmail: string;
  hospitalType: string | null;
  ownerRole: string | null;
  title: string;
  category: string;
  steps: SkillStep[];
  order: number;
}) {
  return {
    user_email: p.userEmail,
    hospital_type: p.hospitalType,
    owner_role: p.ownerRole,
    title: p.title,
    description: '',
    category: p.category,
    status: (p.steps.length > 0 ? 'designed' : 'capturing') as TaskStatus,
    interview: [] as ChatMsg[],
    steps: p.steps,
    automation_summary: '',
    automation_score: 0,
    sort_order: p.order,
  };
}

// ── The "Process Coach" AI ───────────────────────────────────────────────────
// Interviews the staff member on how their task is done, then commits a plan that
// marks which steps can be automated. Talks Hinglish, friendly, non-technical.
export function buildProcessCoachPrompt(task: SkillTask, ownerRole: string | null): string {
  const actionList = SKILL_ACTIONS.map(
    (a) => `${a.type}${a.executable ? '' : ' (needs setup)'} — ${a.hint}`,
  ).join('\n  ');
  const stepsSoFar = task.steps.length
    ? task.steps.map((s) => `${s.label} [${s.mode}${s.actionType ? `:${s.actionType}` : ''}]`).join('; ')
    : 'none yet';

  return `Aap "Process Coach" ho — Hope Hospital aur Ayushman Hospital (Nagpur, India) ke ek senior operations coach. Aap har role ka kaam concrete detail mein jaante ho: reception, IPD/OPD registration, nursing, doctor notes, discharge, pharmacy, lab/radiology orders, billing, aur Ayushman/PMJAY paperwork.

Aap "Skill Factory" ke andar kaam karte ho — ek no-code tool jahan koi bhi staff member apna roz ka kaam (task) likhta hai, aur aap usse poochke uska ek simple, automate-karne-layak plan banate ho.

AAPKA TARIKA (bahut zaroori):
1. HINGLISH mein baat karo — simple, friendly, jaise hospital staff aapas mein baat karte hain. Koi technical jargon nahi. Chhote jawab.
2. PEHLE SAMJHO. Plan banane se pehle 1-3 chhote, relevant sawaal poocho: ye kaam abhi haath se kaise hota hai? kaun karta hai? input/output kya hai (kaunsa form/photo/register)? approve kaun karta hai? Jab tak aap sawaal pooch rahe ho, koi code block mat bhejo.
3. JAB SAB SAMAJH AAYE, sabse simple step-by-step plan banao (zyada se zyada ${MAX_STEPS} steps). Har step concrete ho.

HAR STEP KE LIYE:
- "type": "step" (normal kaam), "decision" (haan/nahi ya branch), ya "output" (final cheez — note, bill, order, summary).
- "mode": "auto" agar computer ye step kar sakta hai, warna "manual".
- Agar "auto", to in actions mein se ek "actionType" choose karo:
  ${actionList}
- "how": ek line Hinglish mein — ye step kaise hoga / kya automate hoga.
Honest raho: jo step abhi sach mein automate nahi ho sakta use "manual" rakho. "needs setup" wale actions tabhi suggest karo jab wahi sahi ho.

AGAR KAAM BADA HAI (${MAX_STEPS} steps se zyada): use ek bade plan mein mat thooso. Use 2-3 chhote tasks ("skills") mein todo (kind:"breakdown"), har ek apne aap mein ${MAX_STEPS}-ya-kam steps ka.

OUTPUT PROTOCOL (critical):
Jab — aur sirf jab — aap plan commit karne ke liye ready ho, pehle 1-2 chhoti Hinglish lines likho, phir EXACTLY ek fenced code block tag "skillfactory" ke saath append karo jisme JSON ho. JSON ke andar koi comment nahi. Do allowed shapes:
\`\`\`skillfactory
{"kind":"task","title":"...","automation_summary":"...","automation_score":70,"steps":[{"label":"...","type":"step","mode":"auto","actionType":"notify","how":"..."}]}
\`\`\`
\`\`\`skillfactory
{"kind":"breakdown","tasks":[{"title":"...","automation_summary":"...","automation_score":50,"steps":[{"label":"...","type":"step","mode":"manual"}]}]}
\`\`\`
JSON rules: har task ke 1-${MAX_STEPS} steps; type = step|decision|output; mode = manual|auto; automation_score = 0-100 (kitna % automate ho sakta). automation_summary ek chhota Hinglish paragraph ho jo bataye kya-kya automate ho sakta hai. Agar aap abhi sawaal pooch rahe ho, koi code block mat bhejo.

ABHI KA CONTEXT:
- Task: "${task.title}"${task.description ? ` — ${task.description}` : ''}
- Ye task banane wale staff ka role: ${ownerRole || 'unknown'}
- Ab tak ke steps: ${stepsSoFar}
Sab kuch ek busy Indian hospital ke liye practical rakho. Concise raho.`;
}

// ── Parse + validate the AI commit ───────────────────────────────────────────
export const SKILL_FENCE = /```skillfactory\s*([\s\S]*?)```/i;

// Split a reply into prose (shown to user) + parsed JSON payload (or null).
export function extractSkillBlock(raw: string): { display: string; payload: unknown } {
  const match = raw.match(SKILL_FENCE);
  if (!match) return { display: raw.trim(), payload: null };
  const display = raw.replace(match[0], '').trim();
  let payload: unknown = null;
  try {
    payload = JSON.parse(match[1].trim());
  } catch {
    payload = null;
  }
  return { display, payload };
}

export interface CommitTask {
  title: string;
  automation_summary: string;
  automation_score: number;
  steps: SkillStep[];
}
export type ParsedCommit =
  | { kind: 'task'; task: CommitTask }
  | { kind: 'breakdown'; tasks: CommitTask[] };

function buildCommitTask(p: Record<string, unknown>, fallbackTitle: string): CommitTask | null {
  const steps = (Array.isArray(p.steps) ? p.steps : [])
    .map((s) => normalizeStep(s as Partial<SkillStep>))
    .filter((s): s is SkillStep => s !== null)
    .slice(0, MAX_STEPS);
  if (steps.length === 0) return null;
  return {
    title: typeof p.title === 'string' && p.title.trim() ? p.title.trim() : fallbackTitle,
    automation_summary: typeof p.automation_summary === 'string' ? p.automation_summary.trim() : '',
    automation_score: clampScore(p.automation_score),
    steps,
  };
}

export function validateCommit(payload: unknown, fallbackTitle: string): ParsedCommit | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;

  if (p.kind === 'task') {
    const task = buildCommitTask(p, fallbackTitle);
    return task ? { kind: 'task', task } : null;
  }
  if (p.kind === 'breakdown' && Array.isArray(p.tasks)) {
    const tasks = p.tasks
      .slice(0, 4)
      .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
      .map((t, i) => buildCommitTask(t, `${fallbackTitle} (${i + 1})`))
      .filter((t): t is CommitTask => t !== null);
    return tasks.length > 0 ? { kind: 'breakdown', tasks } : null;
  }
  return null;
}

// Quick automation score from steps when the AI didn't give one (or for imports).
export function scoreFromSteps(steps: SkillStep[]): number {
  if (steps.length === 0) return 0;
  const auto = steps.filter((s) => s.mode === 'auto').length;
  return Math.round((auto / steps.length) * 100);
}
