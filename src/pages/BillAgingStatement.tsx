import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { useAuth } from '@/contexts/AuthContext';
import { useBillAgingReport } from '@/hooks/useBillAgingReport';
import type { BillAgingRecord } from '@/types/billAging';
import { TallyScreen } from '@/components/accounting/tally/TallyChrome';

const fmt = (n: number): string =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

const tallyDateLabel = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso.slice(0, 10) + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return '';
  const month = d.toLocaleDateString('en-GB', { month: 'short' });
  return `${d.getDate()}-${month}-${String(d.getFullYear()).slice(2)}`;
};

const BUCKET_ORDER = ['0-30', '31-60', '61-90', '91-180', '181-365', '365+'] as const;
const bucketLabel = (b: string): string => (b === '365+' ? 'Greater than 365 Days' : `${b} Days`);
const STATUSES = ['all', 'Pending', 'Overdue', 'Partial', 'Received'] as const;

/**
 * Bill Aging Statement — Tally Prime layout over the corporate bill-aging
 * data: Date / Ref. No. / Party's Name / Bill / Received / Pending / Due on /
 * Overdue by days, with F6 Age wise grouping, F4 party and F5 status
 * filters, E: Export (Excel) and P: Print.
 */
const BillAgingStatement: React.FC = () => {
  const navigate = useNavigate();
  const { hospitalConfig } = useAuth();
  const { data, isLoading, filters, setFilters, summary, corporates } = useBillAgingReport(hospitalConfig?.name);
  const [ageWise, setAgeWise] = useState(false);
  const [showOptions, setShowOptions] = useState(false);

  const rows = data; // hook applies party/status/date filters + sorting

  const byBucket = useMemo(() => {
    const map = new Map<string, { rows: BillAgingRecord[]; total: number }>();
    for (const r of rows) {
      const g = map.get(r.aging_bucket) ?? { rows: [], total: 0 };
      g.rows.push(r);
      g.total += r.outstanding_amount;
      map.set(r.aging_bucket, g);
    }
    return map;
  }, [rows]);

  const exportExcel = (): void => {
    const exportData = rows.map((r) => ({
      'Bill No': r.bill_no,
      'Claim ID': r.claim_id ?? '',
      'Visit ID': r.visit_id,
      Patient: r.patient_name,
      Corporate: r.corporate,
      'Submission Date': r.date_of_submission ?? '',
      'Expected Payment': r.expected_payment_date ?? '',
      'Bill Amount': r.bill_amount,
      'Received Amount': r.received_amount,
      Outstanding: r.outstanding_amount,
      'Days Outstanding': r.days_outstanding,
      Bucket: r.aging_bucket,
      Status: r.status,
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Bill Aging Statement');
    XLSX.writeFile(wb, `Bill_Aging_Statement_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const billRow = (r: BillAgingRecord) => (
    <div
      key={r.id}
      onClick={() => navigate(`/final-bill/${r.visit_id}`)}
      title="Open final bill"
      className="flex cursor-pointer border-b border-dashed border-gray-200 hover:bg-[#fdf6d8]"
    >
      <div className="w-20 shrink-0 px-1">{tallyDateLabel(r.date_of_submission)}</div>
      <div className="w-32 shrink-0 truncate px-1 font-mono text-[12px]">{r.bill_no || r.claim_id || r.visit_id}</div>
      <div className="min-w-0 flex-1 truncate px-1">
        {r.corporate || 'Direct'}
        <span className="ml-1 text-[11px] italic text-gray-500">({r.patient_name})</span>
      </div>
      <div className="w-28 shrink-0 px-1 text-right font-mono">{fmt(r.bill_amount)}</div>
      <div className="w-28 shrink-0 px-1 text-right font-mono text-gray-600">{r.received_amount > 0 ? fmt(r.received_amount) : ''}</div>
      <div className="w-28 shrink-0 px-1 text-right font-mono font-semibold">{fmt(r.outstanding_amount)}</div>
      <div className="w-20 shrink-0 px-1">{tallyDateLabel(r.expected_payment_date)}</div>
      <div className="w-20 shrink-0 px-1 text-right font-mono">{r.days_outstanding > 0 ? r.days_outstanding : ''}</div>
    </div>
  );

  return (
    <div className="p-1">
      <TallyScreen
        title="Bill Aging Statement"
        onClose={() => navigate(-1)}
        rail={[
          { hotkey: 'F2', label: 'Period', onClick: () => setShowOptions((v) => !v) },
          { hotkey: 'F3', label: 'Company', disabled: true },
          {
            hotkey: 'F4',
            label: filters.corporate === 'all' ? 'Party' : filters.corporate.slice(0, 16),
            gapBefore: true,
            onClick: () =>
              setFilters((prev) => {
                const ids = ['all', ...corporates];
                return { ...prev, corporate: ids[(ids.indexOf(prev.corporate) + 1) % ids.length] };
              }),
          },
          {
            hotkey: 'F5',
            label: filters.status === 'all' ? 'Status: All' : filters.status,
            onClick: () =>
              setFilters((prev) => {
                const i = STATUSES.indexOf(prev.status as any);
                return { ...prev, status: STATUSES[(i + 1) % STATUSES.length] as any };
              }),
          },
          { hotkey: 'F6', label: 'Age wise', gapBefore: true, onClick: () => setAgeWise((v) => !v), active: ageWise },
          { hotkey: 'E', label: 'Export', gapBefore: true, onClick: exportExcel },
          { hotkey: 'P', label: 'Print', onClick: () => window.print() },
        ]}
      >
        <div className="px-3 pb-4 pt-1 text-[13px]">
          <div className="text-center">
            <div className="font-bold">
              {ageWise ? 'Age wise analysis of Bills' : 'Bill Aging Statement'}
              {filters.corporate !== 'all' ? ` — ${filters.corporate}` : ''}
              {filters.status !== 'all' ? ` (${filters.status})` : ''}
            </div>
            <div className="text-[11px]">
              {summary.total_bills} bill(s) · Outstanding ₹{fmt(summary.total_outstanding_amount)} · Avg days to payment{' '}
              {summary.average_days_to_payment}
            </div>
          </div>

          {showOptions && (
            <div className="mb-2 mt-1 flex flex-wrap items-center gap-2 border border-[#9db8d8] bg-[#fdf6d8] px-2 py-1">
              <span>Party:</span>
              <select
                value={filters.corporate}
                onChange={(e) => setFilters((p) => ({ ...p, corporate: e.target.value }))}
                className="border bg-white px-1"
              >
                <option value="all">All Parties</option>
                {corporates.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <span>Status:</span>
              <select
                value={filters.status}
                onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value as any }))}
                className="border bg-white px-1"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s === 'all' ? 'All' : s}
                  </option>
                ))}
              </select>
              <span>Submitted:</span>
              <input
                type="date"
                value={filters.dateFrom ?? ''}
                onChange={(e) => setFilters((p) => ({ ...p, dateFrom: e.target.value || null }))}
                className="border bg-white px-1"
              />
              <span>to</span>
              <input
                type="date"
                value={filters.dateTo ?? ''}
                onChange={(e) => setFilters((p) => ({ ...p, dateTo: e.target.value || null }))}
                className="border bg-white px-1"
              />
              <span>Search:</span>
              <input
                value={filters.searchTerm}
                onChange={(e) => setFilters((p) => ({ ...p, searchTerm: e.target.value }))}
                placeholder="bill / claim / patient"
                className="border bg-white px-1"
              />
            </div>
          )}

          {/* Column header */}
          <div className="mt-1 flex border-y border-black bg-[#f0f4fa] font-semibold">
            <div className="w-20 shrink-0 px-1">Date</div>
            <div className="w-32 shrink-0 px-1">Ref. No.</div>
            <div className="min-w-0 flex-1 px-1">Party's Name</div>
            <div className="w-28 shrink-0 px-1 text-right">Bill Amount</div>
            <div className="w-28 shrink-0 px-1 text-right">Received</div>
            <div className="w-28 shrink-0 px-1 text-right">Pending</div>
            <div className="w-20 shrink-0 px-1">Due on</div>
            <div className="w-20 shrink-0 px-1 text-right">Overdue</div>
          </div>

          {isLoading ? (
            <div className="py-10 text-center text-gray-400">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="py-10 text-center text-gray-400">No bills match the current filters.</div>
          ) : ageWise ? (
            BUCKET_ORDER.filter((b) => byBucket.has(b)).map((b) => {
              const g = byBucket.get(b)!;
              return (
                <React.Fragment key={b}>
                  <div className="mt-1.5 flex bg-[#eef3fa] font-bold">
                    <div className="min-w-0 flex-1 px-1">{bucketLabel(b)}</div>
                    <div className="w-28 shrink-0 px-1 text-right font-mono">{fmt(g.total)}</div>
                    <div className="w-40 shrink-0 px-1 text-right text-[11px] font-normal italic text-gray-600">
                      {g.rows.length} bill(s)
                    </div>
                  </div>
                  {g.rows.map(billRow)}
                </React.Fragment>
              );
            })
          ) : (
            rows.map(billRow)
          )}

          {!isLoading && rows.length > 0 && (
            <div className="mt-2 flex border-t border-black pt-0.5 font-bold">
              <div className="w-20 shrink-0 px-1" />
              <div className="w-32 shrink-0 px-1" />
              <div className="min-w-0 flex-1 px-1 tracking-[0.2em]">Total — {rows.length} bill(s)</div>
              <div className="w-28 shrink-0 px-1 text-right font-mono">{fmt(summary.total_bill_amount)}</div>
              <div className="w-28 shrink-0 px-1 text-right font-mono">{fmt(summary.total_received_amount)}</div>
              <div className="w-28 shrink-0 px-1 text-right font-mono">{fmt(summary.total_outstanding_amount)}</div>
              <div className="w-20 shrink-0 px-1" />
              <div className="w-20 shrink-0 px-1" />
            </div>
          )}
        </div>
      </TallyScreen>
    </div>
  );
};

export default BillAgingStatement;
