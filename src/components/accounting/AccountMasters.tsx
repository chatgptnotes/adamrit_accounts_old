import React, { useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import GroupCreation from './GroupCreation';
import TallyLedgerCreation from './TallyLedgerCreation';
import VoucherTypeCreation from './VoucherTypeCreation';
import { TallyScreen } from './tally/TallyChrome';
import { useTallyReport } from './tally/useTallyReport';

interface MasterItem {
  id: 'group' | 'ledger' | 'voucher-type';
  label: string;
}

// Accounting Masters this app actually supports (Tally also lists Currency etc.)
const MASTERS: MasterItem[] = [
  { id: 'group', label: 'Group' },
  { id: 'ledger', label: 'Ledger' },
  { id: 'voucher-type', label: 'Voucher Type' },
];

/**
 * AccountMasters -- Tally's "Master Alteration" gateway: a searchable
 * List of Masters that opens each master's creation screen.
 */
const AccountMasters: React.FC = () => {
  const { hospitalConfig } = useAuth();
  const [search, setSearch] = useState('');
  const [active, setActive] = useState<MasterItem['id'] | null>(null);
  const [highlight, setHighlight] = useState(0);

  const options = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? MASTERS.filter((m) => m.label.toLowerCase().includes(q)) : MASTERS;
  }, [search]);

  const report = useTallyReport({
    // Master creation screens have no report columns to compare
    supportsColumns: false,
    filterFields: ['Master'],
    views: [
      { label: 'Chart of Accounts', target: 'chart-of-accounts' },
      { label: 'Opening Balances', target: 'opening-balances' },
      { label: 'Trial Balance', target: 'trial-balance' },
      { label: 'Voucher Entry', target: 'voucher-entry' },
    ],
    screenKeys: [{ hotkey: 'F10', label: 'Other Masters', onClick: () => setActive(null) }],
  });

  if (active) {
    const activeTitle = MASTERS.find((m) => m.id === active)?.label ?? '';
    return (
      <>
      <TallyScreen title={`${activeTitle} Creation`} onClose={() => setActive(null)} rail={report.rail}>
        <div className="space-y-3 p-2">
          <Button variant="outline" size="sm" className="h-7 rounded-none text-xs" onClick={() => setActive(null)}>
            <ArrowLeft className="mr-1 h-3.5 w-3.5" /> List of Masters
          </Button>
          {active === 'group' && <GroupCreation />}
          {active === 'ledger' && <TallyLedgerCreation />}
          {active === 'voucher-type' && <VoucherTypeCreation />}
        </div>
      </TallyScreen>

      {report.popups}
      </>
    );
  }

  return (
    <>
    <TallyScreen title="Master Alteration" rail={report.rail}>
    <div className="mx-auto max-w-xl pt-4">
      <div className="overflow-hidden rounded-md border shadow-sm">
        {/* Company + title, Tally style */}
        <div className="border-b bg-[#dce6f2] px-3 py-2 text-center">
          <div className="text-xs font-semibold text-gray-700">{hospitalConfig.name}</div>
          <div className="text-base font-bold text-[#16437e]">Master Alteration</div>
        </div>

        {/* Search box */}
        <div className="bg-[#fffefb] px-4 py-3">
          <Input
            value={search}
            autoFocus
            onChange={(e) => {
              setSearch(e.target.value);
              setHighlight(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setHighlight((h) => Math.min(h + 1, options.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setHighlight((h) => Math.max(h - 1, 0));
              } else if (e.key === 'Enter' && options[highlight]) {
                e.preventDefault();
                setActive(options[highlight].id);
              }
            }}
            placeholder="Type to search masters…"
            className="h-8 w-full rounded-none border border-gray-400 bg-[#fdf6d8] px-2 shadow-none focus-visible:ring-0 focus-visible:border-blue-600"
          />
        </div>

        {/* List of Masters */}
        <div className="bg-[#eef3fa]">
          <div className="bg-[#16437e] px-3 py-1 text-xs font-semibold text-white">List of Masters</div>
          <div className="border-b bg-gray-200 px-3 py-1 text-sm font-semibold">Accounting Masters</div>
          {options.length === 0 ? (
            <div className="px-3 py-4 text-center text-sm text-gray-400">No master matches "{search}"</div>
          ) : (
            options.map((m, i) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setActive(m.id)}
                onMouseEnter={() => setHighlight(i)}
                className={`block w-full border-b border-white px-3 py-1.5 text-left text-sm ${
                  i === highlight ? 'bg-[#fdd835] font-semibold' : 'hover:bg-[#fdf6d8]'
                }`}
              >
                {m.label}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
    </TallyScreen>

    {report.popups}
    </>
  );
};

export default AccountMasters;
