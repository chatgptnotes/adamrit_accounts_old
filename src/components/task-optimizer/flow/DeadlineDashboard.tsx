// Open Dashboard — utility-bill deadline tracker.
// Self-contained: reads/writes only `utility_deadlines`. See
// OPEN_DASHBOARD_DOCUMENTATION.md (sections 4–8) for the full spec.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlarmClock,
  ArrowLeft,
  Pencil,
  Plus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Clock,
  CalendarClock,
  Search,
  Loader2,
  IndianRupee,
  Paperclip,
  X,
  Wifi,
  Phone,
  Zap,
  Smartphone,
  Router as RouterIcon,
  Wrench,
  Building2,
  Home,
  FileText,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import {
  useUtilityDeadlines,
  type UtilityBillType,
  type UtilityDeadline,
} from '@/hooks/useUtilityDeadlines';
import { useAuth } from '@/contexts/AuthContext';
import { dispatchFlowEvent } from '@/lib/flowDispatcher';
import DeadlineNotificationBell from './DeadlineNotificationBell';

// ── Bill types catalogue (§3) ───────────────────────────────────────
interface BillTypeMeta {
  value: UtilityBillType;
  label: string;
  Icon: typeof Wifi;
  tint: string; // tinted square bg + text
  accent: string; // left accent bar for the list row
}

const BILL_TYPES: BillTypeMeta[] = [
  { value: 'wifi', label: 'Wi-Fi / Internet', Icon: Wifi, tint: 'bg-sky-100 text-sky-700', accent: 'bg-sky-400' },
  { value: 'landline', label: 'Landline', Icon: Phone, tint: 'bg-violet-100 text-violet-700', accent: 'bg-violet-400' },
  { value: 'electricity', label: 'Electricity Bill Hope Hospital', Icon: Zap, tint: 'bg-amber-100 text-amber-700', accent: 'bg-amber-400' },
  { value: 'airtel_postpaid', label: 'Airtel Postpaid Bill', Icon: Smartphone, tint: 'bg-red-100 text-red-700', accent: 'bg-red-400' },
  { value: 'electricity_ayushman', label: 'Electricity Bill Ayushman', Icon: Zap, tint: 'bg-amber-100 text-amber-700', accent: 'bg-amber-400' },
  { value: 'orange_internet', label: 'Orange Internet', Icon: Wifi, tint: 'bg-orange-100 text-orange-700', accent: 'bg-orange-400' },
  { value: 'hope_landline', label: 'Hope Landline', Icon: Phone, tint: 'bg-violet-100 text-violet-700', accent: 'bg-violet-400' },
  { value: 'backup_orange', label: 'Backup Orange Connection', Icon: RouterIcon, tint: 'bg-orange-100 text-orange-700', accent: 'bg-orange-400' },
  { value: 'ayushman_landline_bsnl', label: 'Ayushman Landline BSNL', Icon: Phone, tint: 'bg-teal-100 text-teal-700', accent: 'bg-teal-400' },
  { value: 'maintenance_shrivardhan', label: 'Maintainance For Shrivardhan', Icon: Wrench, tint: 'bg-slate-100 text-slate-700', accent: 'bg-slate-400' },
  { value: 'hostel_automative_square', label: 'Girls Hostel (Automative Square)', Icon: Building2, tint: 'bg-pink-100 text-pink-700', accent: 'bg-pink-400' },
  { value: 'hostel_mohan_nagar', label: 'Girls Hostel (Mohan Nagar)', Icon: Home, tint: 'bg-pink-100 text-pink-700', accent: 'bg-pink-400' },
  { value: 'other', label: 'Other', Icon: FileText, tint: 'bg-slate-100 text-slate-700', accent: 'bg-slate-400' },
];

const BILL_TYPE_BY_VALUE = new Map<UtilityBillType, BillTypeMeta>(
  BILL_TYPES.map((b) => [b.value, b]),
);
const billMeta = (t: UtilityBillType): BillTypeMeta =>
  BILL_TYPE_BY_VALUE.get(t) ?? BILL_TYPES[BILL_TYPES.length - 1];

// ── Status helpers (§4, §7) ─────────────────────────────────────────
type DerivedStatus = 'paid' | 'overdue' | 'due_soon' | 'upcoming';

const todayStr = (): string => {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const daysUntil = (due: string, today: string = todayStr()): number => {
  const [y1, m1, d1] = due.split('-').map(Number);
  const [y2, m2, d2] = today.split('-').map(Number);
  const a = Date.UTC(y1, (m1 ?? 1) - 1, d1 ?? 1);
  const b = Date.UTC(y2, (m2 ?? 1) - 1, d2 ?? 1);
  return Math.round((a - b) / 86400000);
};

const deriveStatus = (row: UtilityDeadline, today: string = todayStr()): DerivedStatus => {
  if (row.status === 'paid') return 'paid';
  const n = daysUntil(row.due_date, today);
  if (n < 0) return 'overdue';
  if (n <= 7) return 'due_soon';
  return 'upcoming';
};

const relativeDue = (due: string, today: string = todayStr()): string => {
  const n = daysUntil(due, today);
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

const prettyDate = (d: string): string => {
  const [y, m, day] = d.split('-').map(Number);
  if (!y || !m || !day) return d;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${String(day).padStart(2, '0')} ${months[m - 1]} ${y}`;
};

const STATUS_META: Record<
  DerivedStatus,
  { label: string; badge: string; ring: string; accent: string; Icon: typeof CheckCircle2 }
> = {
  paid: {
    label: 'Paid',
    badge: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    ring: 'ring-emerald-300',
    accent: 'bg-emerald-400',
    Icon: CheckCircle2,
  },
  overdue: {
    label: 'Overdue',
    badge: 'bg-red-100 text-red-700 border-red-200',
    ring: 'ring-red-300',
    accent: 'bg-red-500',
    Icon: AlertTriangle,
  },
  due_soon: {
    label: 'Due soon',
    badge: 'bg-amber-100 text-amber-700 border-amber-200',
    ring: 'ring-amber-300',
    accent: 'bg-amber-400',
    Icon: Clock,
  },
  upcoming: {
    label: 'Upcoming',
    badge: 'bg-slate-100 text-slate-600 border-slate-200',
    ring: 'ring-slate-300',
    accent: 'bg-slate-300',
    Icon: CalendarClock,
  },
};

type Filter = 'all' | DerivedStatus;

// ── Form state ──────────────────────────────────────────────────────
interface FormState {
  id: string | null;
  name: string;
  bill_type: UtilityBillType;
  amount: string;
  due_date: string;
  notes: string;
  attachment_url: string | null;
  recurring: boolean;
}

const emptyForm = (): FormState => ({
  id: null,
  name: '',
  bill_type: 'electricity',
  amount: '',
  due_date: '',
  notes: '',
  attachment_url: null,
  recurring: true,
});

// ── Component ───────────────────────────────────────────────────────
interface Props {
  onBack?: () => void;
}

export default function DeadlineDashboard({ onBack }: Props) {
  const {
    deadlines,
    isLoading,
    error,
    createDeadline,
    updateDeadline,
    deleteDeadline,
    markPaid,
    isSaving,
  } = useUtilityDeadlines();

  const [form, setForm] = useState<FormState>(emptyForm());
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [uploading, setUploading] = useState(false);
  const [today, setToday] = useState(todayStr());
  const formCardRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Re-derive status at local midnight rollover so "Due today" → "1 day overdue"
  // updates without a refresh.
  useEffect(() => {
    const id = setInterval(() => setToday(todayStr()), 60_000);
    return () => clearInterval(id);
  }, []);

  // ── Derived counts / totals ──────────────────────────────────────
  const derived = useMemo(
    () =>
      deadlines.map((d) => ({
        row: d,
        status: deriveStatus(d, today),
      })),
    [deadlines, today],
  );

  const counts = useMemo(() => {
    const c = { overdue: 0, due_soon: 0, paid: 0, upcoming: 0, total: deadlines.length };
    for (const d of derived) {
      if (d.status === 'overdue') c.overdue++;
      else if (d.status === 'due_soon') c.due_soon++;
      else if (d.status === 'paid') c.paid++;
      else c.upcoming++;
    }
    return c;
  }, [derived, deadlines.length]);

  const outstanding = useMemo(
    () => deadlines.filter((d) => d.status !== 'paid').reduce((s, d) => s + Number(d.amount || 0), 0),
    [deadlines],
  );

  // ── Automation event emission for due / overdue bills ────────────────
  // Whenever the bills list changes (load, mutation, midnight rollover), scan
  // for rows that are overdue or due-soon and dispatch the matching event.
  // The dispatcher dedups per-(bill, event, day, tab) so this effect can run
  // freely without producing duplicate notifications. Skips paid bills.
  const { hospitalType } = useAuth();
  useEffect(() => {
    if (isLoading || deadlines.length === 0) return;
    for (const { row, status } of derived) {
      if (status === 'paid') continue;
      const eventType = status === 'overdue' ? 'deadline_overdue' : status === 'due_soon' ? 'deadline_due' : null;
      if (!eventType) continue;
      const days = daysUntil(row.due_date, today);
      void dispatchFlowEvent(eventType, {
        hospitalType,
        entityId: row.id,
        // Rule 17 — pass the bill's creation timestamp so a freshly-saved
        // automation doesn't retroactively fire for bills that already existed.
        entityCreatedAt: row.created_at,
        // Lets deadline_due flows gate on cfg.withinDays (e.g. "1 day before").
        eventData: { billType: row.bill_type, daysUntilDue: days },
        meta: { name: row.name, amount: row.amount, due_date: row.due_date, days_until: days },
      });
    }
  }, [derived, hospitalType, isLoading, deadlines.length]);

  // ── Filter + search ──────────────────────────────────────────────
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return derived.filter(({ row, status }) => {
      if (filter !== 'all' && status !== filter) return false;
      if (!term) return true;
      const meta = billMeta(row.bill_type);
      const hay = `${row.name} ${row.notes ?? ''} ${meta.label}`.toLowerCase();
      return hay.includes(term);
    });
  }, [derived, filter, search]);

  // ── Form handlers ────────────────────────────────────────────────
  const isEditing = form.id !== null;
  const canSave =
    form.name.trim().length > 0 &&
    form.due_date.length > 0 &&
    form.amount.trim().length > 0 &&
    Number(form.amount) >= 0;

  const startEdit = (d: UtilityDeadline) => {
    setForm({
      id: d.id,
      name: d.name,
      bill_type: d.bill_type,
      amount: String(d.amount ?? ''),
      due_date: d.due_date,
      notes: d.notes ?? '',
      attachment_url: d.attachment_url ?? null,
      recurring: d.recurring,
    });
    formCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const cancelEdit = () => setForm(emptyForm());

  const onSubmit = async () => {
    if (!canSave) return;
    const payload = {
      name: form.name.trim(),
      bill_type: form.bill_type,
      amount: Number(form.amount),
      due_date: form.due_date,
      recurring: form.recurring,
      notes: form.notes.trim() || null,
      attachment_url: form.attachment_url,
    };
    try {
      if (form.id) await updateDeadline({ id: form.id, ...payload });
      else await createDeadline(payload);
      setForm(emptyForm());
    } catch {
      /* hook already toasted */
    }
  };

  const onUpload = async (file: File) => {
    setUploading(true);
    try {
      const path = `utility-deadlines/${Date.now()}-${file.name.replace(/[^a-z0-9.\-_]/gi, '_')}`;
      const { error: upErr } = await supabase.storage.from('uploads').upload(path, file, {
        upsert: false,
        cacheControl: '3600',
      });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('uploads').getPublicUrl(path);
      setForm((f) => ({ ...f, attachment_url: pub.publicUrl }));
      toast.success('Receipt attached');
    } catch (e: unknown) {
      console.warn('[DeadlineDashboard] upload failed', e);
      toast.error('Could not upload the receipt.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const confirmDelete = async (d: UtilityDeadline) => {
    if (!window.confirm(`Delete this bill? "${d.name}" — this can't be undone.`)) return;
    try {
      await deleteDeadline(d.id);
      if (form.id === d.id) setForm(emptyForm());
    } catch {
      /* hook toasted */
    }
  };

  // Toggle a card filter — re-clicking the active one clears (except "Total bills"
  // which always sets "all").
  const onCardClick = (next: Filter) => {
    setFilter((cur) => (next === 'all' ? 'all' : cur === next ? 'all' : next));
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-slate-50">
      {/* ── 5.1 Hero ── */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white">
        <div className="max-w-6xl mx-auto px-5 py-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-white/10 ring-1 ring-white/15 flex items-center justify-center shrink-0">
            <AlarmClock className="w-5 h-5 text-amber-300" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-semibold leading-tight">Deadline Tracking</h1>
            <p className="text-xs text-slate-300 mt-0.5">
              Never miss a utility bill — avoid penalties and disconnection.
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[10px] uppercase tracking-wider text-slate-300">Outstanding</p>
            <p className="text-lg font-bold tabular-nums">{inr(outstanding)}</p>
          </div>
          <DeadlineNotificationBell variant="dark" autoPopup />
          {onBack && (
            <button
              onClick={onBack}
              className="ml-1 flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/15 ring-1 ring-white/15"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back
            </button>
          )}
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-5 pb-10 pt-5 space-y-5">
        {/* ── 5.2 Summary cards ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <SummaryCard
            label="Overdue"
            value={counts.overdue}
            tone="red"
            active={filter === 'overdue'}
            onClick={() => onCardClick('overdue')}
          />
          <SummaryCard
            label="Due in 7 days"
            value={counts.due_soon}
            tone="amber"
            active={filter === 'due_soon'}
            onClick={() => onCardClick('due_soon')}
          />
          <SummaryCard
            label="Paid"
            value={counts.paid}
            tone="emerald"
            active={filter === 'paid'}
            onClick={() => onCardClick('paid')}
          />
          <SummaryCard
            label="Total bills"
            value={counts.total}
            tone="slate"
            active={filter === 'all'}
            onClick={() => onCardClick('all')}
          />
        </div>

        {/* ── 5.3 Add / Edit form ── */}
        <div
          ref={formCardRef}
          className={`rounded-xl border bg-white p-4 shadow-sm transition-all ${
            isEditing ? 'border-blue-300 ring-2 ring-blue-200' : 'border-slate-200'
          }`}
        >
          <div className="flex items-center gap-2 mb-3">
            {isEditing ? (
              <Pencil className="w-4 h-4 text-blue-600" />
            ) : (
              <Plus className="w-4 h-4 text-blue-600" />
            )}
            <h2 className="text-sm font-semibold text-slate-900">
              {isEditing ? 'Edit bill' : 'Add a new bill'}
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Bill name" required>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Electricity — Main building"
                className="w-full text-sm px-3 py-2 rounded-md border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </Field>

            <Field label="Type">
              <select
                value={form.bill_type}
                onChange={(e) => setForm({ ...form, bill_type: e.target.value as UtilityBillType })}
                className="w-full text-sm px-3 py-2 rounded-md border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {BILL_TYPES.map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Amount (₹)" required>
              <div className="relative">
                <IndianRupee className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  placeholder="0"
                  className="w-full text-sm pl-8 pr-3 py-2 rounded-md border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </Field>

            <Field label="Due date" required>
              <input
                type="date"
                value={form.due_date}
                onChange={(e) => setForm({ ...form, due_date: e.target.value })}
                className="w-full text-sm px-3 py-2 rounded-md border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </Field>

            <Field label="Notes (optional)">
              <input
                type="text"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Account / consumer number…"
                className="w-full text-sm px-3 py-2 rounded-md border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </Field>

            <Field label="Receipt / bill copy (optional)">
              <div className="flex items-center gap-2">
                {form.attachment_url ? (
                  <div className="flex items-center gap-2 text-xs px-2 py-1.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200">
                    <Paperclip className="w-3.5 h-3.5" />
                    <a
                      href={form.attachment_url}
                      target="_blank"
                      rel="noreferrer"
                      className="underline truncate max-w-[160px]"
                    >
                      Attached
                    </a>
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, attachment_url: null })}
                      title="Remove"
                      className="text-emerald-700 hover:text-red-600"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="text-emerald-700 underline ml-1"
                    >
                      Replace
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={uploading}
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50"
                  >
                    {uploading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Paperclip className="w-3.5 h-3.5" />
                    )}
                    {uploading ? 'Uploading…' : 'Attach file'}
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void onUpload(f);
                  }}
                />
              </div>
            </Field>
          </div>

          <label className="mt-3 flex items-center gap-2 text-sm text-slate-700 select-none cursor-pointer">
            <input
              type="checkbox"
              checked={form.recurring}
              onChange={(e) => setForm({ ...form, recurring: e.target.checked })}
              className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            Repeats monthly
            <span className="text-xs text-slate-400">
              (when paid, next month's copy is auto-created)
            </span>
          </label>

          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void onSubmit()}
              disabled={!canSave || isSaving}
              className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {isEditing ? 'Save changes' : 'Add bill'}
            </button>
            {isEditing && (
              <button
                type="button"
                onClick={cancelEdit}
                className="text-sm px-4 py-2 rounded-md border border-slate-200 bg-white hover:bg-slate-50"
              >
                Cancel
              </button>
            )}
          </div>
        </div>

        {/* ── 5.4 Bills list ── */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-900">Bills</h2>
            {filter !== 'all' && (
              <button
                onClick={() => setFilter('all')}
                className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100"
              >
                {STATUS_META[filter].label} <X className="w-3 h-3" />
              </button>
            )}
            {deadlines.length > 0 && (
              <div className="ml-auto relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search bills…"
                  className="text-xs pl-8 pr-2 py-1.5 rounded-md border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 w-56"
                />
              </div>
            )}
          </div>

          <div className="divide-y divide-slate-100">
            {isLoading && (
              <div className="flex items-center gap-2 px-4 py-6 text-sm text-slate-500">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading…
              </div>
            )}
            {!isLoading && error && (
              <div className="px-4 py-6 text-sm text-red-600">
                Could not load bills. The <code className="bg-red-50 px-1 py-0.5 rounded">utility_deadlines</code> table
                may not exist yet — run the migration in Supabase.
              </div>
            )}
            {!isLoading && !error && deadlines.length === 0 && (
              <div className="px-4 py-10 text-center text-sm text-slate-500">
                <p className="font-medium text-slate-700">No bills yet</p>
                <p className="mt-1">Add your first utility bill using the form above.</p>
              </div>
            )}
            {!isLoading && !error && deadlines.length > 0 && visible.length === 0 && (
              <div className="px-4 py-10 text-center text-sm text-slate-500">
                <p>No bills match the current filter.</p>
                <button
                  onClick={() => {
                    setFilter('all');
                    setSearch('');
                  }}
                  className="mt-2 text-xs px-3 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50"
                >
                  Clear filters
                </button>
              </div>
            )}
            {visible.map(({ row, status }) => (
              <BillRow
                key={row.id}
                bill={row}
                status={status}
                today={today}
                onEdit={() => startEdit(row)}
                onDelete={() => void confirmDelete(row)}
                onMarkPaid={() => void markPaid(row).catch(() => {})}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────
function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-wide text-slate-500 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </span>
      {children}
    </label>
  );
}

function SummaryCard({
  label,
  value,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: number;
  tone: 'red' | 'amber' | 'emerald' | 'slate';
  active: boolean;
  onClick: () => void;
}) {
  const toneMap = {
    red: { text: 'text-red-700', value: 'text-red-700', ring: 'ring-red-300', bg: 'bg-red-50' },
    amber: { text: 'text-amber-700', value: 'text-amber-700', ring: 'ring-amber-300', bg: 'bg-amber-50' },
    emerald: { text: 'text-emerald-700', value: 'text-emerald-700', ring: 'ring-emerald-300', bg: 'bg-emerald-50' },
    slate: { text: 'text-slate-700', value: 'text-slate-900', ring: 'ring-slate-300', bg: 'bg-slate-50' },
  } as const;
  const t = toneMap[tone];
  return (
    <button
      aria-pressed={active}
      onClick={onClick}
      className={`text-left rounded-xl border bg-white p-4 shadow-sm transition-all hover:shadow ${
        active ? `ring-2 ${t.ring}` : 'border-slate-200'
      }`}
    >
      <p className={`text-[10px] uppercase tracking-wider ${t.text}`}>{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${t.value}`}>{value}</p>
      <div className={`mt-2 h-1 w-12 rounded-full ${t.bg}`} />
    </button>
  );
}

function BillRow({
  bill,
  status,
  today,
  onEdit,
  onDelete,
  onMarkPaid,
}: {
  bill: UtilityDeadline;
  status: DerivedStatus;
  today: string;
  onEdit: () => void;
  onDelete: () => void;
  onMarkPaid: () => void;
}) {
  const meta = billMeta(bill.bill_type);
  const st = STATUS_META[status];
  const rel = relativeDue(bill.due_date, today);
  const relClass =
    status === 'overdue' ? 'text-red-600 font-medium' : status === 'due_soon' ? 'text-amber-700 font-medium' : 'text-slate-500';
  return (
    <div className="relative group flex items-start gap-3 px-4 py-3 hover:bg-slate-50">
      <span className={`absolute left-0 top-3 bottom-3 w-1 rounded-r ${st.accent}`} />
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${meta.tint}`}>
        <meta.Icon className="w-4 h-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-slate-900 truncate">{bill.name}</p>
          {bill.recurring && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
              monthly
            </span>
          )}
        </div>
        <p className="text-xs text-slate-600 mt-0.5 flex items-center gap-1 flex-wrap">
          <span className="font-semibold text-slate-800">{inr(Number(bill.amount || 0))}</span>
          <span className="text-slate-300">·</span>
          <span>{meta.label}</span>
          <span className="text-slate-300">·</span>
          <span>due {prettyDate(bill.due_date)}</span>
          <span className="text-slate-300">·</span>
          <span className={relClass}>{rel}</span>
          {bill.notes && (
            <>
              <span className="text-slate-300">·</span>
              <span className="text-slate-500 truncate">{bill.notes}</span>
            </>
          )}
          {bill.attachment_url && (
            <>
              <span className="text-slate-300">·</span>
              <a
                href={bill.attachment_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 text-blue-600 hover:underline"
              >
                <Paperclip className="w-3 h-3" /> Receipt
              </a>
            </>
          )}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span
          className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border ${st.badge}`}
        >
          <st.Icon className="w-3 h-3" /> {st.label}
        </span>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {status !== 'paid' && (
            <button
              onClick={onMarkPaid}
              title="Mark as paid"
              className="p-1.5 rounded-md text-emerald-600 hover:bg-emerald-50"
            >
              <CheckCircle2 className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={onEdit}
            title="Edit"
            className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100"
          >
            <Pencil className="w-4 h-4" />
          </button>
          <button
            onClick={onDelete}
            title="Delete"
            className="p-1.5 rounded-md text-slate-500 hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
