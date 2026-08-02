import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { fetchActiveAccounts } from '@/lib/fetchAccounts';
import { BeneficiaryBankHint } from '@/components/BeneficiaryBankHint';

// A ledger is picked by searching the chart of accounts — never typed. Used
// by master forms that map a person (RMO, staff) to their accounting ledger.
// Shows the ledger code on every suggestion and, once picked, the bank that
// holds the party as a beneficiary.

interface LedgerOption {
  id: string;
  account_code: string | null;
  account_name: string;
  account_group: string | null;
}

export function useActiveLedgerOptions() {
  return useQuery({
    queryKey: ['ledger-search-options'],
    staleTime: 5 * 60_000,
    queryFn: () =>
      fetchActiveAccounts<LedgerOption>({
        columns: 'id, account_code, account_name, account_group',
      }),
  });
}

/** Compact "name · code" line for a mapped ledger, with the beneficiary bank. */
export function LedgerBadge({ accountId }: { accountId: string }) {
  const { data: ledgers = [] } = useActiveLedgerOptions();
  const ledger = ledgers.find((l) => l.id === accountId);
  if (!ledger) return null;
  return (
    <div className="text-xs">
      <span className="font-medium">{ledger.account_name}</span>
      {ledger.account_code ? (
        <span className="ml-1 text-muted-foreground">· {ledger.account_code}</span>
      ) : null}
      <BeneficiaryBankHint accountId={accountId} />
    </div>
  );
}

export function LedgerSearchField({
  value,
  onChange,
}: {
  /** chart_of_accounts id, or '' when nothing is picked. */
  value: string;
  onChange: (id: string) => void;
}) {
  const { data: ledgers = [], isLoading } = useActiveLedgerOptions();
  const [search, setSearch] = useState('');

  const picked = useMemo(() => ledgers.find((l) => l.id === value) || null, [ledgers, value]);
  const term = search.trim().toLowerCase();
  const hits = term.length >= 2
    ? ledgers
        .filter(
          (l) =>
            l.account_name.toLowerCase().includes(term) ||
            (l.account_code || '').toLowerCase().includes(term),
        )
        .slice(0, 8)
    : [];

  if (picked) {
    return (
      <div className="flex items-start justify-between gap-2 rounded-md border px-3 py-2">
        <LedgerBadge accountId={picked.id} />
        <button
          type="button"
          className="shrink-0 text-muted-foreground hover:text-destructive"
          title="Clear the mapped ledger"
          onClick={() => onChange('')}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={isLoading ? 'Loading ledgers…' : 'Search ledger by name or code…'}
        className="pl-8"
      />
      {hits.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-y-auto rounded-md border bg-background shadow-lg">
          {hits.map((l) => (
            <button
              key={l.id}
              type="button"
              className="block w-full border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted/60"
              onPointerDown={(e) => {
                e.preventDefault();
                onChange(l.id);
                setSearch('');
              }}
            >
              <span className="font-medium">{l.account_name}</span>
              <span className="ml-2 text-xs text-muted-foreground">
                {[l.account_code, l.account_group].filter(Boolean).join(' · ')}
              </span>
            </button>
          ))}
        </div>
      )}
      {term.length >= 2 && hits.length === 0 && !isLoading && (
        <p className="mt-1 text-xs text-amber-700">
          No ledger matches — create it on Ledger Creation first.
        </p>
      )}
    </div>
  );
}
