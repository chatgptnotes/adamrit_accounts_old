import { useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { BellRing, FlaskConical, Printer, ReceiptText } from 'lucide-react';
import type { DialysisCharge } from '@/lib/nephroplus/dialysisData';
import {
  CYCLES_PER_BILL,
  LAB_REPORT_INTERVAL_DAYS,
  buildTrackerRows,
  fetchBilledCycles,
  fetchLastLabDates,
  markCyclesBilled,
  type DialysisTrackerRow,
} from '@/lib/nephroplus/dialysisTracker';
import { printDialysisLabReport } from '@/lib/nephroplus/dialysisLabReport';

interface Props {
  charges: readonly DialysisCharge[];
  hospitalName: string;
  chargesLoading: boolean;
}

export default function DialysisTracker({ charges, hospitalName, chargesLoading }: Props) {
  const { toast } = useToast();
  const [billed, setBilled] = useState<Map<string, number>>(new Map());
  const [lastLabDates, setLastLabDates] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const patientUuids = useMemo(
    () => Array.from(new Set(charges.map((c) => c.patientUuid).filter((id): id is string => !!id))),
    [charges]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [billedMap, labMap] = await Promise.all([
        fetchBilledCycles(hospitalName),
        fetchLastLabDates(patientUuids),
      ]);
      setBilled(billedMap);
      setLastLabDates(labMap);
    } catch (err) {
      toast({
        title: 'Failed to load dialysis tracking',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    }
    setLoading(false);
  }, [hospitalName, patientUuids, toast]);

  useEffect(() => {
    if (!chargesLoading) load();
  }, [chargesLoading, load]);

  const rows = useMemo(
    () => buildTrackerRows(charges, billed, lastLabDates),
    [charges, billed, lastLabDates]
  );

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) => r.patientName.toLowerCase().includes(q) || (r.patientsId ?? '').toLowerCase().includes(q)
    );
  }, [rows, search]);

  const billsToPrepare = rows.filter((r) => r.billsDue > 0).length;
  const labsDue = rows.filter((r) => r.labDue).length;

  const handleMarkBilled = async (row: DialysisTrackerRow) => {
    const upTo = row.billedCycles + row.billsDue * CYCLES_PER_BILL;
    setBusyKey(row.key);
    try {
      await markCyclesBilled(hospitalName, row, upTo);
      setBilled((prev) => new Map(prev).set(row.key, upTo));
      toast({
        title: `Billed ${row.billsDue * CYCLES_PER_BILL} cycles for ${row.patientName}`,
        description:
          row.unbilledCycles % CYCLES_PER_BILL > 0
            ? `${row.unbilledCycles % CYCLES_PER_BILL} cycle(s) carry over to the next bill.`
            : undefined,
      });
    } catch (err) {
      toast({
        title: 'Could not save',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    }
    setBusyKey(null);
  };

  const handlePrintLab = async (row: DialysisTrackerRow) => {
    setBusyKey(row.key);
    try {
      const problem = await printDialysisLabReport(row);
      if (problem) toast({ title: 'Cannot print lab report', description: problem, variant: 'destructive' });
    } catch (err) {
      toast({
        title: 'Could not print lab report',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    }
    setBusyKey(null);
  };

  const busy = loading || chargesLoading;

  return (
    <div className="space-y-4">
      {/* What needs doing */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card className={billsToPrepare > 0 ? 'border-rose-200 bg-rose-50/60' : undefined}>
          <CardContent className="flex items-center gap-4 p-5">
            <div className={`rounded-full p-3 ${billsToPrepare > 0 ? 'bg-rose-100' : 'bg-muted'}`}>
              <ReceiptText className={`h-6 w-6 ${billsToPrepare > 0 ? 'text-rose-600' : 'text-muted-foreground'}`} />
            </div>
            <div>
              <p className={`text-2xl font-bold ${billsToPrepare > 0 ? 'text-rose-600' : ''}`}>
                {busy ? '…' : billsToPrepare}
              </p>
              <p className="text-sm text-muted-foreground">
                patient{billsToPrepare === 1 ? '' : 's'} completed {CYCLES_PER_BILL} cycles — prepare the bill
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className={labsDue > 0 ? 'border-amber-200 bg-amber-50/60' : undefined}>
          <CardContent className="flex items-center gap-4 p-5">
            <div className={`rounded-full p-3 ${labsDue > 0 ? 'bg-amber-100' : 'bg-muted'}`}>
              <FlaskConical className={`h-6 w-6 ${labsDue > 0 ? 'text-amber-600' : 'text-muted-foreground'}`} />
            </div>
            <div>
              <p className={`text-2xl font-bold ${labsDue > 0 ? 'text-amber-600' : ''}`}>{busy ? '…' : labsDue}</p>
              <p className="text-sm text-muted-foreground">
                lab report{labsDue === 1 ? '' : 's'} due (mandatory every {LAB_REPORT_INTERVAL_DAYS} days)
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Input
        placeholder="Search patient name or ID…"
        className="max-w-sm"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Patient</TableHead>
              <TableHead className="text-right">Cycles</TableHead>
              <TableHead className="text-right">To bill</TableHead>
              <TableHead>Billing</TableHead>
              <TableHead>Lab report</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {busy ? (
              <TableRow><TableCell colSpan={6} className="py-6 text-center text-muted-foreground">Loading…</TableCell></TableRow>
            ) : visibleRows.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="py-6 text-center text-muted-foreground">No dialysis patients found.</TableCell></TableRow>
            ) : (
              visibleRows.map((r) => (
                <TableRow key={r.key} className={r.billsDue > 0 ? 'bg-rose-50/40' : undefined}>
                  <TableCell>
                    <span className="font-medium">{r.patientName}</span>
                    <span className="block text-xs text-muted-foreground">
                      {r.patientsId ? `${r.patientsId} · ` : ''}last session {r.lastSessionDate}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">{r.totalCycles}</TableCell>
                  <TableCell className="text-right font-semibold">{r.unbilledCycles}</TableCell>
                  <TableCell>
                    {r.billsDue > 0 ? (
                      <Badge variant="destructive" className="gap-1">
                        <BellRing className="h-3 w-3" />
                        Prepare bill{r.billsDue > 1 ? ` ×${r.billsDue}` : ''}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {CYCLES_PER_BILL - (r.unbilledCycles % CYCLES_PER_BILL)} more cycle(s)
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {r.labDue ? (
                      <Badge className="gap-1 border-amber-300 bg-amber-100 text-amber-800 hover:bg-amber-100">
                        <FlaskConical className="h-3 w-3" />
                        {r.lastLabDate ? `Due — ${r.daysSinceLab} days old` : 'Due — none on record'}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {r.lastLabDate} · due in {r.daysUntilLabDue} day(s)
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busyKey === r.key}
                        onClick={() => handlePrintLab(r)}
                      >
                        <Printer className="mr-1 h-3.5 w-3.5" /> Lab report
                      </Button>
                      {r.billsDue > 0 && (
                        <Button size="sm" disabled={busyKey === r.key} onClick={() => handleMarkBilled(r)}>
                          Mark {r.billsDue * CYCLES_PER_BILL} billed
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
