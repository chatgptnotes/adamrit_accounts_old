import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { LedgerSearchField } from '@/components/LedgerSearchField';

// Maps a consultant or surgeon to their accounting ledger, from the doctor's
// own master.
//
// Unlike the RMO masters, hope_consultants / ayushman_consultants and the
// three surgeon masters carry no ledger column. Their mapping lives in
// doctor_ledger_map, keyed by the doctor's NAME, and that is the table the
// posting code actually reads — the Rupali register resolves a doctor's
// payable ledger from it, and the OT feed bills surgeons through it. Adding a
// column to each master instead would create a second mapping that nothing
// posts against.
//
// So this field writes straight to doctor_ledger_map when a ledger is picked,
// rather than travelling through the master's own save. The dialog's Update
// button does not need to be pressed for the mapping to stick, and the
// mapping survives an edit that is later cancelled.

interface Mapping {
  id: string;
  party_account_id: string;
}

/** The ledger a doctor is mapped to today, or null. Matched case-insensitively. */
function useDoctorLedger(doctorName: string) {
  return useQuery({
    queryKey: ['doctor-ledger-map', doctorName.trim().toLowerCase()],
    enabled: Boolean(doctorName.trim()),
    queryFn: async (): Promise<Mapping | null> => {
      const { data, error } = await (supabase as any)
        .from('doctor_ledger_map')
        .select('id, party_account_id')
        .ilike('surgeon_name', doctorName.trim())
        .maybeSingle();
      if (error) throw error;
      return (data as Mapping) ?? null;
    },
  });
}

export function DoctorLedgerField({ doctorName }: { doctorName: string }) {
  const queryClient = useQueryClient();
  const name = doctorName.trim();
  const { data: mapping, isLoading } = useDoctorLedger(name);

  if (!name) {
    return (
      <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
        Enter the name and save first — then reopen this doctor to map the ledger.
      </p>
    );
  }

  const save = async (accountId: string) => {
    try {
      if (!accountId) {
        if (mapping) {
          const { error } = await (supabase as any)
            .from('doctor_ledger_map')
            .delete()
            .eq('id', mapping.id);
          if (error) throw new Error(error.message);
          toast.success(`Ledger unmapped for ${name}.`);
        }
      } else {
        // doctor_ledger_map.company_id is NOT NULL, and the only company that
        // cannot disagree with the ledger is the ledger's own.
        const { data: ledger, error: ledgerError } = await (supabase as any)
          .from('chart_of_accounts')
          .select('company_id, account_name')
          .eq('id', accountId)
          .maybeSingle();
        if (ledgerError) throw new Error(ledgerError.message);
        if (!ledger?.company_id) {
          throw new Error('That ledger belongs to no company — pick one that does.');
        }

        // The unique index is on lower(surgeon_name), an expression, so
        // upsert(onConflict) cannot target it. Look up first, then write.
        const write = mapping
          ? (supabase as any)
              .from('doctor_ledger_map')
              .update({
                party_account_id: accountId,
                company_id: ledger.company_id,
                updated_at: new Date().toISOString(),
              })
              .eq('id', mapping.id)
          : (supabase as any).from('doctor_ledger_map').insert({
              surgeon_name: name,
              party_account_id: accountId,
              company_id: ledger.company_id,
            });
        const { error } = await write;
        if (error) throw new Error(error.message);
        toast.success(`${name} mapped to ${ledger.account_name}.`);
      }
      await queryClient.invalidateQueries({ queryKey: ['doctor-ledger-map', name.toLowerCase()] });
    } catch (err: any) {
      toast.error(err?.message || 'Could not save the ledger mapping');
    }
  };

  return (
    <div className="space-y-1">
      <LedgerSearchField value={mapping?.party_account_id || ''} onChange={(id) => void save(id)} />
      <p className="text-xs text-muted-foreground">
        {isLoading
          ? 'Checking the current mapping…'
          : mapping
            ? 'Saved. Payments to this doctor post to this ledger.'
            : 'Not mapped yet — visits and OT bills cannot be paid until one is picked.'}
      </p>
    </div>
  );
}

/** The AddItemDialog field entry, so every doctor master declares it the same way. */
export const doctorLedgerFormField = (doctorName: string) => ({
  key: 'ledger_account_id',
  label: 'Accounting Ledger (search — saves as soon as you pick)',
  type: 'custom' as const,
  render: () => <DoctorLedgerField doctorName={doctorName} />,
});

export default DoctorLedgerField;
