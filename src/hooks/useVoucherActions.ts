import React, { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import TallyConfirm from '@/components/accounting/tally/TallyConfirm';

/**
 * Tally's two alteration actions on a voucher, shared by the Voucher Entry
 * screen and the report key bars (Day Book's `Alt+X: Cancel Vch` / `Alt+D:
 * Delete`).
 *
 * Cancel is soft — the voucher keeps its number but stops affecting reports.
 * Delete is hard. Both stamp `last_modified_by` first so the database trigger
 * records who did it in `voucher_edit_log`.
 *
 * Both ask first, in Tally's own confirmation box. Callers must render
 * `confirmUI` for the question to appear — without it nothing is ever
 * destroyed, which is the safe way round.
 */
export function useVoucherActions(): {
  cancelVoucher: (id: string, number: string) => Promise<boolean>;
  deleteVoucher: (id: string, number: string) => Promise<boolean>;
  busy: boolean;
  confirmUI: React.ReactNode;
} {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const username = user?.username || user?.email || 'system';
  const [busy, setBusy] = useState(false);
  const [question, setQuestion] = useState<{ title: string; message: string } | null>(null);
  const answer = useRef<((yes: boolean) => void) | null>(null);

  /** Put the question on screen and wait for Y / N. */
  const ask = useCallback(
    (title: string, message: string): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        answer.current = resolve;
        setQuestion({ title, message });
      }),
    [],
  );

  const settle = useCallback((yes: boolean) => {
    setQuestion(null);
    answer.current?.(yes);
    answer.current = null;
  }, []);

  const confirmUI = question
    ? React.createElement(TallyConfirm, {
        title: question.title,
        message: question.message,
        onAccept: () => settle(true),
        onClose: () => settle(false),
      })
    : null;

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['vouchers'] });
    queryClient.invalidateQueries({ queryKey: ['daybook_vouchers'] });
  }, [queryClient]);

  const cancelVoucher = useCallback(
    async (id: string, number: string): Promise<boolean> => {
      if (!(await ask('Cancel Voucher?', `${number} will keep its number but stop affecting all reports.`)))
        return false;
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
    [ask, refresh, username],
  );

  const deleteVoucher = useCallback(
    async (id: string, number: string): Promise<boolean> => {
      if (!(await ask('Delete Voucher?', `${number} and its entries go for good. This cannot be undone.`)))
        return false;
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
    [ask, refresh, username],
  );

  return { cancelVoucher, deleteVoucher, busy, confirmUI };
}
