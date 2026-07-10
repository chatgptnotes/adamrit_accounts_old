import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CalendarDays, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCorporateData } from '@/hooks/useCorporateData';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type DailyValues = Record<number, string>;

interface PatientEntry {
  id: string;
  day: number;
  patient_name: string;
  panel: string;
  admission_date: string | null;
  package_amount: number;
}

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
const patientTable = () => (supabase as any).from('director_matrix_patient_entries');

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
  const [dialogDay, setDialogDay] = useState<number | null>(null);
  const [patientForm, setPatientForm] = useState({ name: '', panel: 'Private', admissionDate: '', amount: '' });
  const [savingPatient, setSavingPatient] = useState(false);
  const { corporateOptions } = useCorporateData();

  const panelOptions = useMemo(() => {
    const options = corporateOptions.filter(opt => opt.label.toLowerCase() !== 'private');
    return [{ value: 'Private', label: 'Private' }, ...options];
  }, [corporateOptions]);

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

  const { data: patientEntries } = useQuery({
    queryKey: ['director-matrix-patient-entries', statementKey, rowLabel, year, month],
    enabled: isValidRoute,
    queryFn: async () => {
      const { data, error } = await patientTable()
        .select('id, day, patient_name, panel, admission_date, package_amount')
        .eq('statement_key', statementKey)
        .eq('year', year)
        .eq('month', month)
        .eq('row_label', rowLabel)
        .order('day', { ascending: true })
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data as PatientEntry[];
    },
  });

  const patientsByDay = useMemo(() => {
    const grouped: Record<number, PatientEntry[]> = {};
    for (const entry of patientEntries ?? []) {
      (grouped[entry.day] ??= []).push(entry);
    }
    return grouped;
  }, [patientEntries]);

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

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['director-matrix-daily-totals', statementKey, year] });
    queryClient.invalidateQueries({ queryKey: ['director-matrix-daily-entries', statementKey, rowLabel, year, month] });
    queryClient.invalidateQueries({ queryKey: ['director-matrix-patient-entries', statementKey, rowLabel, year, month] });
  };

  // Keeps the day's revenue in director_matrix_daily_entries equal to the sum of its patient packages.
  const syncDayTotal = async (day: number, dayTotal: number, hasPatients: boolean) => {
    if (hasPatients) {
      const { error } = await table().upsert(
        {
          statement_key: statementKey,
          row_label: rowLabel,
          year,
          month,
          day,
          amount: dayTotal,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'statement_key,row_label,year,month,day' }
      );
      if (error) throw error;
    } else {
      const { error } = await table()
        .delete()
        .eq('statement_key', statementKey)
        .eq('year', year)
        .eq('month', month)
        .eq('row_label', rowLabel)
        .eq('day', day);
      if (error) throw error;
    }
  };

  const handleAddPatient = async () => {
    if (dialogDay === null) return;
    const name = patientForm.name.trim();
    const amount = Number(patientForm.amount);
    if (!name) {
      toast.error('Enter the patient name.');
      return;
    }
    if (!patientForm.amount || !Number.isFinite(amount) || amount <= 0) {
      toast.error('Enter a valid package amount.');
      return;
    }

    setSavingPatient(true);
    try {
      const { error } = await patientTable().insert({
        statement_key: statementKey,
        row_label: rowLabel,
        year,
        month,
        day: dialogDay,
        patient_name: name,
        panel: patientForm.panel,
        admission_date: patientForm.admissionDate || null,
        package_amount: amount,
      });
      if (error) throw error;

      const existing = patientsByDay[dialogDay] ?? [];
      const dayTotal = existing.reduce((sum, p) => sum + Number(p.package_amount || 0), 0) + amount;
      await syncDayTotal(dialogDay, dayTotal, true);

      invalidateAll();
      setDialogDay(null);
      setPatientForm({ name: '', panel: 'Private', admissionDate: '', amount: '' });
    } catch (error) {
      console.error('Failed to add patient entry:', error);
      toast.error('Could not add the patient. Please retry.');
    } finally {
      setSavingPatient(false);
    }
  };

  const handleDeletePatient = async (entry: PatientEntry) => {
    try {
      const { error } = await patientTable().delete().eq('id', entry.id);
      if (error) throw error;

      const remaining = (patientsByDay[entry.day] ?? []).filter(p => p.id !== entry.id);
      const dayTotal = remaining.reduce((sum, p) => sum + Number(p.package_amount || 0), 0);
      await syncDayTotal(entry.day, dayTotal, remaining.length > 0);

      invalidateAll();
    } catch (error) {
      console.error('Failed to delete patient entry:', error);
      toast.error('Could not remove the patient. Please retry.');
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
                  {days.map(day => {
                    const dayPatients = patientsByDay[day] ?? [];
                    const hasPatients = dayPatients.length > 0;
                    return (
                      <tr key={day} className="align-top">
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
                              disabled={isLoading || hasPatients}
                              onChange={event => handleChange(day, event.target.value)}
                              onBlur={() => handleBlur(day)}
                            />
                            {hasPatients && (
                              <p className="mt-1 text-right text-[11px] text-gray-400">
                                Total of {dayPatients.length} patient{dayPatients.length > 1 ? 's' : ''}
                              </p>
                            )}
                          </div>
                        </td>
                        <td className="border px-4 py-2 text-xs text-gray-500">
                          <div className="space-y-1.5">
                            {dayPatients.map(patient => (
                              <div
                                key={patient.id}
                                className="flex items-center justify-between gap-2 rounded border bg-gray-50 px-2 py-1.5"
                              >
                                <div className="min-w-0">
                                  <p className="truncate font-medium text-gray-900">
                                    {patient.patient_name}
                                    <span className="ml-1.5 rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-normal text-gray-700">
                                      {patient.panel}
                                    </span>
                                  </p>
                                  <p className="text-[11px] text-gray-500">
                                    {patient.admission_date
                                      ? `Adm ${new Date(patient.admission_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`
                                      : 'Adm date not set'}
                                    {' · '}Package ₹{Number(patient.package_amount).toLocaleString('en-IN')}
                                  </p>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 shrink-0 text-gray-400 hover:text-rose-600"
                                  aria-label={`Remove ${patient.patient_name}`}
                                  onClick={() => handleDeletePatient(patient)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            ))}
                            <div className="flex items-center gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={() => {
                                  setPatientForm(prev => ({
                                    ...prev,
                                    admissionDate: `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
                                  }));
                                  setDialogDay(day);
                                }}
                              >
                                <Plus className="h-3.5 w-3.5" />
                                Add patient
                              </Button>
                              {savingDay === day && (
                                <span className="inline-flex items-center gap-1 text-emerald-700">
                                  <Save className="h-3.5 w-3.5" />
                                  Saving
                                </span>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={dialogDay !== null} onOpenChange={open => !open && setDialogDay(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Add patient{dialogDay !== null ? ` - ${formatDate(selectedYear, selectedMonth, dialogDay)}` : ''}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="patient-name">Patient name</Label>
              <Input
                id="patient-name"
                value={patientForm.name}
                onChange={event => setPatientForm(prev => ({ ...prev, name: event.target.value }))}
                placeholder="Patient name"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Panel / Private</Label>
              <Select
                value={patientForm.panel}
                onValueChange={value => setPatientForm(prev => ({ ...prev, panel: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select panel" />
                </SelectTrigger>
                <SelectContent>
                  {panelOptions.map(option => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="admission-date">Date of admission</Label>
              <Input
                id="admission-date"
                type="date"
                value={patientForm.admissionDate}
                onChange={event => setPatientForm(prev => ({ ...prev, admissionDate: event.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="package-amount">Package amount (₹)</Label>
              <Input
                id="package-amount"
                type="text"
                inputMode="decimal"
                placeholder="0"
                value={patientForm.amount}
                onChange={event => {
                  const value = event.target.value;
                  if (value && !/^\d*\.?\d*$/.test(value)) return;
                  setPatientForm(prev => ({ ...prev, amount: value }));
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogDay(null)} disabled={savingPatient}>
              Cancel
            </Button>
            <Button onClick={handleAddPatient} disabled={savingPatient}>
              {savingPatient ? 'Saving...' : 'Add patient'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
