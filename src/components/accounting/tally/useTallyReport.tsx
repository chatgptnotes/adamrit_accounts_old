import React, { useCallback, useMemo, useRef, useState } from 'react';
import type { RailItem } from './TallyChrome';
import { getTallyConfig, openCompanyList } from './TallyChrome';
import { useShortcuts } from './keyboard';
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
import ReportConfigure, { defaultsOf, type ReportConfig, type ReportConfigField } from './ReportConfigure';
import { emailReport, exportReport, type ReportExport } from './reportExport';
import { printTallyReport } from '@/lib/tallyPrint';
import { useTallyLetterhead } from './useLetterhead';

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

export type { PeriodColumn, ReportFilter, ValueBasis, ReportConfig, ReportConfigField };

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
  | 'auto-column'
  | 'configure';

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
  /** Stable key for a screen-scoped period retained during the Accounting session. */
  screenKey?: string;
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
  detailedToggle?: { hotkey: string; mod?: 'alt' | 'ctrl'; label?: string };
  /** Screens that open expanded regardless of the F12 preference */
  initialDetailed?: boolean;
  /** Columns offered by F: Apply Filter (first one is the default) */
  filterFields?: string[];
  /** Related reports listed by H: Change View */
  views?: AlternateView[];
  /** Screens with no comparison column of their own opt out of C/A/D/N */
  supportsColumns?: boolean;
  /**
   * This report's own F12: Configure switches. Tally's F12 is per-report —
   * "Show Opening Balance" on the Trial Balance, "Show Narrations" on the Day
   * Book. Answers come back on `report.config`.
   */
  configFields?: ReportConfigField[];
  /**
   * The report's rows for Alt+E: Export and Alt+M: E-mail. Screens that do not
   * supply this draw both keys greyed, the way Tally greys an action a screen
   * cannot perform.
   */
  exportData?: () => ReportExport;
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
  /**
   * Replace the comparison columns outright. F6: Monthly uses this to lay one
   * column per month across the report; pass [] to go back to a single period.
   */
  replaceColumns: (columns: Omit<PeriodColumn, 'id'>[]) => void;
  /** Format an amount under the current Basis of Values */
  fmtAmount: (amount: number) => string;
  /** False when Basis of Values says this line should be dropped */
  passesBasis: (amount: number) => boolean;
  /** False when an active filter excludes this row */
  passesFilter: (values: Record<string, string | number | null | undefined>) => boolean;
  /** Answers to this report's F12: Configure switches, keyed by field */
  config: ReportConfig;
  /** The full rail, ready to hand to TallyScreen */
  rail: RailItem[];
  /** Render next to <TallyScreen> — the pop-ups the rail opens */
  popups: React.ReactNode;
}

export function useTallyReport(options: UseTallyReportOptions = {}): TallyReport {
  const {
    scope = 'company',
    screenKey,
    supportsPeriod = true,
    screenKeys = [],
    detailedToggle,
    filterFields = ['Particulars'],
    views = DEFAULT_VIEWS,
    supportsColumns = true,
    configFields = [],
    exportData,
  } = options;
  const accountingCompany = useAccountingCompanyOptional();
  const periodContext = useAccountingPeriodOptional();

  // Company-scoped screens read Tally's one shared period; screen-scoped ones
  // (and any screen rendered outside the provider) keep their own.
  const [ownPeriod, setOwnPeriod] = useState<AccountingPeriod>(() => {
    const fy = currentFinancialYear();
    const fallback = { from: options.from ?? fy.from, to: options.to ?? fy.to };
    return (screenKey && periodContext?.screenPeriods[screenKey]) || fallback;
  });
  const shared = scope === 'company' ? periodContext : null;
  const period = shared ? shared.period : ownPeriod;
  const { from, to } = period;

  const [detailed, setDetailed] = useState(() => options.initialDetailed ?? getTallyConfig().defaultDetailed);
  const [basis, setBasis] = useState<ValueBasis>(DEFAULT_BASIS);
  const [filters, setFilters] = useState<ReportFilter[]>([]);
  const [columns, setColumns] = useState<PeriodColumn[]>([]);
  const [popup, setPopup] = useState<Popup>(null);
  const [config, setConfig] = useState<ReportConfig>(() => defaultsOf(configFields));

  // Held in a ref, not a dependency: a screen builds its export rows from state
  // declared further down its own body, so the callback is a fresh closure on
  // every render and would otherwise rebuild the rail each time. Whether the
  // screen exports at all does not change while it is mounted.
  const exportRef = useRef(exportData);
  exportRef.current = exportData;
  const canExport = !!exportData;
  const letterhead = useTallyLetterhead();

  const setPeriod = useCallback(
    (nextFrom: string, nextTo: string) => {
      if (shared) shared.setPeriod({ from: nextFrom, to: nextTo });
      else {
        const next = { from: nextFrom, to: nextTo };
        if (screenKey && periodContext) periodContext.setScreenPeriod(screenKey, next);
        setOwnPeriod(next);
      }
    },
    [shared, screenKey, periodContext],
  );

  // Tally's PgDn / PgUp: walk the period forward or back by its own length.
  // The row cursor used to bind these too, as a ±10-row jump; whichever hook
  // registered first won. Tally steps the period here, so that is what stays.
  const stepBy = useCallback(
    (direction: 1 | -1) => {
      const next = stepPeriod(period, direction);
      setPeriod(next.from, next.to);
    },
    [period, setPeriod],
  );
  useShortcuts(
    [
      { combo: 'PageDown', layer: 'screen', label: 'Next / previous period', run: () => stepBy(1) },
      { combo: 'PageUp', layer: 'screen', run: () => stepBy(-1) },
    ],
    supportsPeriod,
  );

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

  const replaceColumns = useCallback((next: Omit<PeriodColumn, 'id'>[]) => {
    setColumns(next.map((c, i) => ({ ...c, id: `${c.from}:${c.to}:${i}` })));
  }, []);

  const addColumn = useCallback((column: Omit<PeriodColumn, 'id'>) => {
    setColumns((cols) => [...cols, { ...column, id: `${column.from}:${column.to}:${cols.length}` }]);
  }, []);

  // The screen's own buttons, laid out in F4 → F10 order. Tally leaves every
  // F-slot the report has no action for blank and greyed, so we do too.
  const screenRail = useMemo(() => {
    // Tally's Detailed / Condensed toggle. A screen that names its own key
    // (the Day Book's "Alt+F5: Detailed", a report's "F5: Ledger-wise") keeps
    // it and picks up Alt+F1 / Alt+F5 as unlabelled aliases; a screen that
    // names none gets the Alt+F5 button Tally shows by default.
    const toggle: RailItem = {
      hotkey: detailedToggle?.hotkey ?? 'F5',
      mod: detailedToggle?.mod ?? 'alt',
      aliases: [
        { hotkey: 'F1', mod: 'alt' as const },
        { hotkey: 'F5', mod: 'alt' as const },
      ],
      label: detailedToggle?.label ?? 'Detailed',
      active: detailed,
      onClick: () => setDetailed((v) => !v),
    };
    const own: RailItem[] = [...screenKeys, toggle];

    // Sort by F-slot, keeping any hotkey-less buttons (ledger lists, voucher
    // types) attached to the button they were declared under.
    //
    // An F-slot the report has no action for is left genuinely blank. We used
    // to push a `{ label: '', disabled: true }` filler into every unclaimed
    // slot, which drew a row of empty bordered grey buttons — Tally shows
    // nothing at all there.
    const blocks: { slot: number; items: RailItem[] }[] = [];
    for (const item of own) {
      const slot = /^F(\d+)$/.exec(item.hotkey?.toUpperCase() ?? '');
      if (slot) blocks.push({ slot: Number(slot[1]), items: [item] });
      else if (blocks.length > 0) blocks[blocks.length - 1].items.push(item);
      else blocks.push({ slot: 0, items: [item] });
    }
    blocks.sort((a, b) => a.slot - b.slot);
    // Tally groups F2/F3/F4 together and starts a fresh group at F5 — with the
    // fillers gone the gap goes on whichever button opens the F5-and-up group.
    const gapAt = blocks.findIndex((b) => b.slot >= 5);
    return blocks.flatMap((block, i) =>
      i === gapAt && i >= 0
        ? block.items.map((item, j) => (j === 0 ? { ...item, gapBefore: true } : item))
        : block.items,
    );
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
      { hotkey: 'F3', label: 'Company', onClick: accountingCompany ? openCompanyList : undefined },
      ...screenRail,
      // Tally labels these report keys with Ctrl / Alt. The bare letters this
      // module shipped with stay bound as unlabelled aliases so nothing anyone
      // has learned stops working.
      {
        hotkey: 'B',
        mod: 'ctrl' as const,
        // Ctrl+F12 is Tally's value filter — Basis of Values is that filter here
        aliases: [{ hotkey: 'B' }, { hotkey: 'F12', mod: 'ctrl' as const }],
        label: 'Basis of Values',
        gapBefore: true,
        active: !isDefaultBasis(basis),
        onClick: () => setPopup('basis'),
      },
      {
        hotkey: 'H',
        mod: 'ctrl' as const,
        aliases: [{ hotkey: 'H' }],
        label: 'Change View',
        active: detailed,
        onClick: () => setPopup('view'),
      },
      {
        hotkey: 'J',
        mod: 'ctrl' as const,
        aliases: [{ hotkey: 'J' }],
        label: 'Exception Reports',
        onClick: () => goTo('exception-reports'),
      },
      {
        hotkey: 'L',
        mod: 'ctrl' as const,
        aliases: [{ hotkey: 'L' }],
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
            {
              hotkey: 'C',
              mod: 'alt' as const,
              aliases: [{ hotkey: 'C' }],
              label: 'New Column',
              gapBefore: true,
              onClick: () => setPopup('new-column'),
            },
            {
              hotkey: 'A',
              mod: 'alt' as const,
              aliases: [{ hotkey: 'A' }],
              label: 'Alter Column',
              disabled: columns.length === 0,
              onClick: () => setPopup('alter-column'),
            },
            {
              hotkey: 'D',
              mod: 'alt' as const,
              aliases: [{ hotkey: 'D' }],
              label: 'Delete Column',
              disabled: columns.length === 0,
              onClick: () => setColumns((cols) => cols.slice(0, -1)),
            },
            {
              hotkey: 'N',
              mod: 'alt' as const,
              aliases: [{ hotkey: 'N' }],
              label: 'Auto Column',
              onClick: () => setPopup('auto-column'),
            },
          ]
        : []),
      // Tally Prime's Print / Export / E-mail block. A screen that has not
      // handed over its rows draws Export and E-mail greyed rather than
      // exporting something that does not match what is on the page.
      {
        hotkey: 'P',
        mod: 'alt' as const,
        // Same alias the voucher screen carries, so the key behaves the same
        // everywhere rather than only where a modifier happens to register.
        aliases: [{ hotkey: 'P' }],
        label: 'Print',
        gapBefore: true,
        // A screen that has not handed over its rows cannot be laid out as a
        // Tally report, so it falls back to printing the page as it stands.
        onClick: () =>
          canExport
            ? void printTallyReport(exportRef.current!(), letterhead.orgName, letterhead.addressLines)
            : window.print(),
      },
      {
        hotkey: 'E',
        mod: 'alt' as const,
        // Tally accepts Ctrl+E as well as Alt+E for Export
        aliases: [{ hotkey: 'E', mod: 'ctrl' as const }],
        label: 'Export',
        disabled: !canExport,
        onClick: canExport ? () => void exportReport(exportRef.current!()) : undefined,
      },
      {
        hotkey: 'M',
        mod: 'alt' as const,
        label: 'E-mail',
        disabled: !canExport,
        onClick: canExport ? () => void emailReport(exportRef.current!()) : undefined,
      },
      // Tally's rail ends with Help / Features / Configure.
      {
        hotkey: 'F1',
        label: 'Help',
        gapBefore: true,
        onClick: () => window.dispatchEvent(new CustomEvent('tally-help')),
      },
      { hotkey: 'F11', label: 'Features', onClick: () => window.dispatchEvent(new CustomEvent('tally-features')) },
      {
        // Chrome will not release a bare F12 — Alt+F12 is the one that works.
        hotkey: 'F12',
        mod: 'alt' as const,
        aliases: [{ hotkey: 'F12' }],
        label: 'Configure',
        active: configFields.some((f) => config[f.key] !== (f.value ?? false)),
        onClick: () =>
          configFields.length > 0
            ? setPopup('configure')
            : window.dispatchEvent(new CustomEvent('tally-configure')),
      },
      // No P: Print here — Tally's report rail ends at Configure, Print sits in
      // the top bar and on the bottom key bar.
    ],
    [
      periodKeys,
      accountingCompany,
      screenRail,
      basis,
      detailed,
      filters,
      columns.length,
      supportsColumns,
      configFields,
      config,
      canExport,
      letterhead,
    ],
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
      {popup === 'configure' && configFields.length > 0 && (
        <ReportConfigure
          fields={configFields}
          config={config}
          onAccept={(next) => {
            setConfig(next);
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
    replaceColumns,
    fmtAmount,
    passesBasis,
    passesFilter,
    config,
    rail,
    popups,
  };
}
