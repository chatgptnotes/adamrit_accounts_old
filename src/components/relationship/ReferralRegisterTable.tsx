import { Fragment, useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { jsPDF } from 'jspdf';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Plus, Trash2, FileDown } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

// One row of the referral register. Mirrors the public.referral_register table.
interface ReferralRow {
  id: string;
  date_of_registration: string | null;
  patient_name: string;
  paid_amount: number;
  consultant: string | null;
  referral_name: string | null;
  referral_amount: number;
  sort_order: number;
}

// Fields a user types directly. Sr.No is derived; everything else is manual.
type EditableField =
  | 'date_of_registration'
  | 'patient_name'
  | 'paid_amount'
  | 'consultant'
  | 'referral_name'
  | 'referral_amount';

const toNumber = (value: string | number | null | undefined): number => {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  return Number.isFinite(n) ? n : 0;
};

const formatMoney = (value: number): string =>
  value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Render an ISO 'YYYY-MM-DD' as 'DD-Mon-YYYY' without timezone drift.
const formatDateHeading = (iso: string | null): string => {
  if (!iso) return 'No date';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}-${MONTHS[parseInt(m, 10) - 1] ?? m}-${y}`;
};

// One day's worth of rows plus its running totals. startSerial keeps the
// Sr. No continuous across days even though rows are clustered by date.
interface DateGroup {
  key: string; // '' for undated rows
  date: string | null;
  rows: ReferralRow[];
  paid: number;
  referral: number;
  startSerial: number;
}

// Cluster rows by date_of_registration, chronological ascending, undated last.
const buildDateGroups = (rows: ReferralRow[]): DateGroup[] => {
  const map = new Map<string, DateGroup>();
  for (const row of rows) {
    const key = row.date_of_registration || '';
    let group = map.get(key);
    if (!group) {
      group = { key, date: row.date_of_registration || null, rows: [], paid: 0, referral: 0, startSerial: 0 };
      map.set(key, group);
    }
    group.rows.push(row);
    group.paid += toNumber(row.paid_amount);
    group.referral += toNumber(row.referral_amount);
  }
  const groups = Array.from(map.values()).sort((a, b) => {
    if (a.key === '') return 1;
    if (b.key === '') return -1;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
  let serial = 0;
  for (const group of groups) {
    group.startSerial = serial;
    serial += group.rows.length;
  }
  return groups;
};

const ReferralRegisterTable = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  // Local editable copy of the rows so typing stays smooth; persisted on blur.
  const [rows, setRows] = useState<ReferralRow[]>([]);
  // Date chosen for PDF export. '' means export every date.
  const [exportDate, setExportDate] = useState<string>('');

  const { data: fetchedRows = [], isLoading } = useQuery({
    queryKey: ['referral-register'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('referral_register')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });

      if (error) {
        console.error('Error fetching referral register:', error);
        throw error;
      }
      return (data || []) as ReferralRow[];
    },
  });

  // Keep the editable copy in sync with the server whenever it refetches.
  useEffect(() => {
    setRows(fetchedRows);
  }, [fetchedRows]);

  const addMutation = useMutation({
    mutationFn: async () => {
      const nextSort =
        rows.reduce((max, r) => Math.max(max, r.sort_order), 0) + 1;
      const { error } = await supabase
        .from('referral_register')
        .insert([{ sort_order: nextSort }]);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['referral-register'] });
    },
    onError: (error) => {
      console.error('Add referral row error:', error);
      toast({ title: 'Error', description: 'Failed to add row', variant: 'destructive' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (row: ReferralRow) => {
      const { error } = await supabase
        .from('referral_register')
        .update({
          date_of_registration: row.date_of_registration || null,
          patient_name: row.patient_name,
          paid_amount: row.paid_amount,
          consultant: row.consultant || null,
          referral_name: row.referral_name || null,
          referral_amount: row.referral_amount,
        })
        .eq('id', row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['referral-register'] });
    },
    onError: (error) => {
      console.error('Update referral row error:', error);
      toast({ title: 'Error', description: 'Failed to save changes', variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('referral_register').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['referral-register'] });
      toast({ title: 'Deleted', description: 'Row removed' });
    },
    onError: (error) => {
      console.error('Delete referral row error:', error);
      toast({ title: 'Error', description: 'Failed to delete row', variant: 'destructive' });
    },
  });

  // Update one field in local state. Money fields are parsed to numbers.
  const handleChange = (id: string, field: EditableField, value: string) => {
    setRows((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row;
        const isNumeric = field === 'paid_amount' || field === 'referral_amount';
        return { ...row, [field]: isNumeric ? toNumber(value) : value };
      })
    );
  };

  // Persist the current local state of one row to the server.
  const handleBlur = (id: string) => {
    const row = rows.find((r) => r.id === id);
    if (row) updateMutation.mutate(row);
  };

  const handleDelete = (id: string) => {
    if (confirm('Delete this row?')) deleteMutation.mutate(id);
  };

  const totals = rows.reduce(
    (acc, row) => ({
      paid: acc.paid + toNumber(row.paid_amount),
      referral: acc.referral + toNumber(row.referral_amount),
    }),
    { paid: 0, referral: 0 }
  );

  // Rows clustered by date, each with its own daily subtotal.
  const dateGroups = buildDateGroups(rows);
  // Distinct dates that actually have entries, for the export picker.
  const availableDates = dateGroups.map((g) => g.key).filter(Boolean);

  // Build a printable landscape PDF of the current register, including totals.
  const handleExportPdf = () => {
    // When a date is selected, export only that day; otherwise the whole register.
    const groupsToExport = exportDate
      ? dateGroups.filter((g) => g.key === exportDate)
      : dateGroups;

    const exportRowCount = groupsToExport.reduce((n, g) => n + g.rows.length, 0);
    if (exportRowCount === 0) {
      toast({
        title: 'Nothing to export',
        description: exportDate
          ? 'No entries for the selected date.'
          : 'Add at least one row before generating a PDF.',
        variant: 'destructive',
      });
      return;
    }

    const exportTotals = groupsToExport.reduce(
      (acc, g) => ({ paid: acc.paid + g.paid, referral: acc.referral + g.referral }),
      { paid: 0, referral: 0 }
    );

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const marginX = 10;

    // Column layout: [label, x-offset from marginX, width, alignment].
    const cols: { label: string; w: number; align: 'left' | 'right' }[] = [
      { label: 'Sr. No', w: 14, align: 'left' },
      { label: 'Date of Regi.', w: 28, align: 'left' },
      { label: 'Patient Name', w: 50, align: 'left' },
      { label: 'Paid Amount', w: 32, align: 'right' },
      { label: 'Consultant', w: 50, align: 'left' },
      { label: 'Referral Name', w: 55, align: 'left' },
      { label: 'Referral Amount', w: 38, align: 'right' },
    ];
    const xs: number[] = [];
    cols.reduce((x, c) => {
      xs.push(x);
      return x + c.w;
    }, marginX);

    const cellText = (text: string, colIdx: number, y: number) => {
      const c = cols[colIdx];
      const x = c.align === 'right' ? xs[colIdx] + c.w - 2 : xs[colIdx] + 2;
      const clipped = doc.splitTextToSize(text, c.w - 3)[0] ?? '';
      doc.text(clipped, x, y, { align: c.align });
    };

    let y = 16;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(
      exportDate ? `Referral Register - ${formatDateHeading(exportDate)}` : 'Referral Register',
      pageWidth / 2,
      y,
      { align: 'center' }
    );
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(`Generated: ${new Date().toLocaleDateString()}`, pageWidth / 2, y, {
      align: 'center',
    });
    y += 6;

    const drawHeader = () => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      cols.forEach((_, i) => cellText(cols[i].label, i, y));
      y += 1.5;
      doc.setLineWidth(0.3);
      doc.line(marginX, y, marginX + cols.reduce((s, c) => s + c.w, 0), y);
      y += 4;
      doc.setFont('helvetica', 'normal');
    };
    drawHeader();

    const tableWidth = cols.reduce((s, c) => s + c.w, 0);

    let serial = 0;
    groupsToExport.forEach((group) => {
      // Date heading for this day's block.
      if (y > pageHeight - 24) {
        doc.addPage();
        y = 16;
        drawHeader();
      }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.text(formatDateHeading(group.date), marginX + 2, y);
      y += 5;
      doc.setFont('helvetica', 'normal');

      group.rows.forEach((row) => {
        if (y > pageHeight - 18) {
          doc.addPage();
          y = 16;
          drawHeader();
        }
        cellText(String(++serial), 0, y);
        cellText(row.date_of_registration || '-', 1, y);
        cellText(row.patient_name || '-', 2, y);
        cellText(formatMoney(toNumber(row.paid_amount)), 3, y);
        cellText(row.consultant || '-', 4, y);
        cellText(row.referral_name || '-', 5, y);
        cellText(formatMoney(toNumber(row.referral_amount)), 6, y);
        y += 6;
      });

      // Daily subtotal line.
      if (y > pageHeight - 18) {
        doc.addPage();
        y = 16;
        drawHeader();
      }
      doc.setLineWidth(0.1);
      doc.line(marginX, y - 2, marginX + tableWidth, y - 2);
      doc.setFont('helvetica', 'bold');
      cellText(`Total for ${formatDateHeading(group.date)}`, 2, y);
      cellText(formatMoney(group.paid), 3, y);
      cellText(formatMoney(group.referral), 6, y);
      doc.setFont('helvetica', 'normal');
      y += 8;
    });

    // Grand total row.
    y += 1;
    doc.setLineWidth(0.3);
    doc.line(marginX, y, marginX + tableWidth, y);
    y += 4;
    doc.setFont('helvetica', 'bold');
    cellText('Grand Total', 2, y);
    cellText(formatMoney(exportTotals.paid), 3, y);
    cellText(formatMoney(exportTotals.referral), 6, y);

    doc.save(`referral_register_${exportDate || 'all-dates'}.pdf`);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-primary">Referral Register</h2>
          <p className="text-sm text-muted-foreground">
            Add rows manually. Entries are grouped by date with a daily total; Sr. No and totals are calculated automatically.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={exportDate}
            onChange={(e) => setExportDate(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            title="Choose a date to export"
          >
            <option value="">All dates</option>
            {availableDates.map((d) => (
              <option key={d} value={d}>
                {formatDateHeading(d)}
              </option>
            ))}
          </select>
          <Button variant="outline" onClick={handleExportPdf}>
            <FileDown className="h-4 w-4 mr-2" />
            {exportDate ? 'Generate PDF (selected date)' : 'Generate PDF'}
          </Button>
          <Button onClick={() => addMutation.mutate()} disabled={addMutation.isPending}>
            <Plus className="h-4 w-4 mr-2" />
            Add Row
          </Button>
        </div>
      </div>

      <div className="rounded-md border bg-white overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">Sr. No</TableHead>
              <TableHead className="min-w-[150px]">Date of Registration</TableHead>
              <TableHead className="min-w-[160px]">Patient Name</TableHead>
              <TableHead className="min-w-[120px] text-right">Paid Amount</TableHead>
              <TableHead className="min-w-[140px]">Consultant</TableHead>
              <TableHead className="min-w-[160px]">Referral Name</TableHead>
              <TableHead className="min-w-[130px] text-right">Referral Amount</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                  Loading…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                  No entries yet. Click “Add Row” to start.
                </TableCell>
              </TableRow>
            ) : (
              dateGroups.map((group) => (
                <Fragment key={group.key || 'no-date'}>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableCell colSpan={8} className="py-1.5 text-sm font-semibold text-primary">
                      {formatDateHeading(group.date)}
                    </TableCell>
                  </TableRow>
                  {group.rows.map((row, idx) => (
                    <TableRow key={row.id}>
                      <TableCell className="text-center font-medium">
                        {group.startSerial + idx + 1}
                      </TableCell>
                      <TableCell>
                        <Input
                          type="date"
                          value={row.date_of_registration ?? ''}
                          onChange={(e) => handleChange(row.id, 'date_of_registration', e.target.value)}
                          onBlur={() => handleBlur(row.id)}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={row.patient_name ?? ''}
                          placeholder="Patient name"
                          onChange={(e) => handleChange(row.id, 'patient_name', e.target.value)}
                          onBlur={() => handleBlur(row.id)}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          className="text-right"
                          value={row.paid_amount || ''}
                          placeholder="0"
                          onChange={(e) => handleChange(row.id, 'paid_amount', e.target.value)}
                          onBlur={() => handleBlur(row.id)}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={row.consultant ?? ''}
                          placeholder="Consultant"
                          onChange={(e) => handleChange(row.id, 'consultant', e.target.value)}
                          onBlur={() => handleBlur(row.id)}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={row.referral_name ?? ''}
                          placeholder="Referral name"
                          onChange={(e) => handleChange(row.id, 'referral_name', e.target.value)}
                          onBlur={() => handleBlur(row.id)}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          className="text-right"
                          value={row.referral_amount || ''}
                          placeholder="0"
                          onChange={(e) => handleChange(row.id, 'referral_amount', e.target.value)}
                          onBlur={() => handleBlur(row.id)}
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(row.id)}
                          className="text-red-600 hover:text-red-700"
                          title="Delete row"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-muted/20 hover:bg-muted/20">
                    <TableCell colSpan={3} className="text-right text-sm font-medium">
                      Total for {formatDateHeading(group.date)}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatMoney(group.paid)}
                    </TableCell>
                    <TableCell colSpan={2} />
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatMoney(group.referral)}
                    </TableCell>
                    <TableCell />
                  </TableRow>
                </Fragment>
              ))
            )}
          </TableBody>
          {rows.length > 0 && (
            <TableFooter>
              <TableRow>
                <TableCell colSpan={3} className="font-semibold text-right">
                  Grand Total
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {formatMoney(totals.paid)}
                </TableCell>
                <TableCell colSpan={2} />
                <TableCell className="text-right font-semibold tabular-nums">
                  {formatMoney(totals.referral)}
                </TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </div>
    </div>
  );
};

export default ReferralRegisterTable;
