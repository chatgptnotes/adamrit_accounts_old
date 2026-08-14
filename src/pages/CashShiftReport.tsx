import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  fetchHandoverLog,
  fetchOpenings,
  fetchOpeningForHandover,
  fetchShiftLines,
  type HandoverRow,
} from '@/lib/cashShiftReport';

/**
 * Cash Shift Report — the trail for a counter, in order.
 *
 * Three questions, one screen, because they are one story: who opened a drawer
 * and when, who handed one on and when, and what happened in between. The
 * opening log in particular had no screen at all before this; the figure was
 * recorded and could then only be read out of the database by hand.
 *
 * Times are shown to the minute and in sequence. A handover reconciles to the
 * minute or it does not reconcile, and "14 Aug" is not enough to tell two
 * cashiers' shifts apart on the same counter.
 */

const inr = (n: number) =>
  `₹${(n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const stamp = (iso: string | null) =>
  iso ? format(new Date(iso), 'dd MMM yy, HH:mm') : '—';

const HOSPITALS = [
  { key: '', label: 'Both hospitals' },
  { key: 'hope', label: 'Hope' },
  { key: 'ayushman', label: 'Ayushman' },
];

export default function CashShiftReport() {
  const today = format(new Date(), 'yyyy-MM-dd');
  const [hospital, setHospital] = useState('');
  const [from, setFrom] = useState(format(new Date(Date.now() - 6 * 86_400_000), 'yyyy-MM-dd'));
  const [to, setTo] = useState(today);
  const [openShift, setOpenShift] = useState<string | null>(null);

  // The date inputs are days; the columns are timestamps. Without widening the
  // upper bound to the end of the day, "to = today" silently excludes today.
  const range = useMemo(
    () => ({ from: from ? `${from}T00:00:00` : null, to: to ? `${to}T23:59:59.999` : null }),
    [from, to],
  );

  const openings = useQuery({
    queryKey: ['cash-report-openings', hospital, range.from, range.to],
    queryFn: () => fetchOpenings({ hospitalType: hospital || null, ...range }),
  });

  const handovers = useQuery({
    queryKey: ['cash-report-handovers', hospital, range.from, range.to],
    queryFn: () => fetchHandoverLog({ hospitalType: hospital || null, ...range }),
  });

  return (
    <div className="space-y-4 p-4">
      <div>
        <h1 className="text-2xl font-bold">Cash Shift Report</h1>
        <p className="text-sm text-muted-foreground">
          Opening counts, handovers and the receipts in between — by counter, by day, in order.
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div>
            <Label>Counter</Label>
            <div className="mt-1 flex gap-1">
              {HOSPITALS.map((h) => (
                <Button
                  key={h.key}
                  size="sm"
                  variant={hospital === h.key ? 'default' : 'outline'}
                  onClick={() => setHospital(h.key)}
                >
                  {h.label}
                </Button>
              ))}
            </div>
          </div>
          <div>
            <Label htmlFor="csr-from">From</Label>
            <Input id="csr-from" type="date" value={from} className="mt-1"
              onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="csr-to">To</Label>
            <Input id="csr-to" type="date" value={to} className="mt-1"
              onChange={(e) => setTo(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      {/* ------------------------------------------------ opening cash log */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Opening cash recorded{' '}
            <span className="font-normal text-muted-foreground">
              ({openings.data?.length ?? 0})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {openings.isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : (openings.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No opening cash was recorded on this counter in this period.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="py-2 pr-3">Recorded at</th>
                    <th className="py-2 pr-3">Counter</th>
                    <th className="py-2 pr-3">Cashier</th>
                    <th className="py-2 pr-3 text-right">Amount</th>
                    <th className="py-2 pr-3">Note (drawer / locker)</th>
                    <th className="py-2">State</th>
                  </tr>
                </thead>
                <tbody>
                  {(openings.data ?? []).map((o) => (
                    <tr key={o.id} className="border-b last:border-0">
                      <td className="py-2 pr-3 font-mono text-xs">{stamp(o.at)}</td>
                      <td className="py-2 pr-3 capitalize">{o.hospitalType}</td>
                      <td className="py-2 pr-3 font-medium">{o.declaredByName}</td>
                      <td className="py-2 pr-3 text-right font-mono">{inr(o.amount)}</td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">{o.note || '—'}</td>
                      <td className="py-2 text-xs">
                        {o.handoverId ? (
                          <span className="text-emerald-700">carried into a handover</span>
                        ) : (
                          <span className="text-amber-700">still on the counter</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* --------------------------------------------------- handover log */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Cash handed over{' '}
            <span className="font-normal text-muted-foreground">
              ({handovers.data?.length ?? 0})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {handovers.isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : (handovers.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No cash was handed over on this counter in this period.
            </p>
          ) : (
            <div className="space-y-2">
              {(handovers.data ?? []).map((h) => (
                <ShiftRow
                  key={h.id}
                  row={h}
                  open={openShift === h.id}
                  onToggle={() => setOpenShift(openShift === h.id ? null : h.id)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** One handover, expandable into the whole shift it covers. */
function ShiftRow({
  row,
  open,
  onToggle,
}: {
  row: HandoverRow;
  open: boolean;
  onToggle: () => void;
}) {
  const detail = useQuery({
    queryKey: ['cash-report-shift', row.id],
    enabled: open,
    queryFn: async () => ({
      opening: await fetchOpeningForHandover(row.id),
      lines: await fetchShiftLines(row.id),
    }),
  });

  const linesTotal = (detail.data?.lines ?? []).reduce((s, l) => s + l.amount, 0);

  return (
    <div className="rounded-md border">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-left text-sm"
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <span className="font-mono text-xs">{row.handoverNo}</span>
        <span className="font-mono text-xs text-muted-foreground">{stamp(row.submittedAt)}</span>
        <span className="capitalize text-muted-foreground">{row.hospitalType ?? '—'}</span>
        <span className="font-medium">{row.fromName ?? '—'}</span>
        <span className="text-muted-foreground">→ {row.toName ?? '—'}</span>
        <span className="ml-auto font-mono">{inr(row.counted)}</span>
        <span
          className={
            Math.round(row.variance * 100) === 0
              ? 'text-xs font-medium text-emerald-700'
              : 'text-xs font-medium text-amber-700'
          }
        >
          {Math.round(row.variance * 100) === 0 ? 'matches' : `${row.variance > 0 ? 'over' : 'short'} ${inr(Math.abs(row.variance))}`}
        </span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] uppercase">{row.status}</span>
      </button>

      {open && (
        <div className="space-y-3 border-t bg-muted/30 px-3 py-3 text-sm">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Fact label="Shift ran" value={`${stamp(row.periodFrom)} → ${stamp(row.periodTo)}`} />
            <Fact label="Accepted" value={stamp(row.acceptedAt)} />
            <Fact label="Verified" value={stamp(row.verifiedAt)} />
            <Fact label="Receipts claimed" value={String(row.sourceCount)} />
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <Fact label="Software expected" value={inr(row.expected)} />
            <Fact label="Counted in drawer" value={inr(row.counted)} />
            <Fact label="In the locker" value={inr(row.locker)} />
            <Fact label="Deposited in bank" value={inr(row.deposit)} />
            <Fact
              label="Variance"
              value={Math.round(row.variance * 100) === 0 ? 'matches' : inr(row.variance)}
            />
          </div>

          {row.varianceReason && (
            <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
              <span className="font-semibold">Reason given: </span>{row.varianceReason}
            </p>
          )}

          {detail.isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <>
              <div className="rounded border bg-background p-2">
                <p className="text-xs font-semibold uppercase text-muted-foreground">
                  Opening cash for this shift
                </p>
                {detail.data?.opening ? (
                  <p className="mt-1 text-sm">
                    {inr(detail.data.opening.amount)} recorded by{' '}
                    <span className="font-medium">{detail.data.opening.declaredByName}</span> at{' '}
                    <span className="font-mono text-xs">{stamp(detail.data.opening.at)}</span>
                    {detail.data.opening.note && (
                      <span className="text-muted-foreground"> — {detail.data.opening.note}</span>
                    )}
                  </p>
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">
                    None was carried into this handover.
                  </p>
                )}
              </div>

              <div className="rounded border bg-background">
                <p className="border-b px-2 py-1 text-xs font-semibold uppercase text-muted-foreground">
                  Receipts taken during the shift ({detail.data?.lines.length ?? 0}) — {inr(linesTotal)}
                </p>
                {(detail.data?.lines ?? []).length === 0 ? (
                  <p className="px-2 py-2 text-sm text-muted-foreground">
                    No individual receipts were claimed by this handover.
                  </p>
                ) : (
                  <div className="max-h-72 overflow-y-auto">
                    <table className="w-full text-sm">
                      <tbody>
                        {(detail.data?.lines ?? []).map((l, i) => (
                          <tr key={i} className="border-b last:border-0">
                            <td className="py-1 pl-2 pr-3 font-mono text-xs">{stamp(l.at)}</td>
                            <td className="py-1 pr-3">{l.patientName || '—'}</td>
                            <td className="py-1 pr-3 text-xs text-muted-foreground">
                              {l.collectedByLabel || '—'}
                            </td>
                            <td className="py-1 pr-2 text-right font-mono">{inr(l.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}
