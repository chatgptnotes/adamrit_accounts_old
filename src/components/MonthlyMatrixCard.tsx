import { ReactNode, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// cellValues[row][monthIndex] = manually entered amount (string, as typed)
type CellValues = Record<string, Record<number, string>>;

interface MonthlyMatrixCardProps {
  title: string;
  icon: ReactNode;
  accentClass: string; // e.g. "border-l-emerald-500"
  rows: string[];
  subtitle?: string;
  footnote?: string;
}

/**
 * Director-dashboard matrix: rows x 12 months. Every cell has a manual-entry
 * input plus a read-only "Sys" value that will be pulled from the database
 * once the matching source (billing, payroll, vendor ledger...) is wired.
 */
export function MonthlyMatrixCard({ title, icon, accentClass, rows, subtitle, footnote }: MonthlyMatrixCardProps) {
  const year = new Date().getFullYear();
  const [manualValues, setManualValues] = useState<CellValues>({});

  const systemValue = (_row: string, _monthIndex: number): string | null => null;

  const handleChange = (row: string, monthIndex: number, value: string) => {
    // Allow digits and one decimal point only
    if (value && !/^\d*\.?\d*$/.test(value)) return;
    setManualValues(prev => ({
      ...prev,
      [row]: { ...prev[row], [monthIndex]: value },
    }));
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
                      />
                      <div
                        className="mt-1 px-2 text-right text-xs text-gray-400"
                        title="Pulled from the software database (not yet connected)"
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
          Top field: manual entry. “Sys” shows the value pulled from the software database once the
          source is connected. Manual entries are not yet saved to the database.
          {footnote ? ` ${footnote}` : ''}
        </p>
      </CardContent>
    </Card>
  );
}
