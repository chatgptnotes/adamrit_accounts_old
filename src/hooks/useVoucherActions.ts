import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Tally's two alteration actions on a voucher, shared by the Voucher Entry
 * screen and the report key bars (Day Book's `X: Cancel Vch` / `D: Delete`).
 *
 * Cancel is soft — the voucher keeps its number but stops affecting reports.
 * Delete is hard. Both stamp `last_modified_by` first so the database trigger
 * records who did it in `voucher_edit_log`.
 */
export function useVoucherActions(): {
  cancelVoucher: (id: string, number: string) => Promise<boolean>;
  deleteVoucher: (id: string, number: string) => Promise<boolean>;
  busy: boolean;
} {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const username = user?.username || user?.email || 'system';
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['vouchers'] });
    queryClient.invalidateQueries({ queryKey: ['daybook_vouchers'] });
  }, [queryClient]);

  const cancelVoucher = useCallback(
    async (id: string, number: string): Promise<boolean> => {
      if (!window.confirm(`Cancel voucher ${number}? It will stop affecting all reports.`)) return false;
      setBusy(true);
      try {
        const { error } = await supabase
          .from('vouchers')
          .update({ status: 'CANCELLED', last_modified_by: username })
          .eq('id', id);
        if (error) throw error;
        toast.info(`Voucher ${number} cancelled`);
        refresh();
        return true;
      } catch (err) {
        console.error('Cancel failed:', err);
        toast.error('Failed to cancel — please try again');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [refresh, username],
  );

  const deleteVoucher = useCallback(
    async (id: string, number: string): Promise<boolean> => {
      if (!window.confirm(`Permanently DELETE voucher ${number} and its entries? This cannot be undone.`)) return false;
      setBusy(true);
      try {
        // Stamp who is deleting so the edit-log trigger records it
        await supabase.from('vouchers').update({ last_modified_by: username }).eq('id', id);
        const { error: eErr } = await supabase.from('voucher_entries').delete().eq('voucher_id', id);
        if (eErr) throw eErr;
        const { error: vErr } = await supabase.from('vouchers').delete().eq('id', id);
        if (vErr) throw vErr;
        toast.info(`Voucher ${number} deleted`);
        refresh();
        return true;
      } catch (err) {
        console.error('Delete failed:', err);
        toast.error('Failed to delete — it may be referenced elsewhere');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [refresh, username],
  );

  return { cancelVoucher, deleteVoucher, busy };
}
