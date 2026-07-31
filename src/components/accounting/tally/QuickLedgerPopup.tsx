import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { TallyChoiceField, TallyPopup, TallyTextField } from './TallyPopup';
import { useAccountingCompany } from '../AccountingCompanyContext';
import { accountTypeForGroupChain, insertLedgerAccount, normalizeAccountName } from '@/lib/ledgerMasters';

/**
 * Tally's Alt+C — create the ledger you were typing without leaving the
 * voucher. It asks the two things Tally asks for and nothing else; the rest of
 * the master (mailing address, bank details, opening balance) is filled in
 * later on Masters → Ledger, which writes through the same
 * `insertLedgerAccount` this does.
 */

interface LedgerGroupRow {
  id: string;
  name: string;
  parent_id: string | null;
  group_type: string | null;
}

export const QuickLedgerPopup: React.FC<{
  /** What the user had typed in the ledger field */
  initialName: string;
  onCreated: (account: { id: string; account_name: string; account_code: string }) => void;
  onClose: () => void;
}> = ({ initialName, onCreated, onClose }) => {
  const queryClient = useQueryClient();
  const { selectedCompanyId, companies } = useAccountingCompany();
  const companyName = companies.find((c) => c.id === selectedCompanyId)?.company_name ?? '';
  const [name, setName] = useState(initialName);
  const [groupName, setGroupName] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: groups = [] } = useQuery({
    queryKey: ['ledger_groups'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from('ledger_groups').select('*').order('name');
      if (error) throw error;
      return (data ?? []) as LedgerGroupRow[];
    },
  });

  const groupNames = groups.map((g) => g.name);
  const chosen = groups.find((g) => g.name === (groupName || groupNames[0]));

  /** The group and every group above it — how the account type is derived. */
  const chain = (): string[] => {
    const out: string[] = [];
    let node = chosen;
    const byId = new Map(groups.map((g) => [g.id, g]));
    while (node && out.length < 12) {
      out.push(node.name);
      node = node.parent_id ? byId.get(node.parent_id) : undefined;
    }
    return out;
  };

  const accept = async (): Promise<void> => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('Enter the ledger name');
      return;
    }
    if (!selectedCompanyId) {
      toast.error('Select a company first (F3)');
      return;
    }
    if (!chosen) {
      toast.error('Select the group (Under)');
      return;
    }
    const derived = accountTypeForGroupChain(chain());
    if (!derived?.type) {
      toast.error(`Cannot tell what kind of account "${chosen.name}" is — create this one under Masters`);
      return;
    }
    // account_name is not unique in the database and a duplicate does not
    // error: it collapses into one line on the Trial Balance and shows twice in
    // the voucher picker. Refuse it here, as the master screen does.
    const { data: existing } = await (supabase as any)
      .from('chart_of_accounts')
      .select('account_name')
      .eq('company_id', selectedCompanyId)
      .eq('is_active', true);
    const clash = (existing ?? []).find(
      (a: { account_name: string }) => normalizeAccountName(a.account_name) === normalizeAccountName(trimmed),
    );
    if (clash) {
      toast.error(`"${clash.account_name}" already exists — pick it from the list instead`);
      return;
    }

    setSaving(true);
    try {
      const created = await insertLedgerAccount(supabase as any, {
        companyId: selectedCompanyId,
        name: trimmed,
        accountType: derived.type,
        groupName: chosen.name,
        ledgerGroupId: chosen.id,
      });
      toast.success(`Ledger "${trimmed}" created in ${companyName}`);
      queryClient.invalidateQueries();
      onCreated(created);
    } catch (err: unknown) {
      console.error('Quick ledger creation failed:', err);
      toast.error('Failed to create the ledger — try Masters → Ledger');
    } finally {
      setSaving(false);
    }
  };

  return (
    <TallyPopup title="Ledger Creation" width={340} onAccept={saving ? undefined : accept} onClose={onClose}>
      <TallyTextField label="Name" value={name} onChange={setName} width={190} labelWidth={70} />
      <TallyChoiceField
        label="Under"
        value={groupName || groupNames[0] || ''}
        options={groupNames}
        onChange={setGroupName}
        width={190}
        labelWidth={70}
      />
      <div className="pt-2 text-center text-[11px] italic text-gray-500">
        A: Accept · Q: Quit — the rest of the master is on Masters → Ledger
      </div>
    </TallyPopup>
  );
};

export default QuickLedgerPopup;
