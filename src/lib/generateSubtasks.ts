// AI auto-fill for a task's sub-tasks (steps). Deadline Tracking ships with a
// hardcoded DEADLINE_DEFAULT_STEPS list; every other task can't be hardcoded, so
// this infers 3-6 concrete steps from the task name + the staff member's role.
// Best-effort: callers should treat a thrown error / empty array as "leave the
// Steps panel empty" — never block the UI.
import { geminiGenerateContentUrl, geminiFetch, GEMINI_MODEL_LITE } from '@/lib/gemini';
import { LLM_BACKEND, callVpsClaude } from '@/lib/vpsClaude';

export interface GenerateSubtasksInput {
  task: string;
  designation: string;
  // Optional project context so steps fit the wider workflow this task lives in.
  staffName?: string;
  hospitalType?: string;
  projectTasks?: string[]; // the staff member's other tasks = the "project"
}

function buildPrompt({ task, designation, staffName, hospitalType, projectTasks }: GenerateSubtasksInput): string {
  const contextLines: string[] = [];
  if (hospitalType) contextLines.push(`- Hospital / unit type: ${hospitalType}`);
  if (staffName) contextLines.push(`- Staff member: ${staffName}`);
  if (projectTasks && projectTasks.length) {
    contextLines.push(
      `- Their full task list (the wider project this task belongs to): ${projectTasks
        .map((t) => `"${t}"`)
        .join(', ')}`,
    );
  }
  const context = contextLines.length
    ? `\nProject context:\n${contextLines.join('\n')}\nUse this context so the steps fit how THIS task connects to the staff member's other work, and don't duplicate steps that clearly belong to a different task in the list.\n`
    : '';

  return `Break this hospital-staff task into 3-6 short, concrete sub-task steps that a ${designation || 'staff member'} would actually perform, in the order they'd do them.
${context}
Task: "${task}"

Return ONLY a JSON array of short step strings (no markdown, no prose). Each step:
- 2-7 words, imperative, specific to THIS task (never generic like "do the task" or "complete it")
- in natural performing order
Example for "Discharge summary": ["Collect case sheet", "Verify diagnosis & treatment", "Draft summary", "Doctor review & sign", "Hand over to patient"]

Output a single valid JSON array.`;
}

async function runLlm(prompt: string): Promise<string> {
  if (LLM_BACKEND === 'vps') return callVpsClaude(prompt);
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) throw new Error('Gemini API key is not configured.');
  const response = await geminiFetch(geminiGenerateContentUrl(apiKey, GEMINI_MODEL_LITE), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 300 },
    }),
  });
  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

export async function generateSubtasksForTask(input: GenerateSubtasksInput): Promise<string[]> {
  if (!input.task.trim()) return [];
  const text = await runLlm(buildPrompt(input));
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

  let arr: unknown;
  try {
    arr = JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\[[\s\S]*\]/);
    if (!m) return [];
    try {
      arr = JSON.parse(m[0]);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of arr) {
    if (typeof s !== 'string') continue;
    const t = s.trim();
    if (!t || t.length > 60) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= 6) break;
  }
  return out;
}
