import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { RailItem } from './TallyChrome';
import { getTallyConfig, isTypingTarget, tallyModalIsOpen } from './TallyChrome';
import { useAccountingCompanyOptional } from '../AccountingCompanyContext';
import {
  currentFinancialYear,
  periodLabel as labelOf,
  stepPeriod,
  useAccountingPeriodOptional,
  type AccountingPeriod,
} from './PeriodContext';
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

type Popup =
  | null
  | 'period'
  | 'date'
  | 'basis'
  | 'view'
  | 'filter'
  | 'filter-details'
  | 'new-column'
  | 'alter-column'
  | 'auto-column';

const goTo = (target: string) => window.dispatchEvent(new CustomEvent('tally-goto', { detail: target }));

const isDefaultBasis = (b: ValueBasis): boolean =>
  b.scale === DEFAULT_BASIS.scale &&
  b.showPaise === DEFAULT_BASIS.showPaise &&
  b.hideZero === DEFAULT_BASIS.hideZero &&
  b.minAmount === DEFAULT_BASIS.minAmount;

export interface UseTallyReportOptions {
  /**
   * 'company' (default) shares Tally's one Current Period with every other
   * screen. 'screen' keeps a period of this screen's own — for the day-scoped
   * screens (Day Book, Edit Log) Tally opens on a single date, not the period.
   */
  scope?: 'company' | 'screen';
  /** Opening period for `scope: 'screen'` — defaults to the financial year */
  from?: string;
  to?: string;
  /** Masters and data-entry screens carry no period at all in Tally */
  supportsPeriod?: boolean;
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
  /** "1-Apr-26 to 31-Mar-27" — the caption under a Tally report title */
  periodLabel: string;
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

export function useTallyReport(options: UseTallyReportOptions = {}): TallyReport {
  const {
    scope = 'company',
    supportsPeriod = true,
    screenKeys = [],
    detailedToggle,
    filterFields = ['Particulars'],
    views = DEFAULT_VIEWS,
    supportsColumns = true,
  } = options;
  const accountingCompany = useAccountingCompanyOptional();
  const periodContext = useAccountingPeriodOptional();

  // Company-scoped screens read Tally's one shared period; screen-scoped ones
  // (and any screen rendered outside the provider) keep their own.
  const [ownPeriod, setOwnPeriod] = useState<AccountingPeriod>(() => {
    const fy = currentFinancialYear();
    return { from: options.from ?? fy.from, to: options.to ?? fy.to };
  });
  const shared = scope === 'company' ? periodContext : null;
  const period = shared ? shared.period : ownPeriod;
  const { from, to } = period;

  const [detailed, setDetailed] = useState(() => options.initialDetailed ?? getTallyConfig().defaultDetailed);
  const [basis, setBasis] = useState<ValueBasis>(DEFAULT_BASIS);
  const [filters, setFilters] = useState<ReportFilter[]>([]);
  const [columns, setColumns] = useState<PeriodColumn[]>([]);
  const [popup, setPopup] = useState<Popup>(null);

  const setPeriod = useCallback(
    (nextFrom: string, nextTo: string) => {
      if (shared) shared.setPeriod({ from: nextFrom, to: nextTo });
      else setOwnPeriod({ from: nextFrom, to: nextTo });
    },
    [shared],
  );

  // Tally's PgDn / PgUp: walk the period forward or back by its own length.
  useEffect(() => {
    if (!supportsPeriod) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || tallyModalIsOpen() || isTypingTarget(e.target)) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const direction = e.key === 'PageDown' ? 1 : e.key === 'PageUp' ? -1 : 0;
      if (!direction) return;
      e.preventDefault();
      const next = stepPeriod(period, direction as 1 | -1);
      setPeriod(next.from, next.to);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [supportsPeriod, period, setPeriod]);

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

  // The screen's own buttons, laid out in F4 → F10 order. Tally leaves every
  // F-slot the report has no action for blank and greyed, so we do too.
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
    const filler: RailItem[] = [];
    for (const slot of ['F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10']) {
      if (claimed.has(slot)) continue;
      filler.push({ hotkey: slot, label: '', disabled: true });
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
    // Tally groups F2/F3/F4 together and starts a fresh group at F5
    return blocks
      .flatMap((b) => b.items)
      .map((item) => (item.hotkey?.toUpperCase() === 'F5' ? { ...item, gapBefore: true } : item));
  }, [screenKeys, detailedToggle, detailed]);

  // Tally puts "F2: Period" on a report and "F2: Date · Alt+F2: Period" on the
  // day-scoped screens, where you pick a day first and widen to a range second.
  const periodKeys = useMemo<RailItem[]>(() => {
    if (!supportsPeriod) return [];
    if (scope === 'screen') {
      return [
        { hotkey: 'F2', label: 'Date', onClick: () => setPopup('date') },
        { hotkey: 'F2', mod: 'alt' as const, label: 'Period', onClick: () => setPopup('period') },
      ];
    }
    return [{ hotkey: 'F2', label: 'Period', onClick: () => setPopup('period') }];
  }, [supportsPeriod, scope]);

  const rail = useMemo<RailItem[]>(
    () => [
      ...periodKeys,
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
      // No P: Print here — Tally's report rail ends at Ctrl+F: Filter Details,
      // Print sits in the top bar.
    ],
    [periodKeys, accountingCompany, screenRail, basis, detailed, filters, columns.length, supportsColumns],
  );

  const lastColumn = columns[columns.length - 1];

  const popups = (
    <>
      {(popup === 'period' || popup === 'date') && (
        <ChangePeriod
          mode={popup}
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
    periodLabel: labelOf(period),
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
