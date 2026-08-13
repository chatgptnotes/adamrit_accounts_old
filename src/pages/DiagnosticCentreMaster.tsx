import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDebounce } from 'use-debounce';
import { Building2, Loader2, Plus, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  LedgerAutocomplete, type LedgerAccountOption,
} from '@/components/accounting/LedgerAutocomplete';
import { ceilingError, searchMasterTests, type MasterTest } from '@/lib/diagnostics/masterTests';

// DATA SOURCE: diagnostic_centres + diagnostic_centre_tests — the master
// behind the tablet Diagnostics tiles (centre dropdown + auto amounts).
//
// A centre IS a creditor ledger: record_diagnostic_referral() finds the
// ledger to credit by matching this name against the chart of accounts, and
// opens a duplicate ledger when nothing matches. So the name is never typed
// here — it is taken verbatim from the ledger picked below. Test names come
// from the radiology / lab masters for the same reason.

interface Centre {
  id: string;
  name: string;
  is_active: boolean;
  ledger_account_id: string | null;
}

interface CentreTest {
  id: string;
  centre_id: string;
  test_name: string;
  amount: number;
  is_active: boolean;
}

/** Type-to-search over the radiology + lab masters. No free text: a rate is
 *  only meaningful against a test the hospital's own catalogue knows. */
function MasterTestPicker({
  value,
  onChange,
}: {
  value: MasterTest | null;
  onChange: (test: MasterTest | null) => void;
}) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [debounced] = useDebounce(search, 250);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickAway = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickAway);
    return () => document.removeEventListener('mousedown', onClickAway);
  }, [open]);

  const { data: options = [], isLoading } = useQuery({
    queryKey: ['diag-master-test-search', debounced],
    enabled: debounced.trim().length >= 1,
    queryFn: () => searchMasterTests(debounced),
  });

  if (value && !open) {
    return (
      <div className="flex flex-1 items-center gap-2 rounded-md border bg-background px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-sm">{value.name}</span>
        <button
          type="button"
          aria-label="Clear test"
          className="rounded p-1 text-muted-foreground hover:bg-muted"
          onClick={() => onChange(null)}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div ref={boxRef} className="relative flex-1">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={search}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setSearch(e.target.value);
          setOpen(true);
        }}
        placeholder="Search the radiology / lab master…"
        className="pl-9"
      />
      {open && search.trim().length >= 1 && (
        <div className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-popover shadow-md">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 p-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Searching
            </div>
          ) : options.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">
              No matching test. Add it in the Radiology Master or Lab Master first.
            </p>
          ) : (
            options.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => {
                  onChange(option);
                  setOpen(false);
                  setSearch('');
                }}
                className="flex w-full items-start gap-2 border-b px-3 py-2 text-left last:border-b-0 hover:bg-muted"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{option.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[option.source === 'radiology' ? 'Radiology' : 'Lab', option.category]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function DiagnosticCentreMaster() {
  const queryClient = useQueryClient();
  const [newLedger, setNewLedger] = useState<LedgerAccountOption | null>(null);
  const [selectedCentreId, setSelectedCentreId] = useState<string | null>(null);
  const [testForm, setTestForm] = useState<{ test: MasterTest | null; amount: string }>({
    test: null,
    amount: '',
  });

  const { data: centres = [], isLoading } = useQuery({
    queryKey: ['diag-master-centres'],
    queryFn: async (): Promise<Centre[]> => {
      const { data, error } = await (supabase as any)
        .from('diagnostic_centres')
        .select('id, name, is_active, ledger_account_id')
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
      if (!newLedger) throw new Error('Search for the centre’s ledger first');
      // The name is the ledger's, verbatim — that is what the referral RPC
      // matches on when it credits the centre.
      const { error } = await (supabase as any)
        .from('diagnostic_centres')
        .insert({ name: newLedger.account_name.trim(), ledger_account_id: newLedger.id });
      if (error) {
        if (error.code === '23505') throw new Error('This centre already exists.');
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      toast.success('Centre added.');
      setNewLedger(null);
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
      if (!testForm.test) throw new Error('Search the radiology / lab master for the test');
      if (!Number.isFinite(amount) || amount < 0) throw new Error('Enter a valid amount');
      const breach = ceilingError(testForm.test.name, amount);
      if (breach) throw new Error(breach);
      const { error } = await (supabase as any).from('diagnostic_centre_tests').insert({
        centre_id: selectedCentreId,
        test_name: testForm.test.name,
        amount,
      });
      if (error) {
        if (error.code === '23505') throw new Error('This test already exists for the centre.');
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      toast.success('Test added.');
      setTestForm({ test: null, amount: '' });
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
            <div className="space-y-2">
              <div className="flex gap-2">
                <div className="flex-1">
                  <LedgerAutocomplete
                    value={newLedger}
                    onChange={setNewLedger}
                    placeholder="Search the centre’s ledger…"
                  />
                </div>
                <Button
                  onClick={() => addCentre.mutate()}
                  disabled={!newLedger || addCentre.isPending}
                >
                  {addCentre.isPending ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="mr-1 h-4 w-4" />
                  )}
                  Add
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                A centre is its creditor ledger — pick it from the chart of accounts so the
                referral credits the ledger you already pay from.
              </p>
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
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <MasterTestPicker
                      value={testForm.test}
                      onChange={(test) => setTestForm((f) => ({ ...f, test }))}
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
                  {testForm.test && testForm.amount
                    ? (() => {
                        const breach = ceilingError(testForm.test.name, parseFloat(testForm.amount));
                        return breach ? (
                          <p className="text-xs font-medium text-destructive">{breach}</p>
                        ) : null;
                      })()
                    : (
                      <p className="text-xs text-muted-foreground">
                        Test names come from the radiology / lab master. No CT above Rs. 2,500,
                        no MRI above Rs. 3,500 — anything under the cap is editable.
                      </p>
                    )}
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
