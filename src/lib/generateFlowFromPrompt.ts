import { geminiGenerateContentUrl, geminiFetch, GEMINI_MODEL_LITE } from '@/lib/gemini';
import { LLM_BACKEND, callVpsClaude } from '@/lib/vpsClaude';
import { ACTION_STATUSES, type ActionStatus } from '@/lib/optimizeTasks';
import { formatRegistryForPrompt } from '@/lib/pageActionRegistry';
import type {
  StoredNode,
  StoredEdge,
  TriggerConfig,
  ConditionConfig,
  ActionConfig,
} from '@/lib/taskOptimizerFlows';
import {
  FlowSafetyError,
  SAFETY_LAW,
  SAFE_ACTION_TYPES,
  isDestructiveIntent,
  isFlowEventType,
  isSafeActionType,
  pickSafeAlternative,
} from '@/lib/flowSafety';

// Persona-driven, plain-English -> automation graph. When `current` is given,
// the AI EDITS that existing workflow instead of building a fresh one.
export interface GenerateFlowInput {
  persona: string;
  instruction: string;
  current?: { nodes: StoredNode[]; edges: StoredEdge[] };
  // Optional workspace context so the assistant can also organise the left-hand
  // panels — add / remove tasks and steps — not just build the canvas.
  // activeTask is the task the user has drilled into (if any); tasks is the full
  // task list for the staff member; stepsByTask maps each task to its steps.
  activeTask?: string;
  tasks?: string[];
  stepsByTask?: Record<string, string[]>;
}

// A task to add to / remove from the Tasks column.
export interface TaskChange {
  action: 'add' | 'remove';
  task: string;
}

// A step to add to / remove from a task's Steps list.
export interface StepChange {
  action: 'add' | 'remove';
  task: string;
  step: string;
}

export interface GeneratedFlow {
  name: string;
  explanation: string;
  // Clarifying or refinement questions the assistant proposes after building
  // the flow — rendered as clickable chips in the chatbot.
  questions?: string[];
  nodes: StoredNode[];
  edges: StoredEdge[];
  // Task / step mutations the assistant wants applied to the left-hand panels.
  // Empty arrays when the user only asked to change the workflow.
  taskChanges: TaskChange[];
  stepChanges: StepChange[];
}

const CONDITION_FIELDS = ['designation', 'suggestion_type', 'time_saved_mins'] as const;
const CONDITION_OPS = ['eq', 'contains', 'gte'] as const;
// SAFE_ACTION_TYPES (imported from flowSafety) is the single source of truth —
// it's the same allowlist the runtime, prompt, and validator share.
const ACTION_TYPES = SAFE_ACTION_TYPES;

type RawCondition = { field?: string; op?: string; value?: string };
type RawAction = { type?: string; message?: string; setStatus?: string; to?: string; subject?: string; url?: string; label?: string };
// Trigger shapes the AI may emit. `event` is optional for backward compat with
// status_changed-only callers; mapToGraph defaults missing event to status_changed.
type RawTrigger = {
  event?: string;
  toStatus?: string;
  billType?: string;
  withinDays?: number;
};
interface RawFlow {
  name?: string;
  explanation?: string;
  questions?: unknown;
  trigger?: RawTrigger;
  conditions?: RawCondition[];
  actions?: RawAction[];
  taskChanges?: unknown;
  stepChanges?: unknown;
}

function coerceStatus(value: string | undefined, fallback: ActionStatus): ActionStatus {
  return ACTION_STATUSES.includes(value as ActionStatus) ? (value as ActionStatus) : fallback;
}

// Convert the live canvas nodes back into the JSON spec the AI works with, so
// it can be shown the current workflow and edit it.
function summarizeFlow(nodes: StoredNode[]): RawFlow | null {
  if (!nodes || nodes.length === 0) return null;
  const triggerNode = nodes.find(n => n.type === 'trigger');
  const trigger = triggerNode
    ? { toStatus: (triggerNode.data.config as TriggerConfig).toStatus }
    : { toStatus: 'done' };
  const conditions = nodes
    .filter(n => n.type === 'condition')
    .map(n => {
      const c = n.data.config as ConditionConfig;
      return { field: c.field, op: c.op, value: c.value };
    });
  const actions = nodes
    .filter(n => n.type === 'action')
    .map(n => {
      const a = n.data.config as ActionConfig;
      return { type: a.type, message: a.message, setStatus: a.setStatus };
    });
  return { trigger, conditions, actions };
}

function buildPrompt({ persona, instruction, current, activeTask, tasks, stepsByTask }: GenerateFlowInput): string {
  const currentSpec = current ? summarizeFlow(current.nodes) : null;
  const taskList = tasks ?? [];
  const stepsMap = stepsByTask ?? {};
  const taskLines = taskList.length
    ? taskList
        .map((t) => {
          const steps = stepsMap[t] ?? [];
          return steps.length ? `- "${t}" (steps: ${steps.map((s) => `"${s}"`).join(', ')})` : `- "${t}"`;
        })
        .join('\n')
    : '(no tasks yet)';
  const workspaceBlock = `
Workspace you can also edit (not just the canvas):
Task currently in focus: ${activeTask ? `"${activeTask}"` : '(none — staff overview)'}
Existing tasks for this person:
${taskLines}
`;
  const editBlock = currentSpec
    ? `\nThe user is EDITING an existing automation. Here is its current JSON:\n${JSON.stringify(currentSpec)}\n\nApply the requested change to it. KEEP every existing trigger, condition, and action unless the change clearly replaces or removes it. Return the FULL updated automation (not just the change).\n`
    : '';
  const verb = currentSpec ? 'edit the' : 'design an';
  return `${SAFETY_LAW}

You ${verb} automation for a hospital app. Automations fire on one of these real events: a task's status changes; a bill is added; a deadline becomes due; a deadline becomes overdue; a deadline is marked paid. Tailor it to the person's role.

${formatRegistryForPrompt()}

You also act as a thoughtful coach: after producing the automation, propose 2-3 SHORT follow-up questions that help the user refine it, decide between approaches, or add the next sensible step. Phrase each question so the user can answer it by sending it straight back (e.g. "Should I also notify the supervisor?" "Add a 24-hour delay before reminding?"). Make the questions specific to the role and the task, not generic.

Person's role / persona: ${persona}
What they want: ${instruction}
${workspaceBlock}${editBlock}
Beyond the canvas, you can also organise the person's work: add a new task, remove an existing task, and add or remove steps under a task. Do this ONLY when the user asks for it (words like add, create, new, remove, delete, drop). Otherwise leave taskChanges and stepChanges as empty arrays.

Return ONLY valid JSON (no markdown, no code fences) of exactly this shape:
{
  "name": "short automation name",
  "explanation": "one or two sentences describing what it does, addressed to the persona",
  "questions": ["question 1?", "question 2?", "question 3?"],
  "trigger": { "event": "status_changed|bill_added|deadline_due|deadline_overdue|deadline_paid", "toStatus": "(status_changed only) one of: suggested, in_progress, done, dismissed, any", "withinDays": "(deadline_due only) integer, default 3" },
  "conditions": [ { "field": "designation|suggestion_type|time_saved_mins", "op": "eq|contains|gte", "value": "string" } ],
  "actions": [ { "type": "notify|tag|set_status|whatsapp|email|slack|guide", "message": "text (may use {staff} {task} {status})", "setStatus": "optional status for set_status", "to": "email address (for email type only)", "subject": "email subject (for email type only, may use {staff} {task} {status})", "url": "(guide only) app route to open, e.g. /lab?tab=results", "label": "(guide only) short button label, e.g. Open Lab Results" } ],
  "taskChanges": [ { "action": "add|remove", "task": "task name" } ],
  "stepChanges": [ { "action": "add|remove", "task": "owning task name", "step": "step text" } ]
}

Rules:
- At least one action. Conditions may be an empty array.
- Default to event=status_changed if the user doesn't mention bills or deadlines.
- For non-status events (bill_added / deadline_*), prefer 'notify' / 'whatsapp' / 'email' actions — 'tag' and 'set_status' need a task row and may be skipped at runtime.
- suggestion_type values are one of: automate, reduce, delegate, keep.
- "questions" MUST contain 2-3 strings ending with "?". These are next-step refinements or automation choices the user might want to try.
- Use whatsapp only if the user explicitly wants a WhatsApp message sent; keep messages concise.
- Use email only if the user explicitly wants an email sent; provide a to address and subject.
- Use slack to post an alert to the team Slack channel (e.g. "notify the team on Slack when a bill is scanned"). Put the alert text in "message"; it fires by default (no opt-in needed).
- Use guide to point the user to a page to act on — set "url" to one of the routes listed in the page catalog above and "label" to a short button text, with "message" describing what to do. Only use routes from that catalog; never invent a URL.
- taskChanges and stepChanges default to []. Only fill them when the user asks to add/create/remove/delete a task or step.
- To remove a task or step, its text MUST exactly match one shown in the workspace context above.
- For a step, set "task" to the task it belongs under; if the user didn't name one and a task is in focus, use the focused task.
- When the user describes a brand-new piece of work, add it as a task AND add its steps, in addition to building the canvas workflow.
- Output a single valid JSON object.`;
}

// Build the right TriggerConfig variant for the AI-emitted event. The previous
// (silent-coerce) version always produced status_changed; now we honour the AI's
// choice and refuse anything outside the allowlist (Safety Layer C).
function buildTriggerConfig(raw: RawTrigger | undefined): { config: TriggerConfig; label: string } {
  // Default to legacy status_changed when no event is specified.
  const event = raw?.event ?? 'status_changed';
  if (!isFlowEventType(event)) {
    throw new FlowSafetyError(
      'unknown_trigger',
      `The AI proposed an event type "${event}" that isn't in the allowlist.`,
    );
  }
  switch (event) {
    case 'status_changed':
      return {
        config: {
          event: 'status_changed',
          toStatus: raw?.toStatus === 'any' ? 'any' : coerceStatus(raw?.toStatus, 'done'),
        },
        label: 'When status changes',
      };
    case 'bill_added':
      return {
        config: { event: 'bill_added', billType: raw?.billType ?? 'any' },
        label: 'When a bill is added',
      };
    case 'deadline_due':
      return {
        config: {
          event: 'deadline_due',
          withinDays: Number.isFinite(raw?.withinDays) ? Math.max(1, Math.min(30, Number(raw?.withinDays))) : 3,
        },
        label: 'When a deadline is due',
      };
    case 'deadline_overdue':
      return { config: { event: 'deadline_overdue' }, label: 'When a deadline is overdue' };
    case 'deadline_paid':
      return { config: { event: 'deadline_paid' }, label: 'When a bill is marked paid' };
  }
}

// Shape-validate the AI's task changes: action ∈ {add,remove}, non-empty name,
// length-capped, de-duplicated. Existence checks (don't re-add, don't remove a
// missing task) are enforced by the caller against live state.
function sanitizeTaskChanges(raw: unknown): TaskChange[] {
  if (!Array.isArray(raw)) return [];
  const out: TaskChange[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const action = (r as { action?: unknown }).action;
    const task = (r as { task?: unknown }).task;
    if ((action !== 'add' && action !== 'remove') || typeof task !== 'string') continue;
    const name = task.trim();
    if (!name || name.length > 80) continue;
    const key = `${action}:${name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ action, task: name });
  }
  return out;
}

// Same for step changes. A missing owning task falls back to the focused task.
function sanitizeStepChanges(raw: unknown, fallbackTask: string | undefined): StepChange[] {
  if (!Array.isArray(raw)) return [];
  const out: StepChange[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const action = (r as { action?: unknown }).action;
    const stepRaw = (r as { step?: unknown }).step;
    const taskRaw = (r as { task?: unknown }).task;
    if ((action !== 'add' && action !== 'remove') || typeof stepRaw !== 'string') continue;
    const step = stepRaw.trim();
    const task = (typeof taskRaw === 'string' && taskRaw.trim()) || (fallbackTask ?? '');
    if (!step || !task || step.length > 120) continue;
    const key = `${action}:${task.toLowerCase()}:${step.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ action, task, step });
  }
  return out;
}

function mapToGraph(raw: RawFlow, input: GenerateFlowInput): GeneratedFlow {
  const nodes: StoredNode[] = [];
  const edges: StoredEdge[] = [];

  // Trigger (Safety Layer C — throw on unknown event)
  const { config: triggerCfg, label: triggerLabel } = buildTriggerConfig(raw.trigger);
  nodes.push({
    id: 'trigger-1',
    type: 'trigger',
    position: { x: 60, y: 160 },
    data: { kind: 'trigger', label: triggerLabel, config: triggerCfg },
  });

  // Conditions, chained after the trigger left-to-right.
  const conditions = Array.isArray(raw.conditions) ? raw.conditions : [];
  let lastChainId = 'trigger-1';
  conditions.forEach((c, i) => {
    const field = (CONDITION_FIELDS.includes(c.field as (typeof CONDITION_FIELDS)[number])
      ? c.field
      : 'suggestion_type') as ConditionConfig['field'];
    const op = (CONDITION_OPS.includes(c.op as (typeof CONDITION_OPS)[number])
      ? c.op
      : 'eq') as ConditionConfig['op'];
    const cfg: ConditionConfig = { field, op, value: (c.value ?? '').toString() };
    const id = `cond-${i + 1}`;
    nodes.push({
      id,
      type: 'condition',
      position: { x: 60 + 320 * (i + 1), y: 160 },
      data: { kind: 'condition', label: `${field} ${op} "${cfg.value}"`, config: cfg },
    });
    edges.push({ id: `e-${lastChainId}-${id}`, source: lastChainId, target: id });
    lastChainId = id;
  });

  // Actions placed in the column after the last chain node, stacked vertically.
  // Safety Layer C: unknown action types now throw FlowSafetyError instead of
  // silently degrading to 'notify' — the chatbot surfaces this as a red note so
  // the user knows the AI was overruled (no confused "saved a different thing").
  const actionsRaw = Array.isArray(raw.actions) && raw.actions.length > 0 ? raw.actions : [{ type: 'notify' }];
  const actionX = 60 + 320 * (conditions.length + 1);
  actionsRaw.forEach((a, i) => {
    if (!isSafeActionType(a.type)) {
      throw new FlowSafetyError(
        'unknown_action',
        `The AI proposed an action type "${a.type ?? '(missing)'}" that isn't allowed.`,
      );
    }
    const type = a.type as ActionConfig['type'];
    const cfg: ActionConfig = { type };
    if (type === 'set_status') cfg.setStatus = coerceStatus(a.setStatus, 'in_progress');
    else cfg.message = (a.message ?? '').toString();
    if (type === 'whatsapp') cfg.enabled = false; // opt-in only
    if (type === 'email') {
      cfg.to = (a.to ?? '').toString();
      cfg.subject = (a.subject ?? '').toString();
      cfg.enabled = false; // opt-in only
    }
    if (type === 'guide') {
      cfg.url = (a.url ?? '').toString();
      cfg.label = (a.label ?? '').toString();
    }
    const id = `action-${i + 1}`;
    const label = type === 'set_status' ? `Set status → ${cfg.setStatus}` : type.charAt(0).toUpperCase() + type.slice(1);
    nodes.push({
      id,
      type: 'action',
      position: { x: actionX, y: 160 + 110 * i },
      data: { kind: 'action', label, config: cfg },
    });
    edges.push({ id: `e-${lastChainId}-${id}`, source: lastChainId, target: id });
  });

  // Sanitize the AI's follow-up questions: max 3, each must end in "?" and be
  // non-empty. Defensive against the model emitting arrays of objects, etc.
  const questions: string[] = Array.isArray(raw.questions)
    ? (raw.questions as unknown[])
        .map((q) => (typeof q === 'string' ? q.trim() : ''))
        .filter((q): q is string => q.length > 0 && q.length <= 140)
        .slice(0, 3)
    : [];

  return {
    name: (raw.name ?? '').toString().trim() || 'AI automation',
    explanation: (raw.explanation ?? '').toString().trim(),
    questions,
    nodes,
    edges,
    taskChanges: sanitizeTaskChanges(raw.taskChanges),
    stepChanges: sanitizeStepChanges(raw.stepChanges, input.activeTask),
  };
}

/**
 * Ask Gemini to design an automation for a persona, then map it to the flow
 * schema. Throws on missing key / blank instruction / unreachable AI.
 */
export async function generateFlowFromPrompt(input: GenerateFlowInput): Promise<GeneratedFlow> {
  if (!input.instruction.trim()) throw new Error('Please describe the automation you want.');

  // Safety Layer B — refuse destructive prompts BEFORE the model sees them.
  // Stops prompt-laundering ("schedule a job that deletes bills") at the door,
  // since the model is never given the chance to rationalize the request into
  // a plausible-but-unsafe graph.
  if (isDestructiveIntent(input.instruction)) {
    throw new FlowSafetyError(
      'destructive_prompt',
      'Your request asked to delete or remove data. Automations can only notify, tag, or change status — never erase.',
      pickSafeAlternative(input.instruction),
    );
  }

  let text: string;
  if (LLM_BACKEND === 'vps') {
    // No fallback: any VPS failure throws and surfaces verbatim to the chat UI.
    text = await callVpsClaude(buildPrompt(input));
  } else {
    let response: Response;
    try {
      response = await geminiFetch(geminiGenerateContentUrl('', GEMINI_MODEL_LITE), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildPrompt(input) }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 1500 },
        }),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '';
      if (message.includes('429') || /quota|RESOURCE_EXHAUSTED/i.test(message)) {
        throw new Error('The AI service is rate-limited or out of quota. Please try again shortly.');
      }
      if (message.includes('400') && /API key not valid/i.test(message)) {
        throw new Error('The Gemini AI service rejected the request.');
      }
      if (message.includes('403')) throw new Error('The Gemini API key is not authorized for this model.');
      throw new Error('Could not reach the AI service. Please try again.');
    }
    const data = await response.json();
    text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('The AI did not return a usable automation. Please rephrase.');
    parsed = JSON.parse(match[0]);
  }

  return mapToGraph(parsed as RawFlow, input);
}
