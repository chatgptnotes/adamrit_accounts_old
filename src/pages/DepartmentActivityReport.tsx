import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// Day-wise departmental activity for a month — the same counting rules as the
// director dashboard's Department Data Entry tiles, laid out day by day so a
// drop in any department's activity is visible at a glance.

const sb = supabase as unknown as { from: (table: string) => any };

const DEPARTMENTS = [
  'Lab',
  'Radiology',
  'Pharmacy',
  'Operation Theatre',
  'Nursing',
  'Accounts',
  'Collections',
] as const;

const OT_CATEGORIES = ['ot_photos', 'ot_notes', 'implant_sticker', 'implant_invoice'];
const NURSING_CATEGORIES = ['treatment_sheet', 'monitor_chart', 'dialysis', 'dialysis_scan', 'clinical_notes'];

/** All rows of one timestamp column in a window, paged past the 1000-row cap. */
async function fetchDates(
  table: string,
  column: string,
  startISO: string,
  endISO: string,
  extra?: (q: any) => any,
): Promise<string[]> {
  const out: string[] = [];
  for (let from = 0; ; from += 1000) {
    let q = sb
      .from(table)
      .select(column)
      .gte(column, startISO)
      .lt(column, endISO)
      .order('id')
      .range(from, from + 999);
    if (extra) q = extra(q);
    const { data, error } = await q;
    if (error) throw error;
    for (const r of data ?? []) out.push(String(r[column]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** Bucket a UTC timestamp into its IST calendar day (yyyy-mm-dd). */
const istDay = (ts: string): string => {
  if (ts.length <= 10) return ts.slice(0, 10); // already a plain date
  const d = new Date(new Date(ts).getTime() + 5.5 * 3_600_000);
  return d.toISOString().slice(0, 10);
};

const monthLabel = (ym: string): string =>
  new Date(`${ym}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

const DepartmentActivityReport = () => {
  const now = new Date();
  const [month, setMonth] = useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
  );

  const { data, isLoading } = useQuery({
    queryKey: ['department-activity-report', month],
    queryFn: async () => {
      const [y, m] = month.split('-').map(Number);
      const daysInMonth = new Date(y, m, 0).getDate();
      // IST month window in UTC: the 1st 00:00 IST is 18:30 the previous day
      const startISO = new Date(Date.UTC(y, m - 1, 1) - 5.5 * 3_600_000).toISOString();
      const endISO = new Date(Date.UTC(y, m, 1) - 5.5 * 3_600_000).toISOString();
      const monthStart = `${month}-01`;
      // Exclusive upper bound for plain DATE columns
      const nextMonthFirst = `${m === 12 ? y + 1 : y}-${String((m % 12) + 1).padStart(2, '0')}-01`;

      const [labD, radD, radUp, phaD, otD, otUp, nurD, nurUp, accD, advD, finD] = await Promise.all([
        fetchDates('visit_labs', 'created_at', startISO, endISO),
        fetchDates('radiology_orders', 'created_at', startISO, endISO),
        fetchDates('file_uploads', 'created_at', startISO, endISO, (q) => q.in('category', ['radiology_investigation'])),
        fetchDates('visit_medications', 'created_at', startISO, endISO),
        fetchDates('ot_schedule', 'scheduled_date', monthStart, nextMonthFirst),
        fetchDates('file_uploads', 'created_at', startISO, endISO, (q) => q.in('category', OT_CATEGORIES)),
        fetchDates('vital_signs', 'recorded_at', startISO, endISO),
        fetchDates('file_uploads', 'created_at', startISO, endISO, (q) => q.in('category', NURSING_CATEGORIES)),
        fetchDates('vouchers', 'voucher_date', monthStart, nextMonthFirst),
        fetchDates('advance_payment', 'created_at', startISO, endISO),
        fetchDates('final_payments', 'created_at', startISO, endISO),
      ]);

      // counts[day][department]
      const counts: Record<string, Record<string, number>> = {};
      const bump = (dept: (typeof DEPARTMENTS)[number], dates: string[]) => {
        for (const ts of dates) {
          const day = istDay(ts);
          if (!day.startsWith(month)) continue;
          counts[day] = counts[day] ?? {};
          counts[day][dept] = (counts[day][dept] ?? 0) + 1;
        }
      };
      bump('Lab', labD);
      bump('Radiology', [...radD, ...radUp]);
      bump('Pharmacy', phaD);
      bump('Operation Theatre', [...otD, ...otUp]);
      bump('Nursing', [...nurD, ...nurUp]);
      bump('Accounts', accD);
      bump('Collections', [...advD, ...finD]);

      return { counts, daysInMonth };
    },
  });

  const todayIst = istDay(new Date().toISOString());

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-indigo-600" />
            <div>
              <CardTitle>Department Activity — {monthLabel(month)}</CardTitle>
              <p className="mt-0.5 text-xs text-gray-500">
                Day-wise entry counts per department, same counting as the director dashboard tiles.
                Red cells mark days a department entered nothing.
              </p>
            </div>
          </div>
          <input
            type="month"
            value={month}
            onChange={(e) => e.target.value && setMonth(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1 text-sm"
            aria-label="Report month"
          />
        </CardHeader>
        <CardContent>
          {isLoading || !data ? (
            <div className="py-16 text-center text-gray-400">Counting the month's activity…</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="border-collapse text-sm [font-variant-numeric:tabular-nums]">
                <thead>
                  <tr className="bg-gray-100">
                    <th className="sticky left-0 z-10 border bg-gray-100 px-3 py-2 text-left font-semibold">Date</th>
                    {DEPARTMENTS.map((d) => (
                      <th key={d} className="border px-3 py-2 text-right font-semibold min-w-[90px]">{d}</th>
                    ))}
                    <th className="border px-3 py-2 text-right font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: data.daysInMonth }, (_, i) => {
                    const day = `${month}-${String(i + 1).padStart(2, '0')}`;
                    if (day > todayIst) return null; // future days aren't failures
                    const row = data.counts[day] ?? {};
                    const total = DEPARTMENTS.reduce((s, d) => s + (row[d] ?? 0), 0);
                    const weekday = new Date(`${day}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short' });
                    return (
                      <tr key={day} className={day === todayIst ? 'bg-indigo-50/50' : ''}>
                        <td className="sticky left-0 z-10 border bg-white px-3 py-1.5 font-medium whitespace-nowrap">
                          {i + 1} {weekday}
                        </td>
                        {DEPARTMENTS.map((d) => {
                          const c = row[d] ?? 0;
                          return (
                            <td
                              key={d}
                              className={`border px-3 py-1.5 text-right ${c === 0 ? 'bg-red-50 font-semibold text-red-700' : ''}`}
                            >
                              {c === 0 ? '—' : c.toLocaleString('en-IN')}
                            </td>
                          );
                        })}
                        <td className="border px-3 py-1.5 text-right font-semibold">{total.toLocaleString('en-IN')}</td>
                      </tr>
                    );
                  })}
                  <tr className="bg-gray-50 font-bold">
                    <td className="sticky left-0 z-10 border bg-gray-50 px-3 py-2">Month total</td>
                    {DEPARTMENTS.map((d) => {
                      const total = Object.values(data.counts).reduce((s, row) => s + (row[d] ?? 0), 0);
                      return (
                        <td key={d} className="border px-3 py-2 text-right">{total.toLocaleString('en-IN')}</td>
                      );
                    })}
                    <td className="border px-3 py-2 text-right">
                      {Object.values(data.counts)
                        .reduce((s, row) => s + DEPARTMENTS.reduce((x, d) => x + (row[d] ?? 0), 0), 0)
                        .toLocaleString('en-IN')}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default DepartmentActivityReport;
