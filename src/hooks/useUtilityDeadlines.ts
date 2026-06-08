// Utility-bills CRUD + recurring auto-create for the Open Dashboard.
// Scoped to the logged-in hospital_type so Hope and Ayushman see separate lists.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { dispatchFlowEvent } from '@/lib/flowDispatcher';

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
        void dispatchFlowEvent('bill_added', {
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
      void dispatchFlowEvent('deadline_paid', {
        hospitalType,
        entityId: bill.id,
        meta: { name: bill.name, amount: bill.amount, due_date: bill.due_date },
      });
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
