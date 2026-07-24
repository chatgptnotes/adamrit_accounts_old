import React, { useCallback, useMemo, useState } from 'react';
import type { RailItem } from './TallyChrome';
import { getTallyConfig } from './TallyChrome';
import { useAccountingCompanyOptional } from '../AccountingCompanyContext';
import ChangePeriod from './ChangePeriod';
import BasisOfValues, { DEFAULT_BASIS, SCALE_DIVISOR, type ValueBasis } from './BasisOfValues';
import ChangeView, { DEFAULT_VIEWS, type AlternateView } from './ChangeView';
import ApplyFilter, { type ReportFilter } from './ApplyFilter';
import { AutoColumnBox, ColumnBox, columnTitle, shiftYear, type PeriodColumn } from './ColumnBox';

/**
 * The state behind Tally's right-hand button rail, shared by every accounting
 * screen so the rail is identical wherever you are: F2 Period, F3 Company,
 * B Basis of Values, H Change View, J Exception Reports, L Save View,
 * F/Ctrl+F filters, C/A/D/N columns and P Print.
 *
 * A screen supplies only its own F4–F10 buttons; the unclaimed F-slots become
 * jumps to the other reports (Tally's "F10: Other Reports"), so no key on the
 * rail is ever dead.
 */

export type { PeriodColumn, ReportFilter, ValueBasis };

type Popup = null | 'period' | 'basis' | 'view' | 'filter' | 'filter-details' | 'new-column' | 'alter-column' | 'auto-column';

const goTo = (target: string) => window.dispatchEvent(new CustomEvent('tally-goto', { detail: target }));

/** Report jumps that fill any F-slot the screen does not claim. */
const SPARE_SLOTS: { label: string; target: string }[] = [
  { label: 'Day Book', target: 'day-book' },
  { label: 'Trial Balance', target: 'trial-balance' },
  { label: 'Ledger Vouchers', target: 'ledger-view' },
  { label: 'Group Summary', target: 'group-summary' },
  { label: 'Cash/Bank Summary', target: 'cash-bank-summary' },
  { label: 'Balance Sheet', target: 'balance-sheet' },
];

const isDefaultBasis = (b: ValueBasis): boolean =>
  b.scale === DEFAULT_BASIS.scale &&
  b.showPaise === DEFAULT_BASIS.showPaise &&
  b.hideZero === DEFAULT_BASIS.hideZero &&
  b.minAmount === DEFAULT_BASIS.minAmount;

export interface UseTallyReportOptions {
  /** Opening period — defaults to the running financial year to today */
  from?: string;
  to?: string;
  /** The screen's own F4–F10 buttons; F-slots are sorted into Tally's order */
  screenKeys?: RailItem[];
  /**
   * Puts the Detailed / Condensed toggle on this F-key, the way Tally's
   * reports carry "F5: Ledger-wise". H: Change View sets the same state.
   */
  detailedToggle?: { hotkey: string; label?: string };
  /** Screens that open expanded regardless of the F12 preference */
  initialDetailed?: boolean;
  /** Columns offered by F: Apply Filter (first one is the default) */
  filterFields?: string[];
  /** Related reports listed by H: Change View */
  views?: AlternateView[];
  /** Screens with no comparison column of their own opt out of C/A/D/N */
  supportsColumns?: boolean;
}

export interface TallyReport {
  from: string;
  to: string;
  setPeriod: (from: string, to: string) => void;
  detailed: boolean;
  setDetailed: (detailed: boolean) => void;
  basis: ValueBasis;
  filters: ReportFilter[];
  columns: PeriodColumn[];
  /** Format an amount under the current Basis of Values */
  fmtAmount: (amount: number) => string;
  /** False when Basis of Values says this line should be dropped */
  passesBasis: (amount: number) => boolean;
  /** False when an active filter excludes this row */
  passesFilter: (values: Record<string, string | number | null | undefined>) => boolean;
  /** The full rail, ready to hand to TallyScreen */
  rail: RailItem[];
  /** Render next to <TallyScreen> — the pop-ups the rail opens */
  popups: React.ReactNode;
}

const fyStart = (): string => {
  const now = new Date();
  const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${y}-04-01`;
};

const today = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function useTallyReport(options: UseTallyReportOptions = {}): TallyReport {
  const {
    screenKeys = [],
    detailedToggle,
    filterFields = ['Particulars'],
    views = DEFAULT_VIEWS,
    supportsColumns = true,
  } = options;
  const accountingCompany = useAccountingCompanyOptional();

  const [from, setFrom] = useState(options.from ?? fyStart);
  const [to, setTo] = useState(options.to ?? today);
  const [detailed, setDetailed] = useState(() => options.initialDetailed ?? getTallyConfig().defaultDetailed);
  const [basis, setBasis] = useState<ValueBasis>(DEFAULT_BASIS);
  const [filters, setFilters] = useState<ReportFilter[]>([]);
  const [columns, setColumns] = useState<PeriodColumn[]>([]);
  const [popup, setPopup] = useState<Popup>(null);

  const setPeriod = useCallback((nextFrom: string, nextTo: string) => {
    setFrom(nextFrom);
    setTo(nextTo);
  }, []);

  const fmtAmount = useCallback(
    (amount: number) => {
      const digits = basis.showPaise ? 2 : 0;
      return new Intl.NumberFormat('en-IN', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(amount / SCALE_DIVISOR[basis.scale]);
    },
    [basis],
  );

  const passesBasis = useCallback(
    (amount: number) => {
      if (basis.hideZero && amount === 0) return false;
      return Math.abs(amount) >= basis.minAmount;
    },
    [basis],
  );

  const passesFilter = useCallback(
    (values: Record<string, string | number | null | undefined>) =>
      filters.every((f) => String(values[f.field] ?? '').toLowerCase().includes(f.contains.toLowerCase())),
    [filters],
  );

  const addColumn = useCallback((column: Omit<PeriodColumn, 'id'>) => {
    setColumns((cols) => [...cols, { ...column, id: `${column.from}:${column.to}:${cols.length}` }]);
  }, []);

  // The screen's own buttons, plus report jumps in whatever F-slots are left
  // over, all laid out in F4 → F10 order.
  const screenRail = useMemo(() => {
    const own: RailItem[] = detailedToggle
      ? [
          ...screenKeys,
          {
            hotkey: detailedToggle.hotkey,
            label: detailedToggle.label ?? 'Ledger-wise',
            active: detailed,
            onClick: () => setDetailed((v) => !v),
          },
        ]
      : screenKeys;

    const claimed = new Set(own.map((item) => item.hotkey?.toUpperCase()));
    const spares = [...SPARE_SLOTS];
    const filler: RailItem[] = [];
    for (const slot of ['F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10']) {
      if (claimed.has(slot)) continue;
      // F10 is Tally's "Other Reports"; the rest jump to a specific report
      const spare = slot === 'F10' ? undefined : spares.shift();
      filler.push(
        spare
          ? { hotkey: slot, label: spare.label, onClick: () => goTo(spare.target) }
          : { hotkey: slot, label: 'Other Reports', onClick: () => setPopup('view') },
      );
    }

    // Sort by F-slot, keeping any hotkey-less buttons (ledger lists, voucher
    // types) attached to the button they were declared under.
    const blocks: { slot: number; items: RailItem[] }[] = [];
    for (const item of [...own, ...filler]) {
      const slot = /^F(\d+)$/.exec(item.hotkey?.toUpperCase() ?? '');
      if (slot) blocks.push({ slot: Number(slot[1]), items: [item] });
      else if (blocks.length > 0) blocks[blocks.length - 1].items.push(item);
      else blocks.push({ slot: 0, items: [item] });
    }
    blocks.sort((a, b) => a.slot - b.slot);
    const items = blocks.flatMap((b) => b.items);
    return items.map((item, i) => (i === 0 ? { ...item, gapBefore: true } : item));
  }, [screenKeys, detailedToggle, detailed]);

  const rail = useMemo<RailItem[]>(
    () => [
      { hotkey: 'F2', label: 'Period', onClick: () => setPopup('period') },
      { hotkey: 'F3', label: 'Company', onClick: accountingCompany?.cycleCompany },
      ...screenRail,
      {
        hotkey: 'B',
        label: 'Basis of Values',
        gapBefore: true,
        active: !isDefaultBasis(basis),
        onClick: () => setPopup('basis'),
      },
      { hotkey: 'H', label: 'Change View', active: detailed, onClick: () => setPopup('view') },
      { hotkey: 'J', label: 'Exception Reports', onClick: () => goTo('exception-reports') },
      {
        hotkey: 'L',
        label: 'Save View',
        onClick: () => window.dispatchEvent(new CustomEvent('tally-save-view')),
      },
      {
        hotkey: 'F',
        label: filters.length > 0 ? `Filter (${filters.length})` : 'Apply Filter',
        gapBefore: true,
        active: filters.length > 0,
        onClick: () => setPopup('filter'),
      },
      { hotkey: 'F', mod: 'ctrl' as const, label: 'Filter Details', onClick: () => setPopup('filter-details') },
      ...(supportsColumns
        ? [
            { hotkey: 'C', label: 'New Column', gapBefore: true, onClick: () => setPopup('new-column') },
            {
              hotkey: 'A',
              label: 'Alter Column',
              disabled: columns.length === 0,
              onClick: () => setPopup('alter-column'),
            },
            {
              hotkey: 'D',
              label: 'Delete Column',
              disabled: columns.length === 0,
              onClick: () => setColumns((cols) => cols.slice(0, -1)),
            },
            { hotkey: 'N', label: 'Auto Column', onClick: () => setPopup('auto-column') },
          ]
        : []),
      { hotkey: 'P', label: 'Print', gapBefore: true, onClick: () => window.print() },
    ],
    [accountingCompany, screenRail, basis, detailed, filters, columns.length, supportsColumns],
  );

  const lastColumn = columns[columns.length - 1];

  const popups = (
    <>
      {popup === 'period' && (
        <ChangePeriod
          from={from}
          to={to}
          onAccept={(nextFrom, nextTo) => {
            setPeriod(nextFrom, nextTo);
            setPopup(null);
          }}
          onClose={() => setPopup(null)}
        />
      )}
      {popup === 'basis' && (
        <BasisOfValues
          basis={basis}
          onAccept={(next) => {
            setBasis(next);
            setPopup(null);
          }}
          onClose={() => setPopup(null)}
        />
      )}
      {popup === 'view' && (
        <ChangeView
          detailed={detailed}
          views={views}
          onDetailed={(next) => {
            setDetailed(next);
            setPopup(null);
          }}
          onClose={() => setPopup(null)}
        />
      )}
      {(popup === 'filter' || popup === 'filter-details') && (
        <ApplyFilter
          mode={popup === 'filter' ? 'apply' : 'details'}
          fields={filterFields}
          filters={filters}
          onAccept={(next) => {
            setFilters(next);
            setPopup(null);
          }}
          onClose={() => setPopup(null)}
        />
      )}
      {popup === 'new-column' && (
        <ColumnBox
          title="New Column"
          column={{ from: shiftYear(from), to: shiftYear(to), title: columnTitle(shiftYear(from), shiftYear(to)) }}
          onAccept={(column) => {
            addColumn(column);
            setPopup(null);
          }}
          onClose={() => setPopup(null)}
        />
      )}
      {popup === 'alter-column' && lastColumn && (
        <ColumnBox
          title="Alter Column"
          column={lastColumn}
          onAccept={(column) => {
            setColumns((cols) => [...cols.slice(0, -1), { ...column, id: lastColumn.id }]);
            setPopup(null);
          }}
          onClose={() => setPopup(null)}
        />
      )}
      {popup === 'auto-column' && (
        <AutoColumnBox
          from={from}
          to={to}
          onAccept={(cols) => {
            setColumns(cols.map((c, i) => ({ ...c, id: `${c.from}:${c.to}:${i}` })));
            setPopup(null);
          }}
          onClose={() => setPopup(null)}
        />
      )}
    </>
  );

  return {
    from,
    to,
    setPeriod,
    detailed,
    setDetailed,
    basis,
    filters,
    columns,
    fmtAmount,
    passesBasis,
    passesFilter,
    rail,
    popups,
  };
}
