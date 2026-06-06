import { geminiGenerateContentUrl, geminiFetch, GEMINI_MODEL_LITE } from '@/lib/gemini';
import { ACTION_STATUSES, type ActionStatus } from '@/lib/optimizeTasks';
import type {
  StoredNode,
  StoredEdge,
  TriggerConfig,
  ConditionConfig,
  ActionConfig,
} from '@/lib/taskOptimizerFlows';

// Persona-driven, plain-English -> automation graph. When `current` is given,
// the AI EDITS that existing workflow instead of building a fresh one.
export interface GenerateFlowInput {
  persona: string;
  instruction: string;
  current?: { nodes: StoredNode[]; edges: StoredEdge[] };
}

export interface GeneratedFlow {
  name: string;
  explanation: string;
  // Clarifying or refinement questions the assistant proposes after building
  // the flow — rendered as clickable chips in the chatbot.
  questions?: string[];
  nodes: StoredNode[];
  edges: StoredEdge[];
}

const CONDITION_FIELDS = ['designation', 'suggestion_type', 'time_saved_mins'] as const;
const CONDITION_OPS = ['eq', 'contains', 'gte'] as const;
const ACTION_TYPES = ['notify', 'tag', 'set_status', 'whatsapp', 'email'] as const;

type RawCondition = { field?: string; op?: string; value?: string };
type RawAction = { type?: string; message?: string; setStatus?: string; to?: string; subject?: string };
interface RawFlow {
  name?: string;
  explanation?: string;
  questions?: unknown;
  trigger?: { toStatus?: string };
  conditions?: RawCondition[];
  actions?: RawAction[];
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

function buildPrompt({ persona, instruction, current }: GenerateFlowInput): string {
  const currentSpec = current ? summarizeFlow(current.nodes) : null;
  const editBlock = currentSpec
    ? `\nThe user is EDITING an existing automation. Here is its current JSON:\n${JSON.stringify(currentSpec)}\n\nApply the requested change to it. KEEP every existing trigger, condition, and action unless the change clearly replaces or removes it. Return the FULL updated automation (not just the change).\n`
    : '';
  const verb = currentSpec ? 'edit the' : 'design an';
  return `You ${verb} automation for a hospital "Task Optimizer". An automation runs when a staff task's STATUS CHANGES (statuses: suggested, in_progress, done, dismissed). Tailor it to the person's role.

You also act as a thoughtful coach: after producing the automation, propose 2-3 SHORT follow-up questions that help the user refine it, decide between approaches, or add the next sensible step. Phrase each question so the user can answer it by sending it straight back (e.g. "Should I also notify the supervisor?" "Add a 24-hour delay before reminding?"). Make the questions specific to the role and the task, not generic.

Person's role / persona: ${persona}
What they want: ${instruction}
${editBlock}
Return ONLY valid JSON (no markdown, no code fences) of exactly this shape:
{
  "name": "short automation name",
  "explanation": "one or two sentences describing what it does, addressed to the persona",
  "questions": ["question 1?", "question 2?", "question 3?"],
  "trigger": { "toStatus": "one of: suggested, in_progress, done, dismissed, any" },
  "conditions": [ { "field": "designation|suggestion_type|time_saved_mins", "op": "eq|contains|gte", "value": "string" } ],
  "actions": [ { "type": "notify|tag|set_status|whatsapp|email", "message": "text (may use {staff} {task} {status})", "setStatus": "optional status for set_status", "to": "email address (for email type only)", "subject": "email subject (for email type only, may use {staff} {task} {status})" } ]
}

Rules:
- At least one action. Conditions may be an empty array.
- suggestion_type values are one of: automate, reduce, delegate, keep.
- "questions" MUST contain 2-3 strings ending with "?". These are next-step refinements or automation choices the user might want to try.
- Use whatsapp only if the user explicitly wants a WhatsApp message sent; keep messages concise.
- Use email only if the user explicitly wants an email sent; provide a to address and subject.
- Output a single valid JSON object.`;
}

function mapToGraph(raw: RawFlow): GeneratedFlow {
  const nodes: StoredNode[] = [];
  const edges: StoredEdge[] = [];

  // Trigger
  const triggerCfg: TriggerConfig = {
    event: 'status_changed',
    toStatus: raw.trigger?.toStatus === 'any' ? 'any' : coerceStatus(raw.trigger?.toStatus, 'done'),
  };
  nodes.push({
    id: 'trigger-1',
    type: 'trigger',
    position: { x: 60, y: 160 },
    data: { kind: 'trigger', label: 'When status changes', config: triggerCfg },
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
  const actionsRaw = Array.isArray(raw.actions) && raw.actions.length > 0 ? raw.actions : [{ type: 'notify' }];
  const actionX = 60 + 320 * (conditions.length + 1);
  actionsRaw.forEach((a, i) => {
    const type = (ACTION_TYPES.includes(a.type as (typeof ACTION_TYPES)[number])
      ? a.type
      : 'notify') as ActionConfig['type'];
    const cfg: ActionConfig = { type };
    if (type === 'set_status') cfg.setStatus = coerceStatus(a.setStatus, 'in_progress');
    else cfg.message = (a.message ?? '').toString();
    if (type === 'whatsapp') cfg.enabled = false; // opt-in only
    if (type === 'email') {
      cfg.to = (a.to ?? '').toString();
      cfg.subject = (a.subject ?? '').toString();
      cfg.enabled = false; // opt-in only
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
  };
}

/**
 * Ask Gemini to design an automation for a persona, then map it to the flow
 * schema. Throws on missing key / blank instruction / unreachable AI.
 */
export async function generateFlowFromPrompt(input: GenerateFlowInput): Promise<GeneratedFlow> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) throw new Error('Gemini API key is not configured.');
  if (!input.instruction.trim()) throw new Error('Please describe the automation you want.');

  let response: Response;
  try {
    response = await geminiFetch(geminiGenerateContentUrl(apiKey, GEMINI_MODEL_LITE), {
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
      throw new Error('The Gemini API key is invalid. Please check VITE_GEMINI_API_KEY.');
    }
    if (message.includes('403')) throw new Error('The Gemini API key is not authorized for this model.');
    throw new Error('Could not reach the AI service. Please try again.');
  }

  const data = await response.json();
  const text: string = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('The AI did not return a usable automation. Please rephrase.');
    parsed = JSON.parse(match[0]);
  }

  return mapToGraph(parsed as RawFlow);
}
