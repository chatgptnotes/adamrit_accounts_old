import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, startOfMonth, endOfMonth, addMonths, subMonths } from 'date-fns';
import { ChevronLeft, ChevronRight, Calendar, CheckCircle2, Clock, XCircle, FileSpreadsheet, FileText } from 'lucide-react';
import { SearchableSelect, type SearchableSelectOption } from '@/components/ui/searchable-select';
import { supabaseData } from '@/integrations/supabase/data-client';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// ── Types ──────────────────────────────────────────────────────────────────

type LogType = 'account-log' | 'all-hms' | 'billing' | 'pharmacy' | 'vouchers' | 'tally-sync';
type TallyStatus = 'synced' | 'pending' | 'failed';

interface LedgerEntry { ledger: string; amount: number; is_debit: boolean }

interface LogEntry {
  id: string;
  created_at: string;
  accounting_date?: string;
  type: string;
  description: string;
  amount?: number;
  tally_status?: TallyStatus;
  party_ledger?: string;
  ledger_entries?: LedgerEntry[];
}

interface TallyLedger {
  id: string;
  name: string;
  parent_group: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const INR = (n: number) =>
  `₹${n.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const BADGE_COLORS: Record<string, string> = {
  'Payment':         'bg-blue-100 text-blue-700',
  'Payment Voucher': 'bg-blue-100 text-blue-700',
  'Receipt':         'bg-cyan-100 text-cyan-700',
  'Journal':         'bg-purple-100 text-purple-700',
  'Contra':          'bg-slate-100 text-slate-600',
  'Pharmacy Sale':   'bg-orange-100 text-orange-700',
  'Pharmacy Return': 'bg-amber-100 text-amber-700',
  'Advance Payment': 'bg-green-100 text-green-700',
  'Final Payment':   'bg-teal-100 text-teal-700',
  'Bill':            'bg-indigo-100 text-indigo-700',
  'Insurance Bill':  'bg-violet-100 text-violet-700',
  'ESIC Bill':       'bg-rose-100 text-rose-700',
  'Tally Sync':      'bg-gray-100 text-gray-600',
};

const badgeColor = (type: string) =>
  BADGE_COLORS[type] ?? 'bg-slate-100 text-slate-700';

const TallyStatusIcon = ({ status }: { status?: TallyStatus }) => {
  if (status === 'synced') return <CheckCircle2 className="h-4 w-4 text-green-500" />;
  if (status === 'pending') return <Clock className="h-4 w-4 text-amber-500" />;
  if (status === 'failed')  return <XCircle className="h-4 w-4 text-red-500" />;
  return null;
};

const mapPushType = (t: string): string =>
  ({ bill: 'Bill', payment: 'Payment Voucher', pharmacy: 'Pharmacy Sale',
     esic_bill: 'ESIC Bill', insurance_bill: 'Insurance Bill',
     insurance_payment: 'Payment Voucher' }[t] ?? t);

const mapQueueStatus   = (s: string): TallyStatus =>
  s === 'completed' ? 'synced' : s === 'failed_permanent' ? 'failed' : 'pending';
const mapVoucherStatus = (s: string): TallyStatus =>
  s === 'synced' ? 'synced' : (s === 'failed' || s === 'conflict') ? 'failed' : 'pending';

const dateOnly = (isoDate: string) => format(new Date(isoDate), 'yyyy-MM-dd');

const getEntryDate = (entry: LogEntry) => entry.accounting_date ?? entry.created_at;

const PAGE_SIZE = 1000;

async function fetchAllPages<T>(buildQuery: () => any): Promise<T[]> {
  const rows: T[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await buildQuery().range(from, to);

    if (error) throw error;

    const page = (data ?? []) as T[];
    rows.push(...page);

    if (page.length < PAGE_SIZE) break;
  }

  return rows;
}

const groupByDay = (entries: LogEntry[]) => {
  const sorted = [...entries].sort(
    (a, b) =>
      new Date(getEntryDate(a)).getTime() - new Date(getEntryDate(b)).getTime() ||
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  const map = new Map<string, { label: string; entries: LogEntry[] }>();
  for (const e of sorted) {
    const entryDate = new Date(getEntryDate(e));
    const key = format(entryDate, 'yyyy-MM-dd');
    if (!map.has(key))
      map.set(key, { label: format(entryDate, 'EEEE, d MMMM'), entries: [] });
    map.get(key)!.entries.push(e);
  }
  return [...map.entries()].map(([date, g]) => ({ date, ...g }));
};

// ── Data fetchers ──────────────────────────────────────────────────────────

async function fetchAccountLog(start: string, end: string): Promise<LogEntry[]> {
  const startDate = dateOnly(start);
  const endDate = dateOnly(end);

  const [voucherRows, queueRows] = await Promise.all([
    fetchAllPages<any>(() =>
      supabaseData
        .from('tally_vouchers')
        .select('id, voucher_type, party_ledger, amount, narration, sync_status, date, created_at, adamrit_payment_id, ledger_entries')
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: true })
        .order('created_at', { ascending: true })
    ),
    fetchAllPages<any>(() =>
      supabaseData
        .from('tally_push_queue')
        .select('id, push_type, reference_id, status, payload, created_at')
        .in('status', ['completed', 'pending', 'failed_permanent'])
        .gte('created_at', start)
        .lte('created_at', end)
        .order('created_at', { ascending: true })
    ),
  ]);

  const fromVouchers: LogEntry[] = voucherRows.map((r: any) => ({
    id: `tv-${r.id}`,
    created_at: r.created_at,
    accounting_date: r.date ? `${r.date}T00:00:00` : undefined,
    type: r.voucher_type ?? 'Payment Voucher',
    description: r.narration || r.party_ledger || r.adamrit_payment_id || '—',
    amount: r.amount ?? undefined,
    tally_status: mapVoucherStatus(r.sync_status ?? 'pending'),
    party_ledger: r.party_ledger ?? undefined,
    ledger_entries: Array.isArray(r.ledger_entries) ? r.ledger_entries : undefined,
  }));

  const coveredRefs = new Set(
    voucherRows.map((r: any) => r.adamrit_payment_id).filter(Boolean)
  );

  const fromQueue: LogEntry[] = queueRows
    .filter((r: any) => !coveredRefs.has(r.reference_id))
    .map((r: any) => ({
      id: `pq-${r.id}`,
      created_at: r.created_at,
      type: mapPushType(r.push_type ?? ''),
      description: r.reference_id || r.payload?.patientName || r.payload?.narration || '—',
      amount: r.payload?.amount ?? undefined,
      tally_status: mapQueueStatus(r.status),
    }));

  return [...fromVouchers, ...fromQueue];
}

async function fetchVouchers(start: string, end: string): Promise<LogEntry[]> {
  const { data, error } = await supabaseData
    .from('payment_vouchers')
    .select('id, voucher_no, person_name, amount, purpose, created_at')
    .gte('created_at', start)
    .lte('created_at', end);
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: `pv-${r.id}`,
    created_at: r.created_at,
    type: 'Payment Voucher',
    description: [r.voucher_no, r.person_name, r.purpose].filter(Boolean).join(' – '),
    amount: r.amount ?? undefined,
  }));
}

async function fetchPharmacy(start: string, end: string): Promise<LogEntry[]> {
  // Column names here are sale_id / bill_number / total_amount. They were
  // previously id / bill_no / total, which the database rejects outright — and
  // because the error was dropped, every pharmacy sale silently vanished from
  // this log rather than showing an error.
  const { data, error } = await supabaseData
    .from('pharmacy_sales')
    .select('sale_id, bill_number, patient_name, total_amount, created_at')
    .gte('created_at', start)
    .lte('created_at', end);
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: `ps-${r.sale_id}`,
    created_at: r.created_at,
    type: 'Pharmacy Sale',
    description: [r.bill_number ? `Rx #${r.bill_number}` : 'Sale', r.patient_name].filter(Boolean).join(' – '),
    amount: r.total_amount ?? undefined,
  }));
}

async function fetchBilling(start: string, end: string): Promise<LogEntry[]> {
  const [apRes, fpRes] = await Promise.all([
    supabaseData
      .from('advance_payment')
      .select('id, advance_amount, payment_mode, created_at')
      .gte('created_at', start)
      .lte('created_at', end),
    supabaseData
      .from('final_payments')
      // mode_of_payment, not payment_mode — the latter does not exist here and
      // the rejected query silently dropped every final payment from the log.
      .select('id, amount, mode_of_payment, created_at')
      .gte('created_at', start)
      .lte('created_at', end),
  ]);
  if (apRes.error) throw apRes.error;
  if (fpRes.error) throw fpRes.error;
  const ap: LogEntry[] = (apRes.data ?? []).map((r: any) => ({
    id: `ap-${r.id}`,
    created_at: r.created_at,
    type: 'Advance Payment',
    description: r.payment_mode ? `via ${r.payment_mode}` : 'Advance',
    amount: r.advance_amount ?? undefined,
  }));
  const fp: LogEntry[] = (fpRes.data ?? []).map((r: any) => ({
    id: `fp-${r.id}`,
    created_at: r.created_at,
    type: 'Final Payment',
    description: r.mode_of_payment ? `via ${r.mode_of_payment}` : 'Final Payment',
    amount: r.amount ?? undefined,
  }));
  return [...ap, ...fp];
}

async function fetchTallySync(start: string, end: string): Promise<LogEntry[]> {
  // This table has no company_name and no created_at. It carries company_id and
  // started_at, so the old query was rejected and every Tally sync silently
  // disappeared from the log. company_id has no foreign key to companies, so
  // PostgREST cannot embed the name — it is looked up separately and mapped.
  const [syncRes, companyRes] = await Promise.all([
    supabaseData
      .from('tally_sync_log')
      .select('id, sync_type, direction, status, records_synced, started_at, company_id')
      .gte('started_at', start)
      .lte('started_at', end),
    supabaseData.from('companies').select('id, company_name'),
  ]);
  if (syncRes.error) throw syncRes.error;
  if (companyRes.error) throw companyRes.error;
  const companyName = new Map<string, string>(
    (companyRes.data ?? []).map((c: any) => [String(c.id), String(c.company_name)]),
  );
  return (syncRes.data ?? []).map((r: any) => ({
    id: `tsl-${r.id}`,
    created_at: r.started_at,
    type: 'Tally Sync',
    description: [r.sync_type, r.direction,
      r.company_id ? companyName.get(String(r.company_id)) : null,
      r.records_synced != null ? `${r.records_synced} records` : null]
      .filter(Boolean).join(' / '),
    tally_status:
      r.status === 'completed' ? 'synced' : r.status === 'failed' ? 'failed' : 'pending',
  }));
}

async function fetchAllHMS(start: string, end: string): Promise<LogEntry[]> {
  const [pv, ps, billing, ts] = await Promise.all([
    fetchVouchers(start, end),
    fetchPharmacy(start, end),
    fetchBilling(start, end),
    fetchTallySync(start, end),
  ]);
  return [...pv, ...ps, ...billing, ...ts];
}

function queryFn(log: LogType, start: string, end: string): Promise<LogEntry[]> {
  switch (log) {
    case 'account-log': return fetchAccountLog(start, end);
    case 'vouchers':    return fetchVouchers(start, end);
    case 'pharmacy':    return fetchPharmacy(start, end);
    case 'billing':     return fetchBilling(start, end);
    case 'tally-sync':  return fetchTallySync(start, end);
    case 'all-hms':     return fetchAllHMS(start, end);
  }
}

// Cash inflows/outflows used when no ledger-side debit/credit is available.
const isInflowType = (type: string) => {
  const t = type.toLowerCase();
  return ['receipt', 'advance payment', 'final payment', 'pharmacy sale'].includes(t);
};

const isOutflowType = (type: string) => {
  const t = type.toLowerCase();
  return t === 'payment' || t === 'payment voucher';
};

// ── Static options ────────────────────────────────────────────────────────

const LOG_OPTIONS: SearchableSelectOption[] = [
  { value: 'account-log', label: '⭐ Account Log' },
  { value: 'all-hms',     label: 'All HMS Entries' },
  { value: 'billing',     label: 'Billing & Payments' },
  { value: 'pharmacy',    label: 'Pharmacy' },
  { value: 'vouchers',    label: 'Vouchers' },
  { value: 'tally-sync',  label: 'Tally Sync History' },
];

// ── Export helpers ────────────────────────────────────────────────────────

function exportToExcel(
  groups: { label: string; entries: LogEntry[] }[],
  monthLabel: string,
  ledgerLabel: string,
) {
  const rows: any[] = [];
  for (const group of groups) {
    // Day heading row
    rows.push({ Date: group.label, Time: '', Type: '', Description: '', Amount: '', 'Tally Status': '' });
    for (const e of group.entries) {
      rows.push({
        Date: format(new Date(getEntryDate(e)), 'dd/MM/yyyy'),
        Time: format(new Date(e.created_at), 'HH:mm'),
        Type: e.type,
        Description: e.description,
        Amount: e.amount ?? '',
        'Tally Status': e.tally_status ?? '',
      });
    }
    // blank separator
    rows.push({ Date: '', Time: '', Type: '', Description: '', Amount: '', 'Tally Status': '' });
  }

  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [
    { wch: 20 }, { wch: 8 }, { wch: 18 }, { wch: 45 }, { wch: 14 }, { wch: 14 },
  ];
  const wb = XLSX.utils.book_new();
  const sheetName = monthLabel.replace(' ', '-');
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const filename = `Account-Logs_${monthLabel.replace(' ', '-')}${ledgerLabel ? `_${ledgerLabel}` : ''}.xlsx`;
  XLSX.writeFile(wb, filename);
}

function exportToPDF(
  groups: { label: string; entries: LogEntry[] }[],
  monthLabel: string,
  ledgerLabel: string,
  showTallyStatus: boolean,
) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  const title = `Account Logs — ${monthLabel}${ledgerLabel ? ` — ${ledgerLabel}` : ''}`;
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(title, 14, 16);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text(`Exported: ${format(new Date(), 'dd MMM yyyy, HH:mm')}`, 14, 22);

  let startY = 28;

  for (const group of groups) {
    const head = showTallyStatus
      ? [['Time', 'Type', 'Description', 'Amount (₹)', 'Tally Status']]
      : [['Time', 'Type', 'Description', 'Amount (₹)']];

    const body = group.entries.map(e => {
      const row = [
        format(new Date(e.created_at), 'HH:mm'),
        e.type,
        e.description,
        e.amount != null && e.amount > 0
          ? e.amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })
          : '—',
      ];
      if (showTallyStatus) row.push(e.tally_status ?? '—');
      return row;
    });

    autoTable(doc, {
      head,
      body,
      startY,
      didDrawPage: () => { startY = 20; },
      headStyles: { fillColor: [59, 130, 246], fontSize: 8, fontStyle: 'bold' },
      bodyStyles: { fontSize: 7.5 },
      columnStyles: { 2: { cellWidth: 90 } },
      margin: { left: 14, right: 14 },
      didDrawCell: () => {},
      // Day label above table
    });

    // Day heading drawn before table
    const prevY = startY;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(100, 100, 100);
    doc.text(group.label.toUpperCase(), 14, prevY - 2);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(0, 0, 0);

    startY = (doc as any).lastAutoTable.finalY + 10;
  }

  const filename = `Account-Logs_${monthLabel.replace(' ', '-')}${ledgerLabel ? `_${ledgerLabel}` : ''}.pdf`;
  doc.save(filename);
}

// ── Component ──────────────────────────────────────────────────────────────

const AccountLogs: React.FC = () => {
  const [selectedLog, setSelectedLog]       = useState<LogType>('account-log');
  const [selectedLedger, setSelectedLedger] = useState<string>('all');
  const [fromDate, setFromDate] = useState(() => format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [toDate, setToDate]     = useState(() => format(new Date(), 'yyyy-MM-dd'));

  // Derived from fromDate so the label always matches what the date inputs show
  const currentMonth = useMemo(() => new Date(`${fromDate}T00:00:00`), [fromDate]);

  // When month navigator is used, snap the date range to that full month
  const goPrevMonth = () => {
    const m = subMonths(currentMonth, 1);
    setFromDate(format(startOfMonth(m), 'yyyy-MM-dd'));
    setToDate(format(endOfMonth(m), 'yyyy-MM-dd'));
  };
  const goNextMonth = () => {
    const m = addMonths(currentMonth, 1);
    setFromDate(format(startOfMonth(m), 'yyyy-MM-dd'));
    setToDate(format(endOfMonth(m), 'yyyy-MM-dd'));
  };

  // Reset ledger filter when switching away from account-log
  useEffect(() => {
    if (selectedLog !== 'account-log') setSelectedLedger('all');
  }, [selectedLog]);

  const rangeStart = useMemo(() => new Date(`${fromDate}T00:00:00`).toISOString(), [fromDate]);
  const rangeEnd   = useMemo(() => new Date(`${toDate}T23:59:59.999`).toISOString(), [toDate]);
  const priorRangeEnd = useMemo(
    () => new Date(new Date(`${fromDate}T00:00:00`).getTime() - 1).toISOString(),
    [fromDate]
  );

  // Main entries query
  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['account-logs', selectedLog, rangeStart, rangeEnd],
    queryFn: () => queryFn(selectedLog, rangeStart, rangeEnd),
  });

  // Opening balance = entries from the start of fromDate's month up to (not including) fromDate
  const monthOfFrom = useMemo(
    () => new Date(startOfMonth(new Date(`${fromDate}T00:00:00`))).toISOString(),
    [fromDate]
  );
  const { data: priorEntries = [] } = useQuery({
    queryKey: ['account-logs-opening', selectedLog, monthOfFrom, priorRangeEnd],
    queryFn: () => queryFn(selectedLog, monthOfFrom, priorRangeEnd),
    enabled: new Date(priorRangeEnd).getTime() >= new Date(monthOfFrom).getTime(),
    staleTime: 5 * 60 * 1000,
  });

  // Ledgers query — only runs when Account Log is selected
  const { data: ledgers = [] } = useQuery<TallyLedger[]>({
    queryKey: ['tally-ledgers-list'],
    queryFn: async () => {
      const { data } = await supabaseData
        .from('tally_ledgers')
        .select('id, name, parent_group')
        .order('name');
      return (data ?? []) as TallyLedger[];
    },
    enabled: selectedLog === 'account-log',
    staleTime: 5 * 60 * 1000,
  });

  const ledgerOptions = useMemo<SearchableSelectOption[]>(() => [
    { value: 'all', label: 'All Accounts' },
    ...ledgers.map(l => ({
      value: l.name,
      // searchable by both name and group; selectedLabel shows just the name in trigger
      label: l.parent_group ? `${l.name}  (${l.parent_group})` : l.name,
      selectedLabel: l.name,
    })),
  ], [ledgers]);

  // Filter entries by selected ledger (client-side, only for account-log)
  const filteredEntries = useMemo(() => {
    if (selectedLog !== 'account-log' || selectedLedger === 'all') return entries;
    return entries.filter(e =>
      e.party_ledger === selectedLedger ||
      e.ledger_entries?.some(le => le.ledger === selectedLedger)
    );
  }, [entries, selectedLedger, selectedLog]);

  // Prior entries filtered by ledger (same logic as filteredEntries)
  const filteredPrior = useMemo(() => {
    if (selectedLog !== 'account-log' || selectedLedger === 'all') return priorEntries;
    return priorEntries.filter(e =>
      e.party_ledger === selectedLedger ||
      e.ledger_entries?.some(le => le.ledger === selectedLedger)
    );
  }, [priorEntries, selectedLog, selectedLedger]);

  // Bills, invoices, tally-sync etc. are not cash movements — excluded from balance

  const getLedgerAmounts = useCallback((entry: LogEntry) => {
    if (selectedLog === 'account-log' && selectedLedger !== 'all' && entry.ledger_entries?.length) {
      return entry.ledger_entries
        .filter(le => le.ledger === selectedLedger)
        .reduce(
          (totals, le) => ({
            debit: totals.debit + (le.is_debit ? le.amount : 0),
            credit: totals.credit + (!le.is_debit ? le.amount : 0),
          }),
          { debit: 0, credit: 0 }
        );
    }

    return {
      debit: isInflowType(entry.type) ? (entry.amount ?? 0) : 0,
      credit: isOutflowType(entry.type) ? (entry.amount ?? 0) : 0,
    };
  }, [selectedLedger, selectedLog]);

  const priorDebit    = useMemo(() => filteredPrior.reduce((s, e) => s + getLedgerAmounts(e).debit, 0), [filteredPrior, getLedgerAmounts]);
  const priorCredit   = useMemo(() => filteredPrior.reduce((s, e) => s + getLedgerAmounts(e).credit, 0), [filteredPrior, getLedgerAmounts]);
  const openingNet    = priorDebit - priorCredit;

  const currentDebit  = useMemo(() => filteredEntries.reduce((s, e) => s + getLedgerAmounts(e).debit, 0), [filteredEntries, getLedgerAmounts]);
  const currentCredit = useMemo(() => filteredEntries.reduce((s, e) => s + getLedgerAmounts(e).credit, 0), [filteredEntries, getLedgerAmounts]);
  const closingNet    = openingNet + currentDebit - currentCredit;

  const groups = useMemo(() => groupByDay(filteredEntries), [filteredEntries]);
  const showTallyStatus = selectedLog === 'account-log' || selectedLog === 'tally-sync';

  const periodLabel = `${format(new Date(`${fromDate}T00:00:00`), 'dd MMM yyyy')} – ${format(new Date(`${toDate}T00:00:00`), 'dd MMM yyyy')}`;
  const ledgerLabel = selectedLedger !== 'all' ? selectedLedger : '';

  const handleExcelExport = () => exportToExcel(groups, periodLabel, ledgerLabel);
  const handlePDFExport   = () => exportToPDF(groups, periodLabel, ledgerLabel, showTallyStatus);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Account Logs</h1>

      {/* Controls row */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">

        {/* Left: Log dropdown + Ledger dropdown */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Log type selector — searchable */}
          <SearchableSelect
            options={LOG_OPTIONS}
            value={selectedLog}
            onValueChange={(v) => setSelectedLog(v as LogType)}
            placeholder="Select a Log"
            searchPlaceholder="Search log type…"
            className="w-52"
          />

          {/* Account / Ledger selector — searchable, only for Account Log */}
          {selectedLog === 'account-log' && (
            <SearchableSelect
              options={ledgerOptions}
              value={selectedLedger}
              onValueChange={setSelectedLedger}
              placeholder="All Accounts"
              searchPlaceholder="Search account or ledger…"
              emptyText="No matching account found"
              className="w-64"
            />
          )}
        </div>

        {/* Right: Month navigator + Export */}
        <div className="flex items-center gap-2">
          {/* Export buttons — only when there's data */}
          {groups.length > 0 && (
            <div className="flex items-center gap-1.5">
              <button
                onClick={handleExcelExport}
                title="Export to Excel"
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 transition-colors"
              >
                <FileSpreadsheet className="h-3.5 w-3.5" />
                Excel
              </button>
              <button
                onClick={handlePDFExport}
                title="Export to PDF"
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
              >
                <FileText className="h-3.5 w-3.5" />
                PDF
              </button>
            </div>
          )}

          {/* Month navigator */}
          <div className="flex items-center gap-1 border rounded-lg px-1 py-0.5 bg-white">
            <button
              onClick={goPrevMonth}
              className="p-1.5 rounded hover:bg-gray-100 transition-colors"
              aria-label="Previous month"
            >
              <ChevronLeft className="h-4 w-4 text-gray-600" />
            </button>
            <span className="text-sm font-medium w-32 text-center text-gray-700">
              {format(currentMonth, 'MMMM yyyy')}
            </span>
            <button
              onClick={goNextMonth}
              className="p-1.5 rounded hover:bg-gray-100 transition-colors"
              aria-label="Next month"
            >
              <ChevronRight className="h-4 w-4 text-gray-600" />
            </button>
          </div>

          {/* Custom date range picker */}
          <div className="flex items-center gap-2 border rounded-lg px-3 py-1.5 bg-white">
            <Calendar className="h-3.5 w-3.5 text-gray-400 shrink-0" />
            <input
              type="date"
              value={fromDate}
              onChange={e => setFromDate(e.target.value)}
              className="text-sm text-gray-700 border-none outline-none bg-transparent"
              aria-label="From date"
            />
            <span className="text-gray-400 text-xs font-medium">to</span>
            <input
              type="date"
              value={toDate}
              onChange={e => setToDate(e.target.value)}
              className="text-sm text-gray-700 border-none outline-none bg-transparent"
              aria-label="To date"
            />
          </div>
        </div>
      </div>

      {/* Active ledger filter pill */}
      {selectedLog === 'account-log' && selectedLedger !== 'all' && (
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs text-gray-500">Showing entries for:</span>
          <span className="inline-flex items-center gap-1.5 bg-blue-50 text-blue-700 text-xs font-medium px-3 py-1 rounded-full border border-blue-200">
            {selectedLedger}
            <button
              onClick={() => setSelectedLedger('all')}
              className="hover:text-blue-900 font-bold leading-none"
              aria-label="Clear filter"
            >
              ×
            </button>
          </span>
        </div>
      )}

      {/* Body */}
      {isLoading ? (
        <div className="space-y-6">
          {[1, 2, 3].map(i => (
            <div key={i} className="animate-pulse">
              <div className="h-3.5 bg-gray-200 rounded w-44 mb-3" />
              <div className="bg-white border rounded-lg overflow-hidden">
                {[1, 2, 3].map(j => (
                  <div key={j} className="h-12 border-b last:border-0 flex items-center px-4 gap-3">
                    <div className="h-3 bg-gray-100 rounded w-10" />
                    <div className="h-5 bg-gray-100 rounded w-24" />
                    <div className="h-3 bg-gray-100 rounded flex-1" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <p className="text-base">
            {selectedLedger !== 'all'
              ? `No entries for "${selectedLedger}" in this period`
              : `No entries for ${periodLabel}`}
          </p>
          <p className="text-sm mt-1">Try a different date range or account</p>
        </div>
      ) : (
        <div className="space-y-8">
          {groups.map(group => {
            const dayTotal = group.entries.reduce((s, e) => s + (e.amount ?? 0), 0);
            return (
              <div key={group.date}>
                <div className="flex items-center justify-between mb-2 px-1">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
                    {group.label}
                  </p>
                  <p className="text-xs text-gray-400">
                    {group.entries.length} {group.entries.length === 1 ? 'entry' : 'entries'}
                    {dayTotal > 0 && <> &middot; {INR(dayTotal)}</>}
                  </p>
                </div>

                <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                  {group.entries.map((entry, idx) => (
                    <div
                      key={entry.id}
                      className={`flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors ${
                        idx !== 0 ? 'border-t border-gray-100' : ''
                      }`}
                    >
                      <span className="text-xs text-gray-400 w-10 shrink-0 tabular-nums">
                        {format(new Date(entry.created_at), 'HH:mm')}
                      </span>

                      <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full shrink-0 ${badgeColor(entry.type)}`}>
                        {entry.type}
                      </span>

                      <span className="text-sm text-gray-700 flex-1 truncate min-w-0">
                        {entry.description}
                      </span>

                      {entry.amount != null && entry.amount > 0 && (
                        <span className="text-sm font-medium text-gray-800 shrink-0 tabular-nums">
                          {INR(entry.amount)}
                        </span>
                      )}

                      {showTallyStatus && (
                        <span className="shrink-0 ml-1">
                          <TallyStatusIcon status={entry.tally_status} />
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Balance summary — TallyPrime style, always visible once not loading */}
      {!isLoading && (
        <div className="mt-6 flex justify-end">
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm text-sm">
            {/* Header row */}
            <div className="grid grid-cols-[200px_160px_160px] border-b border-gray-100 bg-gray-50">
              <div />
              <div className="px-5 py-2 text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Debit</div>
              <div className="px-5 py-2 text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Credit</div>
            </div>
            {/* Opening Balance */}
            <div className="grid grid-cols-[200px_160px_160px] border-b border-gray-100">
              <div className="px-5 py-2.5 text-gray-500 text-xs">Opening Balance :</div>
              <div className="px-5 py-2.5 text-right font-medium text-gray-700 tabular-nums">
                {openingNet >= 0 ? INR(openingNet) : ''}
              </div>
              <div className="px-5 py-2.5 text-right font-medium text-gray-700 tabular-nums">
                {openingNet < 0 ? INR(Math.abs(openingNet)) : ''}
              </div>
            </div>
            {/* Current Total */}
            <div className="grid grid-cols-[200px_160px_160px] border-b border-gray-100">
              <div className="px-5 py-2.5 text-gray-500 text-xs">Current Total :</div>
              <div className="px-5 py-2.5 text-right font-medium text-blue-600 tabular-nums">
                {currentDebit > 0 ? INR(currentDebit) : '—'}
              </div>
              <div className="px-5 py-2.5 text-right font-medium text-orange-600 tabular-nums">
                {currentCredit > 0 ? INR(currentCredit) : '—'}
              </div>
            </div>
            {/* Closing Balance */}
            <div className="grid grid-cols-[200px_160px_160px] bg-gray-50">
              <div className="px-5 py-2.5 text-gray-800 text-xs font-bold">Closing Balance :</div>
              <div className="px-5 py-2.5 text-right font-bold text-gray-900 tabular-nums">
                {closingNet >= 0 ? INR(closingNet) : ''}
              </div>
              <div className="px-5 py-2.5 text-right font-bold text-gray-900 tabular-nums">
                {closingNet < 0 ? INR(Math.abs(closingNet)) : ''}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AccountLogs;
