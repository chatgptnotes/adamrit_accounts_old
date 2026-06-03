import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
import { Plus, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

// One row of the referral register. Mirrors the public.referral_register table.
interface ReferralRow {
  id: string;
  date_of_registration: string | null;
  patient_name: string;
  paid_amount: number;
  consultant: string | null;
  referral_percent: number;
  total_paid_amount: number;
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
  | 'total_paid_amount'
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
          total_paid_amount: row.total_paid_amount,
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
          field === 'paid_amount' ||
          field === 'referral_percent' ||
          field === 'total_paid_amount';
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
      totalPaid: acc.totalPaid + toNumber(row.total_paid_amount),
      referral: acc.referral + toNumber(row.referral_amount),
    }),
    { paid: 0, totalPaid: 0, referral: 0 }
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-primary">Referral Register</h2>
          <p className="text-sm text-muted-foreground">
            Add rows manually. Sr. No, Referral Amount and totals are calculated automatically.
          </p>
        </div>
        <Button onClick={() => addMutation.mutate()} disabled={addMutation.isPending}>
          <Plus className="h-4 w-4 mr-2" />
          Add Row
        </Button>
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
              <TableHead className="min-w-[140px] text-right">Total Paid Amount (Full &amp; Final)</TableHead>
              <TableHead className="min-w-[160px]">Referral Name</TableHead>
              <TableHead className="min-w-[130px] text-right">Referral Amount</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                  Loading…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
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
                      type="number"
                      className="text-right"
                      value={row.total_paid_amount || ''}
                      placeholder="0"
                      onChange={(e) => handleChange(row.id, 'total_paid_amount', e.target.value)}
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
                <TableCell className="text-right font-semibold tabular-nums">
                  {formatMoney(totals.totalPaid)}
                </TableCell>
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
