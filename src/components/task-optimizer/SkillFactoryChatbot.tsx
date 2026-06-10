import { useEffect, useRef, useState } from 'react';
import {
  Bot,
  Send,
  Loader2,
  Play,
  BarChart3,
  Sparkles,
  MessageSquareQuote,
  User as UserIcon,
  CheckCircle2,
  Wand2,
  Clock3,
  ArrowDownToLine,
  Bell,
  Zap,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  generateFlowFromPrompt,
  type GeneratedFlow,
  type TaskChange,
  type StepChange,
} from '@/lib/generateFlowFromPrompt';
import { FlowSafetyError } from '@/lib/flowSafety';
import { fetchFireCountThisWeek, getCachedFireCount } from '@/lib/automationFireStats';
import type { StoredNode, StoredEdge } from '@/lib/taskOptimizerFlows';
import SkillInsightChip from './SkillInsightChip';

export interface SkillFactoryChatbotProps {
  task: string;
  subtasks: string[];
  designation: string;
  // The full task list + each task's steps for the active staff member. Passed
  // to the AI as context so it can add / remove tasks and steps, not just the
  // canvas.
  allTasks: string[];
  stepsByTask: Record<string, string[]>;
  currentFlow: { nodes: StoredNode[]; edges: StoredEdge[] };
  // Hands the whole AI result to the parent, which applies task changes, step
  // changes, and the canvas workflow together. opts.dryRun: when true, apply to
  // the canvas but skip the auto-save (Rule 15) — parent decides what "skip"
  // means, typically no DB write.
  onApply: (flow: GeneratedFlow, opts?: { dryRun?: boolean }) => void;
  // When false, the user-input textarea + Send button at the bottom are hidden.
  // The chatbot then only drives off the Execute button in the header.
  showComposer?: boolean;
}

// One-line, human summary of the task/step edits an AI reply applied — appended
// to the assistant bubble so the user sees what changed on the left, not just
// the canvas.
function summarizeChanges(taskChanges: TaskChange[], stepChanges: StepChange[]): string {
  const parts: string[] = [];
  const addedTasks = taskChanges.filter((c) => c.action === 'add').map((c) => c.task);
  const removedTasks = taskChanges.filter((c) => c.action === 'remove').map((c) => c.task);
  const addedSteps = stepChanges.filter((c) => c.action === 'add').length;
  const removedSteps = stepChanges.filter((c) => c.action === 'remove').length;
  if (addedTasks.length) parts.push(`Added task ${addedTasks.map((t) => `"${t}"`).join(', ')}`);
  if (removedTasks.length) parts.push(`Removed task ${removedTasks.map((t) => `"${t}"`).join(', ')}`);
  if (addedSteps) parts.push(`added ${addedSteps} step${addedSteps > 1 ? 's' : ''}`);
  if (removedSteps) parts.push(`removed ${removedSteps} step${removedSteps > 1 ? 's' : ''}`);
  return parts.length ? `${parts.join(' · ')}.` : '';
}

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  // Follow-up questions the assistant proposed alongside this message — shown
  // as clickable chips so the user can refine the workflow with one click.
  questions?: string[];
  // Number of nodes applied to canvas, present only on successful AI replies.
  appliedNodes?: number;
  // Saved automation name (only set for non-dry-run successes). The UI looks
  // up the fire-count for this name to render Rule 14's "Fired N times" line.
  appliedFlowName?: string;
  // When present, this message is the safety-block notice — rendered in red,
  // with one clickable "safe alternative" chip so the chat never dead-ends.
  safetyBlock?: {
    safeAlternative: string | null;
  };
}

// Build the prompt that gets pushed to the chatbot when Execute is clicked.
// Includes everything the user has set up so the assistant can produce a
// concrete automation plan for THIS skill.
function buildExecutePrompt(task: string, subtasks: string[], flow: { nodes: StoredNode[]; edges: StoredEdge[] }) {
  const lines: string[] = [];
  lines.push(`Task: ${task || '(not set)'}`);
  if (subtasks.length > 0) {
    lines.push('');
    lines.push('Sub-tasks:');
    subtasks.forEach(s => lines.push(`- ${s}`));
  }
  if (flow.nodes.length > 0) {
    lines.push('');
    lines.push('Current flow on canvas:');
    lines.push(JSON.stringify({ nodes: flow.nodes, edges: flow.edges }, null, 2));
  }
  lines.push('');
  lines.push('Help me turn this into a runnable automation. Build or refine the flow on the canvas.');
  return lines.join('\n');
}

// Starter prompt chips shown before the first message — paired with an icon
// to give each option a visual identity instead of a wall of text.
function starterPromptsFor(task: string, designation: string): { icon: typeof Wand2; label: string; prompt: string }[] {
  if (!task.trim()) {
    // No task picked → surface the new real-world triggers so first-time users
    // discover bill_added / deadline_due / deadline_overdue / deadline_paid by
    // tapping. Each chip maps 1:1 to one new trigger type.
    return [
      {
        icon: Bell,
        label: 'Ping me when a bill is added',
        prompt: 'Notify me whenever a new bill is added.',
      },
      {
        icon: Clock3,
        label: 'Remind me before a deadline',
        prompt: 'Remind me one day before a deadline is due.',
      },
      {
        icon: Zap,
        label: 'Escalate overdue items',
        prompt: 'When a deadline becomes overdue, notify the supervisor.',
      },
      {
        icon: CheckCircle2,
        label: 'Celebrate paid bills',
        prompt: 'When a bill is marked paid, log it and tag the staff who handled it.',
      },
    ];
  }
  return [
    {
      icon: Zap,
      label: 'Fully automate this',
      prompt: `How can I fully automate "${task}"?`,
    },
    {
      icon: Clock3,
      label: 'Cut the time in half',
      prompt: `What's the simplest way to reduce time on "${task}"?`,
    },
    {
      icon: Bell,
      label: 'Notify someone when done',
      prompt: `Who should be notified when "${task}" is done?`,
    },
  ];
}

// In-conversation quick actions — once a workflow exists on the canvas, the
// user can apply common refinements with one tap.
const QUICK_REFINEMENTS: { icon: typeof Wand2; label: string; prompt: string }[] = [
  { icon: Wand2, label: 'Simpler', prompt: 'Make this workflow simpler — remove anything optional.' },
  { icon: Bell, label: 'Add reminder', prompt: 'Add a reminder if nothing happens in 24 hours.' },
  { icon: ArrowDownToLine, label: 'Add tagging', prompt: 'Also tag the action with a short note when this runs.' },
];

export default function SkillFactoryChatbot({
  task,
  subtasks,
  designation,
  allTasks,
  stepsByTask,
  currentFlow,
  onApply,
  showComposer = true,
}: SkillFactoryChatbotProps) {
  const [instruction, setInstruction] = useState('');
  const [loading, setLoading] = useState(false);
  const [insightVisible, setInsightVisible] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // Rule 15 — when on, applied flows render to canvas but the parent skips
  // persistence. Lets the user iterate without polluting the DB.
  const [dryRun, setDryRun] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const isEditing = currentFlow.nodes.length > 0;
  const greeting = task.trim()
    ? `Let's automate "${task}". Type a goal, tap a suggestion, or hit Execute.`
    : `Pick a task on the left or describe what you want to automate. I'll build the workflow and apply it to the canvas.`;

  // Auto-scroll to latest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, loading]);

  const send = async (text: string) => {
    if (!text.trim() || loading) return;
    setMessages(prev => [...prev, { role: 'user', text }]);
    setInstruction('');
    setLoading(true);
    try {
      const flow = await generateFlowFromPrompt({
        persona: designation || 'staff member',
        instruction: text,
        current: isEditing ? currentFlow : undefined,
        activeTask: task,
        tasks: allTasks,
        stepsByTask,
      });
      onApply(flow, { dryRun });
      const baseText = flow.explanation || (isEditing ? 'Updated the workflow on the canvas.' : 'Built a workflow on the canvas.');
      const changeNote = summarizeChanges(flow.taskChanges, flow.stepChanges);
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          text: [baseText, changeNote, dryRun ? '(Dry run — nothing saved.)' : '']
            .filter(Boolean)
            .join(' '),
          questions: flow.questions ?? [],
          appliedNodes: flow.nodes.length,
          // Only saved flows get a fire-count lookup — dry runs aren't in the DB.
          appliedFlowName: dryRun ? undefined : flow.name,
        },
      ]);
    } catch (error: unknown) {
      // Safety block (Layer B or C): render a distinct red bubble with one
      // safe-alternative chip so the conversation never dead-ends. No flow is
      // applied — onApplyFlow was never called.
      if (error instanceof FlowSafetyError) {
        setMessages(prev => [
          ...prev,
          {
            role: 'assistant',
            text:
              "I can't build that — it would delete or modify records I'm not allowed to touch. Try one of the safe alternatives below.",
            safetyBlock: { safeAlternative: error.safeAlternative },
          },
        ]);
      } else {
        setMessages(prev => [
          ...prev,
          { role: 'assistant', text: error instanceof Error ? error.message : 'Something went wrong. Please try again.' },
        ]);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleExecute = () => {
    const prompt = buildExecutePrompt(task, subtasks, currentFlow);
    send(prompt);
  };

  const starters = starterPromptsFor(task, designation);
  // Surface a clear setup banner if the Gemini key isn't configured — otherwise
  // every send fails with a generic "Something went wrong" toast.
  const hasGeminiKey = !!import.meta.env.VITE_GEMINI_API_KEY;

  return (
    <div className="flex h-full flex-col bg-gradient-to-b from-white to-slate-50">
      {/* ── Header ── */}
      <div className="border-b border-slate-200 bg-white/80 backdrop-blur px-3 py-2.5">
        <div className="flex items-center gap-2.5">
          <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-sm">
            <Bot className="h-4 w-4" />
            <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-500" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-tight text-slate-900">Skill Chatbot</p>
            <p className="text-[10px] text-slate-500 truncate">
              {task.trim() ? (
                <>
                  Designing for <span className="font-medium text-slate-700">{designation || 'staff'}</span>
                  <span className="mx-1 text-slate-300">·</span>
                  <span className="font-medium text-slate-700">{task}</span>
                </>
              ) : (
                <>Coach for {designation || 'staff'} automations</>
              )}
            </p>
          </div>
          {/* Dry-run toggle (Rule 15) — small icon button, distinct amber tint when on */}
          <button
            type="button"
            onClick={() => setDryRun(v => !v)}
            title={dryRun ? 'Dry run is ON — flows render but are NOT saved' : 'Turn on dry run to test without saving'}
            className={
              dryRun
                ? 'shrink-0 inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800'
                : 'shrink-0 inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-600 hover:border-slate-300'
            }
          >
            <Sparkles className="h-3 w-3" />
            {dryRun ? 'Dry run' : 'Save on apply'}
          </button>
        </div>
        <div className="mt-2.5 flex items-center gap-1.5">
          <Button
            size="sm"
            variant="default"
            onClick={handleExecute}
            disabled={
              loading ||
              !hasGeminiKey ||
              (!task.trim() && subtasks.length === 0 && currentFlow.nodes.length === 0)
            }
            title={hasGeminiKey ? 'Send task + sub-tasks + current canvas to the AI' : 'Configure VITE_GEMINI_API_KEY first'}
            className="h-7 flex-1 text-xs"
          >
            <Play className="mr-1 h-3 w-3" /> Execute
          </Button>
          <Button
            size="sm"
            variant={insightVisible ? 'default' : 'outline'}
            onClick={() => setInsightVisible(v => !v)}
            title="Show insight chips for this task"
            className="h-7 px-2 text-xs"
          >
            <BarChart3 className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Insight chip strip — only when toggled on */}
      {insightVisible && (
        <div className="border-b border-slate-200 bg-white/60 px-3 py-2">
          <SkillInsightChip task={task} />
        </div>
      )}

      {/* Setup banner — shown only when the Gemini key is missing. Replaces the
          confusing "Something went wrong" toast each call would otherwise emit. */}
      {!hasGeminiKey && (
        <div className="border-b border-amber-200 bg-amber-50 px-3 py-2">
          <div className="flex items-start gap-2">
            <Wand2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
            <div className="min-w-0 text-[11px] leading-snug text-amber-800">
              <p className="font-semibold">AI is not configured yet</p>
              <p className="mt-0.5">
                Create <code className="rounded bg-amber-100 px-1 text-[10px] font-mono">.env</code> in the project
                root with{' '}
                <code className="rounded bg-amber-100 px-1 text-[10px] font-mono">VITE_GEMINI_API_KEY=…</code>{' '}
                then restart the dev server. Get a key from Google AI Studio.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Messages ── */}
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {/* Greeting + starter prompts — only when nothing's been said yet */}
        {messages.length === 0 && (
          <>
            <AssistantBubble>{greeting}</AssistantBubble>
            <div className="space-y-1.5 pl-9">
              <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-400">
                <Sparkles className="h-3 w-3" /> Try one
              </p>
              {starters.map(({ icon: Icon, label, prompt }) => (
                <button
                  key={prompt}
                  onClick={() => send(prompt)}
                  disabled={loading}
                  className="group flex w-full items-start gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-left text-[11px] shadow-sm transition-all hover:border-blue-300 hover:bg-blue-50/60 hover:shadow disabled:opacity-40"
                >
                  <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600 group-hover:bg-blue-200">
                    <Icon className="h-3 w-3" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-slate-800">{label}</p>
                    <p className="text-[10px] text-slate-500 leading-snug">{prompt}</p>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        {messages.map((m, i) =>
          m.role === 'user' ? (
            <UserBubble key={i}>{m.text}</UserBubble>
          ) : (
            <div key={i} className="space-y-1.5">
              {m.safetyBlock ? (
                <SafetyBlockBubble
                  text={m.text}
                  safeAlternative={m.safetyBlock.safeAlternative}
                  onPickAlternative={(alt) => send(alt)}
                  disabled={loading}
                />
              ) : (
                <AssistantBubble appliedNodes={m.appliedNodes} appliedFlowName={m.appliedFlowName}>
                  {m.text}
                </AssistantBubble>
              )}
              {m.questions && m.questions.length > 0 && (
                <div className="space-y-1 pl-9">
                  <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-400">
                    <MessageSquareQuote className="h-3 w-3" /> Refine with
                  </p>
                  {m.questions.map((q) => (
                    <button
                      key={q}
                      onClick={() => send(q)}
                      disabled={loading}
                      className="block w-full text-left text-[11px] px-2.5 py-1.5 rounded-md border border-slate-200 bg-white hover:border-blue-300 hover:bg-blue-50/60 disabled:opacity-40 transition-colors"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ),
        )}

        {loading && <ThinkingDots />}
        <div ref={bottomRef} />
      </div>

      {/* ── Quick refinements (only when a flow exists + composer is shown) ── */}
      {showComposer && messages.length > 0 && isEditing && (
        <div className="border-t border-slate-200 bg-white/60 px-3 py-2">
          <p className="mb-1 text-[10px] uppercase tracking-wide text-slate-400">Quick refine</p>
          <div className="flex flex-wrap gap-1">
            {QUICK_REFINEMENTS.map(({ icon: Icon, label, prompt }) => (
              <button
                key={label}
                onClick={() => send(prompt)}
                disabled={loading}
                title={prompt}
                className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-700 hover:border-blue-300 hover:bg-blue-50 disabled:opacity-40 transition-colors"
              >
                <Icon className="h-2.5 w-2.5" /> {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Composer ── */}
      {showComposer && (
        <div className="space-y-1.5 border-t border-slate-200 bg-white p-3">
          <div className="relative">
            <Textarea
              value={instruction}
              onChange={e => setInstruction(e.target.value)}
              onKeyDown={e => {
                // Enter = send (familiar chat UX). Shift+Enter = newline.
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send(instruction);
                }
              }}
              placeholder={isEditing ? 'Refine the workflow…' : 'What should this workflow do?'}
              rows={2}
              className="resize-none rounded-lg border-slate-200 pr-10 text-xs focus-visible:ring-blue-500"
            />
            <button
              onClick={() => send(instruction)}
              disabled={loading || !instruction.trim() || !hasGeminiKey}
              title={hasGeminiKey ? 'Send (Enter)' : 'Configure VITE_GEMINI_API_KEY first'}
              className="absolute bottom-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded-md bg-blue-600 text-white shadow-sm transition-all hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            </button>
          </div>
          <div className="flex items-center justify-between px-0.5">
            <p className="text-[10px] text-slate-400">
              Every reply updates the canvas instantly.
            </p>
            <p className="text-[10px] text-slate-400">
              <kbd className="rounded border border-slate-200 bg-slate-50 px-1 py-0.5 text-[9px] font-medium text-slate-500">
                ↵
              </kbd>{' '}
              send · <kbd className="rounded border border-slate-200 bg-slate-50 px-1 py-0.5 text-[9px] font-medium text-slate-500">
                ⇧↵
              </kbd>{' '}
              new line
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Bubble components ───────────────────────────────────────────────
function AssistantBubble({
  children,
  appliedNodes,
  appliedFlowName,
}: {
  children: React.ReactNode;
  appliedNodes?: number;
  appliedFlowName?: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-sm">
        <Bot className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-tl-sm border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 shadow-sm">
          {children}
        </div>
        {typeof appliedNodes === 'number' && (
          <div className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
            <CheckCircle2 className="h-2.5 w-2.5" />
            Applied to canvas · {appliedNodes} node{appliedNodes === 1 ? '' : 's'}
          </div>
        )}
        {appliedFlowName && <FireCountFooter flowName={appliedFlowName} />}
      </div>
    </div>
  );
}

// Rule 14 surface — show "Fired N times this week" below saved-automation
// bubbles. Quiet grey footer; hidden when N=0 so a freshly-saved automation
// doesn't show a discouraging zero before it has had a chance to fire.
function FireCountFooter({ flowName }: { flowName: string }) {
  const [count, setCount] = useState<number | null>(() => getCachedFireCount(flowName));
  useEffect(() => {
    let cancelled = false;
    void fetchFireCountThisWeek(flowName).then((n) => {
      if (!cancelled) setCount(n);
    });
    return () => { cancelled = true; };
  }, [flowName]);
  if (!count || count <= 0) return null;
  return (
    <p className="pl-1 text-[10px] text-slate-400">
      Fired {count} time{count === 1 ? '' : 's'} this week.
    </p>
  );
}

// Distinct red bubble for safety-blocked prompts (Layer B/C catch). Carries
// one clickable safe-alternative so the conversation doesn't dead-end.
function SafetyBlockBubble({
  text,
  safeAlternative,
  onPickAlternative,
  disabled,
}: {
  text: string;
  safeAlternative: string | null;
  onPickAlternative: (prompt: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-start gap-2">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-700 shadow-sm">
        <AlertTriangle className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-tl-sm border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900 shadow-sm">
          {text}
        </div>
        {safeAlternative && (
          <button
            onClick={() => onPickAlternative(safeAlternative)}
            disabled={disabled}
            className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-white px-2.5 py-1 text-[11px] font-medium text-rose-800 hover:border-rose-300 hover:bg-rose-50 disabled:opacity-40 transition-colors"
          >
            <CheckCircle2 className="h-3 w-3" />
            {safeAlternative}
          </button>
        )}
      </div>
    </div>
  );
}

function UserBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-end gap-2">
      <div className="max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-blue-600 px-3 py-2 text-xs text-white shadow-sm">
        {children}
      </div>
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-600">
        <UserIcon className="h-3.5 w-3.5" />
      </div>
    </div>
  );
}

// Smooth three-dot indicator while the AI is thinking — feels alive vs. a spinner.
function ThinkingDots() {
  return (
    <div className="flex items-start gap-2">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-sm">
        <Bot className="h-3.5 w-3.5" />
      </div>
      <div className="rounded-2xl rounded-tl-sm border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
        <div className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.3s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.15s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" />
        </div>
      </div>
    </div>
  );
}
