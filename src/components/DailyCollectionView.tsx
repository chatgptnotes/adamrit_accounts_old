/**
 * The day's collections, on screen.
 *
 * Shared by the desktop report (/daily-collection-report) and the tablet tile
 * so the two can never drift into giving different answers for the same day —
 * the hospital having two figures for "what came in" and no way to choose is
 * the exact failure the cash report was written to avoid.
 *
 * Credit is shown beside the received total, never inside it. See
 * src/lib/dailyCollection.ts for why.
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertTriangle, Loader2, Printer, RefreshCw } from 'lucide-react';
import {
  fetchDailyCollection,
  SOURCE_LABEL,
  type CollectionSource,
  type DailyCollection,
} from '@/lib/dailyCollection';

const rupees = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);

const todayIst = () => {
  const now = new Date();
  const ist = new Date(now.getTime() + (330 + now.getTimezoneOffset()) * 60000);
  return ist.toISOString().slice(0, 10);
};

interface Props {
  /** Tablet passes false to drop the print button and tighten the layout. */
  compact?: boolean;
}

export const DailyCollectionView: React.FC<Props> = ({ compact = false }) => {
  const [date, setDate] = React.useState(todayIst);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<DailyCollection>({
    queryKey: ['daily-collection', date],
    queryFn: () => fetchDailyCollection(date),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <div>
          <label className="block text-xs text-muted-foreground mb-1" htmlFor="collection-date">
            Date
          </label>
          <Input
            id="collection-date"
            type="date"
            value={date}
            max={todayIst()}
            onChange={(e) => setDate(e.target.value)}
            className="w-44"
          />
        </div>
        <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          <span className="ml-2">Refresh</span>
        </Button>
        {!compact && (
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="h-4 w-4" />
            <span className="ml-2">Print</span>
          </Button>
        )}
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground py-8">
          <Loader2 className="h-4 w-4 animate-spin" /> Reading the day…
        </div>
      )}

      {isError && (
        <Card className="border-destructive">
          <CardContent className="pt-6 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-destructive">Could not read the day's collections.</p>
              <p className="text-sm text-muted-foreground mt-1">
                {(error as Error)?.message ?? 'Unknown error'}
              </p>
              <p className="text-sm text-muted-foreground mt-2">
                Nothing is shown rather than a total that might be wrong — a zero here would look
                like a quiet day.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          <div className={compact ? 'grid grid-cols-1 gap-3' : 'grid grid-cols-1 md:grid-cols-3 gap-4'}>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Received {data.refundTotal > 0 ? '(net of refunds)' : ''}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-semibold">{rupees(data.receivedTotal)}</p>
                {data.refundTotal > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    after {rupees(data.refundTotal)} refunded
                  </p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Billed on credit
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-semibold text-amber-700">{rupees(data.creditTotal)}</p>
                <p className="text-xs text-muted-foreground mt-1">not money in — billed, not banked</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Entries</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-semibold">{data.lines.length}</p>
                <p className="text-xs text-muted-foreground mt-1">across advances, final, pharmacy</p>
              </CardContent>
            </Card>
          </div>

          <div className={compact ? 'space-y-4' : 'grid grid-cols-1 md:grid-cols-2 gap-4'}>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">By payment mode</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                {data.byMode.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nothing received on this day.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Mode</TableHead>
                        <TableHead className="text-right">Entries</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.byMode.map((m) => (
                        <TableRow key={m.mode}>
                          <TableCell className="font-medium">{m.mode}</TableCell>
                          <TableCell className="text-right">{m.count}</TableCell>
                          <TableCell className="text-right">{rupees(m.amount)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">By source</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Source</TableHead>
                      <TableHead className="text-right">Received</TableHead>
                      <TableHead className="text-right">On credit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.bySource.map((s) => (
                      <TableRow key={s.source}>
                        <TableCell className="font-medium">
                          {SOURCE_LABEL[s.source as CollectionSource]}
                        </TableCell>
                        <TableCell className="text-right">{rupees(s.received)}</TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {s.credit ? rupees(s.credit) : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Every entry ({data.lines.length})</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {data.lines.length === 0 ? (
                <p className="text-sm text-muted-foreground">No collections recorded on this day.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Source</TableHead>
                      <TableHead>Patient</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead>Mode</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.lines.map((l) => (
                      <TableRow key={`${l.source}-${l.id}`}>
                        <TableCell>{SOURCE_LABEL[l.source]}</TableCell>
                        <TableCell>{l.who ?? '—'}</TableCell>
                        <TableCell className="font-mono text-xs">{l.reference ?? '—'}</TableCell>
                        <TableCell>
                          {l.mode}
                          {l.isRefund && <span className="ml-2 text-xs text-destructive">refund</span>}
                        </TableCell>
                        <TableCell
                          className={`text-right ${l.amount < 0 ? 'text-destructive' : l.received ? '' : 'text-amber-700'}`}
                        >
                          {rupees(l.amount)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground">
            The day runs midnight to midnight IST. Amounts are not split by hospital:
            advance_payment and final_payments carry no company column, so a split would have to be
            invented for two of the three sources.
          </p>
        </>
      )}
    </div>
  );
};

export default DailyCollectionView;
