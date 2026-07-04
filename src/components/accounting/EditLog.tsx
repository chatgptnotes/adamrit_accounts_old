import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { TallyScreen } from './tally/TallyChrome';

interface LogRow {
  id: string;
  voucher_id: string | null;
  voucher_number: string | null;
  action: 'CREATED' | 'ALTERED' | 'CANCELLED' | 'DELETED';
  changed_by: string | null;
  old_data: any;
  new_data: any;
  created_at: string;
}

const fmt = (n: number): string =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

const ACTION_STYLE: Record<LogRow['action'], string> = {
  CREATED: 'text-green-700',
  ALTERED: 'text-blue-700',
  CANCELLED: 'text-orange-700',
  DELETED: 'text-red-700',
};

// One-line human summary of what changed
const summarize = (r: LogRow): string => {
  const o = r.old_data ?? {};
  const n = r.new_data ?? {};
  if (r.action === 'CREATED') return `₹${fmt(Number(n.total_amount) || 0)} — ${n.narration || ''}`;
  if (r.action === 'DELETED') return `was ₹${fmt(Number(o.total_amount) || 0)} — ${o.narration || ''}`;
  const bits: string[] = [];
  if (Number(o.total_amount) !== Number(n.total_amount))
    bits.push(`amount ₹${fmt(Number(o.total_amount) || 0)} → ₹${fmt(Number(n.total_amount) || 0)}`);
  if ((o.voucher_date || '') !== (n.voucher_date || '')) bits.push(`date ${o.voucher_date} → ${n.voucher_date}`);
  if ((o.narration || '') !== (n.narration || ''))
    bits.push(`narration "${(o.narration || '').slice(0, 30)}" → "${(n.narration || '').slice(0, 30)}"`);
  if ((o.status || '') !== (n.status || '')) bits.push(`status ${o.status} → ${n.status}`);
  return bits.join('; ') || 'entries changed';
};

/**
 * Edit Log — Tally Edit Log equivalent: tamper-proof, trigger-written audit
 * trail of every voucher creation, alteration, cancellation and deletion,
 * with who did it and what changed.
 */
const EditLog: React.FC<{ onOpenVoucher?: (id: string) => void }> = ({ onOpenVoucher }) => {
  const today = format(new Date(), 'yyyy-MM-dd');
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [showPeriod, setShowPeriod] = useState(false);
  const [actionFilter, setActionFilter] = useState('');

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['voucher_edit_log', fromDate, toDate, actionFilter],
    queryFn: async () => {
      let query = (supabase as any)
        .from('voucher_edit_log')
        .select('*')
        .gte('created_at', `${fromDate}T00:00:00`)
        .lte('created_at', `${toDate}T23:59:59`)
        .order('created_at', { ascending: false })
        .limit(500);
      if (actionFilter) query = query.eq('action', actionFilter);
      const { data, error } = await query;
      if (error) return [] as LogRow[]; // table not created yet
      return (data ?? []) as LogRow[];
    },
  });

  return (
    <TallyScreen
      title="Edit Log"
      rail={[
        { hotkey: 'F2', label: 'Period', onClick: () => setShowPeriod((v) => !v) },
        { hotkey: 'F3', label: 'Company', disabled: true },
        {
          hotkey: 'F4',
          label: actionFilter || 'All Actions',
          gapBefore: true,
          onClick: () =>
            setActionFilter((cur) => {
              const opts = ['', 'CREATED', 'ALTERED', 'CANCELLED', 'DELETED'];
              return opts[(opts.indexOf(cur) + 1) % opts.length];
            }),
        },
        { hotkey: 'P', label: 'Print', onClick: () => window.print(), gapBefore: true },
      ]}
    >
      <div className="px-3 pb-4 pt-1 text-[13px]">
        <div className="text-center text-[11px]">
          {fromDate === toDate ? `For ${fromDate}` : `${fromDate} to ${toDate}`}
          {actionFilter ? ` — ${actionFilter}` : ''}
        </div>
        {showPeriod && (
          <div className="mb-2 mt-1 flex items-center gap-2 border border-[#9db8d8] bg-[#fdf6d8] px-2 py-1">
            <span>Period:</span>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="border bg-white px-1" />
            <span>to</span>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="border bg-white px-1" />
          </div>
        )}

        <div className="mt-1 flex border-y border-black bg-[#f0f4fa] font-semibold">
          <div className="w-32 px-1">Date / Time</div>
          <div className="w-28 px-1">Vch No.</div>
          <div className="w-24 px-1">Action</div>
          <div className="w-28 px-1">User</div>
          <div className="min-w-0 flex-1 px-1">Details</div>
        </div>

        {isLoading ? (
          <div className="py-10 text-center text-gray-400">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-gray-400">
            No log entries in this period (run the edit-log migration if you haven't).
          </div>
        ) : (
          rows.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => r.action !== 'DELETED' && r.voucher_id && onOpenVoucher?.(r.voucher_id)}
              title={r.action === 'DELETED' ? 'Voucher no longer exists' : 'Open voucher'}
              className={`flex w-full border-b border-dashed border-gray-200 text-left ${
                r.action === 'DELETED' ? 'cursor-default' : 'hover:bg-[#fdf6d8]'
              }`}
            >
              <div className="w-32 shrink-0 px-1 font-mono text-[11px]">
                {format(new Date(r.created_at), 'dd-MMM-yy HH:mm')}
              </div>
              <div className="w-28 shrink-0 px-1 font-mono text-[12px]">{r.voucher_number || ''}</div>
              <div className={`w-24 shrink-0 px-1 font-semibold ${ACTION_STYLE[r.action]}`}>{r.action}</div>
              <div className="w-28 shrink-0 truncate px-1 italic">{r.changed_by || 'system'}</div>
              <div className="min-w-0 flex-1 truncate px-1 text-gray-700">{summarize(r)}</div>
            </button>
          ))
        )}
        {rows.length >= 500 && (
          <div className="mt-1 text-center text-[11px] text-gray-400">Showing latest 500 — narrow the period for more.</div>
        )}
      </div>
    </TallyScreen>
  );
};

export default EditLog;
