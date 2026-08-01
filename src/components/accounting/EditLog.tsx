import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { TallyScreen } from './tally/TallyChrome';
import { TallyList } from './tally/TallyPopup';
import { useTallyReport } from './tally/useTallyReport';
import { useRowCursor } from './tally/useRowCursor';

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
  const [actionFilter, setActionFilter] = useState('');
  const [actionPicker, setActionPicker] = useState(false);

  const report = useTallyReport({
    from: today,
    to: today,
    supportsColumns: false,
    filterFields: ['Vch No.', 'User', 'Details'],
    views: [
      { label: 'Day Book', target: 'day-book' },
      { label: 'Exception Reports', target: 'exception-reports' },
      { label: 'Registers', target: 'voucher-register' },
    ],
    screenKeys: [{ hotkey: 'F4', label: actionFilter || 'All Actions', onClick: () => setActionPicker(true) }],
  });
  const { from: fromDate, to: toDate } = report;

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['voucher_edit_log', fromDate, toDate, actionFilter],
    queryFn: async () => {
      let query = (supabase as any)
        .from('voucher_edit_log')
        .select('*')
        .gte('created_at', new Date(`${fromDate}T00:00:00`).toISOString())
        .lte('created_at', new Date(`${toDate}T23:59:59.999`).toISOString())
        .order('created_at', { ascending: false })
        .limit(500);
      if (actionFilter) query = query.eq('action', actionFilter);
      const { data, error } = await query;
      if (error) return [] as LogRow[]; // table not created yet
      return (data ?? []) as LogRow[];
    },
  });

  const visible = rows.filter((r) =>
    report.passesFilter({ 'Vch No.': r.voucher_number ?? '', User: r.changed_by ?? '', Details: summarize(r) }),
  );

  const { cursor, setCursor } = useRowCursor({
    count: visible.length,
    onEnter: (index) => {
      const r = visible[index];
      if (r && r.action !== 'DELETED' && r.voucher_id) onOpenVoucher?.(r.voucher_id);
    },
  });

  return (
    <>
    <TallyScreen title="Edit Log" rail={report.rail}>
      <div className="px-3 pb-4 pt-1 text-[13px]">
        <div className="text-center text-[11px]">
          {fromDate === toDate ? `For ${fromDate}` : `${fromDate} to ${toDate}`}
          {actionFilter ? ` — ${actionFilter}` : ''}
        </div>
        <div className="mt-1 flex border-y border-black bg-[#f0f4fa] font-semibold">
          <div className="w-32 px-1">Date / Time</div>
          <div className="w-28 px-1">Vch No.</div>
          <div className="w-24 px-1">Action</div>
          <div className="w-28 px-1">User</div>
          <div className="min-w-0 flex-1 px-1">Details</div>
        </div>

        {isLoading ? (
          <div className="py-10 text-center text-gray-400">Loading…</div>
        ) : visible.length === 0 ? (
          <div className="py-10 text-center text-gray-400">
            No log entries in this period (run the edit-log migration if you haven't).
          </div>
        ) : (
          visible.map((r, i) => (
            <button
              key={r.id}
              type="button"
              onClick={() => r.action !== 'DELETED' && r.voucher_id && onOpenVoucher?.(r.voucher_id)}
              onMouseEnter={() => setCursor(i)}
              title={r.action === 'DELETED' ? 'Voucher no longer exists' : 'Open voucher'}
              className={`flex w-full border-b border-dashed border-gray-200 text-left ${
                cursor === i ? 'bg-[#ffc423]' : r.action === 'DELETED' ? 'cursor-default' : 'hover:bg-[#fdf6d8]'
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

    {report.popups}

    {actionPicker && (
      <TallyList
        title="List of Actions"
        onClose={() => setActionPicker(false)}
        items={['', 'CREATED', 'ALTERED', 'CANCELLED', 'DELETED'].map((a) => ({
          label: a || 'All Actions',
          active: a === actionFilter,
          onSelect: () => {
            setActionFilter(a);
            setActionPicker(false);
          },
        }))}
      />
    )}
    </>
  );
};

export default EditLog;
