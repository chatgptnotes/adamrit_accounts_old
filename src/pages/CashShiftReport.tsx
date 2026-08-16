import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  fetchBankDeposits,
  fetchHandoverLog,
  fetchOpenings,
  fetchOpeningForHandover,
  fetchShiftLines,
  type HandoverRow,
} from '@/lib/cashShiftReport';
import { supabase } from '@/integrations/supabase/client';
import { fetchHandoverPhotos, handoverPhotoLabel } from '@/lib/cashHandover';

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

/**
 * Handovers gathered under their session's statement number, newest session
 * first, order preserved within each. A handover whose session could not be
 * attached is shown under a plain label rather than dropped — a row missing
 * from a cash report is worse than a row with no number on it.
 */
const groupBySession = (rows: HandoverRow[]): [string, HandoverRow[]][] => {
  const groups = new Map<string, HandoverRow[]>();
  for (const r of rows) {
    const key = r.statementNo ?? 'No statement number';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  return [...groups.entries()];
};

/** "(3 · ₹1,080.00)" — a list of money is not readable without its total. */
const tally = (rows: { amount?: number; counted?: number }[] | undefined, key: 'amount' | 'counted') =>
  `${rows?.length ?? 0} · ${inr((rows ?? []).reduce((s, r) => s + (r[key] ?? 0), 0))}`;

/**
 * One book per company. Hope Pharmacy and DRM Hope Hospital Private Limited are
 * two companies, and their cash was being read as one: the pharmacy was not
 * even offered here, so its openings and handovers could only be seen mixed
 * into "both hospitals" with nothing to tell them apart.
 */
const BOOKS = [
  { key: '', label: 'All companies', companyKey: null },
  { key: 'hope', label: 'DRM Hope Hospital', companyKey: 'drm_pvt_ltd' },
  { key: 'ayushman', label: 'Ayushman Nagpur', companyKey: 'ayushman_nagpur' },
  { key: 'pharmacy', label: 'Hope Pharmacy', companyKey: 'hope_pharmacy' },
] as const;

/** The counter a row was recorded against, named as the company it belongs to. */
const bookLabel = (hospitalType: string | null | undefined) =>
  BOOKS.find((b) => b.key && b.key === (hospitalType ?? '').trim().toLowerCase())?.label
    ?? hospitalType
    ?? '—';

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

  // Deposits are per COMPANY, not per hospital_type: the pharmacy is its own
  // company with its own bank, so filtering them by counter would silently mix
  // two sets of books.
  const companyId = useQuery({
    queryKey: ['cash-report-company', hospital],
    enabled: !!hospital,
    queryFn: async () => {
      const key = BOOKS.find((b) => b.key === hospital)?.companyKey ?? 'drm_pvt_ltd';
      const { data } = await (supabase as any)
        .from('companies').select('id').eq('company_key', key).maybeSingle();
      return (data?.id as string) ?? null;
    },
  });

  const deposits = useQuery({
    queryKey: ['cash-report-deposits', companyId.data ?? 'all', from, to],
    queryFn: () =>
      fetchBankDeposits({
        companyId: hospital ? companyId.data ?? null : null,
        from: from || null,
        to: to || null,
      }),
    enabled: !hospital || companyId.isFetched,
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
          Three lists, in order: opening cash recorded, cash paid into the bank,
          and cash handed over. Hope Pharmacy keeps its own books, so pick a
          company to read one set on its own.
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div>
            <Label>Company</Label>
            <div className="mt-1 flex flex-wrap gap-1">
              {BOOKS.map((b) => (
                <Button
                  key={b.key}
                  size="sm"
                  variant={hospital === b.key ? 'default' : 'outline'}
                  onClick={() => setHospital(b.key)}
                >
                  {b.label}
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
              ({tally(openings.data, 'amount')})
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
                    <th className="py-2 pr-3">Company</th>
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
                      <td className="py-2 pr-3">{bookLabel(o.hospitalType)}</td>
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

      {/* ------------------------------------------------- bank deposits */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Cash deposited into the bank{' '}
            <span className="font-normal text-muted-foreground">
              ({tally(deposits.data, 'amount')})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {deposits.isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : (deposits.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No cash was paid into the bank in this period.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="py-2 pr-3">Date</th>
                    <th className="py-2 pr-3">Voucher</th>
                    <th className="py-2 pr-3">Company</th>
                    <th className="py-2 pr-3">Bank / note</th>
                    <th className="py-2 pr-3">By</th>
                    <th className="py-2 pr-3 text-right">Amount</th>
                    <th className="py-2">Slip</th>
                  </tr>
                </thead>
                <tbody>
                  {(deposits.data ?? []).map((d) => (
                    <tr key={d.id} className="border-b last:border-0">
                      <td className="py-2 pr-3 font-mono text-xs">
                        {d.at ? format(new Date(d.at), 'dd MMM yy') : '—'}
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs">{d.voucherNo}</td>
                      <td className="py-2 pr-3 text-xs">{d.companyName}</td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">{d.narration}</td>
                      <td className="py-2 pr-3 text-xs">{d.by || '—'}</td>
                      <td className="py-2 pr-3 text-right font-mono">{inr(d.amount)}</td>
                      <td className="py-2 text-xs">
                        {d.slipCount > 0 ? (
                          <span className="text-emerald-700">attached</span>
                        ) : (
                          <span className="text-amber-700">no slip</span>
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
              ({tally(handovers.data, 'counted')})
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
            /* Grouped by statement number, because that is what a session IS:
               two handovers on one counter on one day belong to one statement
               and reading them as two unrelated rows is how a shift stops
               being legible. */
            <div className="space-y-4">
              {groupBySession(handovers.data ?? []).map(([statementNo, rows]) => (
                <div key={statementNo}>
                  <div className="mb-1 flex flex-wrap items-baseline gap-x-3 border-b pb-1">
                    <span className="font-mono text-sm font-semibold">{statementNo}</span>
                    <span className="text-xs text-muted-foreground">
                      {bookLabel(rows[0].hospitalType)}
                      {rows.length > 1 && ` · ${rows.length} handovers in this session`}
                    </span>
                    <span className="ml-auto font-mono text-sm">
                      {inr(rows.reduce((s, r) => s + r.counted, 0))}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {rows.map((h) => (
                      <ShiftRow
                        key={h.id}
                        row={h}
                        open={openShift === h.id}
                        onToggle={() => setOpenShift(openShift === h.id ? null : h.id)}
                      />
                    ))}
                  </div>
                </div>
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
      // The register page and the note the cashier signed. Evidence is worth
      // nothing if the person reviewing a disputed count cannot see it.
      photos: await fetchHandoverPhotos(row.id),
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
        <span className="text-muted-foreground">{bookLabel(row.hospitalType)}</span>
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
            {/* Movements, kept out of the arithmetic above on purpose: the cash
                is already counted in the drawer or the locker. */}
            <Fact label="Out of locker" value={inr(row.lockerOut)} />
            <Fact label="Into locker" value={inr(row.lockerIn)} />
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

              <div className="rounded border bg-background p-2">
                <p className="text-xs font-semibold uppercase text-muted-foreground">
                  Photographs taken at the handover ({detail.data?.photos.length ?? 0})
                </p>
                {(detail.data?.photos ?? []).length === 0 ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    None. This count has no register page or signed note behind it.
                  </p>
                ) : (
                  <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                    {(detail.data?.photos ?? []).map((ph) => (
                      <a
                        key={ph.id}
                        href={ph.fileUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="w-36 shrink-0 overflow-hidden rounded-md border"
                        title={`${handoverPhotoLabel(ph.kind)} — ${ph.fileName}`}
                      >
                        {ph.fileType === 'application/pdf' ? (
                          <span className="flex h-24 items-center justify-center bg-muted text-xs font-semibold text-muted-foreground">
                            PDF
                          </span>
                        ) : (
                          <img
                            src={ph.fileUrl}
                            alt={handoverPhotoLabel(ph.kind)}
                            className="h-24 w-full bg-muted object-cover"
                            loading="lazy"
                          />
                        )}
                        <span className="block truncate px-2 py-1 text-[11px] font-medium">
                          {handoverPhotoLabel(ph.kind)}
                        </span>
                      </a>
                    ))}
                  </div>
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
