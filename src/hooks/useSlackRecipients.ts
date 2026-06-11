// Slack reminder recipients CRUD for the Open Dashboard. Not hospital-scoped —
// the roster is shared across the whole team (a reminder picks one recipient).
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import type { SlackRecipient, SlackRecipientKind } from '@/lib/slackRecipients';

export interface UpsertSlackRecipient {
  id?: string;
  name: string;
  aliases: string[];
  slack_target?: string | null;
  kind: SlackRecipientKind;
  active?: boolean;
  is_director?: boolean;
}

const TABLE = 'slack_recipients';
const qk = ['slack-recipients'] as const;

export function useSlackRecipients() {
  const qc = useQueryClient();

  const list = useQuery({
    queryKey: qk,
    queryFn: async (): Promise<SlackRecipient[]> => {
      const { data, error } = await supabase
        .from(TABLE)
        .select('*')
        .order('name', { ascending: true })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as SlackRecipient[];
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: qk });

  const createRecipient = useMutation({
    mutationFn: async (input: UpsertSlackRecipient) => {
      const row: Record<string, unknown> = {
        name: input.name,
        aliases: input.aliases,
        slack_target: input.slack_target?.trim() || null,
        kind: input.kind,
        active: input.active ?? true,
        is_director: input.is_director ?? false,
      };
      const { data, error } = await supabase.from(TABLE).insert(row).select('*').single();
      if (error) throw error;
      return data as SlackRecipient | null;
    },
    onSuccess: () => {
      toast.success('Recipient added');
      invalidate();
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      const looksLikeMissingTable = /relation .*slack_recipients.* does not exist|schema cache|does not exist/i.test(msg);
      toast.error(
        looksLikeMissingTable
          ? 'slack_recipients table is missing. Run the migration in Supabase first (see supabase/migrations/20260611000000_create_slack_recipients_and_deadline_recipient.sql).'
          : `Could not add the recipient: ${msg}`,
      );
    },
  });

  const updateRecipient = useMutation({
    mutationFn: async (input: UpsertSlackRecipient & { id: string }) => {
      const patch: Record<string, unknown> = {
        name: input.name,
        aliases: input.aliases,
        slack_target: input.slack_target?.trim() || null,
        kind: input.kind,
        active: input.active ?? true,
        is_director: input.is_director ?? false,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from(TABLE).update(patch).eq('id', input.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Recipient updated');
      invalidate();
    },
    onError: (e: unknown) => toast.error(`Could not update: ${e instanceof Error ? e.message : String(e)}`),
  });

  const deleteRecipient = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from(TABLE).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Recipient removed');
      invalidate();
    },
    onError: (e: unknown) => toast.error(`Could not remove: ${e instanceof Error ? e.message : String(e)}`),
  });

  return {
    recipients: list.data ?? [],
    isLoading: list.isLoading,
    error: list.error,
    createRecipient: createRecipient.mutateAsync,
    updateRecipient: updateRecipient.mutateAsync,
    deleteRecipient: deleteRecipient.mutateAsync,
    isSaving: createRecipient.isPending || updateRecipient.isPending || deleteRecipient.isPending,
  };
}
