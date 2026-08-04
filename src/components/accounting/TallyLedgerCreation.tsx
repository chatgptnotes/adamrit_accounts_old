import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { fetchActiveAccounts } from '@/lib/fetchAccounts';
import {
  accountTypeForGroupChain,
  accountTypeFromSiblings,
  insertLedgerAccount,
  isAccountType,
  normalizeAccountName,
  normalizeGroupName,
  type AccountType,
} from '@/lib/ledgerMasters';
import { useAccountingCompany } from './AccountingCompanyContext';
import { GroupSearch, PRIMARY, type LedgerGroup } from './GroupCreation';

/**
 * A ledger master, which is a chart_of_accounts row.
 *
 * This screen used to read and write the `ledgers` table, which no voucher and
 * no report has ever read — a ledger created here saved successfully and was
 * then invisible everywhere else. chart_of_accounts is the master the whole
 * accounting module posts to.
 */
interface LedgerAccount {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  account_group: string | null;
  ledger_group_id: string | null;
  company_id: string | null;
  is_active: boolean | null;
  opening_balance: number | null;
  opening_balance_type: string | null;
  created_at: string | null;
  alias: string | null;
  mailing_name: string | null;
  address: string | null;
  state: string | null;
  country: string | null;
  pincode: string | null;
  bank_name: string | null;
  bank_branch: string | null;
  bank_account_number: string | null;
  ifsc_code: string | null;
  pan: string | null;
  gstin: string | null;
  beneficiary_of_bank_account_id: string | null;
  point_of_contact: string | null;
}

const LEDGER_COLUMNS =
  'id, account_code, account_name, account_type, account_group, ledger_group_id, company_id, ' +
  'is_active, opening_balance, opening_balance_type, created_at, alias, mailing_name, address, ' +
  'state, country, pincode, bank_name, bank_branch, bank_account_number, ifsc_code, pan, gstin, ' +
  'beneficiary_of_bank_account_id, point_of_contact';

// A group picked from the chart_of_accounts text rather than from ledger_groups
const COA_GROUP_PREFIX = 'coa:';

/** How many rows the List of Ledgers renders — a company has thousands. */
const LIST_LIMIT = 200;
const RECENT_LIMIT = 25;

const fmtINR = (n: number): string =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n));

const titleOfType = (type: string): string =>
  type.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

/** The opening balance as a signed figure: Dr positive, Cr negative. */
const signedOpening = (account: Pick<LedgerAccount, 'opening_balance' | 'opening_balance_type'>): number => {
  const value = Number(account.opening_balance) || 0;
  return (account.opening_balance_type ?? '').toUpperCase() === 'CR' ? -Math.abs(value) : Math.abs(value);
};

const TallyLedgerCreation: React.FC<{
  /** Open straight into alteration of this ledger (Tally's List of Ledgers picker). */
  initialAccountId?: string | null;
}> = ({ initialAccountId = null }) => {
  const queryClient = useQueryClient();
  const { selectedCompanyId, companies } = useAccountingCompany();
  const companyName = companies.find((c) => c.id === selectedCompanyId)?.company_name ?? '';

  const [name, setName] = useState('');
  const [alias, setAlias] = useState('');
  const [under, setUnder] = useState('');
  const [openingBalance, setOpeningBalance] = useState('');
  const [openingType, setOpeningType] = useState<'Dr' | 'Cr'>('Dr');
  // Mailing / Banking / Tax details (Tally Ledger Creation right panel)
  const [mailingName, setMailingName] = useState('');
  const [address, setAddress] = useState('');
  const [stateName, setStateName] = useState('Maharashtra');
  const [country, setCountry] = useState('India');
  const [pincode, setPincode] = useState('');
  const [provideBank, setProvideBank] = useState(false);
  const [bankName, setBankName] = useState('');
  const [bankBranch, setBankBranch] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [ifsc, setIfsc] = useState('');
  // Our bank account whose portal has this party saved as a beneficiary —
  // payment screens read it to say which bank the payment goes out from.
  const [beneficiaryBankId, setBeneficiaryBankId] = useState('');
  // The owner or person we deal with at this party. Optional; not shown for
  // patient / staff / consultant ledgers.
  const [pointOfContact, setPointOfContact] = useState('');
  const [pan, setPan] = useState('');
  const [gstin, setGstin] = useState('');
  const [isActive, setIsActive] = useState(true);
  // When set, the form is in Tally's Ledger Alteration mode
  const [editing, setEditing] = useState<LedgerAccount | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  // Alter-by-search box at the top of the form — finds a saved ledger to edit.
  const [alterSearch, setAlterSearch] = useState('');
  // A ledger handed in by the List of Ledgers picker loads once, when the
  // chart arrives — after that the user is free to switch or clear.
  const consumedInitial = React.useRef(false);

  const { data: groups = [] } = useQuery({
    queryKey: ['ledger_groups'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from('ledger_groups').select('*').order('name');
      if (error) throw error;
      return (data ?? []) as LedgerGroup[];
    },
  });

  // The company's ledgers plus the shared ones (company_id IS NULL), the same
  // scope every report totals. A key of its own: ChartOfAccounts owns
  // ['coa_all', …] with columns '*', and sharing a key lets whichever screen
  // mounts first decide the column set.
  const { data: accounts = [], isLoading: accountsLoading } = useQuery({
    queryKey: ['ledger_master_accounts', selectedCompanyId],
    enabled: !!selectedCompanyId,
    queryFn: () =>
      fetchActiveAccounts<LedgerAccount>({
        columns: LEDGER_COLUMNS,
        companyId: selectedCompanyId,
        includeInactive: true,
      }),
  });

  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);

  // Tally groups that exist only as account_group text on this company's
  // ledgers — "Consultant", "Hope Salary Exp", "Mjpjay". They have no
  // ledger_groups row, so without them a new ledger cannot be filed where its
  // siblings already sit.
  const coaGroupOptions = useMemo(() => {
    const known = new Set(groups.map((g) => normalizeGroupName(g.name)));
    const counts = new Map<string, { label: string; count: number }>();
    for (const account of accounts) {
      const key = normalizeGroupName(account.account_group);
      if (!key || known.has(key)) continue;
      const existing = counts.get(key);
      if (existing) existing.count += 1;
      else counts.set(key, { label: (account.account_group ?? '').trim(), count: 1 });
    }
    return [...counts.values()]
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((g) => ({
        id: `${COA_GROUP_PREFIX}${g.label}`,
        label: g.label,
        detail: `${g.count} ledger${g.count === 1 ? '' : 's'}`,
      }));
  }, [accounts, groups]);

  const selectedGroupName = useMemo(() => {
    if (!under) return '';
    if (under.startsWith(COA_GROUP_PREFIX)) return under.slice(COA_GROUP_PREFIX.length);
    return groupById.get(under)?.name ?? '';
  }, [under, groupById]);

  // Tally files a ledger under whichever predefined group its own group
  // descends from, so the chain is what the name rules are matched against.
  const groupChain = useMemo(() => {
    if (!under || under.startsWith(COA_GROUP_PREFIX)) return selectedGroupName ? [selectedGroupName] : [];
    const chain: string[] = [];
    let current = groupById.get(under);
    const seen = new Set<string>();
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      chain.push(current.name);
      current = current.parent_group_id ? groupById.get(current.parent_group_id) : undefined;
    }
    return chain;
  }, [under, groupById, selectedGroupName]);

  /**
   * account_type for the picked group. The siblings already under that group
   * win: the point of filing a ledger under a group is that it reports where
   * they do, including where a past import typed them in a way the name rules
   * would not reproduce. The type is stored automatically and is not shown
   * on the Tally-style creation form.
   */
  const derived = useMemo(() => {
    if (!selectedGroupName) return null;
    const siblings = accountTypeFromSiblings(selectedGroupName, accounts);
    if (siblings) {
      return {
        type: siblings.type,
        reason: `from ${siblings.siblings} ledger${siblings.siblings === 1 ? '' : 's'} already under "${selectedGroupName}"`,
      };
    }
    const group = under.startsWith(COA_GROUP_PREFIX) ? undefined : groupById.get(under);
    const chained = accountTypeForGroupChain(groupChain, group?.group_type);
    return {
      type: chained.type,
      reason:
        chained.derivedFrom === 'rule'
          ? `from the group "${chained.matchedGroup}"`
          : chained.derivedFrom === 'group_type'
            ? `from this group's nature (${group?.group_type})`
            : 'no rule matched — please check',
    };
  }, [selectedGroupName, accounts, under, groupById, groupChain]);

  const effectiveType: AccountType | null = editing && isAccountType(editing.account_type)
    ? editing.account_type
    : derived?.type || null;

  // Tally's Total Opening Balance panel (top-right): the company's Dr and Cr
  // opening totals, over the same rows every report totals. The two sides do
  // not match — that gap is the "Difference in opening balances" the Opening
  // Balances screen reports.
  const totalOpening = useMemo(() => {
    let dr = 0;
    let cr = 0;
    for (const account of accounts) {
      if (editing && account.id === editing.id) continue;
      const value = signedOpening(account);
      if (value > 0) dr += value;
      else cr += -value;
    }
    const pending = Math.abs(Number(openingBalance) || 0);
    if (pending) {
      if (openingType === 'Dr') dr += pending;
      else cr += pending;
    }
    return { dr, cr };
  }, [accounts, openingBalance, openingType, editing]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) {
      return [...accounts]
        .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
        .slice(0, RECENT_LIMIT);
    }
    return accounts.filter((a) =>
      [a.account_name, a.alias, a.account_code, a.account_group].some((field) =>
        (field ?? '').toLowerCase().includes(q),
      ),
    );
  }, [accounts, search]);

  // The company's own bank-account ledgers — the options a party can be a
  // beneficiary of. Matched on the group so imported ledgers count too.
  const bankLedgers = useMemo(
    () =>
      accounts
        .filter((a) => (a.account_group ?? '').toLowerCase().includes('bank'))
        .sort((a, b) => a.account_name.localeCompare(b.account_name)),
    [accounts],
  );

  React.useEffect(() => {
    if (consumedInitial.current || !initialAccountId || !accounts.length) return;
    const account = accounts.find((a) => a.id === initialAccountId);
    if (account) {
      consumedInitial.current = true;
      startEdit(account);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialAccountId, accounts]);

  const startEdit = (account: LedgerAccount): void => {
    setEditing(account);
    setName(account.account_name ?? '');
    setAlias(account.alias ?? '');
    // Prefer the ledger_groups row this ledger was created under; otherwise
    // match its account_group text, so Accept does not silently re-file an
    // imported ledger under a different group.
    const byName = groups.find((g) => normalizeGroupName(g.name) === normalizeGroupName(account.account_group));
    setUnder(
      account.ledger_group_id ??
        (byName ? byName.id : account.account_group ? `${COA_GROUP_PREFIX}${account.account_group}` : ''),
    );
    const opening = Math.abs(Number(account.opening_balance) || 0);
    setOpeningBalance(opening ? String(opening) : '');
    setOpeningType((account.opening_balance_type ?? '').toUpperCase() === 'CR' ? 'Cr' : 'Dr');
    setMailingName(account.mailing_name ?? '');
    setAddress(account.address ?? '');
    setStateName(account.state ?? 'Maharashtra');
    setCountry(account.country ?? 'India');
    setPincode(account.pincode ?? '');
    setProvideBank(!!(account.bank_name || account.bank_account_number || account.ifsc_code));
    setBankName(account.bank_name ?? '');
    setBankBranch(account.bank_branch ?? '');
    setAccountNumber(account.bank_account_number ?? '');
    setIfsc(account.ifsc_code ?? '');
    setBeneficiaryBankId(account.beneficiary_of_bank_account_id ?? '');
    setPointOfContact(account.point_of_contact ?? '');
    setPan(account.pan ?? '');
    setGstin(account.gstin ?? '');
    setIsActive(account.is_active !== false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleClear = (): void => {
    setEditing(null);
    setName('');
    setAlias('');
    setUnder('');
    setOpeningBalance('');
    setOpeningType('Dr');
    setMailingName('');
    setAddress('');
    setStateName('Maharashtra');
    setCountry('India');
    setPincode('');
    setProvideBank(false);
    setBankName('');
    setBankBranch('');
    setAccountNumber('');
    setIfsc('');
    setBeneficiaryBankId('');
    setPointOfContact('');
    setPan('');
    setGstin('');
    setIsActive(true);
  };

  // Patients, staff and consultants have no company contact person — the
  // field is hidden (and never saved) for ledgers filed under those groups.
  const showPointOfContact = !/patient|staff|consultant|salary/i.test(selectedGroupName ?? '');

  const detailFields = () => ({
    point_of_contact: showPointOfContact ? pointOfContact.trim() || null : null,
    alias: alias.trim() || null,
    mailing_name: mailingName.trim() || null,
    address: address.trim() || null,
    state: stateName.trim() || null,
    country: country.trim() || null,
    pincode: pincode.trim() || null,
    bank_name: provideBank ? bankName.trim() || null : null,
    bank_branch: provideBank ? bankBranch.trim() || null : null,
    bank_account_number: provideBank ? accountNumber.trim() || null : null,
    ifsc_code: provideBank ? ifsc.trim() || null : null,
    beneficiary_of_bank_account_id: beneficiaryBankId || null,
    pan: pan.trim() || null,
    gstin: gstin.trim() || null,
  });

  const handleAccept = async (): Promise<void> => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('Enter the ledger name');
      return;
    }
    if (!selectedCompanyId) {
      toast.error('Select a company first (F3)');
      return;
    }
    if (!under || under === PRIMARY) {
      toast.error('Select the group (Under)');
      return;
    }
    if (!selectedGroupName || !effectiveType) {
      toast.error('Select a valid group');
      return;
    }
    // account_name is not unique in the database, and a duplicate does not
    // error: it collapses into one line on the Trial Balance (mergedLedgerBalances
    // keys by name) and shows twice in the voucher picker. Refuse it here.
    const duplicate = accounts.find(
      (a) => a.id !== editing?.id && normalizeAccountName(a.account_name) === normalizeAccountName(trimmed),
    );
    if (duplicate) {
      toast.error(`"${duplicate.account_name}" already exists — find it below and alter it instead`);
      return;
    }

    const opening = Math.abs(Number(openingBalance) || 0);
    const openingFields = {
      opening_balance: opening,
      opening_balance_type: opening ? openingType.toUpperCase() : null,
    };
    setSaving(true);
    try {
      if (editing) {
        const { error } = await (supabase as any)
          .from('chart_of_accounts')
          .update({
            account_name: trimmed,
            account_type: effectiveType,
            account_group: selectedGroupName,
            ledger_group_id: under.startsWith(COA_GROUP_PREFIX) ? null : under,
            is_active: isActive,
            ...openingFields,
            ...detailFields(),
          })
          .eq('id', editing.id);
        if (error) throw error;
        toast.success(`Ledger "${trimmed}" altered`);
        queryClient.invalidateQueries();
        handleClear();
        return;
      }

      await insertLedgerAccount(supabase as any, {
        companyId: selectedCompanyId,
        name: trimmed,
        accountType: effectiveType,
        groupName: selectedGroupName,
        ledgerGroupId: under.startsWith(COA_GROUP_PREFIX) ? null : under,
        extras: { ...openingFields, ...detailFields() },
      });
      toast.success(`Ledger "${trimmed}" created in ${companyName}`);
      queryClient.invalidateQueries();
      handleClear();
    } catch (err: any) {
      console.error('Failed to save ledger:', err);
      toast.error(
        err?.code === '23505'
          ? 'This ledger name is already taken in the Tally ledger list'
          : err?.message || 'Failed to save — please try again',
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async (account: LedgerAccount): Promise<void> => {
    try {
      const { error } = await (supabase as any)
        .from('chart_of_accounts')
        .update({ is_active: false })
        .eq('id', account.id);
      if (error) throw error;
      toast.info(`Ledger "${account.account_name}" set inactive`);
      queryClient.invalidateQueries();
      if (editing?.id === account.id) handleClear();
    } catch (err: any) {
      console.error('Failed to deactivate ledger:', err);
      toast.error(err?.message || 'Failed to deactivate — please try again');
    }
  };

  const handleDelete = async (account: LedgerAccount): Promise<void> => {
    if (account.company_id === null) {
      toast.error('Shared ledger — used by every company. Alter it from Chart of Accounts.');
      return;
    }
    if (!window.confirm(`Delete the ledger "${account.account_name}" permanently?`)) return;
    try {
      const { error } = await (supabase as any).from('chart_of_accounts').delete().eq('id', account.id);
      if (error) throw error;
      toast.info(`Ledger "${account.account_name}" deleted`);
      queryClient.invalidateQueries();
      if (editing?.id === account.id) handleClear();
    } catch (err: any) {
      console.error('Failed to delete ledger:', err);
      if (err?.code === '23503') {
        toast.error('This ledger is used by vouchers — set it inactive instead');
        return;
      }
      toast.error(err?.message || 'Failed to delete — please try again');
    }
  };

  if (!selectedCompanyId) {
    return (
      <div className="rounded-md border bg-[#fffefb] p-6 text-center text-sm text-gray-500">
        Select a company (F3) to create a ledger.
      </div>
    );
  }

  const editingShared = editing?.company_id === null;

  return (
    <div className="space-y-6">
      {/* ----- Tally-style Ledger Creation panel ----- */}
      <div className="overflow-hidden rounded-md border shadow-sm">
        <div className="bg-[#16437e] px-3 py-1.5 text-sm font-semibold text-white">
          {editing ? `Ledger Alteration — ${editing.account_name}` : 'Ledger Creation'}
        </div>

  <div className="min-h-[600px] bg-[#fffefb] px-4 pb-3 pt-3">
          {/* Total Opening Balance panel, Tally top-right */}
          <div className="float-right w-64 border border-gray-400 bg-white px-3 py-2 text-right text-sm">
            <div className="border-b border-gray-300 pb-1 font-bold">Total Opening Balance</div>
            <div className="mt-1 font-mono">{fmtINR(totalOpening.dr)} Dr</div>
            <div className="font-mono">{fmtINR(totalOpening.cr)} Cr</div>
            <div className="mt-1 border-t border-gray-300 pt-1 font-mono text-xs text-muted-foreground">
              Difference {fmtINR(totalOpening.dr - totalOpening.cr)}{' '}
              {totalOpening.dr - totalOpening.cr >= 0 ? 'Dr' : 'Cr'}
            </div>
            <div className="text-[11px] font-normal text-muted-foreground">
              {companyName || 'this company'} + shared ledgers
            </div>
          </div>

          {editingShared && (
            <div className="mb-2 border border-amber-400 bg-amber-50 px-2 py-1 text-xs text-amber-900">
              This is a shared ledger used by every company. Alter it from Chart of Accounts.
            </div>
          )}

          {/* Alter-by-search: find a saved ledger and load it into the form,
              the way Tally's Alteration opens with a ledger list. The result
              row already answers "which bank holds them as beneficiary". */}
          {!editing && (
            <div className="relative mb-3 flex items-center gap-2">
              <span className="w-40 shrink-0 text-sm font-semibold">Alter existing</span>
              <span className="text-sm">:</span>
              <div className="relative w-full max-w-md">
                <Input
                  value={alterSearch}
                  onChange={(e) => setAlterSearch(e.target.value)}
                  autoComplete="off"
                  placeholder="Search a saved ledger by name or code to edit it…"
                  className="h-8 w-full rounded-none border border-gray-400 bg-white px-2 shadow-none focus-visible:ring-0 focus-visible:border-blue-600"
                />
                {alterSearch.trim().length >= 2 && (
                  <div className="absolute left-0 right-0 top-full z-50 mt-0.5 max-h-64 overflow-y-auto border border-gray-400 bg-white shadow-lg">
                    {(() => {
                      const q = alterSearch.trim().toLowerCase();
                      const hits = accounts
                        .filter(
                          (a) =>
                            a.account_name.toLowerCase().includes(q) ||
                            (a.account_code || '').toLowerCase().includes(q) ||
                            (a.alias || '').toLowerCase().includes(q),
                        )
                        .slice(0, 10);
                      if (!hits.length) {
                        return (
                          <p className="px-3 py-2 text-sm text-muted-foreground">
                            No saved ledger matches — the form below creates a new one.
                          </p>
                        );
                      }
                      return hits.map((a) => {
                        const bank = a.beneficiary_of_bank_account_id
                          ? accounts.find((b) => b.id === a.beneficiary_of_bank_account_id)
                          : null;
                        return (
                          <button
                            key={a.id}
                            type="button"
                            className="block w-full border-b border-gray-200 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-[#fdf6d8]"
                            onPointerDown={(e) => {
                              e.preventDefault();
                              startEdit(a);
                              setAlterSearch('');
                            }}
                          >
                            <span className="font-medium">{a.account_name}</span>
                            <span className="ml-2 text-xs text-muted-foreground">
                              {[a.account_code, a.account_group].filter(Boolean).join(' · ')}
                            </span>
                            <span className={`block text-xs ${bank ? 'text-emerald-700' : 'text-amber-700'}`}>
                              {bank
                                ? `Beneficiary in ${bank.account_name}`
                                : 'Not added in any bank portal'}
                            </span>
                          </button>
                        );
                      });
                    })()}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <span className="w-40 shrink-0 text-sm">Name</span>
            <span className="text-sm">:</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
              className="h-8 w-full max-w-md rounded-none border border-gray-400 bg-[#fdf6d8] px-2 shadow-none focus-visible:ring-0 focus-visible:border-blue-600"
            />
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="w-40 shrink-0 text-sm italic text-gray-600">(alias)</span>
            <span className="text-sm">:</span>
            <Input
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              autoComplete="off"
              placeholder="stored for the record — vouchers search the name"
              className="h-8 w-full max-w-md rounded-none border-0 border-b border-dashed border-gray-400 bg-transparent px-1 shadow-none focus-visible:ring-0 focus-visible:border-blue-600 focus-visible:border-solid"
            />
          </div>

    <div className="mt-16 clear-none flex gap-8">
      {/* Left column: Under + Opening */}
      <div className="flex min-h-[430px] w-[46%] shrink-0 flex-col">
              <div className="flex items-center gap-2">
                <span className="w-40 shrink-0 text-sm">Under</span>
                <span className="text-sm">:</span>
                <GroupSearch
                  groups={groups}
                  value={under}
                  onSelect={(value) => {
                    setUnder(value);
                  }}
                  includePrimary={false}
                  extraOptions={coaGroupOptions}
                />
              </div>

        <div className="mt-auto">
          <div className="flex items-center gap-2 border-t border-gray-300 pt-3">
                <span className="w-40 shrink-0 text-sm">Opening Balance</span>
                <span className="text-sm">:</span>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={openingBalance}
                  onChange={(e) => setOpeningBalance(e.target.value)}
                  placeholder="0.00"
                  className="h-8 w-40 rounded-none border-0 border-b border-dashed border-gray-400 bg-transparent px-1 text-right font-mono shadow-none focus-visible:ring-0 focus-visible:border-blue-600 focus-visible:border-solid [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <Select value={openingType} onValueChange={(v) => setOpeningType(v as 'Dr' | 'Cr')}>
                  <SelectTrigger className="h-8 w-16 rounded-none border-0 border-b border-dashed border-gray-400 bg-transparent px-1 text-sm font-semibold shadow-none focus:ring-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Dr">Dr</SelectItem>
                    <SelectItem value="Cr">Cr</SelectItem>
                  </SelectContent>
                </Select>
          </div>
          <div className="ml-[11.5rem] text-xs text-muted-foreground">
                Balance as on the year's first day — for money owed now, pass a voucher instead.
              </div>

              {editing && (
                <div className="mt-4 flex items-center gap-2">
                  <span className="w-40 shrink-0 text-sm">Active</span>
                  <span className="text-sm">:</span>
                  <button
                    type="button"
                    onClick={() => setIsActive((v) => !v)}
                    className="min-w-[44px] border-b border-dashed border-gray-400 px-2 text-left text-sm font-semibold hover:bg-[#fdf6d8]"
                    title="An inactive ledger is hidden from vouchers and reports"
                  >
                    {isActive ? 'Yes' : 'No'}
                  </button>
                </div>
              )}
            </div>

            {/* Right column: Mailing / Banking / Tax, like Tally's image */}
        </div>

      <div className="min-w-0 flex-1 text-sm">
              <div className="border-b border-gray-400 font-semibold">Mailing Details</div>
              {[
                ['Name', mailingName, setMailingName, name || ''],
                ['Address', address, setAddress, ''],
                ['State', stateName, setStateName, ''],
                ['Country', country, setCountry, ''],
                ['Pincode', pincode, setPincode, ''],
              ].map(([label, value, setter, ph]: any) => (
                <div key={label} className="mt-0.5 flex items-center gap-2">
                  <span className="w-24 shrink-0">{label}</span>
                  <span>:</span>
                  <Input
                    value={value}
                    onChange={(e) => setter(e.target.value)}
                    placeholder={ph}
                    autoComplete="off"
                    className="h-7 w-full rounded-none border-0 border-b border-dashed border-gray-400 bg-transparent px-1 text-sm shadow-none focus-visible:ring-0 focus-visible:border-blue-600 focus-visible:border-solid"
                  />
                </div>
              ))}
              {showPointOfContact && (
                <div className="mt-0.5 flex items-center gap-2">
                  <span className="w-24 shrink-0">Point of Contact</span>
                  <span>:</span>
                  <Input
                    value={pointOfContact}
                    onChange={(e) => setPointOfContact(e.target.value)}
                    placeholder="owner / person we deal with (optional)"
                    autoComplete="off"
                    title="Invoices of this ledger can be searched by this person on the Expense Bill page"
                    className="h-7 w-full rounded-none border-0 border-b border-dashed border-gray-400 bg-transparent px-1 text-sm shadow-none focus-visible:ring-0 focus-visible:border-blue-600 focus-visible:border-solid"
                  />
                </div>
              )}

              <div className="mt-3 border-b border-gray-400 font-semibold">Banking Details</div>
              <div className="mt-0.5 flex items-center gap-2">
                <span className="w-40 shrink-0">Provide bank details</span>
                <span>:</span>
                <button
                  type="button"
                  onClick={() => setProvideBank((v) => !v)}
                  className="min-w-[44px] border-b border-dashed border-gray-400 px-2 text-left font-semibold hover:bg-[#fdf6d8]"
                >
                  {provideBank ? 'Yes' : 'No'}
                </button>
              </div>
              {provideBank &&
                [
                  ['Bank name', bankName, setBankName],
                  ['Branch', bankBranch, setBankBranch],
                  ['A/c number', accountNumber, setAccountNumber],
                  ['IFSC code', ifsc, setIfsc],
                ].map(([label, value, setter]: any) => (
                  <div key={label} className="mt-0.5 flex items-center gap-2">
                    <span className="w-24 shrink-0">{label}</span>
                    <span>:</span>
                    <Input
                      value={value}
                      onChange={(e) => setter(e.target.value)}
                      autoComplete="off"
                      className="h-7 w-full rounded-none border-0 border-b border-dashed border-gray-400 bg-transparent px-1 text-sm shadow-none focus-visible:ring-0 focus-visible:border-blue-600 focus-visible:border-solid"
                    />
                  </div>
                ))}

              <div className="mt-0.5 flex items-center gap-2">
                <span className="w-40 shrink-0">Beneficiary of bank</span>
                <span>:</span>
                <select
                  value={beneficiaryBankId}
                  onChange={(e) => setBeneficiaryBankId(e.target.value)}
                  className="h-7 w-full rounded-none border-0 border-b border-dashed border-gray-400 bg-transparent px-1 text-sm focus:border-solid focus:border-blue-600 focus:outline-none"
                  title="Our bank account whose portal has this party saved as a beneficiary"
                >
                  <option value="">Not added in any bank portal</option>
                  {bankLedgers.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.account_name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mt-3 border-b border-gray-400 font-semibold">Tax Registration Details</div>
              <div className="mt-0.5 flex items-center gap-2">
                <span className="w-24 shrink-0">PAN/IT No.</span>
                <span>:</span>
                <Input
                  value={pan}
                  onChange={(e) => setPan(e.target.value.toUpperCase())}
                  autoComplete="off"
                  className="h-7 w-full rounded-none border-0 border-b border-dashed border-gray-400 bg-transparent px-1 font-mono text-sm uppercase shadow-none focus-visible:ring-0 focus-visible:border-blue-600 focus-visible:border-solid"
                />
              </div>
              <div className="mt-0.5 flex items-center gap-2">
                <span className="w-24 shrink-0">GSTIN/UIN</span>
                <span>:</span>
                <Input
                  value={gstin}
                  onChange={(e) => setGstin(e.target.value.toUpperCase())}
                  autoComplete="off"
                  className="h-7 w-full rounded-none border-0 border-b border-dashed border-gray-400 bg-transparent px-1 font-mono text-sm uppercase shadow-none focus-visible:ring-0 focus-visible:border-blue-600 focus-visible:border-solid"
                />
              </div>
            </div>
          </div>
          </div>

        <div className="flex items-center gap-1 border-t bg-[#dce6f2] px-2 py-1.5">
          <Button variant="outline" size="sm" className="h-7 bg-white text-xs" onClick={handleClear} disabled={saving}>
            <span className="mr-1 font-bold underline">Q</span>: Quit
          </Button>
          <Button
            size="sm"
            className="h-7 bg-[#16437e] text-xs hover:bg-[#0f3363]"
            onClick={handleAccept}
            disabled={saving || editingShared}
          >
            <span className="mr-1 font-bold underline">A</span>: {saving ? 'Saving…' : 'Accept'}
          </Button>
          <span className="ml-3 text-xs text-muted-foreground">
            Saved to {companyName || 'the selected company'}'s ledgers — usable in Voucher Entry at once.
          </span>
        </div>
      </div>

      {/* ----- Existing ledgers ----- */}
      <div className="overflow-hidden rounded-md border shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 bg-[#16437e] px-3 py-1.5 text-sm font-semibold text-white">
          <span>List of Ledgers</span>
          <span className="flex items-center gap-2 text-xs font-normal">
            <span>
              {accountsLoading ? 'loading…' : `${accounts.length.toLocaleString('en-IN')} ledgers`}
            </span>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, alias, code or group…"
              className="h-7 w-64 rounded-none border-0 bg-white px-2 text-xs text-black shadow-none focus-visible:ring-0"
            />
          </span>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="bg-[#f0f4fa]">
              <TableHead>Name</TableHead>
              <TableHead>Alias</TableHead>
              <TableHead>Under</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Code</TableHead>
              <TableHead className="text-right">Opening Balance</TableHead>
              <TableHead className="w-16"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-6 text-center text-sm text-gray-400">
                  {accountsLoading ? 'Loading ledgers…' : search ? 'No ledger matches that search.' : 'No ledgers yet.'}
                </TableCell>
              </TableRow>
            ) : (
              visible.slice(0, LIST_LIMIT).map((account) => {
                const opening = signedOpening(account);
                return (
                  <TableRow
                    key={account.id}
                    onClick={() => startEdit(account)}
                    title="Alter ledger"
                    className={`cursor-pointer ${editing?.id === account.id ? 'bg-[#fdf6d8]' : ''} ${
                      account.is_active === false ? 'text-muted-foreground' : ''
                    }`}
                  >
                    <TableCell className="font-medium">
                      {account.account_name}
                      {account.company_id === null && (
                        <span className="ml-2 rounded bg-gray-200 px-1 text-[10px] uppercase text-gray-700">shared</span>
                      )}
                      {account.is_active === false && (
                        <span className="ml-2 rounded bg-gray-200 px-1 text-[10px] uppercase text-gray-700">inactive</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{account.alias || '-'}</TableCell>
                    <TableCell className="text-sm">{account.account_group || '-'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{titleOfType(account.account_type)}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{account.account_code}</TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {opening ? `${fmtINR(opening)} ${opening >= 0 ? 'Dr' : 'Cr'}` : '-'}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {account.is_active !== false && account.company_id !== null && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-1 text-[11px]"
                            title="Hide from vouchers and reports"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeactivate(account);
                            }}
                          >
                            Hide
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          aria-label="Delete ledger"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(account);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-red-500" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
        <div className="border-t bg-[#f7f9fc] px-3 py-1.5 text-xs text-muted-foreground">
          {!search
            ? `Showing the ${Math.min(visible.length, RECENT_LIMIT)} most recently created — search to find any of the ${accounts.length.toLocaleString('en-IN')}.`
            : visible.length > LIST_LIMIT
              ? `Showing ${LIST_LIMIT} of ${visible.length.toLocaleString('en-IN')} matches — refine the search.`
              : `${visible.length.toLocaleString('en-IN')} match${visible.length === 1 ? '' : 'es'}.`}
        </div>
      </div>
    </div>
  );
};

export default TallyLedgerCreation;
