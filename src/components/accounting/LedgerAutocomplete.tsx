import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useDebounce } from 'use-debounce';
import { Check, Loader2, Search, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface LedgerAccountOption {
  id: string;
  account_code: string | null;
  account_name: string;
  account_group: string | null;
  company_id: string | null;
}

/** One ledger by id, so an existing mapping can be shown without a search. */
export function useLedgerAccount(accountId: string | null | undefined) {
  return useQuery({
    queryKey: ['ledger-account', accountId],
    enabled: Boolean(accountId),
    queryFn: async (): Promise<LedgerAccountOption | null> => {
      const { data, error } = await (supabase as any)
        .from('chart_of_accounts')
        .select('id, account_code, account_name, account_group, company_id')
        .eq('id', accountId)
        .maybeSingle();
      if (error) throw error;
      return (data as LedgerAccountOption) || null;
    },
  });
}

/**
 * Type-to-search over the chart of accounts. Like the tablet LedgerPicker, it
 * offers no way to type a free name — what is picked here becomes the account
 * an entry posts to, so it has to already exist.
 */
export function LedgerAutocomplete({
  value,
  onChange,
  companyId,
  placeholder = 'Search the chart of ledgers...',
  autoFocus,
}: {
  value: LedgerAccountOption | null;
  onChange: (ledger: LedgerAccountOption | null) => void;
  companyId?: string | null;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [debounced] = useDebounce(search, 250);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickAway = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickAway);
    return () => document.removeEventListener('mousedown', onClickAway);
  }, [open]);

  const { data: options = [], isLoading } = useQuery({
    queryKey: ['ledger-autocomplete', debounced, companyId || 'all'],
    enabled: debounced.trim().length >= 1,
    queryFn: async (): Promise<LedgerAccountOption[]> => {
      // Searchable by code as well as name: a ledger is usually known by its
      // code to the people who post to it, and the code is the faster way in
      // when several ledgers share most of a name.
      const term = debounced.trim().replace(/[,()]/g, ' ');
      let query = (supabase as any)
        .from('chart_of_accounts')
        .select('id, account_code, account_name, account_group, company_id')
        .eq('is_active', true)
        .or(`account_name.ilike.%${term}%,account_code.ilike.%${term}%`)
        .order('account_name')
        .limit(20);
      if (companyId) query = query.or(`company_id.eq.${companyId},company_id.is.null`);
      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as LedgerAccountOption[];
    },
  });

  if (value && !open) {
    return (
      <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-sm">
          {value.account_name}
          {value.account_code ? (
            <span className="ml-2 text-xs text-muted-foreground">{value.account_code}</span>
          ) : null}
        </span>
        <button
          type="button"
          className="text-xs font-medium text-primary hover:underline"
          onClick={() => {
            setOpen(true);
            setSearch('');
          }}
        >
          Change
        </button>
        <button
          type="button"
          aria-label="Clear ledger"
          className="rounded p-1 text-muted-foreground hover:bg-muted"
          onClick={() => onChange(null)}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div ref={boxRef} className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        autoFocus={autoFocus || open}
        value={search}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setSearch(e.target.value);
          setOpen(true);
        }}
        placeholder={placeholder}
        className="pl-9"
      />
      {open && search.trim().length >= 1 && (
        <div className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-popover shadow-md">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 p-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Searching
            </div>
          ) : options.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">
              No matching ledger. Create it in the chart of accounts first.
            </p>
          ) : (
            options.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  onChange(option);
                  setOpen(false);
                  setSearch('');
                }}
                className={cn(
                  'flex w-full items-start gap-2 border-b px-3 py-2 text-left last:border-b-0 hover:bg-muted',
                  value?.id === option.id && 'bg-muted',
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{option.account_name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[option.account_code, option.account_group].filter(Boolean).join(' · ')}
                  </span>
                </span>
                {value?.id === option.id && <Check className="mt-0.5 h-4 w-4 shrink-0" />}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
