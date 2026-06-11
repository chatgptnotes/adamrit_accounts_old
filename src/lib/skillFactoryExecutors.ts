// Skill Factory v2 — execution layer. Runs a task's steps: "auto" steps go
// through an action registry (only a few are truly executable today — no fake
// execution), "manual" steps are logged as assignments. Every run is written to
// skill_factory_runs as an audit trail.
import { supabase } from '@/integrations/supabase/client';
import { geminiFetch, geminiGenerateContentUrl } from '@/lib/gemini';
import { isExecutable, type SkillStep, type SkillTask, type SkillActionType } from '@/lib/skillFactory';

export interface StepResult {
  stepId: string;
  label: string;
  mode: 'manual' | 'auto';
  actionType?: SkillActionType;
  ok: boolean;
  message: string;
}

export interface RunContext {
  userEmail: string;
  hospitalType: string | null;
  geminiKey: string;
  // UI hooks (optional): show a generated document, surface a toast line.
  onDocument?: (title: string, body: string) => void;
}

type Executor = (step: SkillStep, task: SkillTask, ctx: RunContext) => Promise<StepResult>;

const ok = (s: SkillStep, message: string): StepResult => ({
  stepId: s.id, label: s.label, mode: s.mode, actionType: s.actionType, ok: true, message,
});
const fail = (s: SkillStep, message: string): StepResult => ({
  stepId: s.id, label: s.label, mode: s.mode, actionType: s.actionType, ok: false, message,
});

// ── Executors for the actions that have a real effect today ───────────────────
const executors: Partial<Record<SkillActionType, Executor>> = {
  // An in-app alert. The page surfaces these as toasts; here we just confirm.
  notify: async (s) => ok(s, `Alert taiyaar: "${s.label}"`),

  // A logged assignment — recorded in the run trail so it's auditable.
  create_task: async (s) =>
    ok(s, s.assignee ? `Kaam assign hua: "${s.label}" → ${s.assignee}` : `To-do banaya: "${s.label}"`),

  // Real AI generation via the project's existing Gemini wrapper.
  generate_document: async (s, task, ctx) => {
    if (!ctx.geminiKey) return fail(s, 'Gemini key set nahi hai (VITE_GEMINI_API_KEY).');
    const prompt = `Aap ek hospital assistant ho. Niche diye kaam ke liye ek saaf, professional draft banao (Hinglish/English jaisa theek lage). Sirf draft do, koi extra baat nahi.\n\nTask: ${task.title}\nStep: ${s.label}${s.how ? `\nKaise: ${s.how}` : ''}`;
    try {
      const res = await geminiFetch(geminiGenerateContentUrl(ctx.geminiKey), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 800 },
        }),
      });
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
      if (!text) return fail(s, 'AI se draft nahi mila.');
      ctx.onDocument?.(s.label, text);
      return ok(s, 'Draft generate ho gaya.');
    } catch (e) {
      return fail(s, `Draft banane mein dikkat: ${(e as Error).message}`);
    }
  },
};

// Run one step.
async function runStep(step: SkillStep, task: SkillTask, ctx: RunContext): Promise<StepResult> {
  if (step.mode !== 'auto' || !step.actionType) {
    return ok(step, step.assignee ? `Manual step — ${step.assignee} karega.` : 'Manual step — assign karna baaki.');
  }
  if (!isExecutable(step.actionType)) {
    return fail(step, `"${step.actionType}" abhi setup nahi hai — step plan mein save hai, run nahi hua.`);
  }
  const exec = executors[step.actionType];
  if (!exec) return fail(step, `"${step.actionType}" ka executor nahi mila.`);
  return exec(step, task, ctx);
}

// Run a whole task in order, then write the run to skill_factory_runs.
export async function runTask(
  task: SkillTask,
  ctx: RunContext,
): Promise<{ status: 'done' | 'failed'; results: StepResult[] }> {
  const results: StepResult[] = [];
  for (const step of task.steps) {
    // Errors are captured per-step, never abort the whole run.
    try {
      results.push(await runStep(step, task, ctx));
    } catch (e) {
      results.push(fail(step, (e as Error).message));
    }
  }
  const anyAutoFailed = results.some((r) => r.mode === 'auto' && !r.ok);
  const status: 'done' | 'failed' = anyAutoFailed ? 'failed' : 'done';

  // Best-effort audit log; a logging failure must not break the UX.
  try {
    await supabase.from('skill_factory_runs').insert({
      task_id: task.id,
      user_email: ctx.userEmail,
      hospital_type: ctx.hospitalType,
      status,
      step_results: results,
      finished_at: new Date().toISOString(),
    });
  } catch {
    /* table may not exist yet — ignore */
  }
  return { status, results };
}

export interface RunRow {
  id: string;
  task_id: string;
  status: string;
  step_results: StepResult[];
  started_at: string;
  finished_at: string | null;
}

export async function fetchRuns(taskId: string): Promise<RunRow[]> {
  const { data, error } = await supabase
    .from('skill_factory_runs')
    .select('id, task_id, status, step_results, started_at, finished_at')
    .eq('task_id', taskId)
    .order('started_at', { ascending: false })
    .limit(20);
  if (error) return [];
  return (data as RunRow[]) ?? [];
}
