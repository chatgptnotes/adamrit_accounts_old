// Notification bell for the Open Dashboard hero. Shows a red count badge of
// bills due/overdue, opens a popover of pending + recently-paid bills, and
// optionally fires a 30-second pulsing attention pop-up when the dashboard
// mounts (autoPopup).
import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, AlarmClock, CheckCircle2, X, AlertTriangle, Clock } from 'lucide-react';
import {
  useUtilityDeadlines,
  type UtilityDeadline,
} from '@/hooks/useUtilityDeadlines';

type DerivedStatus = 'paid' | 'overdue' | 'due_soon' | 'upcoming';

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const daysUntil = (due: string) => {
  const [y1, m1, d1] = due.split('-').map(Number);
  const t = new Date();
  const a = Date.UTC(y1, (m1 ?? 1) - 1, d1 ?? 1);
  const b = Date.UTC(t.getFullYear(), t.getMonth(), t.getDate());
  return Math.round((a - b) / 86400000);
};
const deriveStatus = (row: UtilityDeadline): DerivedStatus => {
  if (row.status === 'paid') return 'paid';
  const n = daysUntil(row.due_date);
  if (n < 0) return 'overdue';
  if (n <= 7) return 'due_soon';
  return 'upcoming';
};
const relativeDue = (due: string): string => {
  const n = daysUntil(due);
  if (n === 0) return 'Due today';
  if (n < 0) return `${Math.abs(n)} day${Math.abs(n) === 1 ? '' : 's'} overdue`;
  return `${n} day${n === 1 ? '' : 's'} left`;
};
const inr = (n: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n);

interface Props {
  variant?: 'light' | 'dark';
  autoPopup?: boolean;
}

export default function DeadlineNotificationBell({ variant = 'light', autoPopup = false }: Props) {
  const { deadlines } = useUtilityDeadlines();
  const [open, setOpen] = useState(false);
  const [popup, setPopup] = useState(false);
  const popupTimer = useRef<number | null>(null);

  const { needsAttention, recentlyPaid, mostUrgent } = useMemo(() => {
    const need: { row: UtilityDeadline; status: DerivedStatus }[] = [];
    const paid: UtilityDeadline[] = [];
    for (const d of deadlines) {
      const s = deriveStatus(d);
      if (s === 'overdue' || s === 'due_soon') need.push({ row: d, status: s });
      else if (s === 'paid') paid.push(d);
    }
    need.sort((a, b) => daysUntil(a.row.due_date) - daysUntil(b.row.due_date));
    paid.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
    return {
      needsAttention: need,
      recentlyPaid: paid.slice(0, 5),
      mostUrgent: need[0]?.row ?? null,
    };
  }, [deadlines]);

  const count = needsAttention.length;

  // Auto-popup once per mount when there is something to attend to.
  // The pulsing banner stays visible for 30 seconds, then auto-closes — user
  // can also dismiss earlier.
  useEffect(() => {
    if (!autoPopup) return;
    if (count === 0) return;
    setPopup(true);
    popupTimer.current = window.setTimeout(() => setPopup(false), 30_000);
    return () => {
      if (popupTimer.current) window.clearTimeout(popupTimer.current);
    };
    // Only fire when autoPopup transitions to truthy with content; not on count flips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPopup]);

  const bellBase =
    variant === 'dark'
      ? 'bg-white/10 hover:bg-white/15 ring-1 ring-white/15 text-white'
      : 'bg-slate-100 hover:bg-slate-200 text-slate-700';

  return (
    <>
      <div className="relative shrink-0">
        <button
          onClick={() => setOpen((v) => !v)}
          title="Reminders"
          className={`relative w-9 h-9 rounded-xl flex items-center justify-center transition-colors ${bellBase}`}
        >
          <Bell className="w-4 h-4" />
          {count > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-white">
              {count > 9 ? '9+' : count}
            </span>
          )}
        </button>

        {open && (
          <div className="absolute right-0 mt-2 w-80 rounded-xl border border-slate-200 bg-white shadow-xl z-50 overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-100 flex items-center gap-2">
              <Bell className="w-3.5 h-3.5 text-slate-500" />
              <p className="text-xs font-semibold text-slate-900">Reminders</p>
              <button
                onClick={() => setOpen(false)}
                className="ml-auto p-0.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto">
              {needsAttention.length === 0 && recentlyPaid.length === 0 && (
                <p className="px-3 py-6 text-center text-xs text-slate-500">
                  Nothing to attend to right now.
                </p>
              )}
              {needsAttention.length > 0 && (
                <div className="px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-slate-400 mb-1">
                    Needs attention
                  </p>
                  <ul className="space-y-1">
                    {needsAttention.map(({ row, status }) => (
                      <li
                        key={row.id}
                        className="flex items-start gap-2 text-xs px-2 py-1.5 rounded-md hover:bg-slate-50"
                      >
                        {status === 'overdue' ? (
                          <AlertTriangle className="w-3.5 h-3.5 text-red-500 mt-0.5 shrink-0" />
                        ) : (
                          <Clock className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-slate-900 truncate">{row.name}</p>
                          <p
                            className={`text-[11px] ${
                              status === 'overdue' ? 'text-red-600' : 'text-amber-700'
                            }`}
                          >
                            {inr(Number(row.amount || 0))} · {relativeDue(row.due_date)}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {recentlyPaid.length > 0 && (
                <div className="px-3 py-2 border-t border-slate-100">
                  <p className="text-[10px] uppercase tracking-wider text-slate-400 mb-1">
                    Recently paid
                  </p>
                  <ul className="space-y-1">
                    {recentlyPaid.map((row) => (
                      <li
                        key={row.id}
                        className="flex items-start gap-2 text-xs px-2 py-1.5 rounded-md hover:bg-slate-50"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mt-0.5 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-slate-700 truncate">{row.name}</p>
                          <p className="text-[11px] text-emerald-700">
                            {inr(Number(row.amount || 0))}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 30-second pulsing attention pop-up */}
      {popup && mostUrgent && (
        <div className="fixed top-4 right-4 z-[100] w-80 rounded-xl border-2 border-red-300 bg-red-50 shadow-2xl animate-pulse">
          <div className="flex items-start gap-3 px-4 py-3">
            <div className="w-9 h-9 rounded-lg bg-red-500 text-white flex items-center justify-center shrink-0">
              <AlarmClock className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase tracking-wider text-red-700 font-bold">
                Bill reminder
              </p>
              <p className="text-sm font-semibold text-red-900 mt-0.5 truncate">
                {count} bill{count === 1 ? '' : 's'} need{count === 1 ? 's' : ''} attention
              </p>
              <p className="text-xs text-red-800 mt-1 truncate">
                Most urgent: <span className="font-medium">{mostUrgent.name}</span> ·{' '}
                {relativeDue(mostUrgent.due_date)}
              </p>
            </div>
            <button
              onClick={() => {
                setPopup(false);
                if (popupTimer.current) window.clearTimeout(popupTimer.current);
              }}
              className="p-1 rounded text-red-700 hover:bg-red-100 shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
