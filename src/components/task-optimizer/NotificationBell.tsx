// Notification bell + AI assistant for the Skill Factory header.
// Click the bell to see pending utility-bill deadlines, or type a natural
// sentence ("one week from now pay 1000, 23434, 3224 to electric, water, solar")
// and the bot turns each amount/vendor pair into a row on the Deadline
// Tracking dashboard. Each created row fires the existing bill_added flow
// dispatcher, which surfaces a toast on the main screen.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  Bot,
  CheckCircle2,
  Circle,
  ExternalLink,
  ListTodo,
  Loader2,
  Send,
  Sparkles,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { useUtilityDeadlines, type UtilityDeadline } from '@/hooks/useUtilityDeadlines';
import { parseRemindersFromPrompt } from '@/lib/parseReminderFromPrompt';

type Variant = 'compact' | 'inline';

export interface BellTask {
  // Stable id for local "done" toggle (the schema doesn't carry a done flag,
  // so the bell remembers it in localStorage keyed by this id + label).
  id: string;
  label: string;
  // Optional context line shown under the task ("Nursing · Today's log").
  meta?: string;
}

interface NotificationBellProps {
  variant?: Variant;
  tasks?: BellTask[];
  tasksHeading?: string;
}

// localStorage-backed "done" set so checking off a task in the popover
// survives a page reload. Scoped per (task.id, task.label) so two tasks
// with the same label on different logs stay independent.
const DONE_KEY = 'notif-bell:done-tasks';
const readDone = (): Set<string> => {
  try {
    const raw = localStorage.getItem(DONE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.filter((s) => typeof s === 'string') : []);
  } catch {
    return new Set();
  }
};
const writeDone = (set: Set<string>) => {
  try {
    localStorage.setItem(DONE_KEY, JSON.stringify([...set]));
  } catch {
    /* noop */
  }
};
const doneKey = (t: BellTask) => `${t.id}::${t.label}`;

const daysUntil = (due: string): number => {
  const [y, m, d] = due.split('-').map(Number);
  const today = new Date();
  const a = Date.UTC(y, (m ?? 1) - 1, d ?? 1);
  const b = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((a - b) / 86_400_000);
};

const relativeDue = (due: string): string => {
  const n = daysUntil(due);
  if (n === 0) return 'Due today';
  if (n < 0) return `${Math.abs(n)} day${Math.abs(n) === 1 ? '' : 's'} overdue`;
  return `${n} day${n === 1 ? '' : 's'} left`;
};

const inr = (n: number): string =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n);

interface ChatLine {
  role: 'user' | 'assistant';
  text: string;
}

export default function NotificationBell({
  variant = 'inline',
  tasks = [],
  tasksHeading = 'Tasks to do',
}: NotificationBellProps) {
  const navigate = useNavigate();
  const { deadlines, createDeadline } = useUtilityDeadlines();

  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [done, setDone] = useState<Set<string>>(() => readDone());
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const toggleDone = (t: BellTask) => {
    setDone((prev) => {
      const next = new Set(prev);
      const k = doneKey(t);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      writeDone(next);
      return next;
    });
  };
  const openTasks = useMemo(() => tasks.filter((t) => !done.has(doneKey(t))), [tasks, done]);
  const doneTasks = useMemo(() => tasks.filter((t) => done.has(doneKey(t))), [tasks, done]);

  // Bills that are overdue or due within the next 7 days — these drive the
  // badge count and the list at the top of the popover.
  const pending = useMemo(() => {
    return deadlines
      .filter((d) => d.status === 'pending' && daysUntil(d.due_date) <= 7)
      .sort((a, b) => daysUntil(a.due_date) - daysUntil(b.due_date));
  }, [deadlines]);
  const count = pending.length + openTasks.length;

  // Close on outside click + Esc.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!popoverRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Auto-focus the AI input when the popover opens.
  useEffect(() => {
    if (open) {
      const id = window.setTimeout(() => inputRef.current?.focus(), 60);
      return () => window.clearTimeout(id);
    }
  }, [open]);

  const submit = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setChat((c) => [...c, { role: 'user', text }]);
    setInput('');
    setBusy(true);
    try {
      const reminders = await parseRemindersFromPrompt(text);
      if (reminders.length === 0) {
        setChat((c) => [
          ...c,
          {
            role: 'assistant',
            text: "I couldn't pull a bill out of that — try something like \"pay 1000 to electricity in 3 days\" or \"one week from now pay 1000, 2000 to electric, water\".",
          },
        ]);
        return;
      }
      let created = 0;
      for (const r of reminders) {
        try {
          await createDeadline({
            name: r.name,
            bill_type: r.bill_type,
            amount: r.amount,
            due_date: r.due_date,
            recurring: r.recurring,
            notes: r.notes ?? null,
          });
          created++;
        } catch (err) {
          console.warn('[NotificationBell] createDeadline failed', err);
        }
      }
      const summary = reminders
        .map((r) => `• ${r.name} — ${inr(r.amount)} · ${r.dueLabel}`)
        .join('\n');
      setChat((c) => [
        ...c,
        {
          role: 'assistant',
          text:
            created === reminders.length
              ? `Added ${created} reminder${created > 1 ? 's' : ''}:\n${summary}`
              : `Added ${created} of ${reminders.length} reminder${reminders.length > 1 ? 's' : ''}:\n${summary}`,
        },
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong.';
      setChat((c) => [...c, { role: 'assistant', text: msg }]);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  // Visual differences for the collapsed vs. expanded staff panel.
  const buttonClass =
    variant === 'compact'
      ? 'relative p-1.5 rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-700'
      : 'ml-auto relative p-1 rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700';
  const badgePos =
    variant === 'compact'
      ? 'absolute top-0 right-0'
      : 'absolute -top-0.5 -right-0.5';

  return (
    <div className="relative" ref={popoverRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={
          count > 0
            ? `${count} pending deadline${count > 1 ? 's' : ''} — click to view or add new ones with AI`
            : 'Notifications — click to add new reminders with AI'
        }
        className={buttonClass}
      >
        <Bell className="w-4 h-4" />
        {count > 0 && (
          <span
            className={`${badgePos} min-w-[14px] h-[14px] px-1 rounded-full bg-rose-500 text-white text-[9px] font-semibold flex items-center justify-center leading-none`}
          >
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute z-50 mt-2 w-80 rounded-xl border border-gray-200 bg-white shadow-2xl overflow-hidden"
          style={{ left: variant === 'compact' ? '36px' : 'auto', right: variant === 'compact' ? 'auto' : '0', top: variant === 'compact' ? '0' : 'auto' }}
        >
          {/* Header */}
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-100 bg-gradient-to-br from-blue-50 to-white">
            <div className="relative flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-blue-700 text-white">
              <Bell className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-900 leading-tight">Notifications</p>
              <p className="text-[10px] text-gray-500">
                {count > 0
                  ? `${count} bill${count > 1 ? 's' : ''} due in the next 7 days`
                  : 'No bills due in the next 7 days'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="p-1 rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              title="Close"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Pending bills list */}
          {pending.length > 0 && (
            <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
              Deadlines
            </div>
          )}
          <div className="max-h-44 overflow-y-auto">
            {pending.slice(0, 6).map((d) => (
              <PendingRow key={d.id} d={d} />
            ))}
            {pending.length > 6 && (
              <button
                onClick={() => {
                  setOpen(false);
                  navigate('/deadline-tracking');
                }}
                className="w-full px-3 py-1.5 text-[11px] text-blue-600 hover:bg-blue-50 flex items-center gap-1 justify-center"
              >
                See {pending.length - 6} more on the dashboard <ExternalLink className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Tasks section — open + already-marked */}
          {(openTasks.length > 0 || doneTasks.length > 0) && (
            <>
              <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400 flex items-center gap-1">
                <ListTodo className="w-3 h-3" /> {tasksHeading}
                <span className="ml-auto text-gray-400 font-normal normal-case">
                  {openTasks.length} left · {doneTasks.length} done
                </span>
              </div>
              <div className="max-h-44 overflow-y-auto">
                {openTasks.map((t) => (
                  <TaskRow key={doneKey(t)} t={t} done={false} onToggle={() => toggleDone(t)} />
                ))}
                {doneTasks.map((t) => (
                  <TaskRow key={doneKey(t)} t={t} done={true} onToggle={() => toggleDone(t)} />
                ))}
              </div>
            </>
          )}

          {pending.length === 0 && openTasks.length === 0 && doneTasks.length === 0 && (
            <p className="px-3 py-3 text-xs text-gray-400">You're all clear. Add a new one below.</p>
          )}

          {/* AI chat trail */}
          {chat.length > 0 && (
            <div className="border-t border-gray-100 max-h-40 overflow-y-auto px-3 py-2 space-y-2 bg-gray-50">
              {chat.map((line, i) => (
                <div
                  key={i}
                  className={`flex gap-1.5 ${line.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {line.role === 'assistant' && (
                    <div className="w-5 h-5 rounded-full bg-gray-900 flex items-center justify-center shrink-0 mt-0.5">
                      <Bot className="w-2.5 h-2.5 text-blue-400" />
                    </div>
                  )}
                  <div
                    className={`max-w-[80%] text-[11px] px-2 py-1.5 rounded-lg whitespace-pre-wrap leading-snug ${
                      line.role === 'user'
                        ? 'bg-blue-600 text-white rounded-br-none'
                        : 'bg-white border border-gray-200 text-gray-800 rounded-bl-none'
                    }`}
                  >
                    {line.text}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* AI input */}
          <div className="border-t border-gray-100 px-2.5 py-2 bg-white">
            {chat.length === 0 && (
              <p className="px-1 pb-1.5 text-[10px] text-gray-500 flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-blue-500" />
                Tell me what to remind you of — e.g. "one week from now pay 1000, 23434, 3224 to electric, water, solar".
              </p>
            )}
            <div className="flex items-center gap-1.5">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submit();
                }}
                placeholder="Type a reminder…"
                disabled={busy}
                className="flex-1 text-xs px-2.5 py-1.5 rounded-md border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => void submit()}
                disabled={busy || !input.trim()}
                className="p-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
                title="Send to AI assistant"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                navigate('/deadline-tracking');
              }}
              className="mt-1.5 w-full text-[11px] text-blue-600 hover:underline flex items-center justify-center gap-1"
            >
              Open Deadline Tracking <ExternalLink className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function TaskRow({
  t,
  done,
  onToggle,
}: {
  t: BellTask;
  done: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="px-3 py-1.5 border-b border-gray-50 last:border-b-0 flex items-start gap-2">
      <button
        type="button"
        onClick={onToggle}
        title={done ? 'Mark as not done' : 'Mark as done'}
        className="mt-0.5 shrink-0 text-gray-400 hover:text-emerald-600"
      >
        {done ? (
          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
        ) : (
          <Circle className="w-4 h-4" />
        )}
      </button>
      <div className="min-w-0 flex-1">
        <p
          className={`text-xs truncate ${
            done ? 'text-gray-400 line-through' : 'text-gray-900 font-medium'
          }`}
        >
          {t.label}
        </p>
        {t.meta && <p className="text-[10px] text-gray-400 truncate">{t.meta}</p>}
      </div>
    </div>
  );
}

function PendingRow({ d }: { d: UtilityDeadline }) {
  const n = daysUntil(d.due_date);
  const tint =
    n < 0
      ? 'bg-rose-50 text-rose-700 border-rose-200'
      : n <= 2
      ? 'bg-amber-50 text-amber-700 border-amber-200'
      : 'bg-blue-50 text-blue-700 border-blue-200';
  return (
    <div className="px-3 py-2 border-b border-gray-50 last:border-b-0 flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-gray-900 truncate">{d.name}</p>
        <p className="text-[10px] text-gray-500 truncate">{inr(d.amount)} · {d.due_date}</p>
      </div>
      <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-full border ${tint}`}>
        {relativeDue(d.due_date)}
      </span>
    </div>
  );
}
