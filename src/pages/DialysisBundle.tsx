import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Activity, AlertTriangle, CheckCircle2, FlaskConical, IndianRupee, Search } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useDialysisBundles, DIALYSIS_BUNDLE_QUERY_KEY } from '@/hooks/useDialysisBundles';
import { billOneBlock } from '@/lib/dialysis/scheme';
import type { DialysisBundleRow } from '@/lib/dialysis/bundle';

/**
 * Dialysis Bundle — every dialysis patient's course of treatment in one place.
 *
 * The cycle counts are the scheme's, not a single house rule: MJPJAY runs in
 * bundles of six, PMJAY in bundles of three (confirmed by the owner 17-Aug).
 * Sessions, lab reports and billing state are all read from the modules that
 * already own them, so nothing here is a second copy of the truth.
 */

function statusTone(row: DialysisBundleRow): string {
  if (row.status === 'Completed') return 'bg-emerald-100 text-emerald-800 border-emerald-200';
  if (row.status === 'No bundle') return 'bg-muted text-muted-foreground';
  return 'bg-blue-100 text-blue-800 border-blue-200';
}

/** A row of pips, one per session in the bundle, filled for those completed. */
function CycleDots({ row }: { row: DialysisBundleRow }) {
  // Private and other non-Yojana patients are billed per session, so a row of
  // pips would imply a course of treatment they are not on.
  if (!row.hasBundle) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: row.cyclesPerBundle }, (_, i) => (
        <span
          key={i}
          title={`Cycle ${i + 1}`}
          className={`inline-block h-2.5 w-2.5 rounded-full ${
            i < row.completedCycles ? 'bg-primary' : 'bg-muted-foreground/25'
          }`}
        />
      ))}
      <span className="ml-2 text-xs text-muted-foreground">
        {row.completedCycles}/{row.cyclesPerBundle}
      </span>
    </div>
  );
}

export default function DialysisBundle() {
  const { hospitalConfig, user } = useAuth();
  const qc = useQueryClient();
  const { rows, loading, error, total, completed, awaitingBilling, labsDue, noBundle } = useDialysisBundles();
  const [search, setSearch] = useState('');
  const [closing, setClosing] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.patientName.toLowerCase().includes(q) ||
        (r.patientsId || '').toLowerCase().includes(q) ||
        r.schemeLabel.toLowerCase().includes(q),
    );
  }, [rows, search]);

  /**
   * Close a finished bundle and hand it to billing.
   *
   * Goes through billOneBlock, the same path the dialysis billing tile uses, so
   * the oldest unbilled sessions are the ones claimed and the two screens can
   * never disagree about what has already gone out. Marking the sessions billed
   * is what makes the patient's next session read as cycle 1 of a fresh bundle
   * rather than "cycle 7 of 6".
   */
  const completeBundle = async (row: DialysisBundleRow) => {
    if (!row.bundleComplete) return;
    setClosing(row.patientId);
    try {
      const billed = await billOneBlock(hospitalConfig.name, row.source, user?.id ?? null);
      if (billed === 0) {
        // Not treated as success: nothing was claimed, and saying otherwise
        // would leave the bundle sitting unbilled while the screen said done.
        toast.error(`Nothing was billed for ${row.patientName} — the sessions may already be claimed.`);
        return;
      }
      toast.success(
        `Bundle closed — ${row.patientName}, ${billed} ${row.schemeLabel} ${billed === 1 ? 'cycle' : 'cycles'} sent to billing.`,
      );
      // The same keys the dialysis billing tile invalidates. Closing a bundle
      // here and leaving Shashank's tile showing it as still pending is how the
      // same block gets claimed twice.
      await Promise.all([
        qc.invalidateQueries({ queryKey: [DIALYSIS_BUNDLE_QUERY_KEY] }),
        qc.invalidateQueries({ queryKey: ['dialysis-billing'] }),
        qc.invalidateQueries({ queryKey: ['dialysis-session-billing'] }),
      ]);
    } catch (e) {
      // Never swallowed: a failed close would otherwise look like a success and
      // the bundle would be billed twice or not at all.
      toast.error(e instanceof Error ? e.message : 'Could not close the bundle.');
    } finally {
      setClosing(null);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Activity className="h-6 w-6 text-primary" />
          Dialysis Bundle
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Cycle-wise status for every dialysis patient. MJPJAY runs in bundles of 6, PMJAY in bundles of 3.
          Sessions, lab reports and billing are read from the existing modules.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'Dialysis patients', value: total, icon: Activity },
          { label: 'Bundles complete', value: completed, icon: CheckCircle2 },
          { label: 'Awaiting billing', value: awaitingBilling, icon: IndianRupee },
          { label: 'Lab report due', value: labsDue, icon: FlaskConical },
          { label: 'No Yojana block', value: noBundle, icon: AlertTriangle },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs">
                <s.icon className="h-3.5 w-3.5" />
                {s.label}
              </div>
              <div className="text-2xl font-semibold mt-1">{s.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <CardTitle className="text-base">Cycle-wise status</CardTitle>
            <div className="relative w-64 max-w-full">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Patient, UHID or scheme"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading && <p className="text-sm text-muted-foreground py-8 text-center">Loading dialysis bundles…</p>}

          {/* A failed read is shown, never rendered as an empty list — an empty
              table here would read as "no dialysis patients", which is a lie. */}
          {error && (
            <p className="text-sm text-destructive py-8 text-center">
              Could not load dialysis bundles: {error.message}
            </p>
          )}

          {!loading && !error && filtered.length === 0 && (
            <p className="text-sm text-muted-foreground py-8 text-center">No dialysis patients match.</p>
          )}

          {!loading && !error && filtered.length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Patient</TableHead>
                    <TableHead>Scheme</TableHead>
                    <TableHead>Current cycle</TableHead>
                    <TableHead className="text-right">Completed</TableHead>
                    <TableHead className="text-right">Remaining</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Latest lab report</TableHead>
                    <TableHead>Pending</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((row) => (
                    <TableRow key={row.patientId}>
                      <TableCell>
                        <div className="font-medium">{row.patientName}</div>
                        <div className="text-xs text-muted-foreground">
                          {row.patientsId || 'No UHID'} · last session {row.lastSessionDate || '—'}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{row.schemeLabel}</Badge>
                        {row.hasBundle && (
                          <div className="text-xs text-muted-foreground mt-1">
                            Bundle {row.bundleNumber} · {row.cyclesPerBundle} cycles
                          </div>
                        )}
                      </TableCell>
                      <TableCell><CycleDots row={row} /></TableCell>
                      <TableCell className="text-right">{row.hasBundle ? row.completedCycles : '—'}</TableCell>
                      <TableCell className="text-right">{row.hasBundle ? row.remainingCycles : '—'}</TableCell>
                      <TableCell>
                        <span className={`inline-block rounded border px-2 py-0.5 text-xs ${statusTone(row)}`}>
                          {row.status}
                        </span>
                      </TableCell>
                      <TableCell>
                        {row.lastLabDate ? (
                          <div className={row.labDue ? 'text-amber-700' : ''}>
                            <div className="text-sm">{row.lastLabDate}</div>
                            <div className="text-xs text-muted-foreground">
                              {row.daysSinceLab} days ago{row.labDue ? ' · due' : ''}
                            </div>
                          </div>
                        ) : (
                          <span className="text-sm text-amber-700">None on file</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {row.pending.length === 0 ? (
                          <span className="text-xs text-muted-foreground">Nothing pending</span>
                        ) : (
                          <ul className="text-xs space-y-0.5">
                            {row.pending.map((p) => (
                              <li key={p} className="text-muted-foreground">• {p}</li>
                            ))}
                          </ul>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {row.bundleComplete ? (
                          <Button
                            size="sm"
                            disabled={closing === row.patientId}
                            onClick={() => completeBundle(row)}
                          >
                            {closing === row.patientId ? 'Closing…' : 'Bundle Complete'}
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
