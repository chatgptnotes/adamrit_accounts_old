import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Receipt } from 'lucide-react';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const EXPENSE_ROWS = ['Salary', 'Rent', 'Lab charges', 'Electricity bill'];

// cellValues[expense][monthIndex] = manually entered amount (string, as typed)
type CellValues = Record<string, Record<number, string>>;

export function ExpenseReportSection() {
  const year = new Date().getFullYear();
  const [manualValues, setManualValues] = useState<CellValues>({});

  // System values will be imported from accounting/payroll/lab billing once
  // those sources are wired; until then every cell shows an em dash.
  const systemValue = (_expense: string, _monthIndex: number): string | null => null;

  const handleChange = (expense: string, monthIndex: number, value: string) => {
    // Allow digits and one decimal point only
    if (value && !/^\d*\.?\d*$/.test(value)) return;
    setManualValues(prev => ({
      ...prev,
      [expense]: { ...prev[expense], [monthIndex]: value },
    }));
  };

  return (
    <Card className="border-l-4 border-l-emerald-500">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-2">
          <Receipt className="h-5 w-5 text-emerald-600" />
          <CardTitle>Expense Report ({year})</CardTitle>
        </div>
        <span className="text-sm text-gray-500">all amounts in ₹</span>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="border-collapse text-sm [font-variant-numeric:tabular-nums]">
            <thead>
              <tr className="bg-gray-100">
                <th className="border px-4 py-2 text-left font-semibold sticky left-0 bg-gray-100 z-10 min-w-[140px]">
                  Expense
                </th>
                {MONTHS.map(month => (
                  <th key={month} className="border px-3 py-2 text-right font-semibold min-w-[110px]">
                    {month}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {EXPENSE_ROWS.map(expense => (
                <tr key={expense}>
                  <td className="border px-4 py-2 font-medium sticky left-0 bg-white z-10">
                    {expense}
                  </td>
                  {MONTHS.map((month, monthIndex) => (
                    <td key={month} className="border px-2 py-1.5 align-top">
                      <Input
                        type="text"
                        inputMode="decimal"
                        placeholder="0"
                        aria-label={`${expense} ${month} manual amount`}
                        className="h-8 px-2 text-right text-sm"
                        value={manualValues[expense]?.[monthIndex] ?? ''}
                        onChange={e => handleChange(expense, monthIndex, e.target.value)}
                      />
                      <div
                        className="mt-1 px-2 text-right text-xs text-gray-400"
                        title="Imported from system (not yet connected)"
                      >
                        Sys: {systemValue(expense, monthIndex) ?? '—'}
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-gray-500">
          Top field: manual entry. “Sys” shows the value imported from the system once expense
          sources are connected. Manual entries are not yet saved to the database.
        </p>
      </CardContent>
    </Card>
  );
}
