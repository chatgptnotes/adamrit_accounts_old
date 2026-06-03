import { useEffect, useState } from 'react';
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
  referral_percent: number;
  referral_name: string | null;
  referral_amount: number;
  sort_order: number;
}

// Fields a user types directly. Referral Amount + Sr.No are derived, never typed.
type EditableField =
  | 'date_of_registration'
  | 'patient_name'
  | 'paid_amount'
  | 'consultant'
  | 'referral_percent'
  | 'referral_name';

const toNumber = (value: string | number | null | undefined): number => {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  return Number.isFinite(n) ? n : 0;
};

// Referral Amount is auto-calculated: Paid Amount x Referral %.
const calcReferralAmount = (paidAmount: number, referralPercent: number): number =>
  Math.round(paidAmount * (referralPercent / 100) * 100) / 100;

const formatMoney = (value: number): string =>
  value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ReferralRegisterTable = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  // Local editable copy of the rows so typing stays smooth; persisted on blur.
  const [rows, setRows] = useState<ReferralRow[]>([]);

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
          referral_percent: row.referral_percent,
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

  // Update one field in local state. Numeric edits also recompute Referral Amount.
  const handleChange = (id: string, field: EditableField, value: string) => {
    setRows((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row;
        const isNumeric =
          field === 'paid_amount' || field === 'referral_percent';
        const updated: ReferralRow = {
          ...row,
          [field]: isNumeric ? toNumber(value) : value,
        };
        updated.referral_amount = calcReferralAmount(
          updated.paid_amount,
          updated.referral_percent
        );
        return updated;
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

  // Build a printable landscape PDF of the current register, including totals.
  const handleExportPdf = () => {
    if (rows.length === 0) {
      toast({
        title: 'Nothing to export',
        description: 'Add at least one row before generating a PDF.',
        variant: 'destructive',
      });
      return;
    }

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
      { label: 'Consultant', w: 45, align: 'left' },
      { label: 'Referral %', w: 24, align: 'right' },
      { label: 'Referral Name', w: 50, align: 'left' },
      { label: 'Referral Amount', w: 34, align: 'right' },
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
    doc.text('Referral Register', pageWidth / 2, y, { align: 'center' });
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

    rows.forEach((row, index) => {
      if (y > pageHeight - 18) {
        doc.addPage();
        y = 16;
        drawHeader();
      }
      cellText(String(index + 1), 0, y);
      cellText(row.date_of_registration || '-', 1, y);
      cellText(row.patient_name || '-', 2, y);
      cellText(formatMoney(toNumber(row.paid_amount)), 3, y);
      cellText(row.consultant || '-', 4, y);
      cellText(`${toNumber(row.referral_percent)}%`, 5, y);
      cellText(row.referral_name || '-', 6, y);
      cellText(formatMoney(toNumber(row.referral_amount)), 7, y);
      y += 6;
    });

    // Totals row.
    y += 1;
    doc.setLineWidth(0.3);
    doc.line(marginX, y, marginX + cols.reduce((s, c) => s + c.w, 0), y);
    y += 4;
    doc.setFont('helvetica', 'bold');
    cellText('Total Amount', 2, y);
    cellText(formatMoney(totals.paid), 3, y);
    cellText(formatMoney(totals.referral), 7, y);

    doc.save(`referral_register_${new Date().toISOString().split('T')[0]}.pdf`);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-primary">Referral Register</h2>
          <p className="text-sm text-muted-foreground">
            Add rows manually. Sr. No, Referral Amount and totals are calculated automatically.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExportPdf}>
            <FileDown className="h-4 w-4 mr-2" />
            Generate PDF
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
              <TableHead className="min-w-[110px] text-right">Referral % (25% / +%)</TableHead>
              <TableHead className="min-w-[160px]">Referral Name</TableHead>
              <TableHead className="min-w-[130px] text-right">Referral Amount</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                  Loading…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                  No entries yet. Click “Add Row” to start.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row, index) => (
                <TableRow key={row.id}>
                  <TableCell className="text-center font-medium">{index + 1}</TableCell>
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
                      type="number"
                      className="text-right"
                      value={row.referral_percent || ''}
                      placeholder="0"
                      onChange={(e) => handleChange(row.id, 'referral_percent', e.target.value)}
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
                  <TableCell className="text-right font-medium tabular-nums bg-muted/40">
                    {formatMoney(toNumber(row.referral_amount))}
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
              ))
            )}
          </TableBody>
          {rows.length > 0 && (
            <TableFooter>
              <TableRow>
                <TableCell colSpan={3} className="font-semibold text-right">
                  Total Amount
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {formatMoney(totals.paid)}
                </TableCell>
                <TableCell colSpan={2} />
                <TableCell />
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
