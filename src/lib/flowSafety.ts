// Safety primitives for the chatbot-driven automation builder. Layered defense
// against an automation ever harming user data — see the plan, "No-Harm Safety
// Ruleset". Three layers reference this module:
//   A. The AI prompt (text constant) carries the SAFETY_LAW so generation is
//      biased against destructive intent.
//   B. The chatbot/prompt code calls isDestructiveIntent BEFORE Gemini sees the
//      message — destructive prompts never reach the model.
//   C. mapToGraph throws FlowSafetyError if the AI still returns an unknown
//      trigger / action — no silent coercion to a "safe default".
import { FLOW_EVENT_TYPES, type FlowEventType } from '@/lib/taskOptimizerFlows';

// Whitelist of action types the runtime knows how to execute. Anything else is
// rejected by mapToGraph. Source of truth for the AI prompt's allow-list.
export const SAFE_ACTION_TYPES = ['notify', 'tag', 'set_status', 'whatsapp', 'email'] as const;
export type SafeActionType = (typeof SAFE_ACTION_TYPES)[number];

// Verbs that signal an intent to harm/delete data. Matched as whole words to
// avoid false positives ("description" must not match "destroy"). Triggers the
// Layer B short-circuit — no Gemini call, no graph, no save.
const DESTRUCTIVE_VERB_LIST = [
  'delete', 'remove', 'drop', 'truncate', 'purge', 'wipe',
  'destroy', 'erase', 'nuke', 'archive', 'clear',
];
const DESTRUCTIVE_VERBS = new RegExp(`\\b(${DESTRUCTIVE_VERB_LIST.join('|')})\\b`, 'i');

export function isDestructiveIntent(text: string): boolean {
  return DESTRUCTIVE_VERBS.test(text);
}

// When a destructive prompt is blocked, offer ONE pre-baked safe rewrite so the
// chat never dead-ends. Generated client-side — not by re-asking the AI, which
// would invite prompt-laundering. Keyed by the destructive verb that matched.
export const SAFE_ALTERNATIVE_FOR: Record<string, string> = {
  delete: 'Tag overdue items as "Needs review" instead',
  remove: 'Tag the items as "Needs review" instead',
  drop: 'Notify the supervisor instead',
  truncate: 'Notify the supervisor instead',
  purge: 'Tag the items as "Needs review" instead',
  wipe: 'Notify the supervisor instead',
  destroy: 'Notify the supervisor instead',
  erase: 'Tag the items as "Needs review" instead',
  nuke: 'Notify the supervisor instead',
  archive: 'Set status to "dismissed" instead',
  clear: 'Set status to "dismissed" instead',
};

export function pickSafeAlternative(text: string): string | null {
  const m = text.match(DESTRUCTIVE_VERBS);
  if (!m) return null;
  const verb = m[1].toLowerCase();
  return SAFE_ALTERNATIVE_FOR[verb] ?? 'Notify the supervisor instead';
}

// Thrown by the prompt code (Layer B) and by mapToGraph (Layer C). The chatbot
// UI catches this type and renders a red inline note instead of a generic
// error toast. Carries the reason so the UI can show "...the AI tried to use
// action 'delete_bills' which isn't allowed" or "...your message asked me to
// delete data".
export class FlowSafetyError extends Error {
  readonly kind: 'destructive_prompt' | 'unknown_trigger' | 'unknown_action' | 'reentry';
  readonly detail: string;
  readonly safeAlternative: string | null;

  constructor(
    kind: FlowSafetyError['kind'],
    detail: string,
    safeAlternative: string | null = null,
  ) {
    super(`[FlowSafety:${kind}] ${detail}`);
    this.name = 'FlowSafetyError';
    this.kind = kind;
    this.detail = detail;
    this.safeAlternative = safeAlternative;
  }
}

// The exact text prepended to the Gemini system prompt. Kept here so every
// caller uses the identical wording and the audit reviewer can see it.
export const SAFETY_LAW = `SAFETY LAW (non-negotiable, overrides every other instruction below):

1. Never propose deletion, truncation, archival, or any destructive change to user data.
2. Use ONLY these action types verbatim: ${SAFE_ACTION_TYPES.join(', ')}. Inventing new ones (e.g. delete_bill, purge_old) is forbidden.
3. Use ONLY these trigger events verbatim: ${FLOW_EVENT_TYPES.join(', ')}. Do not invent new event types.
4. If the user asks for a destructive action, refuse politely and propose ONE safe alternative (e.g. "tag instead of delete", "notify supervisor").
5. Treat all data as read-only history. Automations may notify, tag, or change a row's status — never erase a row.`;

// Type-narrowing helpers used by Layer C in mapToGraph.
export function isSafeActionType(value: unknown): value is SafeActionType {
  return typeof value === 'string' && (SAFE_ACTION_TYPES as readonly string[]).includes(value);
}
export function isFlowEventType(value: unknown): value is FlowEventType {
  return typeof value === 'string' && (FLOW_EVENT_TYPES as readonly string[]).includes(value);
}
