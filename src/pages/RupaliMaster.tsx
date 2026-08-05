import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Loader2, Check, ChevronsUpDown } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command';
import { cn } from '@/lib/utils';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

// DATA SOURCE: rupali_charge_rules — standard charge per category + doctor + purpose.
// The tablet Rupali tile reads only active rules; deactivating hides a rule
// there without losing its history here.

const CATEGORIES = ['OPD', 'IPD', 'Procedure', 'Day Care'] as const;
const PATIENT_CATEGORIES = ['Any', 'Inpatient', 'Outpatient', 'Yojana', 'Private', 'Corporate', 'Other'] as const;

interface ChargeRule {
  id: string;
  category: string;
  doctor_id: string | null;
  doctor_name: string;
  purpose_reason: string;
  patient_category: string;
  amount: number;
  is_active: boolean;
}

interface DoctorOption {
  id: string;
  name: string;
  hospital: string;
}

export default function RupaliMaster() {
  const queryClient = useQueryClient();
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [doctorOpen, setDoctorOpen] = useState(false);
  const [form, setForm] = useState({
    category: 'OPD',
    doctorKey: '',
    purpose: '',
    patientCategory: 'Any',
    amount: '',
  });

  const { data: rules = [], isLoading } = useQuery({
    queryKey: ['rupali-master-rules'],
    queryFn: async (): Promise<ChargeRule[]> => {
      const { data, error } = await (supabase as any)
        .from('rupali_charge_rules')
        .select('id, category, doctor_id, doctor_name, purpose_reason, patient_category, amount, is_active')
        .order('category')
        .order('doctor_name')
        .order('purpose_reason');
      if (error) throw error;
      return (data || []) as ChargeRule[];
    },
  });

  // Doctors come from both hospitals' consultant masters; new names added
  // there appear here on the next load.
  const { data: doctors = [] } = useQuery({
    queryKey: ['rupali-master-doctors'],
    queryFn: async (): Promise<DoctorOption[]> => {
      const [hope, ayushman] = await Promise.all([
        supabase.from('hope_consultants').select('id, name').order('name'),
        supabase.from('ayushman_consultants').select('id, name').order('name'),
      ]);
      const options: DoctorOption[] = [];
      for (const row of hope.data || []) options.push({ id: row.id, name: row.name, hospital: 'Hope' });
      for (const row of ayushman.data || []) options.push({ id: row.id, name: row.name, hospital: 'Ayushman' });
      return options;
    },
  });

  const doctorByKey = useMemo(() => {
    const map = new Map<string, DoctorOption>();
    doctors.forEach((d) => map.set(`${d.hospital}:${d.id}`, d));
    return map;
  }, [doctors]);

  const addRule = useMutation({
    mutationFn: async () => {
      const doctor = doctorByKey.get(form.doctorKey);
      const amount = parseFloat(form.amount);
      if (!doctor) throw new Error('Select the doctor');
      if (!Number.isFinite(amount) || amount < 0) throw new Error('Enter a valid amount');
      const { error } = await (supabase as any).from('rupali_charge_rules').insert({
        category: form.category,
        doctor_id: doctor.id,
        doctor_name: doctor.name,
        // The tablet flow charges directly per category + doctor; purpose is
        // optional detail and falls back to the category name.
        purpose_reason: form.purpose.trim() || form.category,
        patient_category: form.patientCategory,
        amount,
      });
      if (error) {
        if (error.code === '23505') {
          throw new Error('An active rule for this category, doctor and purpose already exists.');
        }
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      toast.success('Charge rule added.');
      setForm((f) => ({ ...f, purpose: '', amount: '' }));
      queryClient.invalidateQueries({ queryKey: ['rupali-master-rules'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not add the rule'),
  });

  const toggleActive = useMutation({
    mutationFn: async (rule: ChargeRule) => {
      const { error } = await (supabase as any)
        .from('rupali_charge_rules')
        .update({ is_active: !rule.is_active })
        .eq('id', rule.id);
      if (error) {
        if (error.code === '23505') {
          throw new Error('An active rule for this combination already exists — deactivate it first.');
        }
        throw new Error(error.message);
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['rupali-master-rules'] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not update the rule'),
  });

  const visibleRules =
    filterCategory === 'all' ? rules : rules.filter((r) => r.category === filterCategory);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">OPD/IPD Consultation / Visit Master</h1>
        <p className="text-sm text-muted-foreground">
          Standard charges for the tablet Rupali register — one amount per category, doctor and
          purpose.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add charge rule</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="w-36">
            <label className="text-xs font-medium">Category</label>
            <Select value={form.category} onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-72">
            <label className="text-xs font-medium">Doctor</label>
            <Popover open={doctorOpen} onOpenChange={setDoctorOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
                  {doctorByKey.get(form.doctorKey)
                    ? `${doctorByKey.get(form.doctorKey)!.name} (${doctorByKey.get(form.doctorKey)!.hospital})`
                    : 'Select doctor'}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-0">
                <Command>
                  <CommandInput placeholder="Search doctor…" />
                  <CommandList>
                    <CommandEmpty>No doctor found.</CommandEmpty>
                    <CommandGroup>
                      {doctors.map((d) => {
                        const key = `${d.hospital}:${d.id}`;
                        return (
                          <CommandItem
                            key={key}
                            value={`${d.name} ${d.hospital}`}
                            onSelect={() => {
                              setForm((f) => ({ ...f, doctorKey: key }));
                              setDoctorOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                'mr-2 h-4 w-4',
                                form.doctorKey === key ? 'opacity-100' : 'opacity-0',
                              )}
                            />
                            {d.name} <span className="ml-1 text-muted-foreground">({d.hospital})</span>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
          <div className="w-64">
            <label className="text-xs font-medium">Purpose / Procedure (optional)</label>
            <Input
              value={form.purpose}
              onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))}
              placeholder="e.g. First consultation / Dressing"
            />
          </div>
          <div className="w-40">
            <label className="text-xs font-medium">Patient Category</label>
            <Select
              value={form.patientCategory}
              onValueChange={(v) => setForm((f) => ({ ...f, patientCategory: v }))}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PATIENT_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-32">
            <label className="text-xs font-medium">Amount (₹)</label>
            <Input
              type="number"
              inputMode="decimal"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              placeholder="0.00"
            />
          </div>
          <Button onClick={() => addRule.mutate()} disabled={addRule.isPending}>
            {addRule.isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-1 h-4 w-4" />
            )}
            Add
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">
            Charge rules {isLoading ? '' : `(${visibleRules.length})`}
          </CardTitle>
          <Select value={filterCategory} onValueChange={setFilterCategory}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="py-8 text-center text-muted-foreground">Loading…</p>
          ) : visibleRules.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">No charge rules yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead>Doctor</TableHead>
                  <TableHead>Purpose / Procedure</TableHead>
                  <TableHead>Patient Category</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRules.map((rule) => (
                  <TableRow key={rule.id} className={rule.is_active ? '' : 'opacity-50'}>
                    <TableCell>{rule.category}</TableCell>
                    <TableCell>{rule.doctor_name}</TableCell>
                    <TableCell>{rule.purpose_reason}</TableCell>
                    <TableCell>{rule.patient_category || 'Any'}</TableCell>
                    <TableCell className="text-right font-mono">
                      ₹{Number(rule.amount).toLocaleString('en-IN')}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => toggleActive.mutate(rule)}
                        disabled={toggleActive.isPending}
                      >
                        {rule.is_active ? 'Active' : 'Hidden'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
