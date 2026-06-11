import { geminiGenerateContentUrl, geminiFetch, GEMINI_MODEL_LITE } from '@/lib/gemini';
import { LLM_BACKEND, callVpsClaude } from '@/lib/vpsClaude';
import { ADAMRIT_MODULES } from '@/components/task-optimizer/commonTasks';

// How the AI thinks a task should be handled.
export type SuggestionType = 'automate' | 'reduce' | 'delegate' | 'keep';

// Where a suggestion sits in the productivity workflow loop.
export type ActionStatus = 'suggested' | 'in_progress' | 'done' | 'dismissed';

export const ACTION_STATUSES: readonly ActionStatus[] = [
  'suggested',
  'in_progress',
  'done',
  'dismissed',
];

// One AI recommendation for a single daily task. Everything is best-effort
// advice meant for a human to act on, so all fields are plain strings.
export interface TaskSuggestion {
  task: string;
  type: SuggestionType;
  suggestion: string; // concrete action to take
  rationale: string; // short reason why
  tool?: string; // optional tool/feature/software that could help
  existsInAdamrit?: boolean; // true when `tool` is an existing Adamrit feature (instant win)
}

export interface OptimizeTasksInput {
  name: string;
  designation: string;
  tasks: string[];
}

const VALID_TYPES: readonly SuggestionType[] = ['automate', 'reduce', 'delegate', 'keep'];

function buildPrompt({ name, designation, tasks }: OptimizeTasksInput): string {
  const taskList = tasks.map((t, i) => `${i + 1}. ${t}`).join('\n');
  const moduleList = ADAMRIT_MODULES.map(m => `- ${m}`).join('\n');
  return `You are a hospital operations and workflow-automation consultant.

A staff member has listed their daily tasks. For EACH task, decide how they could spend less time on it and recommend a concrete improvement. Consider automation (software, scripts, templates, EMR features), reducing/eliminating low-value work, or delegating to a more appropriate role.

The hospital already runs the "Adamrit" HMS, which includes these modules:
${moduleList}

When a task can be helped by one of the modules ABOVE, prefer recommending that module (it's an instant win) and set "existsInAdamrit" to true. Otherwise set "existsInAdamrit" to false.

Staff member: ${name}
Designation / role: ${designation}

Daily tasks:
${taskList}

Return ONLY valid JSON (no markdown, no code fences, no commentary) as an array with one object per task, in this exact shape:
[
  {
    "task": "the task, restated briefly",
    "type": "one of: automate, reduce, delegate, keep",
    "suggestion": "a concrete, specific action they can take",
    "rationale": "one short sentence explaining the benefit",
    "tool": "a specific tool/software/EMR feature that helps, or empty string",
    "existsInAdamrit": true or false
  }
]

Rules:
- Output one object per listed task, in the same order.
- "type" must be exactly one of: automate, reduce, delegate, keep.
- Use "keep" only when the task genuinely needs the person and cannot be improved.
- Set "existsInAdamrit" to true ONLY when "tool" refers to one of the Adamrit modules listed above.
- Keep suggestions practical for a hospital setting.
- Output must be a single valid JSON array.`;
}

async function runLlm(prompt: string): Promise<string> {
  if (LLM_BACKEND === 'vps') {
    // No fallback: VPS failure throws and surfaces verbatim to the caller.
    return callVpsClaude(prompt);
  }
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) throw new Error('Gemini API key is not configured.');
  let response: Response;
  try {
    // Low-grade text->JSON task: route to the cheaper lite model.
    response = await geminiFetch(geminiGenerateContentUrl(apiKey, GEMINI_MODEL_LITE), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 2000 },
      }),
    });
  } catch (error: unknown) {
    // geminiFetch throws "Gemini API error <status>: <body>". Map the common
    // ones to a clean, human message instead of dumping raw JSON in a toast.
    const message = error instanceof Error ? error.message : '';
    if (message.includes('429') || /quota|RESOURCE_EXHAUSTED/i.test(message)) {
      throw new Error(
        'The AI service is rate-limited or out of quota for now. Please try again in a minute, or check the Gemini API key/billing.',
      );
    }
    if (message.includes('400') && /API key not valid/i.test(message)) {
      throw new Error('The Gemini API key is invalid. Please check VITE_GEMINI_API_KEY.');
    }
    if (message.includes('403')) {
      throw new Error('The Gemini API key is not authorized for this model. Please check the key.');
    }
    throw new Error('Could not reach the AI service. Please try again.');
  }
  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

/**
 * Ask the LLM how a staff member could reduce or automate their daily tasks.
 * Returns one structured suggestion per task. Throws on any failure (missing
 * key, network, or unparseable response) — callers surface a toast/error.
 */
export async function optimizeTasks(input: OptimizeTasksInput): Promise<TaskSuggestion[]> {
  const tasks = input.tasks.map(t => t.trim()).filter(Boolean);
  if (tasks.length === 0) throw new Error('Please add at least one task.');

  const text = await runLlm(buildPrompt({ ...input, tasks }));
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Fall back to the first [...] block if the model wrapped the JSON.
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('No JSON found in AI response.');
    parsed = JSON.parse(match[0]);
  }

  if (!Array.isArray(parsed)) throw new Error('AI response was not a list of suggestions.');

  const suggestions: TaskSuggestion[] = parsed
    .map((raw): TaskSuggestion | null => {
      const item = raw as Partial<TaskSuggestion>;
      const task = (item.task || '').toString().trim();
      if (!task) return null;
      const type = VALID_TYPES.includes(item.type as SuggestionType)
        ? (item.type as SuggestionType)
        : 'keep';
      const tool = (item.tool || '').toString().trim();
      return {
        task,
        type,
        suggestion: (item.suggestion || '').toString().trim(),
        rationale: (item.rationale || '').toString().trim(),
        ...(tool ? { tool } : {}),
        ...(tool && item.existsInAdamrit === true ? { existsInAdamrit: true } : {}),
      };
    })
    .filter((s): s is TaskSuggestion => s !== null);

  if (suggestions.length === 0) {
    throw new Error('The AI did not return any suggestions. Please try again.');
  }

  return suggestions;
}
