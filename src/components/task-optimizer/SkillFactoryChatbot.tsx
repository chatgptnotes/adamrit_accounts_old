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
  AlarmClock,
  IndianRupee,
  FileText,
  ExternalLink,
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
import { parseReminderFromPrompt, type ParsedReminder } from '@/lib/parseReminderFromPrompt';
import { matchRecipient } from '@/lib/slackRecipients';
import { useSlackRecipients } from '@/hooks/useSlackRecipients';
import { classifyChatIntent } from '@/lib/classifyChatIntent';
import { suggestAutomations, type AutomationSuggestion } from '@/lib/suggestAutomations';
import { scanAndExtractForTask, type ScanField, type ScanAttachment } from '@/lib/scanForTask';
import { uploadBillAttachment } from '@/lib/uploadBillAttachment';
import DocumentScanMenu from './DocumentScanMenu';
import { LLM_BACKEND } from '@/lib/vpsClaude';
import { useUtilityDeadlines } from '@/hooks/useUtilityDeadlines';
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
  // Agentic extensions — when provided, the chatbot can also: (a) SUGGEST
  // automations on request; (b) CREATE a NEW saved automation on confirm
  // WITHOUT clobbering the canvas; (c) LIST + LOAD an existing saved automation.
  // onCreateAutomation returns the new row's id+name (or null on absent prop).
  onCreateAutomation?: (
    flow: GeneratedFlow,
    opts?: { nameOverride?: string; alsoLoad?: boolean },
  ) => Promise<{ id: string; name: string } | null>;
  listExistingFlows?: () => ExistingFlowRef[];
  onLoadExistingFlow?: (flowId: string) => void;
  // Document scan: attach a scanned/extracted doc to the active task. When
  // omitted, the scan button is hidden. taskAttachments lists the active task's
  // existing scans so the chatbot can show them.
  onAttachScan?: (task: string, data: ScanAttachment) => void;
  taskAttachments?: ScanAttachment[];
  // When false, the user-input textarea + Send button at the bottom are hidden.
  // The chatbot then only drives off the Execute button in the header.
  showComposer?: boolean;
}

interface ExistingFlowRef {
  id: string;
  name: string;
  enabled: boolean;
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
  // When present, this message reports a reminder/bill that was created from
  // natural-language ("remind me to pay X tomorrow") — rendered in a distinct
  // green card with the resolved due date, amount, and bill type.
  reminderCreated?: {
    name: string;
    dueLabel: string;
    amount: number;
    billType: string;
    recurring: boolean;
    important: boolean;
  };
  // Automation suggestions (shown on request) — each rendered as a card with a
  // "Set this up" button that confirms + creates the automation.
  suggestions?: AutomationSuggestion[];
  // Existing saved automations for this staff — rendered as a picker; tapping
  // one loads it onto the canvas to edit.
  existingFlows?: ExistingFlowRef[];
  // A newly-created automation — rendered with an "Open on canvas" chip.
  createdAutomation?: { id: string; name: string };
  // A scanned document's extracted result — rendered as a fields card.
  scanResult?: { title: string; summary: string; fields: ScanField[]; fileUrl: string | null };
  // When present, this message is asking WHO a parsed-but-not-yet-created
  // reminder should be sent to — rendered as recipient chips (roster + shared
  // channel). The reminder is held here (not re-parsed) so picking a chip just
  // commits it with the chosen recipient_id.
  pendingRecipient?: { reminder: ParsedReminder; hint: string | null };
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
    // tapping. Each chip maps 1:1 to one new trigger type. The first chip is
    // a quick-add reminder (no canvas — creates a real row + notification).
    return [
      {
        icon: AlarmClock,
        label: 'Quick add a reminder',
        prompt: 'Remind me to pay the Airtel postpaid bill tomorrow, ₹2000.',
      },
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
      icon: Sparkles,
      label: 'Suggest automations for this',
      prompt: `Suggest ways to automate "${task}".`,
    },
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

// Interpret the user's answer to "what's their Slack ID?". Returns 'skip' for a
// name-only recipient, a resolved { id, kind } when a Slack ID is found (U/W =
// person, C/G/D = channel), or null when the text is neither (→ re-ask).
function parseSlackTarget(input: string): 'skip' | { slack_target: string; kind: 'dm' | 'channel' } | null {
  const t = input.trim();
  if (/^(skip|no|none|name ?only|by name|later|n\/a)$/i.test(t)) return 'skip';
  const m = t.match(/\b([UWCGD][A-Z0-9]{6,})\b/i);
  if (!m) return null;
  const id = m[1].toUpperCase();
  return { slack_target: id, kind: /^[CGD]/.test(id) ? 'channel' : 'dm' };
}

export default function SkillFactoryChatbot({
  task,
  subtasks,
  designation,
  allTasks,
  stepsByTask,
  currentFlow,
  onApply,
  onCreateAutomation,
  listExistingFlows,
  onLoadExistingFlow,
  onAttachScan,
  taskAttachments,
  showComposer = true,
}: SkillFactoryChatbotProps) {
  const [instruction, setInstruction] = useState('');
  const [loading, setLoading] = useState(false);
  const [insightVisible, setInsightVisible] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // Lets the chatbot create real utility_deadlines rows from natural-language
  // ("remind me to pay X tomorrow") — bypassing the automation-design path.
  // The hook fires bill_added on insert, which the existing notification bell
  // and any bill_added flow picks up automatically.
  const { createDeadline } = useUtilityDeadlines();
  // Roster of Slack recipients a reminder can be addressed to. Used to resolve a
  // "to Murli sir" phrase to a recipient_id, and to render the "who?" chips when
  // the user named no one (or someone not on the roster). createRecipient lets
  // the user add a new person/channel inline, without leaving the chat.
  const { recipients, createRecipient } = useSlackRecipients();
  // Rule 15 — when on, applied flows render to canvas but the parent skips
  // persistence. Lets the user iterate without polluting the DB.
  const [dryRun, setDryRun] = useState(false);
  // When set, the chatbot is waiting for the user to type the Slack ID of a new
  // recipient they're adding inline. The next message is treated as that answer.
  const [pendingNewRecipient, setPendingNewRecipient] = useState<{ reminder: ParsedReminder; name: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const isEditing = currentFlow.nodes.length > 0;
  const greeting = task.trim()
    ? `Let's automate "${task}". I can suggest ideas for this task, build or edit the automation on the canvas, or save a brand-new one. Ask "suggest automations for this", or just describe what you want.`
    : `Pick a task on the left, or ask me to suggest automations. I can build a new automation, edit the one on the canvas, or open your saved ones.`;

  // Auto-scroll to latest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, loading]);

  // Create the utility_deadlines row for a parsed reminder, addressed to an
  // optional recipient. Shared by the direct path (recipient matched in the
  // prompt) and the "who?" chips (recipient picked after the fact).
  const commitReminder = async (
    reminder: ParsedReminder,
    recipient: { id: string; name: string } | null,
  ) => {
    await createDeadline({
      name: reminder.name,
      bill_type: reminder.bill_type,
      amount: reminder.amount,
      due_date: reminder.due_date,
      recurring: reminder.recurring,
      notes: reminder.notes,
      notify_at: reminder.notify_at,
      recipient_id: recipient?.id ?? null,
      important: reminder.important,
    });
    setMessages(prev => [
      ...prev,
      {
        role: 'assistant',
        text: recipient
          ? `Created a reminder for "${reminder.name}" — I'll notify ${recipient.name}.`
          : `Created a reminder for "${reminder.name}".`,
        reminderCreated: {
          name: reminder.name,
          dueLabel: reminder.dueLabel,
          amount: reminder.amount,
          billType: reminder.bill_type,
          recurring: reminder.recurring,
          important: reminder.important === true,
        },
      },
    ]);
  };

  // A "who?" recipient chip was tapped — commit the held reminder with the
  // chosen recipient (or null for the shared channel). Guards against double
  // taps while a create is in flight.
  const pickRecipient = async (
    reminder: ParsedReminder,
    recipient: { id: string; name: string } | null,
  ) => {
    if (loading) return;
    setLoading(true);
    try {
      await commitReminder(reminder, recipient);
    } catch (error: unknown) {
      pushError(error);
    } finally {
      setLoading(false);
    }
  };

  // Add a brand-new recipient inline. Instead of creating a name-only row
  // immediately, ask for their Slack ID so the reminder can actually ping them.
  // The next message the user sends is captured by finalizeNewRecipient.
  const addAndPickRecipient = (reminder: ParsedReminder, name: string) => {
    if (loading) return;
    setPendingNewRecipient({ reminder, name });
    setMessages(prev => [
      ...prev,
      {
        role: 'assistant',
        text: `What's ${name}'s Slack ID? Paste their Slack member ID (starts with "U") — or a channel ID (starts with "C") — so reminders ping them. Type "skip" to add by name only for now.`,
      },
    ]);
  };

  // Handle the user's reply to the "what's their Slack ID?" prompt: create the
  // recipient (with the ID, or name-only on "skip") and address the held
  // reminder to them. On an unrecognized answer, re-ask without losing state.
  const finalizeNewRecipient = async (answer: string, pending: { reminder: ParsedReminder; name: string }) => {
    const parsed = parseSlackTarget(answer);
    if (parsed === null) {
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          text: `That doesn't look like a Slack ID — they start with "U" for a person or "C" for a channel. Paste it again, or type "skip" to add ${pending.name} by name only.`,
        },
      ]);
      return; // keep pendingNewRecipient set so the next message retries
    }
    setLoading(true);
    try {
      const slack_target = parsed === 'skip' ? null : parsed.slack_target;
      const kind = parsed === 'skip' ? 'dm' : parsed.kind;
      const created = await createRecipient({ name: pending.name, aliases: [], kind, slack_target });
      if (created) {
        setPendingNewRecipient(null);
        await commitReminder(pending.reminder, { id: created.id, name: created.name });
      } else {
        pushError(new Error('Could not add the recipient. Please try again.'));
      }
    } catch (error: unknown) {
      pushError(error);
    } finally {
      setLoading(false);
    }
  };

  const send = async (text: string) => {
    if (!text.trim() || loading) return;
    setMessages(prev => [...prev, { role: 'user', text }]);
    setInstruction('');
    // If we asked for a new recipient's Slack ID, this message is the answer —
    // create the recipient + commit the held reminder, don't re-parse as a flow.
    if (pendingNewRecipient) {
      await finalizeNewRecipient(text, pendingNewRecipient);
      return;
    }
    setLoading(true);
    try {
      // Branch 1 — natural-language reminder/bill creation.
      // Skipped silently (returns null) when the prompt doesn't look like a
      // create request, falling through to the automation-design path below.
      const reminder = await parseReminderFromPrompt(text);
      if (reminder) {
        // Resolve "to Murli sir" against the roster. A clear match → create now.
        // A named-but-unknown recipient, or no recipient at all → ask who, with
        // the parsed reminder held on the message so a chip just commits it.
        const match = reminder.recipient_hint
          ? matchRecipient(reminder.recipient_hint, recipients)
          : null;
        if (match) {
          await commitReminder(reminder, { id: match.id, name: match.name });
        } else {
          const askText = reminder.recipient_hint
            ? `I don't have anyone called "${reminder.recipient_hint}" on the recipient list yet. Who should I send this reminder to?`
            : 'Who should I send this reminder to?';
          setMessages(prev => [
            ...prev,
            { role: 'assistant', text: askText, pendingRecipient: { reminder, hint: reminder.recipient_hint } },
          ]);
        }
        return;
      }

      // Branch 2 — conversational intents (only when the agentic props are wired):
      // "what can you automate for me?" → suggestions; "show me my automations"
      // → existing-flow picker. classifyChatIntent returns null for everything
      // else, so the design path below stays the default.
      const intent = classifyChatIntent(text);
      if (intent === 'suggest' && onCreateAutomation) {
        const suggestions = await suggestAutomations({
          persona: designation || 'staff member',
          instruction: text,
          activeTask: task,
          tasks: allTasks,
          stepsByTask,
        });
        setMessages(prev => [
          ...prev,
          {
            role: 'assistant',
            text: `Here are a few automations I can set up for ${designation || 'this staff member'}. Tap one to build it:`,
            suggestions,
          },
        ]);
        return;
      }
      if (intent === 'edit_existing' && listExistingFlows) {
        const existing = listExistingFlows();
        setMessages(prev => [
          ...prev,
          {
            role: 'assistant',
            text: existing.length
              ? 'Here are the saved automations for this staff member. Tap one to open it on the canvas:'
              : 'There are no saved automations for this staff member yet. Ask me to suggest some, or describe one to build.',
            existingFlows: existing,
            questions: existing.length ? undefined : ['What can you automate for me?'],
          },
        ]);
        return;
      }

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
      pushError(error);
    } finally {
      setLoading(false);
    }
  };

  // Shared error → bubble. Safety blocks (Layer B/C) get a distinct red bubble
  // with one safe-alternative chip so the conversation never dead-ends; no flow
  // is applied. Everything else surfaces the verbatim message (no fallback).
  const pushError = (error: unknown) => {
    if (error instanceof FlowSafetyError) {
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          text: "I can't build that — it would delete or modify records I'm not allowed to touch. Try one of the safe alternatives below.",
          safetyBlock: { safeAlternative: error.safeAlternative },
        },
      ]);
    } else {
      setMessages(prev => [
        ...prev,
        { role: 'assistant', text: error instanceof Error ? error.message : 'Something went wrong. Please try again.' },
      ]);
    }
  };

  // Confirm a suggestion → build a FRESH automation (no `current`, so it doesn't
  // edit the open canvas) through the full safety pipeline, then create it as a
  // NEW saved row via onCreateAutomation (which does NOT touch the canvas).
  const confirmSuggestion = async (s: AutomationSuggestion) => {
    if (loading) return;
    setMessages(prev => [...prev, { role: 'user', text: `Set up: ${s.title}` }]);
    setLoading(true);
    try {
      const flow = await generateFlowFromPrompt({
        persona: designation || 'staff member',
        instruction: s.buildPrompt,
        activeTask: task,
        tasks: allTasks,
        stepsByTask,
      });
      const created = onCreateAutomation ? await onCreateAutomation(flow, { nameOverride: s.title }) : null;
      if (created) {
        setMessages(prev => [
          ...prev,
          {
            role: 'assistant',
            text: `Created a new automation: "${created.name}". It's saved and live for ${designation || 'this staff member'}.`,
            createdAutomation: created,
          },
        ]);
      } else {
        // No create callback wired — fall back to applying on the canvas.
        onApply(flow);
        setMessages(prev => [
          ...prev,
          { role: 'assistant', text: flow.explanation || 'Built the automation on the canvas.', appliedNodes: flow.nodes.length, appliedFlowName: flow.name },
        ]);
      }
    } catch (error: unknown) {
      pushError(error);
    } finally {
      setLoading(false);
    }
  };

  // Load an existing saved automation onto the canvas to edit.
  const loadExisting = (f: ExistingFlowRef) => {
    onLoadExistingFlow?.(f.id);
    setMessages(prev => [
      ...prev,
      { role: 'assistant', text: `Loaded "${f.name}" onto the canvas. Edit it and hit Save to update it.` },
    ]);
  };

  // Scan/upload a document for the active task: OCR → AI extracts fields inferred
  // from the task name → show a summary + attach to the task. Best-effort upload.
  const handleScanFile = async (file: Blob, fileName: string) => {
    if (loading) return;
    if (!task.trim()) {
      setMessages(prev => [
        ...prev,
        { role: 'assistant', text: 'Open a task first — the scanned document attaches to that task.' },
      ]);
      return;
    }
    setMessages(prev => [...prev, { role: 'user', text: `📎 Scanning ${fileName}…` }]);
    setLoading(true);
    try {
      const [result, fileUrl] = await Promise.all([
        scanAndExtractForTask({ file, fileName, task, designation: designation || 'staff' }),
        uploadBillAttachment(file, fileName),
      ]);
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          text: result.summary || `Scanned "${result.title}".`,
          scanResult: { title: result.title, summary: result.summary, fields: result.fields, fileUrl },
        },
      ]);
      onAttachScan?.(task, {
        title: result.title,
        summary: result.summary,
        fields: result.fields,
        fileUrl,
        createdAt: new Date().toISOString(),
      });
    } catch (error: unknown) {
      pushError(error);
    } finally {
      setLoading(false);
    }
  };

  const handleExecute = () => {
    const prompt = buildExecutePrompt(task, subtasks, currentFlow);
    send(prompt);
  };

  const starters = starterPromptsFor(task, designation);
  // AI is "ready" if we're on the VPS Claude backend, or a Gemini key is
  // present. Otherwise surface a clear setup banner — without it every send
  // fails with a generic "Something went wrong" toast.
  const aiReady = LLM_BACKEND === 'vps' || !!import.meta.env.VITE_GEMINI_API_KEY;

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
              !aiReady ||
              (!task.trim() && subtasks.length === 0 && currentFlow.nodes.length === 0)
            }
            title={aiReady ? 'Send task + sub-tasks + current canvas to the AI' : 'Configure VITE_GEMINI_API_KEY first'}
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

      {/* Setup banner — shown only when no AI backend is ready. Replaces the
          confusing "Something went wrong" toast each call would otherwise emit. */}
      {!aiReady && (
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
        {/* Scanned documents already attached to this task */}
        {taskAttachments && taskAttachments.length > 0 && (
          <div className="rounded-lg border border-violet-200 bg-violet-50/60 px-2.5 py-2">
            <p className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-violet-500">
              <FileText className="h-3 w-3" /> Scanned for this task ({taskAttachments.length})
            </p>
            <div className="mt-1 space-y-1">
              {taskAttachments.map((a, i) => (
                <div key={i} className="flex items-center gap-1.5 text-[11px]">
                  <span className="min-w-0 flex-1 truncate text-violet-900" title={a.summary}>{a.title}</span>
                  {a.fileUrl && (
                    <a
                      href={a.fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex shrink-0 items-center gap-0.5 text-violet-700 hover:underline"
                    >
                      <ExternalLink className="h-2.5 w-2.5" /> open
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
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
              ) : m.reminderCreated ? (
                <ReminderCreatedBubble
                  text={m.text}
                  reminder={m.reminderCreated}
                />
              ) : m.scanResult ? (
                <ScanResultBubble scan={m.scanResult} />
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
              {m.pendingRecipient && (
                <div className="space-y-1 pl-9">
                  <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-400">
                    <Bell className="h-3 w-3" /> Send to
                  </p>
                  {m.pendingRecipient.hint && (
                    <button
                      onClick={() => addAndPickRecipient(m.pendingRecipient!.reminder, m.pendingRecipient!.hint!)}
                      disabled={loading}
                      className="block w-full text-left text-[11px] px-2.5 py-1.5 rounded-md border border-blue-300 bg-blue-50/60 text-blue-700 font-medium hover:bg-blue-100 disabled:opacity-40 transition-colors"
                    >
                      + Add "{m.pendingRecipient.hint}" as a new recipient
                    </button>
                  )}
                  {recipients.filter((r) => r.active).map((r) => (
                    <button
                      key={r.id}
                      onClick={() => pickRecipient(m.pendingRecipient!.reminder, { id: r.id, name: r.name })}
                      disabled={loading}
                      className="block w-full text-left text-[11px] px-2.5 py-1.5 rounded-md border border-slate-200 bg-white hover:border-blue-300 hover:bg-blue-50/60 disabled:opacity-40 transition-colors"
                    >
                      {r.kind === 'channel' ? `# ${r.name}` : r.name}
                    </button>
                  ))}
                  <button
                    onClick={() => pickRecipient(m.pendingRecipient!.reminder, null)}
                    disabled={loading}
                    className="block w-full text-left text-[11px] px-2.5 py-1.5 rounded-md border border-slate-200 bg-white hover:border-blue-300 hover:bg-blue-50/60 disabled:opacity-40 transition-colors"
                  >
                    Shared channel (no specific person)
                  </button>
                </div>
              )}
              {m.suggestions && m.suggestions.length > 0 && (
                <div className="space-y-1.5 pl-9">
                  {m.suggestions.map((s) => (
                    <div key={s.title} className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 shadow-sm">
                      <div className="flex items-start gap-2">
                        <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600">
                          <Sparkles className="h-3 w-3" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-medium text-slate-800">{s.title}</p>
                          {s.rationale && <p className="text-[10px] text-slate-500 leading-snug">{s.rationale}</p>}
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            <span className="inline-flex items-center rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium text-slate-600">
                              on {s.trigger.replace(/_/g, ' ')}
                            </span>
                            <span className="inline-flex items-center rounded-full bg-blue-50 px-1.5 py-0.5 text-[9px] font-medium text-blue-700">
                              {s.primaryAction}
                            </span>
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => confirmSuggestion(s)}
                        disabled={loading}
                        className="mt-1.5 inline-flex w-full items-center justify-center gap-1 rounded-md bg-blue-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 transition-colors"
                      >
                        <Zap className="h-3 w-3" /> Set this up
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {m.existingFlows && m.existingFlows.length > 0 && (
                <div className="space-y-1 pl-9">
                  <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-400">
                    <ArrowDownToLine className="h-3 w-3" /> Open one
                  </p>
                  {m.existingFlows.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => loadExisting(f)}
                      disabled={loading}
                      className="flex w-full items-center gap-2 text-left text-[11px] px-2.5 py-1.5 rounded-md border border-slate-200 bg-white hover:border-blue-300 hover:bg-blue-50/60 disabled:opacity-40 transition-colors"
                    >
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${f.enabled ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                      <span className="min-w-0 flex-1 truncate text-slate-700">{f.name}</span>
                      {!f.enabled && <span className="text-[9px] text-slate-400">disabled</span>}
                    </button>
                  ))}
                </div>
              )}
              {m.createdAutomation && (
                <div className="pl-9">
                  <button
                    onClick={() => onLoadExistingFlow?.(m.createdAutomation!.id)}
                    disabled={loading}
                    className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-800 hover:border-emerald-300 disabled:opacity-40 transition-colors"
                  >
                    <ArrowDownToLine className="h-3 w-3" /> Open on canvas
                  </button>
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
              className={`resize-none rounded-lg border-slate-200 pr-10 text-xs focus-visible:ring-blue-500 ${onAttachScan ? 'pl-10' : ''}`}
            />
            {onAttachScan && (
              <div className="absolute bottom-1.5 left-1.5">
                <DocumentScanMenu
                  onFile={handleScanFile}
                  disabled={!aiReady || !task.trim()}
                  busy={loading}
                  title={task.trim() ? 'Scan or upload a document for this task' : 'Open a task first'}
                />
              </div>
            )}
            <button
              onClick={() => send(instruction)}
              disabled={loading || !instruction.trim() || !aiReady}
              title={aiReady ? 'Send (Enter)' : 'Configure VITE_GEMINI_API_KEY first'}
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

// Reminder/bill created via natural-language prompt. Distinct green card so the
// user can tell at a glance that a real row was saved (vs. an automation
// designed on the canvas). Shows the parsed fields so any mis-parse is visible
// — the user can then edit in the deadlines table.
function ReminderCreatedBubble({
  text,
  reminder,
}: {
  text: string;
  reminder: {
    name: string;
    dueLabel: string;
    amount: number;
    billType: string;
    recurring: boolean;
    important: boolean;
  };
}) {
  const inr = (n: number) =>
    n > 0
      ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
      : '—';
  return (
    <div className="flex items-start gap-2">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 shadow-sm">
        <AlarmClock className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="max-w-[88%] rounded-2xl rounded-tl-sm border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 shadow-sm">
          <p className="font-medium">{text}</p>
          <div className="mt-1.5 space-y-0.5 text-[11px]">
            <div className="flex items-center gap-1">
              <Clock3 className="h-3 w-3 text-emerald-700" />
              <span>Due {reminder.dueLabel}</span>
            </div>
            <div className="flex items-center gap-1">
              <IndianRupee className="h-3 w-3 text-emerald-700" />
              <span>{inr(reminder.amount)}</span>
              <span className="text-emerald-700/70">·</span>
              <span className="capitalize">{reminder.billType.replace(/_/g, ' ')}</span>
              {reminder.recurring && (
                <>
                  <span className="text-emerald-700/70">·</span>
                  <span>recurring monthly</span>
                </>
              )}
            </div>
          </div>
          {reminder.important && (
            <div className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
              ⭐ Important — directors will be notified
            </div>
          )}
          <p className="mt-1.5 text-[10px] text-emerald-700/80">
            Notification scheduled. You can edit it in the Deadline Tracking dashboard.
          </p>
        </div>
      </div>
    </div>
  );
}

// Scanned-document result — a violet card with the AI-extracted fields + a link
// to the stored file.
function ScanResultBubble({
  scan,
}: {
  scan: { title: string; summary: string; fields: ScanField[]; fileUrl: string | null };
}) {
  return (
    <div className="flex items-start gap-2">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-700 shadow-sm">
        <FileText className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="max-w-[88%] rounded-2xl rounded-tl-sm border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-900 shadow-sm">
          <p className="font-semibold">{scan.title}</p>
          {scan.summary && <p className="mt-0.5 text-[11px] leading-snug text-violet-800">{scan.summary}</p>}
          {scan.fields.length > 0 && (
            <div className="mt-1.5 space-y-0.5 border-t border-violet-200/70 pt-1.5 text-[11px]">
              {scan.fields.map((f) => (
                <div key={f.label} className="flex gap-1.5">
                  <span className="shrink-0 font-medium text-violet-700">{f.label}:</span>
                  <span className="min-w-0 break-words text-violet-900">{f.value}</span>
                </div>
              ))}
            </div>
          )}
          <div className="mt-1.5 flex items-center gap-2 text-[10px] text-violet-700/80">
            <span>Attached to this task.</span>
            {scan.fileUrl && (
              <a
                href={scan.fileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 font-medium text-violet-700 hover:underline"
              >
                <ExternalLink className="h-2.5 w-2.5" /> Open file
              </a>
            )}
          </div>
        </div>
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
