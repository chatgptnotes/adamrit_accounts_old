// Utility-bills CRUD + recurring auto-create for the Open Dashboard.
// Scoped to the logged-in hospital_type so Hope and Ayushman see separate lists.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { dispatchFlowEventWithToasts } from '@/lib/flowDispatcher';
import { notifyUtilitySlack } from '@/lib/notifySlack';

export type UtilityBillType =
  | 'wifi'
  | 'landline'
  | 'electricity'
  | 'airtel_postpaid'
  | 'electricity_ayushman'
  | 'orange_internet'
  | 'hope_landline'
  | 'backup_orange'
  | 'ayushman_landline_bsnl'
  | 'maintenance_shrivardhan'
  | 'hostel_automative_square'
  | 'hostel_mohan_nagar'
  | 'other';

export type UtilityStatus = 'pending' | 'paid';

export interface UtilityDeadline {
  id: string;
  hospital_type: string | null;
  name: string;
  bill_type: UtilityBillType;
  amount: number;
  due_date: string;
  status: UtilityStatus;
  recurring: boolean;
  notes: string | null;
  attachment_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpsertUtilityDeadline {
  id?: string;
  name: string;
  bill_type: UtilityBillType;
  amount: number;
  due_date: string;
  recurring: boolean;
  notes?: string | null;
  attachment_url?: string | null;
  // Optional exact-time reminder (ISO timestamp). When set, the
  // fire-due-reminders cron posts a one-off Slack alert at this time.
  notify_at?: string | null;
}

const TABLE = 'utility_deadlines';
const qk = (hospital: string | null) => ['utility-deadlines', hospital] as const;

// Advance one month, clamping to the new month's last day (Jan 31 → Feb 28/29).
export function addOneMonth(due: string): string {
  const [y, m, d] = due.split('-').map(Number);
  if (!y || !m || !d) return due;
  const date = new Date(Date.UTC(y, m, 0));
  const lastDayOfNext = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDayOfNext);
  const nextMonth = new Date(Date.UTC(y, m, day));
  return nextMonth.toISOString().slice(0, 10);
  void date; // keep variable for readability
}

// ── Slack notification (dev-only relay) ─────────────────────────────
// Builds the "Payment Status" digest and POSTs it to same-origin /slack-proxy,
// which the Vite dev server forwards to SLACK_WEBHOOK_URL (see vite.config.ts).
// Window = due_date within ±3 days of today; paid = updated within last 3 days.
// Empty sections are omitted; returns null (nothing sent) if all three are empty.
const SLACK_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const slackDate = (d: string): string => {
  const [y, m, day] = d.split('-').map(Number);
  if (!y || !m || !day) return d;
  return `${String(day).padStart(2, '0')} ${SLACK_MONTHS[m - 1]} ${y}`;
};
const slackInr = (n: number): string =>
  '₹' + new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n || 0);
const slackNow = (): string => {
  const d = new Date();
  const h = d.getHours();
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'pm' : 'am';
  const h12 = ((h + 11) % 12) + 1;
  return `${slackDate(d.toISOString().slice(0, 10))}, ${h12}:${mm} ${ampm}`;
};
const slackDaysUntil = (due: string): number => {
  const [y, m, d] = due.split('-').map(Number);
  const t = new Date();
  return Math.round(
    (Date.UTC(y, (m ?? 1) - 1, d ?? 1) - Date.UTC(t.getFullYear(), t.getMonth(), t.getDate())) / 86_400_000,
  );
};

export function buildUtilitySlackSummary(
  deadlines: UtilityDeadline[],
  hospitalType: string | null,
): string | null {
  const overdue: UtilityDeadline[] = [];
  const due: UtilityDeadline[] = [];
  const paid: UtilityDeadline[] = [];
  const now = Date.now();
  for (const d of deadlines) {
    if (d.status === 'paid') {
      const upd = new Date(d.updated_at).getTime();
      if (Number.isFinite(upd) && now - upd <= 3 * 86_400_000) paid.push(d);
      continue;
    }
    const n = slackDaysUntil(d.due_date);
    if (n < 0 && n >= -3) overdue.push(d);
    else if (n >= 0 && n <= 3) due.push(d);
  }
  if (!overdue.length && !due.length && !paid.length) return null;

  const sum = (arr: UtilityDeadline[]) => arr.reduce((s, d) => s + Number(d.amount || 0), 0);
  const lines: string[] = [
    `*Payment Status — ${hospitalType || 'hope'}*`,
    `Updated: ${slackNow()}`,
    '──────────────────────────────',
    '',
  ];
  if (overdue.length) {
    lines.push(`*Overdue (${overdue.length}) — ${slackInr(sum(overdue))}*`);
    for (const d of overdue) lines.push(`• ${d.name} — ${slackInr(Number(d.amount || 0))} — due ${slackDate(d.due_date)}`);
    lines.push('');
  }
  if (due.length) {
    lines.push(`*Due (${due.length}) — ${slackInr(sum(due))}*`);
    for (const d of due) lines.push(`• ${d.name} — ${slackInr(Number(d.amount || 0))} — due ${slackDate(d.due_date)}`);
    lines.push('');
  }
  if (paid.length) {
    lines.push(`*Paid (${paid.length}) — ${slackInr(sum(paid))}*`);
    for (const d of paid) lines.push(`• ${d.name} — ${slackInr(Number(d.amount || 0))}`);
  }
  while (lines[lines.length - 1] === '') lines.pop();
  lines.push('──────────────────────────────', `*Total Outstanding: ${slackInr(sum(overdue) + sum(due))}*`);
  return lines.join('\n');
}

// Instant Slack alert when a bill is scanned in (focused, always fires — unlike
// the windowed digest, a freshly-scanned bill may not be in the ±3-day window).
export async function notifyBillScannedSlack(bill: UtilityDeadline): Promise<void> {
  const msg = [
    `*New bill scanned — ${bill.hospital_type || 'hope'}*`,
    `• ${bill.name} — ${slackInr(Number(bill.amount || 0))} — due ${slackDate(bill.due_date)}`,
    bill.notes ? `_${bill.notes}_` : '',
  ]
    .filter(Boolean)
    .join('\n');
  await notifyUtilitySlack(msg);
}

// Re-exported (imported at the top) so existing importers of this hook module
// keep working, while the flow runtime imports it directly from
// '@/lib/notifySlack' to avoid an import cycle.
export { notifyUtilitySlack };

export function useUtilityDeadlines() {
  const { hospitalType } = useAuth();
  const qc = useQueryClient();

  const list = useQuery({
    queryKey: qk(hospitalType),
    queryFn: async (): Promise<UtilityDeadline[]> => {
      let q = supabase
        .from(TABLE)
        .select('*')
        .order('due_date', { ascending: true })
        .limit(500);
      if (hospitalType) q = q.eq('hospital_type', hospitalType);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as UtilityDeadline[];
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: qk(hospitalType) });

  const createDeadline = useMutation({
    mutationFn: async (input: UpsertUtilityDeadline) => {
      const row: Record<string, unknown> = {
        hospital_type: hospitalType,
        name: input.name,
        bill_type: input.bill_type,
        amount: input.amount,
        due_date: input.due_date,
        status: 'pending',
        recurring: input.recurring,
        notes: input.notes ?? null,
      };
      if (input.attachment_url) row.attachment_url = input.attachment_url;
      if (input.notify_at) row.notify_at = input.notify_at;
      // Returning the row so the dispatcher can use its id as a dedup key.
      const { data, error } = await supabase.from(TABLE).insert(row).select('*').single();
      if (error) throw error;
      return data as UtilityDeadline | null;
    },
    onSuccess: (inserted) => {
      toast.success('Bill added');
      invalidate();
      // Fire the bill_added automation event (Rule 12 logs each fire).
      if (inserted?.id) {
        void dispatchFlowEventWithToasts('bill_added', {
          hospitalType,
          entityId: inserted.id,
          // Lets flows filter by bill_type (e.g. only fire for 'wifi').
          eventData: { billType: inserted.bill_type },
          meta: {
            name: inserted.name,
            bill_type: inserted.bill_type,
            amount: inserted.amount,
            due_date: inserted.due_date,
          },
        });
      }
    },
    onError: (e: unknown) => {
      console.warn('[useUtilityDeadlines] create failed', e);
      const msg = e instanceof Error ? e.message : String(e);
      const looksLikeMissingTable = /relation .*utility_deadlines.* does not exist|schema cache|does not exist/i.test(msg);
      toast.error(
        looksLikeMissingTable
          ? 'utility_deadlines table is missing. Run the migration in Supabase first (see supabase/migrations/20260605130000_create_utility_deadlines.sql).'
          : `Could not add the bill: ${msg}`,
      );
    },
  });

  const updateDeadline = useMutation({
    mutationFn: async (input: UpsertUtilityDeadline & { id: string }) => {
      const patch: Record<string, unknown> = {
        name: input.name,
        bill_type: input.bill_type,
        amount: input.amount,
        due_date: input.due_date,
        recurring: input.recurring,
        notes: input.notes ?? null,
        updated_at: new Date().toISOString(),
      };
      if (input.attachment_url !== undefined) patch.attachment_url = input.attachment_url;
      const { error } = await supabase.from(TABLE).update(patch).eq('id', input.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Bill updated');
      invalidate();
    },
    onError: (e: unknown) => {
      console.warn('[useUtilityDeadlines] update failed', e);
      toast.error('Could not save changes.');
    },
  });

  const deleteDeadline = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from(TABLE).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Bill removed');
      invalidate();
    },
    onError: (e: unknown) => {
      console.warn('[useUtilityDeadlines] delete failed', e);
      toast.error('Could not delete the bill.');
    },
  });

  // Mark a bill paid. If it's recurring, also insert a pending copy for next
  // month so the calendar loop is self-sustaining (history is preserved — the
  // paid row stays).
  const markPaid = useMutation({
    mutationFn: async (bill: UtilityDeadline) => {
      const now = new Date().toISOString();
      const { error: upErr } = await supabase
        .from(TABLE)
        .update({ status: 'paid', updated_at: now })
        .eq('id', bill.id);
      if (upErr) throw upErr;

      if (bill.recurring) {
        const row: Record<string, unknown> = {
          hospital_type: bill.hospital_type ?? null,
          name: bill.name,
          bill_type: bill.bill_type,
          amount: bill.amount,
          due_date: addOneMonth(bill.due_date),
          status: 'pending',
          recurring: true,
          notes: bill.notes,
        };
        // Carry the attachment_url forward only if present, so DBs that lack
        // the column still accept the insert.
        if (bill.attachment_url) row.attachment_url = bill.attachment_url;
        const { error: insErr } = await supabase.from(TABLE).insert(row);
        if (insErr) throw insErr;
      }
      return { recurring: bill.recurring };
    },
    onSuccess: (res, bill) => {
      toast.success(res.recurring ? 'Marked paid — next month created' : 'Marked paid');
      invalidate();
      // Fire deadline_paid for any flow listening on the paid event.
      void dispatchFlowEventWithToasts('deadline_paid', {
        hospitalType,
        entityId: bill.id,
        meta: { name: bill.name, amount: bill.amount, due_date: bill.due_date },
      });
      // Post the current payment-status digest to Slack (dev-only relay). Use the
      // cached list with the just-paid bill flipped to paid so it shows under
      // "Paid" immediately, before the invalidated query refetches.
      const cached = (qc.getQueryData(qk(hospitalType)) as UtilityDeadline[] | undefined) ?? [];
      const nowIso = new Date().toISOString();
      const snapshot = cached.map((d) =>
        d.id === bill.id ? { ...d, status: 'paid' as const, updated_at: nowIso } : d,
      );
      const summary = buildUtilitySlackSummary(snapshot, hospitalType);
      if (summary) void notifyUtilitySlack(summary);
    },
    onError: (e: unknown) => {
      console.warn('[useUtilityDeadlines] markPaid failed', e);
      toast.error('Could not mark the bill as paid.');
    },
  });

  return {
    deadlines: list.data ?? [],
    isLoading: list.isLoading,
    error: list.error,
    createDeadline: createDeadline.mutateAsync,
    updateDeadline: updateDeadline.mutateAsync,
    deleteDeadline: deleteDeadline.mutateAsync,
    markPaid: markPaid.mutateAsync,
    isSaving:
      createDeadline.isPending ||
      updateDeadline.isPending ||
      deleteDeadline.isPending ||
      markPaid.isPending,
  };
}
