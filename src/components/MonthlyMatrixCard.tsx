import { ReactNode, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// cellValues[row][monthIndex] = manually entered amount (string, as typed)
type CellValues = Record<string, Record<number, string>>;

interface MonthlyMatrixCardProps {
  title: string;
  /** Stable key the entries are saved under in director_matrix_entries. */
  statementKey: string;
  icon: ReactNode;
  accentClass: string; // e.g. "border-l-emerald-500"
  rows: string[];
  subtitle?: string;
  footnote?: string;
  /** Database-pulled values per row label, keyed by month index (0-11). */
  systemValues?: Record<string, Record<number, number>>;
}

/**
 * Director-dashboard matrix: rows x 12 months. Every cell has a manual-entry
 * input (saved to director_matrix_entries on blur) plus a read-only "Sys"
 * value that will be pulled from the database once the matching source
 * (billing, payroll, vendor ledger...) is wired.
 */
export function MonthlyMatrixCard({ title, statementKey, icon, accentClass, rows, subtitle, footnote, systemValues }: MonthlyMatrixCardProps) {
  const year = new Date().getFullYear();
  const [manualValues, setManualValues] = useState<CellValues>({});

  // director_matrix_entries isn't in the generated types yet
  const table = () => (supabase as any).from('director_matrix_entries');

  const { data: savedEntries } = useQuery({
    queryKey: ['director-matrix', statementKey, year],
    queryFn: async () => {
      const { data, error } = await table()
        .select('row_label, month, manual_value')
        .eq('statement_key', statementKey)
        .eq('year', year);
      if (error) throw error;
      return data as { row_label: string; month: number; manual_value: number | null }[];
    },
  });

  // Seed local state from saved entries once they arrive
  useEffect(() => {
    if (!savedEntries) return;
    const seeded: CellValues = {};
    for (const e of savedEntries) {
      if (e.manual_value === null) continue;
      seeded[e.row_label] = { ...seeded[e.row_label], [e.month - 1]: String(e.manual_value) };
    }
    setManualValues(seeded);
  }, [savedEntries]);

  const systemValue = (row: string, monthIndex: number): string | null => {
    const v = systemValues?.[row]?.[monthIndex];
    return v === undefined || v === null ? null : Math.round(v).toLocaleString('en-IN');
  };

  const handleChange = (row: string, monthIndex: number, value: string) => {
    // Allow digits and one decimal point only
    if (value && !/^\d*\.?\d*$/.test(value)) return;
    setManualValues(prev => ({
      ...prev,
      [row]: { ...prev[row], [monthIndex]: value },
    }));
  };

  const handleBlur = async (row: string, monthIndex: number) => {
    const raw = manualValues[row]?.[monthIndex] ?? '';
    const { error } = await table().upsert(
      {
        statement_key: statementKey,
        row_label: row,
        year,
        month: monthIndex + 1,
        manual_value: raw === '' ? null : Number(raw),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'statement_key,row_label,year,month' }
    );
    if (error) {
      console.error('Failed to save matrix entry:', error);
      toast.error(`Could not save ${row} — ${MONTHS[monthIndex]}. Please retry.`);
    }
  };

  return (
    <Card className={`border-l-4 ${accentClass}`}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-2">
          {icon}
          <div>
            <CardTitle>{title} ({year})</CardTitle>
            {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
          </div>
        </div>
        <span className="text-sm text-gray-500">all amounts in ₹</span>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="border-collapse text-sm [font-variant-numeric:tabular-nums]">
            <thead>
              <tr className="bg-gray-100">
                <th className="border px-4 py-2 text-left font-semibold sticky left-0 bg-gray-100 z-10 min-w-[170px]">
                  {title}
                </th>
                {MONTHS.map(month => (
                  <th key={month} className="border px-3 py-2 text-right font-semibold min-w-[110px]">
                    {month}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row}>
                  <td className="border px-4 py-2 font-medium sticky left-0 bg-white z-10">
                    {row}
                  </td>
                  {MONTHS.map((month, monthIndex) => (
                    <td key={month} className="border px-2 py-1.5 align-top">
                      <Input
                        type="text"
                        inputMode="decimal"
                        placeholder="0"
                        aria-label={`${title} ${row} ${month} manual amount`}
                        className="h-8 px-2 text-right text-sm"
                        value={manualValues[row]?.[monthIndex] ?? ''}
                        onChange={e => handleChange(row, monthIndex, e.target.value)}
                        onBlur={() => handleBlur(row, monthIndex)}
                      />
                      <div
                        className="mt-1 px-2 text-right text-xs text-gray-400"
                        title="Pulled from the software database"
                      >
                        Sys: {systemValue(row, monthIndex) ?? '—'}
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-gray-500">
          Top field: manual entry — saves automatically when you leave the cell. “Sys” shows the
          value pulled from the software database once the source is connected.
          {footnote ? ` ${footnote}` : ''}
        </p>
      </CardContent>
    </Card>
  );
}
