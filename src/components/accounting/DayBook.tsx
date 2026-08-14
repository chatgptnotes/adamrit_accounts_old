import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { TallyReportHeader, TallyScreen, getTallyConfig, voucherBottomBar } from './tally/TallyChrome';
import { TallyList } from './tally/TallyPopup';
import { useTallyReport } from './tally/useTallyReport';
import { useRowCursor } from './tally/useRowCursor';
import { fetchTallyVouchers } from '@/lib/mergedVouchers';
import { normalizeName } from '@/lib/tallyCompanyMatch';
import { useSourceFilter, matchesSource } from './useSourceFilter';
import { useAccountingCompany } from './AccountingCompanyContext';
import { useVoucherActions } from '@/hooks/useVoucherActions';
import { toast } from 'sonner';
import { VoucherAttachmentButton, useVoucherAttachmentMap } from './VoucherAttachmentViewer';
import { openGeneratedInvoice, useGeneratedInvoiceMap } from '@/lib/generated-voucher-invoices';
import { openStoredDocument } from '@/lib/openStoredDocument';
import { printTallyVoucher } from '@/lib/tallyPrint';
import { BadgeCheck, FileText, Printer } from 'lucide-react';

type LedgerSource = 'adamrit' | 'tally';

interface DayRow {
  id: string;
  nativeId: string | null;
  date: string;
  particulars: string;
  type: string;
  /** Voucher category (RECEIPT / PAYMENT / CONTRA / …) — drives the printed
   *  layout, since Tally prints those three in single-account mode. */
  category: string;
  number: string;
  debit: number;
  credit: number;
  narration: string | null;
  entries: { label: string; debit: number; credit: number }[];
  cancelled: boolean;
  isAuto: boolean;
  source: LedgerSource;
}

interface VoucherType {
  id: string;
  voucher_type_name: string;
  voucher_category: string;
}

interface EntryRow {
  id: string;
  debit_amount: number;
  credit_amount: number;
  narration: string | null;
  entry_order: number;
  account: { id: string; account_name: string; account_code: string } | null;
}

interface Voucher {
  id: string;
  voucher_number: string;
  voucher_date: string;
  reference_number: string | null;
  narration: string | null;
  total_amount: number;
  status: string;
  is_auto?: boolean;
  voucher_type: VoucherType | null;
  voucher_entries: EntryRow[];
}

const tallyDateLabel = (iso: string): string => {
  const d = new Date(iso + 'T00:00:00');
  const month = d.toLocaleDateString('en-GB', { month: 'short' });
  return `${d.getDate()}-${month}-${String(d.getFullYear()).slice(2)}`;
};

const summarySides = (
  voucherType: string,
  total: number,
  entries: { debit: number; credit: number; order: number }[],
): { debit: number; credit: number } => {
  const normalizedType = voucherType.toLowerCase();
  const amount = total || entries.reduce((sum, entry) => sum + Math.max(entry.debit, entry.credit), 0);

  if (normalizedType.includes('receipt')) return { debit: 0, credit: amount };
  if (normalizedType.includes('payment') || normalizedType.includes('contra')) return { debit: amount, credit: 0 };

  const lead = [...entries]
    .sort((a, b) => a.order - b.order)
    .find((entry) => entry.debit > 0 || entry.credit > 0);
  if (lead?.debit > 0) return { debit: lead.debit, credit: 0 };
  if (lead?.credit > 0) return { debit: 0, credit: lead.credit };
  return { debit: 0, credit: 0 };
};

/**
 * Day Book — Tally Prime replica: one row per voucher (Date, Particulars =
 * lead ledger, Vch Type, Vch No., Debit/Credit amount), click expands to
 * show all ledger lines like Tally's detailed mode.
 */
const DayBook: React.FC<{ onOpenVoucher?: (id: string) => void }> = ({ onOpenVoucher }) => {
  const today = format(new Date(), 'yyyy-MM-dd');
  const [typeFilter, setTypeFilter] = useState('');
  // Regular = authorised up to today; Optional = is_optional; Post-Dated = future-dated
  const [scope, setScope] = useState<'Regular' | 'Optional' | 'Post-Dated'>('Regular');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [typePicker, setTypePicker] = useState(false);
  // Space marks lines; R hides them from the report and U puts the last batch back
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [removedStack, setRemovedStack] = useState<string[][]>([]);
  const { cancelVoucher, deleteVoucher, confirmUI } = useVoucherActions();
  const { source: srcFilter, railItem: sourceRail } = useSourceFilter();
  const { selectedCompanyId } = useAccountingCompany();

  const { data: voucherTypes = [] } = useQuery({
    // Its own key: this list drops prefix / current_number, and sharing
    // ['voucher_types'] with Voucher Entry left that screen numbering from a
    // cached row with no prefix and no counter — it renumbered vouchers "0001".
    queryKey: ['voucher_types', 'names'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('voucher_types')
        .select('id, voucher_type_name, voucher_category')
        .eq('is_active', true)
        .order('voucher_type_name');
      if (error) throw error;
      return data as VoucherType[];
    },
  });

  const report = useTallyReport({
    // Tally's Day Book opens on a single date (F2: Date), not the shared period
    scope: 'screen',
    screenKey: 'day-book',
    from: getTallyConfig().dayBookMonth ? today.slice(0, 8) + '01' : today,
    to: today,
    filterFields: ['Particulars', 'Narration', 'Vch Type', 'Vch No.'],
    views: [
      { label: 'Registers', target: 'voucher-register' },
      { label: 'Ledger Vouchers', target: 'ledger-view' },
      { label: 'Cash/Bank Book', target: 'cash-bank-book' },
      { label: 'Edit Log', target: 'edit-log' },
    ],
    supportsColumns: false,
    // Tally's Day Book F12
    configFields: [
      { key: 'narrations', label: 'Show Narrations also', value: true },
      { key: 'cancelled', label: 'Show Cancelled Vouchers' },
    ],
    // Tally's Alt+F5 — the Day Book had no Detailed F-key at all, it was only
    // reachable through Change View.
    detailedToggle: { hotkey: 'F5', mod: 'alt', label: 'Detailed' },
    // Alt+E / Alt+M export exactly the rows on screen, filters and all.
    exportData: () => ({
      title: 'Day Book',
      period: report.periodLabel,
      columns: ['Date', 'Particulars', 'Vch Type', 'Vch No.', 'Debit', 'Credit', 'Narration'],
      rows: rows.map((r) => [r.date, r.particulars, r.type, r.number, r.debit, r.credit, r.narration ?? '']),
    }),
    screenKeys: [
      { hotkey: 'F4', label: 'Voucher Type', onClick: () => setTypePicker(true) },
      {
        hotkey: 'F6',
        label: scope,
        active: scope !== 'Regular',
        onClick: () =>
          setScope((cur) => {
            const order: ('Regular' | 'Optional' | 'Post-Dated')[] = ['Regular', 'Optional', 'Post-Dated'];
            return order[(order.indexOf(cur) + 1) % order.length];
          }),
      },
      { ...sourceRail, hotkey: 'F7', gapBefore: false },
      // No F7: Show Profit / F8: Columnar. Both need per-voucher cost of sales,
      // which this installation has no inventory module to supply — a greyed
      // button that can never light up is worse than no button.
    ],
  });
  const { from: fromDate, to: toDate, detailed, fmtAmount: fmt, config } = report;
  const showCancelled = !!config.cancelled;

  const { data: vouchers = [], isLoading } = useQuery({
    queryKey: ['daybook_vouchers', selectedCompanyId, fromDate, toDate, typeFilter, scope, showCancelled],
    enabled: Boolean(selectedCompanyId),
    queryFn: async () => {
      let query = supabase
        .from('vouchers')
        .select(`
          id, voucher_number, voucher_date, reference_number, narration, total_amount, status, is_auto,
          voucher_type:voucher_types(id, voucher_type_name, voucher_category),
          voucher_entries(
            id, debit_amount, credit_amount, narration, entry_order,
            account:chart_of_accounts(id, account_name, account_code)
          )
        `);
      query = query.eq('company_id', selectedCompanyId);
      // Tally lists cancelled vouchers struck through when F12 asks for them;
      // otherwise only authorised ones show.
      const statuses = showCancelled ? ['AUTHORISED', 'CANCELLED'] : ['AUTHORISED'];
      if (scope === 'Optional') {
        query = (query as any).eq('is_optional', true);
      } else if (scope === 'Post-Dated') {
        query = query.in('status', statuses).gt('voucher_date', format(new Date(), 'yyyy-MM-dd'));
      } else {
        query = query.in('status', statuses);
      }
      query = query
        .gte('voucher_date', scope === 'Post-Dated' ? format(new Date(), 'yyyy-MM-dd') : fromDate)
        .lte('voucher_date', scope === 'Post-Dated' ? '2099-12-31' : toDate)
        .order('voucher_date', { ascending: true })
        .order('created_at', { ascending: true })
        .limit(1000);
      if (typeFilter) query = query.eq('voucher_type_id', typeFilter);
      const { data, error } = await query;
      if (error) throw error;
      return data as unknown as Voucher[];
    },
  });
  // Letterhead for the printed voucher. The daybook only ever held the company
  // id, but a voucher cannot print without the name and address on top of it.
  const { data: company } = useQuery({
    queryKey: ['daybook_company', selectedCompanyId],
    enabled: Boolean(selectedCompanyId),
    queryFn: async () => {
      const { data } = await supabase
        .from('companies')
        .select('company_name, address_line1, address_line2')
        .eq('id', selectedCompanyId)
        .maybeSingle();
      return data as { company_name: string; address_line1: string | null; address_line2: string | null } | null;
    },
  });

  /**
   * The voucher itself, printed the way TallyPrime prints one.
   *
   * Every row can produce this — a Tally mirror row as readily as a native one
   * — because it is built from the ledger lines already on the row, not from
   * anything uploaded. Previously a daybook row offered a document only when
   * somebody had attached a proof or an invoice had been generated, so most
   * entries showed nothing at all.
   *
   * Tally puts the cash/bank side in the header as "Through :" instead of in
   * the Particulars table, but only on the single-account categories, and only
   * when that side is one line. Anything else prints in journal layout, which
   * is always correct — it just shows both columns.
   */
  const printRowVoucher = (row: DayRow): void => {
    const category = row.category.toUpperCase();
    const isReceipt = category.includes('RECEIPT');
    const isPayment = category.includes('PAYMENT') || category.includes('CONTRA');
    const lines = row.entries.map((entry) => ({
      name: entry.label.replace(/^(Dr|Cr)\s+/, ''),
      dr: entry.debit,
      cr: entry.credit,
    }));

    let through: string | null = null;
    let rowsToPrint = lines;
    if (isReceipt || isPayment) {
      // On a receipt the cash/bank sits on the debit side; on a payment and a
      // contra, the credit side.
      const throughSide = isReceipt ? lines.filter((l) => l.dr > 0) : lines.filter((l) => l.cr > 0);
      const otherSide = isReceipt ? lines.filter((l) => l.dr <= 0) : lines.filter((l) => l.cr <= 0);
      if (throughSide.length === 1 && otherSide.length > 0) {
        through = throughSide[0].name;
        rowsToPrint = otherSide;
      }
    }

    if (rowsToPrint.length === 0) {
      toast.error('Nothing to print — this entry has no ledger lines');
      return;
    }

    const printed = printTallyVoucher({
      orgName: company?.company_name || 'Hospital',
      addressLines: [company?.address_line1, company?.address_line2].filter(Boolean) as string[],
      voucherTypeName: row.type || 'Voucher',
      voucherNumber: row.number || '',
      voucherDate: row.date,
      category,
      through,
      rows: rowsToPrint,
      narration: row.narration || '',
    });
    if (!printed) toast.error('Popup blocked — allow popups to print');
  };

  const nativeVoucherIds = useMemo(() => vouchers.map((voucher) => voucher.id), [vouchers]);
  const { data: attachmentMap = new Map() } = useVoucherAttachmentMap(nativeVoucherIds);
  // The system-generated invoice behind auto-posted vouchers (expense bills,
  // M.L. Enterprises referral invoices, specialist/OT bills) — every JV shows
  // its evidence, uploaded or generated.
  const voucherRefs = useMemo(
    () => vouchers.map((voucher) => ({ id: voucher.id, referenceNumber: voucher.reference_number })),
    [vouchers],
  );
  const { data: generatedInvoiceMap = new Map() } = useGeneratedInvoiceMap(voucherRefs);

  // Tally mirror vouchers for the same window (Regular scope only — Optional /
  // Post-Dated are native-only concepts). Deduped against native by number.
  const typeName = voucherTypes.find((t) => t.id === typeFilter)?.voucher_type_name;
  const { data: tallyRows = [] } = useQuery({
    queryKey: ['daybook_tally', selectedCompanyId, fromDate, toDate, scope],
    enabled: scope === 'Regular' && Boolean(selectedCompanyId),
    queryFn: () => fetchTallyVouchers({ companyId: selectedCompanyId, from: fromDate, upto: toDate }),
  });

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const leadLedger = (
    voucherType: string,
    entries: { accountName: string; debit: number; credit: number; order: number }[],
  ): string => {
    const sorted = [...entries].sort((a, b) => a.order - b.order);
    const normalizedType = voucherType.toLowerCase();
    const lead = normalizedType.includes('receipt') || normalizedType.includes('contra')
      ? sorted.find((e) => e.credit > 0)
      : sorted.find((e) => e.debit > 0);
    return lead?.accountName ?? sorted[0]?.accountName ?? '';
  };

  const rows: DayRow[] = useMemo(() => {
    const nativeRows: DayRow[] = vouchers.map((v) => {
      const entries = [...(v.voucher_entries ?? [])].sort((a, b) => (a.entry_order || 0) - (b.entry_order || 0));
      const normalizedEntries = entries.map((e) => ({
        accountName: e.account?.account_name ?? '',
        debit: Number(e.debit_amount) || 0,
        credit: Number(e.credit_amount) || 0,
        order: e.entry_order || 0,
      }));
      const sides = summarySides(
        v.voucher_type?.voucher_category ?? v.voucher_type?.voucher_type_name ?? '',
        Number(v.total_amount) || 0,
        normalizedEntries,
      );
      return {
        id: `adamrit:${v.id}`,
        nativeId: v.id,
        date: v.voucher_date,
        particulars: leadLedger(v.voucher_type?.voucher_category ?? v.voucher_type?.voucher_type_name ?? '', normalizedEntries),
        type: v.voucher_type?.voucher_type_name?.replace(' Voucher', '') ?? '',
        category: v.voucher_type?.voucher_category ?? v.voucher_type?.voucher_type_name ?? '',
        number: v.voucher_number,
        debit: sides.debit,
        credit: sides.credit,
        narration: v.narration,
        entries: entries.map((e) => ({
          label: `${Number(e.debit_amount) > 0 ? 'Dr' : 'Cr'} ${e.account?.account_name ?? ''}`,
          debit: Number(e.debit_amount) || 0,
          credit: Number(e.credit_amount) || 0,
        })),
        cancelled: v.status === 'CANCELLED',
        isAuto: !!v.is_auto,
        source: 'adamrit',
      };
    });

    let mappedTally: DayRow[] = tallyRows.map((v) => {
      const normalizedEntries = v.entries.map((e, index) => ({
        accountName: e.ledger,
        debit: e.debit,
        credit: e.credit,
        order: index,
      }));
      const sides = summarySides(v.voucher_type, v.total, normalizedEntries);
      return {
        id: v.id,
        nativeId: null,
        date: v.date,
        particulars: leadLedger(v.voucher_type, normalizedEntries),
        type: v.voucher_type.replace(' Voucher', ''),
        // Tally carries no separate category; its type name is the category.
        category: v.voucher_type,
        number: v.voucher_number,
        debit: sides.debit,
        credit: sides.credit,
        narration: v.narration,
        entries: v.entries.map((e) => ({
          label: `${e.debit > 0 ? 'Dr' : 'Cr'} ${e.ledger}`,
          debit: e.debit,
          credit: e.credit,
        })),
        cancelled: false,
        // Tally's own vouchers carry no such distinction.
        isAuto: false,
        source: 'tally',
      };
    });
    if (typeName) mappedTally = mappedTally.filter((r) => r.type.toLowerCase().includes(typeName.replace(' Voucher', '').toLowerCase()));

    const byNumber = new Map<string, DayRow>();
    const passthrough: DayRow[] = [];
    for (const r of [...nativeRows, ...mappedTally]) {
      const key = normalizeName(r.number);
      if (!key) { passthrough.push(r); continue; }
      const existing = byNumber.get(key);
      if (!existing) { byNumber.set(key, r); continue; }
      // Tally's copy is the one displayed, but it is the native voucher that
      // owns the evidence: both the attachment button and the generated
      // invoice resolve through nativeId, and a Tally row has none. Letting
      // the mirror simply replace the native row therefore stripped the M.L.
      // Enterprises bill off every approved cut, and the generated invoice off
      // the scan-centre and specialist payments, wherever the same voucher had
      // also been imported from Tally. The id rides across the swap.
      const winner = r.source === 'tally' ? r : existing;
      byNumber.set(key, { ...winner, nativeId: winner.nativeId ?? existing.nativeId ?? r.nativeId });
    }
    return [...byNumber.values(), ...passthrough]
      .filter((r) => !removedIds.has(r.id))
      .filter((r) => matchesSource(r.source, srcFilter))
      .filter((r) => report.passesFilter({
        Particulars: r.particulars,
        Narration: r.narration,
        'Vch Type': r.type,
        'Vch No.': r.number,
      }))
      .filter((r) => report.passesBasis(r.debit || r.credit))
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  }, [vouchers, tallyRows, typeName, srcFilter, removedIds, report.passesFilter, report.passesBasis]);

  const { totalDebit, totalCredit } = useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({ totalDebit: acc.totalDebit + r.debit, totalCredit: acc.totalCredit + r.credit }),
        { totalDebit: 0, totalCredit: 0 },
      ),
    [rows],
  );

  const openRow = (index: number) => {
    const row = rows[index];
    if (!row) return;
    if (row.nativeId && onOpenVoucher) onOpenVoucher(row.nativeId);
    else toggleExpanded(row.id);
  };

  const { cursor, setCursor } = useRowCursor({ count: rows.length, onEnter: openRow });

  // ---- Tally's voucher key bar, acting on the highlighted line ----
  const cursorRow = rows[cursor];

  /** Tally-sourced rows are a read-only mirror — they can only change in Tally. */
  const nativeRow = (): DayRow | null => {
    if (!cursorRow) return null;
    if (!cursorRow.nativeId) {
      toast.info(`${cursorRow.number || 'This voucher'} came from Tally — alter it in Tally.`);
      return null;
    }
    return cursorRow;
  };

  const toggleSelected = () => {
    if (!cursorRow) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(cursorRow.id)) next.delete(cursorRow.id);
      else next.add(cursorRow.id);
      return next;
    });
  };

  // R / U are view-only: they hide and restore report lines, never data.
  const removeLine = () => {
    const target = selectedIds.size > 0 ? [...selectedIds] : cursorRow ? [cursorRow.id] : [];
    if (target.length === 0) return;
    setRemovedIds((prev) => new Set([...prev, ...target]));
    setRemovedStack((prev) => [...prev, target]);
    setSelectedIds(new Set());
  };

  const restoreLine = () => {
    setRemovedStack((prev) => {
      const last = prev[prev.length - 1];
      if (!last) return prev;
      setRemovedIds((ids) => {
        const next = new Set(ids);
        last.forEach((id) => next.delete(id));
        return next;
      });
      return prev.slice(0, -1);
    });
  };

  return (
    <>
    <TallyScreen
      periodScope="screen"
      title={`Day Book${typeName ? ` — ${typeName}` : ''}${scope !== 'Regular' ? ` (${scope})` : ''}`}
      rail={report.rail}
      bottomBar={voucherBottomBar({
        onQuit: () => window.dispatchEvent(new CustomEvent('tally-escape')),
        onAlter: cursorRow ? () => openRow(cursor) : undefined,
        onSelect: cursorRow ? toggleSelected : undefined,
        onAdd: () => window.dispatchEvent(new CustomEvent('tally-goto', { detail: 'voucher-entry' })),
        onDuplicate: cursorRow
          ? () => {
              const row = nativeRow();
              if (row) window.dispatchEvent(new CustomEvent('tally-duplicate-voucher', { detail: row.nativeId }));
            }
          : undefined,
        onInsert: cursorRow
          ? () => window.dispatchEvent(new CustomEvent('tally-insert-voucher', { detail: cursorRow.date }))
          : undefined,
        onDelete: cursorRow
          ? () => {
              const row = nativeRow();
              if (row) void deleteVoucher(row.nativeId!, row.number);
            }
          : undefined,
        onCancelVch: cursorRow
          ? () => {
              const row = nativeRow();
              if (row) void cancelVoucher(row.nativeId!, row.number);
            }
          : undefined,
        onRemoveLine: cursorRow ? removeLine : undefined,
        onRestoreLine: removedStack.length > 0 ? restoreLine : undefined,
      })}
    >
      <div className="px-3 pb-4 pt-1 text-[13px]">
        <TallyReportHeader
          title="Day Book"
          period={
            fromDate === toDate
              ? `For ${tallyDateLabel(fromDate)}`
              : `${tallyDateLabel(fromDate)} to ${tallyDateLabel(toDate)}`
          }
        />

        {/* Column head. The Inwards / Outwards Qty captions Tally stacks under
            the amounts are gone — there is no inventory module behind them, so
            they were two permanently empty columns. */}
        <div className="flex border-y border-black font-semibold">
          <div className="w-20 px-1">Date</div>
          <div className="min-w-0 flex-1 px-1">Particulars</div>
          <div className="w-32 px-1">Vch Type</div>
          <div className="w-28 px-1">Vch No.</div>
          <div className="w-10 px-1 text-center">Files</div>
          <div className="w-32 px-1 text-right">Debit Amount</div>
          <div className="w-32 px-1 text-right">Credit Amount</div>
        </div>

        {isLoading ? (
          <div className="py-10 text-center text-gray-400">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-gray-400">No vouchers in this period.</div>
        ) : (
          <>
            {rows.map((r, i) => {
              const expanded = detailed || expandedIds.has(r.id);
              return (
                <React.Fragment key={r.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => (r.nativeId && onOpenVoucher ? onOpenVoucher(r.nativeId) : toggleExpanded(r.id))}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      if (r.nativeId && onOpenVoucher) onOpenVoucher(r.nativeId);
                      else toggleExpanded(r.id);
                    }}
                    onMouseEnter={() => setCursor(i)}
                    title={r.nativeId ? 'Open voucher (alter)' : 'Tally voucher — expand'}
                    className={`flex w-full text-left ${
                      cursor === i ? 'bg-[#ffc423]' : selectedIds.has(r.id) ? 'bg-[#fde68a]' : 'hover:bg-[#fdf6d8]'
                    }`}
                  >
                    <div className="w-20 px-1">{tallyDateLabel(r.date)}</div>
                    <div
                      className={`min-w-0 flex-1 truncate px-1 font-semibold ${
                        r.cancelled ? 'text-gray-500 line-through' : ''
                      }`}
                    >
                      {r.particulars}
                      {r.cancelled && <span className="pl-2 text-[11px] not-italic">(Cancelled)</span>}
                    </div>
                    <div className="w-32 px-1">{r.type}</div>
                    <div className="w-28 px-1 font-mono text-[12px]">
                      {r.number}
                      {/* Posted by a trigger rather than typed by anyone. */}
                      {r.isAuto && (
                        <span className="ml-1 bg-gray-200 px-1 text-[9px] font-bold text-gray-600">AUTO</span>
                      )}
                    </div>
                    <div className="flex w-10 items-center justify-center gap-0.5 px-1 text-center">
                      {/* Every entry, whatever its source, can show its own
                          voucher. The two icons after this one appear only
                          where a document was uploaded or generated. */}
                      <button
                        type="button"
                        title={`Print voucher ${r.number}`}
                        aria-label={`Print voucher ${r.number}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          printRowVoucher(r);
                        }}
                        className="text-gray-500 hover:text-black"
                      >
                        <Printer className="h-3.5 w-3.5" />
                      </button>
                      {r.nativeId && (
                        <VoucherAttachmentButton
                          attachments={attachmentMap.get(r.nativeId) || []}
                          voucherNumber={r.number}
                        />
                      )}
                      {r.nativeId && generatedInvoiceMap.get(r.nativeId) && (
                        <button
                          type="button"
                          title={`View ${generatedInvoiceMap.get(r.nativeId)!.label || 'the generated invoice'}`}
                          aria-label={`View invoice for voucher ${r.number}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            void openGeneratedInvoice(generatedInvoiceMap.get(r.nativeId!)!).catch(
                              (err: any) => toast.error(err?.message || 'Could not open the invoice'),
                            );
                          }}
                          className="inline-flex h-7 w-8 items-center justify-center rounded text-emerald-700 hover:bg-emerald-100"
                        >
                          <FileText className="h-4 w-4" />
                        </button>
                      )}
                      {/* The confirmation that the money actually went out:
                          the signed cash payment voucher, or the transfer
                          screenshot, stored beside the bill. The day book was
                          already fetching it and then never showing it, so a
                          payment row proved the invoice but never the payment.
                          The Expense Bills page calls this "Signed PV". */}
                      {r.nativeId && generatedInvoiceMap.get(r.nativeId)?.signedVoucherUrl && (
                        <button
                          type="button"
                          title={`View the payment confirmation for ${r.number}`}
                          aria-label={`View payment confirmation for voucher ${r.number}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            void openStoredDocument(
                              generatedInvoiceMap.get(r.nativeId!)!.signedVoucherUrl!,
                            ).catch((err: any) =>
                              toast.error(err?.message || 'Could not open the payment confirmation'),
                            );
                          }}
                          className="inline-flex h-7 w-8 items-center justify-center rounded text-blue-700 hover:bg-blue-100"
                        >
                          <BadgeCheck className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    <div className={`w-32 px-1 text-right font-mono ${r.cancelled ? 'line-through' : ''}`}>
                      {r.debit > 0 ? fmt(r.debit) : ''}
                    </div>
                    <div className={`w-32 px-1 text-right font-mono ${r.cancelled ? 'line-through' : ''}`}>
                      {r.credit > 0 ? fmt(r.credit) : ''}
                    </div>
                  </div>
                  {expanded && (
                    <div className="bg-[#fffdf2] py-0.5">
                      {r.entries.flatMap((e, i) => [
                        ...(e.debit > 0 ? [{ key: `${i}-debit`, label: e.label.replace(/^Cr /, 'Dr '), debit: e.debit, credit: 0 }] : []),
                        ...(e.credit > 0 ? [{ key: `${i}-credit`, label: e.label.replace(/^Dr /, 'Cr '), debit: 0, credit: e.credit }] : []),
                      ]).map((entry) => (
                        <div key={entry.key} className="flex text-[12px] italic text-gray-700">
                          <div className="w-20" />
                          <div className="min-w-0 flex-1 truncate px-1">{entry.label}</div>
                          <div className="w-32" />
                          <div className="w-28" />
                          <div className="w-10" />
                          <div className="w-32 px-1 text-right font-mono">
                            {entry.debit > 0 ? fmt(entry.debit) : ''}
                          </div>
                          <div className="w-32 px-1 text-right font-mono">
                            {entry.credit > 0 ? fmt(entry.credit) : ''}
                          </div>
                        </div>
                      ))}
                      {!!config.narrations && r.narration && (
                        <div className="px-24 text-[11px] italic text-gray-500">({r.narration})</div>
                      )}
                    </div>
                  )}
                </React.Fragment>
              );
            })}

            {/* Tally closes the Day Book with the column totals and a count */}
            <div className="mt-1 flex border-t border-black pt-0.5 font-semibold">
              <div className="w-20 px-1" />
              <div className="min-w-0 flex-1 px-1">Total</div>
              <div className="w-32 px-1" />
              <div className="w-28 px-1" />
              <div className="w-32 px-1 text-right font-mono">{fmt(totalDebit)}</div>
              <div className="w-32 px-1 text-right font-mono">{fmt(totalCredit)}</div>
            </div>
            <div className="pt-1 text-[11px] italic text-gray-500">
              {rows.length} voucher{rows.length === 1 ? '' : 's'}
              {removedIds.size > 0 && ` · ${removedIds.size} line(s) removed from this view`}
            </div>
          </>
        )}
      </div>
    </TallyScreen>

    {report.popups}
    {/* Tally asks before Alt+D deletes or Alt+X cancels */}
    {confirmUI}

    {typePicker && (
      <TallyList
        title="List of Voucher Types"
        onClose={() => setTypePicker(false)}
        items={[
          { label: 'All Vouchers', active: !typeFilter, onSelect: () => { setTypeFilter(''); setTypePicker(false); } },
          ...voucherTypes.map((t) => ({
            label: t.voucher_type_name,
            active: t.id === typeFilter,
            onSelect: () => {
              setTypeFilter(t.id);
              setTypePicker(false);
            },
          })),
        ]}
      />
    )}
    </>
  );
};

export default DayBook;
