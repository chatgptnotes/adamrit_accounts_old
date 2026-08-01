import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { TallyScreen } from './tally/TallyChrome';
import { useShortcuts, type Binding } from './tally/keyboard';
import { TallyPopup } from './tally/TallyPopup';
import { CompanyInfoPopup, CompanySelectPopup } from './tally/CompanyPopups';
import ChangePeriod from './tally/ChangePeriod';
import { dayLabel, periodLabel, useAccountingPeriod } from './tally/PeriodContext';
import { useAccountingCompanyOptional } from './AccountingCompanyContext';

const isoDateLabel = (iso: string): string => dayLabel(iso);

interface MenuItem {
  label: string;
  /** Accounting tab id to open */
  target?: string;
  /** Submenu to descend into */
  menu?: string;
  /** Which letter is Tally's hot-capital in the label */
  hotIndex?: number;
  /** Tally groups menu items with blank lines */
  gapBefore?: boolean;
  /** No matching screen in this module — greyed like Tally's inapplicable items */
  disabled?: boolean;
}

interface MenuSection {
  heading?: string;
  items: MenuItem[];
}

interface Menu {
  title: string;
  sections: MenuSection[];
}

/**
 * Tally's Gateway menu tree, mapped onto this module's screens. Registers open
 * the Voucher Register pre-filtered to that voucher type ("id:Type").
 */
const MENUS: Record<string, Menu> = {
  gateway: {
    title: 'Gateway of Tally',
    sections: [
      {
        heading: 'MASTERS',
        items: [
          { label: 'Create', target: 'masters-create' },
          { label: 'Alter', target: 'masters-alter' },
          { label: 'CHart of Accounts', target: 'chart-of-accounts', hotIndex: 1 },
        ],
      },
      {
        heading: 'TRANSACTIONS',
        items: [
          { label: 'Vouchers', target: 'voucher-entry' },
          { label: 'Day BooK', target: 'day-book', hotIndex: 7 },
        ],
      },
      {
        heading: 'UTILITIES',
        items: [
          { label: 'BaNking', target: 'banking', hotIndex: 2 },
          { label: 'TallyCapital', target: 'tally-live' },
        ],
      },
      {
        heading: 'REPORTS',
        items: [
          { label: 'Balance Sheet', target: 'balance-sheet' },
          { label: 'Profit & Loss A/c', target: 'profit-loss' },
          { label: 'Stock Summary', disabled: true },
          { label: 'Ratio Analysis', target: 'ratio-analysis' },
          { label: 'Display More Reports', menu: 'more', hotIndex: 8, gapBefore: true },
          { label: 'DashbOard', target: 'dashboard', hotIndex: 6 },
        ],
      },
    ],
  },
  more: {
    title: 'Display More Reports',
    sections: [
      {
        heading: 'ACCOUNTING',
        items: [
          { label: 'Trial Balance', target: 'trial-balance' },
          { label: 'Day Book', target: 'day-book', hotIndex: 4 },
          { label: 'Cash Flow', target: 'cash-flow' },
          { label: 'Funds Flow', target: 'funds-flow' },
        ],
      },
      {
        items: [
          { label: 'Account Books', menu: 'account-books', gapBefore: true },
          { label: 'Statements of Accounts', menu: 'statements' },
        ],
      },
      {
        heading: 'INVENTORY',
        items: [
          { label: 'Inventory Books', disabled: true },
          { label: 'StatEments of Inventory', disabled: true, hotIndex: 5 },
        ],
      },
      {
        heading: 'STATUTORY',
        items: [{ label: 'MSME RepOrts', disabled: true, hotIndex: 9 }],
      },
      {
        heading: 'EXCEPTION',
        items: [
          { label: 'EXception Reports', target: 'exception-reports', hotIndex: 1 },
          { label: 'Analysis & Verification', target: 'statistics', hotIndex: 11 },
          { label: 'Edit Log Summary', target: 'edit-log', hotIndex: 5 },
        ],
      },
    ],
  },
  'account-books': {
    title: 'Account Books',
    sections: [
      {
        heading: 'SUMMARY',
        items: [
          { label: 'Cash/Bank Book(s)', target: 'cash-bank-summary' },
          { label: 'Ledger', target: 'ledger-view' },
          { label: 'Group Summary', target: 'group-summary', gapBefore: true },
          { label: 'Group Vouchers', target: 'voucher-register', hotIndex: 6 },
        ],
      },
      {
        heading: 'REGISTERS',
        items: [
          { label: 'ConTra Register', target: 'voucher-register:Contra', hotIndex: 3 },
          { label: 'PaYment Register', target: 'voucher-register:Payment', hotIndex: 2 },
          { label: 'Receipt Register', target: 'voucher-register:Receipt' },
          { label: 'Sales Register', target: 'voucher-register:Sales', gapBefore: true },
          { label: 'Purchase Register', target: 'voucher-register:Purchase' },
          { label: 'Journal Register', target: 'voucher-register:Journal', gapBefore: true },
          { label: 'Debit Note Register', target: 'voucher-register:Debit Note' },
          { label: 'CrEdit Note Register', target: 'voucher-register:Credit Note', hotIndex: 2 },
          { label: 'VoUcher Clarification', target: 'exception-reports', hotIndex: 2, gapBefore: true },
        ],
      },
    ],
  },
  statements: {
    title: 'Statements of Accounts',
    sections: [
      {
        heading: 'OUTSTANDINGS',
        items: [
          { label: 'Bills Receivable', target: 'bills-receivable' },
          { label: 'Bills Payable', target: 'bills-payable', hotIndex: 6 },
          { label: 'Bill-wise Outstandings', target: 'billwise', hotIndex: 5 },
        ],
      },
      {
        heading: 'COST CENTRES',
        items: [{ label: 'Cost Centre Breakup', target: 'cost-centres' }],
      },
      {
        heading: 'STATISTICS',
        items: [
          { label: 'Receipts & Payments', target: 'receipts-payments', gapBefore: true },
          { label: 'Bank Reconciliation', target: 'bank-reconciliation', hotIndex: 5 },
          { label: 'StatIstics', target: 'statistics', hotIndex: 4 },
        ],
      },
    ],
  },
};

/**
 * Gateway of Tally — the iconic home screen: current period / date and the
 * company panel on the left, the Masters / Transactions / Utilities / Reports
 * menu on the right, descending into Display More Reports → Account Books.
 */
const GatewayOfTally: React.FC<{ onNavigate: (tab: string) => void }> = ({ onNavigate }) => {
  const accountingCompany = useAccountingCompanyOptional();
  const companies = accountingCompany?.companies ?? [];
  const selectedCompany = companies.find((c) => c.id === accountingCompany?.selectedCompanyId);

  // Tally keeps ONE Current Period and Current Date per company, and the
  // Gateway is where you read them. This screen used to derive both from a
  // date of its own, so changing the period on any report left the Gateway
  // still showing the financial year it started in.
  const { period, setPeriod, currentDate, setCurrentDate } = useAccountingPeriod();

  const [stack, setStack] = useState<string[]>(['gateway']);
  // Tally always has the amber bar resting on a row — the Gateway opens with it
  // on the first item. There is no "no selection" state to fall into.
  const [cursor, setCursor] = useState(0);
  const [popup, setPopup] = useState<null | 'date' | 'period' | 'company' | 'company-info' | 'quit'>(null);

  const menu = MENUS[stack[stack.length - 1]];
  // Flat list drives arrow-key movement and the Quit row at the end
  const flat = useMemo(() => menu.sections.flatMap((s) => s.items), [menu]);

  const companyIds = useMemo(() => companies.map((c) => c.id), [companies]);

  // "Date of last entry" and Tally's (e) exception marker, per company
  const { data: companyInfo = {} } = useQuery({
    queryKey: ['gateway_company_info', companyIds.join(',')],
    enabled: companyIds.length > 0,
    queryFn: async () => {
      const out: Record<string, { lastEntry: string | null; exceptions: boolean }> = {};
      await Promise.all(
        companyIds.map(async (id) => {
          const [last, pending] = await Promise.all([
            (supabase as any)
              .from('vouchers')
              .select('voucher_date')
              .eq('company_id', id)
              .order('voucher_date', { ascending: false })
              .limit(1),
            (supabase as any)
              .from('vouchers')
              .select('id', { count: 'exact', head: true })
              .eq('company_id', id)
              .neq('status', 'AUTHORISED'),
          ]);
          out[id] = {
            lastEntry: last.data?.[0]?.voucher_date ?? null,
            exceptions: (pending.count ?? 0) > 0,
          };
        }),
      );
      return out;
    },
  });

  const anyExceptions = Object.values(companyInfo as Record<string, { exceptions: boolean }>).some(
    (info) => info.exceptions,
  );

  const open = (item: MenuItem) => {
    if (item.disabled) return;
    if (item.menu) {
      setStack((s) => [...s, item.menu as string]);
      setCursor(0);
    } else if (item.target) {
      onNavigate(item.target);
    }
  };

  const back = () => {
    if (stack.length > 1) {
      setStack((s) => s.slice(0, -1));
      setCursor(0);
    } else {
      // Tally never drops you out of the Gateway silently — it asks first.
      setPopup('quit');
    }
  };

  // Tally's hot letters and arrow-key navigation are live on the menu.
  //
  // These sit on the `screen` layer, which is consulted before the top bar's
  // `global` letters — they overlap (Day BooK / Display More Reports /
  // DashbOard / Profit & Loss) and used to be settled by whichever listener
  // happened to run first.
  const bindings = useMemo<Binding[]>(() => {
    const step = (by: 1 | -1) => () => {
      setCursor((c) => {
        // Skip greyed items, and stop on the Quit row (index === flat.length)
        for (let i = 1; i <= flat.length + 1; i++) {
          const next = c + by * i;
          if (next < 0 || next > flat.length) break;
          if (next === flat.length || !flat[next].disabled) return next;
        }
        return c;
      });
    };
    return [
      { combo: 'ArrowDown', layer: 'screen', label: 'Move the menu cursor', run: step(1) },
      { combo: 'ArrowUp', layer: 'screen', run: step(-1) },
      {
        combo: 'Enter',
        layer: 'screen',
        label: 'Open the highlighted item',
        run: () => {
          if (cursor === flat.length) back();
          else open(flat[cursor]);
        },
      },
      { combo: 'Q', layer: 'screen', label: 'Quit this menu', run: back },
      // Tally's hot capitals — the highlighted letter in each menu row.
      ...flat
        .map((item): Binding | null => {
          const hot = item.label[item.hotIndex ?? 0];
          return hot ? { combo: hot.toUpperCase(), layer: 'screen', label: item.label, run: () => open(item) } : null;
        })
        .filter((b): b is Binding => b !== null),
    ];
    // `open` and `back` are stable enough for a menu that rebuilds with `flat`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flat, cursor, stack]);

  // A pop-up (Change Date, company list, Quit?) owns the keyboard.
  useShortcuts(bindings, !popup);

  // Tally marks the key that opens each row by underlining that one letter.
  const hotLabel = (item: MenuItem) => {
    const i = item.hotIndex ?? 0;
    return (
      <>
        {item.label.slice(0, i)}
        <span className="font-semibold underline">{item.label[i]}</span>
        {item.label.slice(i + 1)}
      </>
    );
  };

  const row = (item: MenuItem, index: number) => (
    <button
      key={`${item.label}-${index}`}
      type="button"
      onClick={() => open(item)}
      // Tally's bar follows the mouse as well as the arrow keys — pointing at a
      // row is the same act of selecting it.
      onMouseEnter={() => !item.disabled && setCursor(index)}
      disabled={item.disabled}
      className={`block w-full py-[1px] pl-[92px] text-left leading-[18px] ${item.gapBefore ? 'mt-3' : ''} ${
        item.disabled
          ? 'cursor-default text-[#9bb4d0]'
          : cursor === index
            ? 'bg-[#ffc423] text-black'
            : 'text-[#1a4d8f]'
      }`}
    >
      {hotLabel(item)}
    </button>
  );

  let flatIndex = -1;

  return (
    <>
      <TallyScreen
        title={menu.title}
        closeLabel="✕"
        onClose={back}
        rail={[
          // Tally ERP's Gateway put Select Company on F1; Prime moved Help
          // there. The Gateway is the one screen that keeps the older meaning,
          // so Help lives on the key bar here and F1 loads a company.
          {
            hotkey: 'F1',
            label: 'Select Company',
            onClick: companies.length > 0 ? () => setPopup('company') : undefined,
          },
          { hotkey: 'F2', label: 'Date', onClick: () => setPopup('date') },
          { hotkey: 'F2', mod: 'alt', label: 'Period', onClick: () => setPopup('period') },
          // Tally opens the company list here; it does not silently rotate to
          // the next company the way this button used to.
          { hotkey: 'F3', label: 'Company', onClick: companies.length > 0 ? () => setPopup('company') : undefined },
          {
            hotkey: 'F3',
            mod: 'alt',
            label: 'Company Info',
            gapBefore: true,
            onClick: () => setPopup('company-info'),
          },
          { hotkey: 'F11', label: 'Features', onClick: () => window.dispatchEvent(new CustomEvent('tally-features')) },
          {
            hotkey: 'F12',
            mod: 'alt',
            aliases: [{ hotkey: 'F12' }],
            label: 'Configure',
            onClick: () => window.dispatchEvent(new CustomEvent('tally-configure')),
          },
        ]}
      >
        <div className="flex min-h-[70vh] text-[13px]">
          {/* Left: period / date / company panel */}
          <div className="flex w-[45%] shrink-0 flex-col border-r border-[#9db8d8] px-6 pt-4">
            {/*
              Tally lays this panel out as fixed columns, not edge-to-edge: the
              value column sits at the same offset whatever the window is doing,
              so the headings stay over the figures they label. `grid-cols-…` is
              shared by every row below for exactly that reason.
            */}
            <div className="grid grid-cols-[1fr_2.5rem_9rem] items-baseline text-[10px] font-semibold tracking-wider text-[#3f77bb]">
              <span>CURRENT PERIOD</span>
              <span />
              <span>CURRENT DATE</span>
            </div>
            <div className="grid grid-cols-[1fr_2.5rem_9rem] items-baseline pb-1">
              <span>{periodLabel(period)}</span>
              <span />
              <span className="font-semibold">
                {new Date(`${currentDate}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long' })},{' '}
                {dayLabel(currentDate)}
              </span>
            </div>

            <div className="mt-6 grid grid-cols-[1fr_2.5rem_9rem] items-baseline border-b border-[#9db8d8] pb-0.5 text-[10px] font-semibold tracking-wider text-[#3f77bb]">
              <span>NAME OF COMPANY</span>
              <span />
              <span>DATE OF LAST ENTRY</span>
            </div>

            {!selectedCompany && (
              // Tally leaves this line empty after Shut Company and waits.
              <div className="pt-4 italic text-[#5b7aa0]">No company loaded — press F1 or F3 to select one.</div>
            )}

            {/*
              This list IS the "NAME OF COMPANY" column — the loaded company is
              simply the bold row in it. It used to be printed once above the
              list as well, so the open company appeared twice.
            */}
            <div className="pt-4">
              {companies.map((c) => (
                // Tally loads the company you pick from this list — same action
                // as the F3 company pop-up, one click closer.
                <button
                  key={c.id}
                  type="button"
                  onClick={() => accountingCompany?.setSelectedCompanyId(c.id)}
                  title={`Load ${c.company_name}`}
                  className={`grid w-full grid-cols-[1fr_2.5rem_9rem] items-baseline text-left hover:bg-[#fdf6d8] ${
                    c.id === accountingCompany?.selectedCompanyId ? 'font-bold text-black' : ''
                  }`}
                >
                  <span className="min-w-0 truncate">{c.company_name}</span>
                  <span className="text-center">{companyInfo[c.id]?.exceptions ? '(e)' : ''}</span>
                  <span>{companyInfo[c.id]?.lastEntry ? isoDateLabel(companyInfo[c.id].lastEntry as string) : ''}</span>
                </button>
              ))}
            </div>

            {anyExceptions && <div className="mt-auto pb-2 pt-8 font-semibold">* (e) Data exceptions exist</div>}
          </div>

          {/* Right: the menu itself */}
          <div className="flex flex-1 justify-center pt-8">
            <div className="w-[345px]">
              {/* Breadcrumb of the menus above this one */}
              {stack.slice(0, -1).map((id) => (
                <div key={id} className="pl-[92px] italic leading-[18px] text-[#4a4a4a]">
                  {MENUS[id].title}
                </div>
              ))}

              {/* Tally's menu box floats above the canvas rather than sitting flat on it */}
              <div className="border border-[#8fb0d4] bg-[#f4f8fd] shadow-md">
                <div className="bg-[#2a68a8] py-[3px] text-center font-semibold text-white">{menu.title}</div>
                <div className="pb-2 pt-3">
                  {menu.sections.map((section, si) => (
                    <React.Fragment key={section.heading ?? `s${si}`}>
                      {section.heading && (
                        // Aligned with the item text below it, not 4px short of it
                        <div className="pb-0.5 pl-[92px] pt-3 text-[10px] font-semibold tracking-wider text-[#5d92c8]">
                          {section.heading}
                        </div>
                      )}
                      {section.items.map((item) => {
                        flatIndex += 1;
                        return row(item, flatIndex);
                      })}
                    </React.Fragment>
                  ))}
                  <button
                    type="button"
                    onClick={back}
                    onMouseEnter={() => setCursor(flat.length)}
                    className={`mt-6 block w-full py-[1px] pl-[92px] text-left leading-[18px] ${
                      cursor === flat.length ? 'bg-[#ffc423] text-black' : 'text-[#1a4d8f]'
                    }`}
                  >
                    <span className="font-semibold underline">Q</span>uit
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </TallyScreen>

      {popup === 'date' && (
        <ChangePeriod
          mode="date"
          from={currentDate}
          onAccept={(iso) => {
            setCurrentDate(iso);
            setPopup(null);
          }}
          onClose={() => setPopup(null)}
        />
      )}

      {popup === 'period' && (
        <ChangePeriod
          mode="period"
          from={period.from}
          to={period.to}
          onAccept={(from, to) => {
            setPeriod({ from, to });
            setPopup(null);
          }}
          onClose={() => setPopup(null)}
        />
      )}

      {popup === 'company' && <CompanySelectPopup onClose={() => setPopup(null)} />}

      {popup === 'company-info' && (
        <CompanyInfoPopup onClose={() => setPopup(null)} onSelectCompany={() => setPopup('company')} />
      )}

      {popup === 'quit' && (
        <TallyPopup
          title="Quit?"
          width={220}
          onAccept={() => {
            setPopup(null);
            window.history.back();
          }}
          onClose={() => setPopup(null)}
        >
          <div className="py-1 text-center">Leave the accounting module?</div>
          <div className="pt-1 text-center text-[11px] italic text-gray-500">A: Accept · Q: Quit</div>
        </TallyPopup>
      )}
    </>
  );
};

export default GatewayOfTally;
