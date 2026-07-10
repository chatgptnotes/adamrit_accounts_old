import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CalendarDays, Save } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type DailyValues = Record<number, string>;

const STATEMENT_TITLES: Record<string, string> = {
  income: 'Income Statement',
  expense: 'Expense Report',
  receivables: 'Receivables',
  payables: 'Payables',
  marketing_revenue: 'Marketing Executive Revenue',
};

const STATEMENT_ACCENTS: Record<string, string> = {
  income: 'border-l-blue-500',
  expense: 'border-l-emerald-500',
  receivables: 'border-l-amber-500',
  payables: 'border-l-rose-500',
  marketing_revenue: 'border-l-violet-500',
};

const table = () => (supabase as any).from('director_matrix_daily_entries');

function formatDate(year: number, month: number, day: number) {
  return new Date(year, month - 1, day).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function parsePositiveInt(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export default function DirectorMatrixDailyEntries() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { statementKey = '', year: yearParam, month: monthParam, rowLabel: rowLabelParam } = useParams();
  const year = parsePositiveInt(yearParam);
  const month = parsePositiveInt(monthParam);
  const rowLabel = rowLabelParam ? decodeURIComponent(rowLabelParam) : '';
  const [values, setValues] = useState<DailyValues>({});
  const [savingDay, setSavingDay] = useState<number | null>(null);

  const isValidStatement = Boolean(STATEMENT_TITLES[statementKey]);
  const statementTitle = STATEMENT_TITLES[statementKey] ?? 'Director Matrix';
  const accentClass = STATEMENT_ACCENTS[statementKey] ?? 'border-l-gray-500';
  const isValidRoute = Boolean(isValidStatement && year && month && month >= 1 && month <= 12 && rowLabel);
  const daysInMonth = year && month ? new Date(year, month, 0).getDate() : 31;
  const days = useMemo(() => Array.from({ length: daysInMonth }, (_, index) => index + 1), [daysInMonth]);

  const { data: savedEntries, isLoading } = useQuery({
    queryKey: ['director-matrix-daily-entries', statementKey, rowLabel, year, month],
    enabled: isValidRoute,
    queryFn: async () => {
      const { data, error } = await table()
        .select('day, amount')
        .eq('statement_key', statementKey)
        .eq('year', year)
        .eq('month', month)
        .eq('row_label', rowLabel)
        .order('day', { ascending: true });
      if (error) throw error;
      return data as { day: number; amount: number }[];
    },
  });

  useEffect(() => {
    if (!savedEntries) return;
    const seeded: DailyValues = {};
    for (const entry of savedEntries) {
      seeded[entry.day] = String(entry.amount);
    }
    setValues(seeded);
  }, [savedEntries]);

  const total = useMemo(() => {
    return Object.values(values).reduce((sum, raw) => {
      const amount = raw === '' ? 0 : Number(raw);
      return sum + (Number.isFinite(amount) ? amount : 0);
    }, 0);
  }, [values]);

  const handleChange = (day: number, value: string) => {
    if (value && !/^\d*\.?\d*$/.test(value)) return;
    setValues(prev => ({ ...prev, [day]: value }));
  };

  const handleBlur = async (day: number) => {
    if (!year || !month || !rowLabel) return;
    const raw = values[day] ?? '';

    setSavingDay(day);
    try {
      if (raw === '') {
        const { error } = await table()
          .delete()
          .eq('statement_key', statementKey)
          .eq('year', year)
          .eq('month', month)
          .eq('row_label', rowLabel)
          .eq('day', day);
        if (error) throw error;
      } else {
        const { error } = await table().upsert(
          {
            statement_key: statementKey,
            row_label: rowLabel,
            year,
            month,
            day,
            amount: Number(raw),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'statement_key,row_label,year,month,day' }
        );
        if (error) throw error;
      }

      queryClient.invalidateQueries({ queryKey: ['director-matrix-daily-totals', statementKey, year] });
      queryClient.invalidateQueries({ queryKey: ['director-matrix-daily-entries', statementKey, rowLabel, year, month] });
    } catch (error) {
      console.error('Failed to save daily matrix entry:', error);
      toast.error(`Could not save day ${day}. Please retry.`);
    } finally {
      setSavingDay(null);
    }
  };

  if (!isValidRoute) {
    return (
      <div className="min-h-[100dvh] bg-gray-50 p-4 sm:p-6">
        <Card className="mx-auto max-w-3xl">
          <CardHeader>
            <CardTitle>Invalid detail link</CardTitle>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => navigate('/director-dashboard')}>
              <ArrowLeft className="h-4 w-4" />
              Back to Director Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const selectedYear = year as number;
  const selectedMonth = month as number;

  return (
    <div className="min-h-[100dvh] bg-gray-50 p-4 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Button variant="outline" onClick={() => navigate('/director-dashboard')}>
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <div className="text-left sm:text-right">
            <p className="text-sm text-gray-500">{statementTitle}</p>
            <h1 className="text-2xl font-semibold text-gray-950">
              {rowLabel} - {MONTHS[selectedMonth - 1]} {selectedYear}
            </h1>
          </div>
        </div>

        <Card className={`border-l-4 ${accentClass}`}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-emerald-600" />
              <div>
                <CardTitle>Date-wise entries</CardTitle>
                <p className="mt-0.5 text-xs text-gray-500">Saves automatically when you leave a cell.</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500">Monthly total</p>
              <p className="text-xl font-semibold text-gray-950">
                ₹{Math.round(total).toLocaleString('en-IN')}
              </p>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse text-sm [font-variant-numeric:tabular-nums]">
                <thead>
                  <tr className="bg-gray-100">
                    <th className="border px-4 py-2 text-left font-semibold">Date</th>
                    <th className="border px-4 py-2 text-right font-semibold">Amount</th>
                    <th className="border px-4 py-2 text-left font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map(day => (
                    <tr key={day}>
                      <td className="border px-4 py-2 font-medium text-gray-900">
                        {formatDate(selectedYear, selectedMonth, day)}
                      </td>
                      <td className="border px-4 py-2">
                        <div className="ml-auto max-w-[220px]">
                          <Label htmlFor={`matrix-day-${day}`} className="sr-only">
                            Amount for {formatDate(selectedYear, selectedMonth, day)}
                          </Label>
                          <Input
                            id={`matrix-day-${day}`}
                            type="text"
                            inputMode="decimal"
                            placeholder="0"
                            className="h-9 text-right"
                            value={values[day] ?? ''}
                            disabled={isLoading}
                            onChange={event => handleChange(day, event.target.value)}
                            onBlur={() => handleBlur(day)}
                          />
                        </div>
                      </td>
                      <td className="border px-4 py-2 text-xs text-gray-500">
                        {savingDay === day ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700">
                            <Save className="h-3.5 w-3.5" />
                            Saving
                          </span>
                        ) : values[day] ? (
                          'Saved on blur'
                        ) : (
                          'No entry'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
