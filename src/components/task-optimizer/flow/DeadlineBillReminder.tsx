// Once-a-day dialog reminder for utility deadlines. Mount on the main Adamrit
// dashboard. Opens at most once per local day; dismissing it records the date
// in localStorage so it does not re-open until tomorrow.
import { useEffect, useMemo, useState } from 'react';
import { AlarmClock, AlertTriangle, Clock, X } from 'lucide-react';
import {
  useUtilityDeadlines,
  type UtilityDeadline,
} from '@/hooks/useUtilityDeadlines';

const STORAGE_KEY = 'deadline-bill-reminder:dismissed-on';

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
const relativeDue = (due: string): string => {
  const n = daysUntil(due);
  if (n === 0) return 'Due today';
  if (n < 0) return `${Math.abs(n)} day${Math.abs(n) === 1 ? '' : 's'} overdue`;
  return `${n} day${n === 1 ? '' : 's'} left`;
};

export default function DeadlineBillReminder() {
  const { deadlines, isLoading } = useUtilityDeadlines();
  const [open, setOpen] = useState(false);

  const urgent = useMemo(() => {
    const list: { row: UtilityDeadline; n: number }[] = [];
    for (const d of deadlines) {
      if (d.status === 'paid') continue;
      const n = daysUntil(d.due_date);
      if (n <= 3) list.push({ row: d, n }); // overdue OR due within 3 days
    }
    list.sort((a, b) => a.n - b.n);
    return list;
  }, [deadlines]);

  useEffect(() => {
    if (isLoading) return;
    if (urgent.length === 0) return;
    try {
      const last = localStorage.getItem(STORAGE_KEY);
      if (last === todayStr()) return; // already dismissed today
    } catch {
      /* noop */
    }
    setOpen(true);
  }, [isLoading, urgent.length]);

  const dismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, todayStr());
    } catch {
      /* noop */
    }
    setOpen(false);
  };

  if (!open || urgent.length === 0) return null;

  const overdueCount = urgent.filter((u) => u.n < 0).length;
  const dueSoonCount = urgent.length - overdueCount;
  const most = urgent[0].row;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden">
        <div className="bg-gradient-to-r from-red-500 to-red-600 text-white px-5 py-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center">
            <AlarmClock className="w-5 h-5 animate-pulse" />
          </div>
          <div className="flex-1">
            <p className="text-[10px] uppercase tracking-wider opacity-80">Daily reminder</p>
            <h2 className="text-base font-semibold">Utility bills need attention</h2>
          </div>
          <button onClick={dismiss} className="p-1 rounded hover:bg-white/15">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {overdueCount > 0 && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2">
                <div className="flex items-center gap-1.5 text-red-700">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <p className="text-[10px] uppercase tracking-wider font-semibold">Overdue</p>
                </div>
                <p className="mt-1 text-xl font-bold text-red-700">{overdueCount}</p>
              </div>
            )}
            {dueSoonCount > 0 && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
                <div className="flex items-center gap-1.5 text-amber-700">
                  <Clock className="w-3.5 h-3.5" />
                  <p className="text-[10px] uppercase tracking-wider font-semibold">Due ≤ 3 days</p>
                </div>
                <p className="mt-1 text-xl font-bold text-amber-700">{dueSoonCount}</p>
              </div>
            )}
          </div>
          <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Most urgent</p>
            <p className="mt-0.5 text-sm font-medium text-slate-900 truncate">{most.name}</p>
            <p className="text-xs text-slate-600">{relativeDue(most.due_date)}</p>
          </div>
          <button
            onClick={dismiss}
            className="w-full text-sm font-medium px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700"
          >
            Got it — I'll handle these today
          </button>
        </div>
      </div>
    </div>
  );
}
