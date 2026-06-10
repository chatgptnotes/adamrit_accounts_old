// Sibling of generateFlowFromPrompt: instead of building a graph, it asks the
// LLM for 2-3 role-relevant automation IDEAS the user can then confirm. Each
// suggestion carries a `buildPrompt` seed — a one-line instruction that, when
// confirmed, is fed back through generateFlowFromPrompt (full safety pipeline)
// to actually build + save the automation. So suggestions are advisory only and
// can never bypass the Layer A/B/C safety in generateFlowFromPrompt.
import { geminiGenerateContentUrl, geminiFetch, GEMINI_MODEL_LITE } from '@/lib/gemini';
import { LLM_BACKEND, callVpsClaude } from '@/lib/vpsClaude';
import { FLOW_EVENT_TYPES, type FlowEventType } from '@/lib/taskOptimizerFlows';
import { SAFE_ACTION_TYPES, type SafeActionType, isFlowEventType, isSafeActionType } from '@/lib/flowSafety';
import { APP_AUTOMATION_CONTEXT } from '@/lib/automationCapabilities';

export interface AutomationSuggestion {
  title: string;
  rationale: string;
  trigger: FlowEventType;
  primaryAction: SafeActionType;
  // A plain-English seed fed to generateFlowFromPrompt when the user confirms.
  buildPrompt: string;
}

export interface SuggestAutomationsInput {
  persona: string; // staff role / designation
  instruction: string; // the user's ask (e.g. "what can you automate for me?")
  // The task the user has drilled into, if any. When set, suggestions are
  // focused on automating THAT task specifically.
  activeTask?: string;
  tasks?: string[];
  stepsByTask?: Record<string, string[]>;
}

interface RawSuggestion {
  title?: string;
  rationale?: string;
  trigger?: string;
  primaryAction?: string;
  buildPrompt?: string;
}

function buildSuggestPrompt({ persona, instruction, activeTask, tasks, stepsByTask }: SuggestAutomationsInput): string {
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
  const activeSteps = activeTask ? (stepsMap[activeTask] ?? []) : [];
  const focusBlock = activeTask
    ? `\nThe user is currently focused on the task "${activeTask}"${activeSteps.length ? ` (sub-tasks: ${activeSteps.map((s) => `"${s}"`).join(', ')})` : ''}. PRIORITISE automations for THIS task. Where it helps, target a SPECIFIC sub-task (step) above and name that suggestion after the step, so the user gets a focused automation per sub-task. Make at least two suggestions about "${activeTask}".\n`
    : '';

  return `You are an automation coach for a hospital app. Suggest 2-3 useful automations tailored to this staff member's role and their actual tasks. Do NOT build them — just propose ideas the user can pick from.

${APP_AUTOMATION_CONTEXT}
${focusBlock}

Automations fire on real events (triggers): ${FLOW_EVENT_TYPES.join(', ')}.
They run actions: ${SAFE_ACTION_TYPES.join(', ')}.

Two app features to lean on:
- SCAN: when a bill is scanned/added it fires the "bill_added" trigger. At least ONE suggestion MUST use trigger "bill_added".
- SLACK: the "slack" action posts an alert to the team Slack channel. At least ONE suggestion MUST use primaryAction "slack".

Staff role / persona: ${persona}
What they asked: ${instruction}
Their existing tasks:
${taskLines}

Return ONLY valid JSON (no markdown, no code fences) of exactly this shape:
{
  "suggestions": [
    {
      "title": "short title (e.g. 'Slack alert on every scanned bill')",
      "rationale": "one short sentence on why it helps this role",
      "trigger": "one of: ${FLOW_EVENT_TYPES.join(', ')}",
      "primaryAction": "one of: ${SAFE_ACTION_TYPES.join(', ')}",
      "buildPrompt": "a single plain-English instruction that would build this automation (e.g. 'Notify the team on Slack whenever a bill is scanned')"
    }
  ]
}

Rules:
- Exactly 2-3 suggestions.
- At least one with trigger "bill_added" (scan) and at least one with primaryAction "slack".
- Each "buildPrompt" must be a concrete one-line instruction the automation builder can act on.
- Never suggest deleting, removing, or erasing data.
- Output a single valid JSON object.`;
}

async function runLlm(prompt: string): Promise<string> {
  if (LLM_BACKEND === 'vps') {
    // No fallback: VPS failure throws and surfaces verbatim in the chat UI.
    return callVpsClaude(prompt);
  }
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) throw new Error('Gemini API key is not configured.');
  let response: Response;
  try {
    response = await geminiFetch(geminiGenerateContentUrl(apiKey, GEMINI_MODEL_LITE), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 900 },
      }),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('429') || /quota|RESOURCE_EXHAUSTED/i.test(message)) {
      throw new Error('The AI service is rate-limited or out of quota. Please try again shortly.');
    }
    throw new Error('Could not reach the AI service. Please try again.');
  }
  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// Returns sanitized suggestions. Throws on infra failure or when nothing usable
// comes back (no silent fallback). Suggestions whose trigger/action fall outside
// the safety allowlist are dropped, not coerced.
export async function suggestAutomations(input: SuggestAutomationsInput): Promise<AutomationSuggestion[]> {
  const text = await runLlm(buildSuggestPrompt(input));
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

  let parsed: { suggestions?: RawSuggestion[] };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('The AI did not return usable suggestions. Please rephrase.');
    parsed = JSON.parse(match[0]);
  }

  const rawList = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
  const out: AutomationSuggestion[] = [];
  for (const r of rawList) {
    const title = (r?.title ?? '').toString().trim();
    const buildPrompt = (r?.buildPrompt ?? '').toString().trim();
    if (!title || !buildPrompt) continue;
    if (!isFlowEventType(r?.trigger) || !isSafeActionType(r?.primaryAction)) continue; // Layer C — drop off-allowlist
    out.push({
      title: title.slice(0, 80),
      rationale: (r?.rationale ?? '').toString().trim().slice(0, 160),
      trigger: r.trigger,
      primaryAction: r.primaryAction,
      buildPrompt: buildPrompt.slice(0, 300),
    });
    if (out.length >= 3) break;
  }

  if (out.length === 0) throw new Error('The AI did not return usable suggestions. Please rephrase.');
  return out;
}
