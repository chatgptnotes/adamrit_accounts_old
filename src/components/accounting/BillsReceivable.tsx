import React, { useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useBillAgingReport } from '@/hooks/useBillAgingReport';
import type { BillAgingRecord } from '@/types/billAging';
import { TallyScreen } from './tally/TallyChrome';

const fmt = (n: number): string =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

const tallyDateLabel = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso.slice(0, 10) + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return '';
  const month = d.toLocaleDateString('en-GB', { month: 'short' });
  return `${d.getDate()}-${month}-${String(d.getFullYear()).slice(2)}`;
};

// Tally's Age wise analysis ranges (drawn from the existing aging buckets)
const BUCKET_ORDER = ['0-30', '31-60', '61-90', '91-180', '181-365', '365+'] as const;
const bucketLabel = (b: string): string => (b === '365+' ? 'Greater than 365 Days' : `${b} Days`);

/**
 * Bills Receivable — Tally Prime replica over the corporate bill-aging data:
 * Date / Ref. No. / Party's Name / Pending Amount / Due on / Overdue by days,
 * with F6 Age wise analysis grouped into ageing ranges.
 */
const BillsReceivable: React.FC = () => {
  const { hospitalConfig } = useAuth();
  const { data, isLoading, corporates, filters, setFilters } = useBillAgingReport(hospitalConfig?.name);
  const [ageWise, setAgeWise] = useState(false);
  const [showOptions, setShowOptions] = useState(false);

  // Outstanding bills only — Tally's Bills Receivable never lists settled bills
  const outstanding = useMemo(
    () => data.filter((r) => r.status !== 'Received' && r.outstanding_amount > 0),
    [data],
  );

  const total = useMemo(() => outstanding.reduce((s, r) => s + r.outstanding_amount, 0), [outstanding]);

  const byBucket = useMemo(() => {
    const map = new Map<string, { rows: BillAgingRecord[]; total: number }>();
    for (const r of outstanding) {
      const g = map.get(r.aging_bucket) ?? { rows: [], total: 0 };
      g.rows.push(r);
      g.total += r.outstanding_amount;
      map.set(r.aging_bucket, g);
    }
    return map;
  }, [outstanding]);

  const today = new Date();
  const asAt = tallyDateLabel(today.toISOString());

  const billRow = (r: BillAgingRecord) => (
    <div key={r.id} className="flex border-b border-dashed border-gray-200 hover:bg-[#fdf6d8]">
      <div className="w-20 shrink-0 px-1">{tallyDateLabel(r.date_of_submission)}</div>
      <div className="w-32 shrink-0 truncate px-1 font-mono text-[12px]">{r.bill_no || r.claim_id || r.visit_id}</div>
      <div className="min-w-0 flex-1 truncate px-1">
        {r.corporate || 'Direct'}
        <span className="ml-1 text-[11px] italic text-gray-500">({r.patient_name})</span>
      </div>
      <div className="w-32 shrink-0 px-1 text-right font-mono">{fmt(r.outstanding_amount)}</div>
      <div className="w-24 shrink-0 px-1">{tallyDateLabel(r.expected_payment_date)}</div>
      <div className="w-24 shrink-0 px-1 text-right font-mono">{r.days_outstanding > 0 ? r.days_outstanding : ''}</div>
    </div>
  );

  return (
    <TallyScreen
      title="Bills Receivable"
      rail={[
        { hotkey: 'F2', label: 'Period', onClick: () => setShowOptions((v) => !v) },
        { hotkey: 'F3', label: 'Company', disabled: true },
        {
          hotkey: 'F4',
          label: 'Party',
          gapBefore: true,
          onClick: () =>
            setFilters((prev) => {
              const ids = ['all', ...corporates];
              const next = ids[(ids.indexOf(prev.corporate) + 1) % ids.length];
              return { ...prev, corporate: next };
            }),
        },
        { hotkey: 'F6', label: 'Age wise', gapBefore: true, onClick: () => setAgeWise((v) => !v), active: ageWise },
        { label: 'Basis of Values', disabled: true },
        { label: 'Save View', disabled: true },
        { hotkey: 'P', label: 'Print', onClick: () => window.print(), gapBefore: true },
      ]}
    >
      <div className="px-3 pb-4 pt-1 text-[13px]">
        <div className="text-center">
          <div className="font-bold">
            {ageWise ? 'Age wise analysis of Bills Receivable' : 'Bills Receivable'}
            {filters.corporate !== 'all' ? ` — ${filters.corporate}` : ''}
          </div>
          <div className="text-[11px]">as at {asAt}</div>
        </div>

        {showOptions && (
          <div className="mb-2 mt-1 flex items-center gap-2 border border-[#9db8d8] bg-[#fdf6d8] px-2 py-1">
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
            <span className="ml-3">Submitted:</span>
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
          </div>
        )}

        {/* Column header */}
        <div className="mt-1 flex border-y border-black bg-[#f0f4fa] font-semibold">
          <div className="w-20 shrink-0 px-1">Date</div>
          <div className="w-32 shrink-0 px-1">Ref. No.</div>
          <div className="min-w-0 flex-1 px-1">Party's Name</div>
          <div className="w-32 shrink-0 px-1 text-right">Pending Amount</div>
          <div className="w-24 shrink-0 px-1">Due on</div>
          <div className="w-24 shrink-0 px-1 text-right">Overdue by days</div>
        </div>

        {isLoading ? (
          <div className="py-10 text-center text-gray-400">Loading…</div>
        ) : outstanding.length === 0 ? (
          <div className="py-10 text-center text-gray-400">No outstanding bills.</div>
        ) : ageWise ? (
          BUCKET_ORDER.filter((b) => byBucket.has(b)).map((b) => {
            const g = byBucket.get(b)!;
            return (
              <React.Fragment key={b}>
                <div className="mt-1.5 flex bg-[#eef3fa] font-bold">
                  <div className="min-w-0 flex-1 px-1">{bucketLabel(b)}</div>
                  <div className="w-32 shrink-0 px-1 text-right font-mono">{fmt(g.total)}</div>
                  <div className="w-48 shrink-0 px-1 text-right text-[11px] font-normal italic text-gray-600">
                    {g.rows.length} bill(s)
                  </div>
                </div>
                {g.rows.map(billRow)}
              </React.Fragment>
            );
          })
        ) : (
          outstanding.map(billRow)
        )}

        {!isLoading && outstanding.length > 0 && (
          <div className="mt-2 flex border-t border-black pt-0.5 font-bold">
            <div className="w-20 shrink-0 px-1" />
            <div className="w-32 shrink-0 px-1" />
            <div className="min-w-0 flex-1 px-1 tracking-[0.2em]">Total — {outstanding.length} bill(s)</div>
            <div className="w-32 shrink-0 px-1 text-right font-mono">{fmt(total)}</div>
            <div className="w-24 shrink-0 px-1" />
            <div className="w-24 shrink-0 px-1" />
          </div>
        )}
      </div>
    </TallyScreen>
  );
};

export default BillsReceivable;
