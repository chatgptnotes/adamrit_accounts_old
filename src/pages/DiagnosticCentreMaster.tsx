import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

// DATA SOURCE: diagnostic_centres + diagnostic_centre_tests — the master
// behind the tablet Diagnostics tiles (centre dropdown + auto amounts).

interface Centre {
  id: string;
  name: string;
  is_active: boolean;
}

interface CentreTest {
  id: string;
  centre_id: string;
  test_name: string;
  amount: number;
  is_active: boolean;
}

export default function DiagnosticCentreMaster() {
  const queryClient = useQueryClient();
  const [newCentre, setNewCentre] = useState('');
  const [selectedCentreId, setSelectedCentreId] = useState<string | null>(null);
  const [testForm, setTestForm] = useState({ name: '', amount: '' });

  const { data: centres = [], isLoading } = useQuery({
    queryKey: ['diag-master-centres'],
    queryFn: async (): Promise<Centre[]> => {
      const { data, error } = await (supabase as any)
        .from('diagnostic_centres')
        .select('id, name, is_active')
        .order('name');
      if (error) throw error;
      return (data || []) as Centre[];
    },
  });

  const selectedCentre = centres.find((c) => c.id === selectedCentreId) ?? null;

  const { data: tests = [] } = useQuery({
    queryKey: ['diag-master-tests', selectedCentreId],
    enabled: !!selectedCentreId,
    queryFn: async (): Promise<CentreTest[]> => {
      const { data, error } = await (supabase as any)
        .from('diagnostic_centre_tests')
        .select('id, centre_id, test_name, amount, is_active')
        .eq('centre_id', selectedCentreId)
        .order('test_name');
      if (error) throw error;
      return (data || []) as CentreTest[];
    },
  });

  const addCentre = useMutation({
    mutationFn: async () => {
      if (!newCentre.trim()) throw new Error('Enter the centre name');
      const { error } = await (supabase as any)
        .from('diagnostic_centres')
        .insert({ name: newCentre.trim() });
      if (error) {
        if (error.code === '23505') throw new Error('This centre already exists.');
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      toast.success('Centre added.');
      setNewCentre('');
      queryClient.invalidateQueries({ queryKey: ['diag-master-centres'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not add the centre'),
  });

  const toggleCentre = useMutation({
    mutationFn: async (centre: Centre) => {
      const { error } = await (supabase as any)
        .from('diagnostic_centres')
        .update({ is_active: !centre.is_active })
        .eq('id', centre.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['diag-master-centres'] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not update the centre'),
  });

  const addTest = useMutation({
    mutationFn: async () => {
      const amount = parseFloat(testForm.amount);
      if (!selectedCentreId) throw new Error('Pick a centre first');
      if (!testForm.name.trim()) throw new Error('Enter the test name');
      if (!Number.isFinite(amount) || amount < 0) throw new Error('Enter a valid amount');
      const { error } = await (supabase as any).from('diagnostic_centre_tests').insert({
        centre_id: selectedCentreId,
        test_name: testForm.name.trim(),
        amount,
      });
      if (error) {
        if (error.code === '23505') throw new Error('This test already exists for the centre.');
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      toast.success('Test added.');
      setTestForm({ name: '', amount: '' });
      queryClient.invalidateQueries({ queryKey: ['diag-master-tests', selectedCentreId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not add the test'),
  });

  const toggleTest = useMutation({
    mutationFn: async (test: CentreTest) => {
      const { error } = await (supabase as any)
        .from('diagnostic_centre_tests')
        .update({ is_active: !test.is_active })
        .eq('id', test.id);
      if (error) {
        if (error.code === '23505') throw new Error('An active test with this name already exists.');
        throw new Error(error.message);
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['diag-master-tests', selectedCentreId] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not update the test'),
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Diagnostic Centre Master</h1>
        <p className="text-sm text-muted-foreground">
          Outside CT / MRI / lab centres and their test rates — drives the tablet Diagnostics
          tiles (Chetna / Nisha) and the auto-filled amounts.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Centres</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input
                value={newCentre}
                onChange={(e) => setNewCentre(e.target.value)}
                placeholder="e.g. Noble Scan Center"
              />
              <Button onClick={() => addCentre.mutate()} disabled={addCentre.isPending}>
                {addCentre.isPending ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="mr-1 h-4 w-4" />
                )}
                Add
              </Button>
            </div>
            {isLoading ? (
              <p className="py-6 text-center text-muted-foreground">Loading…</p>
            ) : (
              <div className="space-y-1">
                {centres.map((centre) => (
                  <div
                    key={centre.id}
                    className={`flex cursor-pointer items-center justify-between rounded-md border px-3 py-2 ${
                      selectedCentreId === centre.id ? 'border-primary bg-primary/5' : ''
                    } ${centre.is_active ? '' : 'opacity-50'}`}
                    onClick={() => setSelectedCentreId(centre.id)}
                  >
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      {centre.name}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleCentre.mutate(centre);
                      }}
                      disabled={toggleCentre.isPending}
                    >
                      {centre.is_active ? 'Active' : 'Hidden'}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {selectedCentre ? `Tests at ${selectedCentre.name}` : 'Tests'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!selectedCentre ? (
              <p className="py-6 text-center text-muted-foreground">
                Pick a centre on the left to manage its tests and rates.
              </p>
            ) : (
              <>
                <div className="flex gap-2">
                  <Input
                    value={testForm.name}
                    onChange={(e) => setTestForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. CT Brain Plain"
                  />
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={testForm.amount}
                    onChange={(e) => setTestForm((f) => ({ ...f, amount: e.target.value }))}
                    placeholder="Amount"
                    className="w-32"
                  />
                  <Button onClick={() => addTest.mutate()} disabled={addTest.isPending}>
                    {addTest.isPending ? (
                      <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="mr-1 h-4 w-4" />
                    )}
                    Add
                  </Button>
                </div>
                {tests.length === 0 ? (
                  <p className="py-6 text-center text-muted-foreground">No tests yet.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Test</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead className="text-right">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {tests.map((test) => (
                        <TableRow key={test.id} className={test.is_active ? '' : 'opacity-50'}>
                          <TableCell>{test.test_name}</TableCell>
                          <TableCell className="text-right font-mono">
                            ₹{Number(test.amount).toLocaleString('en-IN')}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => toggleTest.mutate(test)}
                              disabled={toggleTest.isPending}
                            >
                              {test.is_active ? 'Active' : 'Hidden'}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
