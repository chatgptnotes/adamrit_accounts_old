/**
 * Which corporate bill files went out on a given day, and what is still waiting.
 *
 * WHY THIS EXISTS
 * Submission was tracked in two places and reported in neither. The Submission
 * Report at /workflow-status-report/submission filters visits by a workflow
 * *label* — submission_pending / submission_done — which carries no date, no
 * amount and no corporate, so it cannot answer "what did we send yesterday".
 * The real record is bill_preparation.date_of_submission, filled in for 576 of
 * 780 bills, alongside executive_who_submitted, corporate and bill_amount. Its
 * only screen, BillManagement.tsx, has no route in AppRoutes — it was never
 * reachable.
 *
 * THE PENDING SIDE IS THE POINT
 * A bill prepared and never submitted is money the hospital has done the work
 * for and not asked for. Those are listed with the days they have been waiting,
 * oldest first, because that is the list somebody has to act on.
 *
 * DATES ARE PLAIN DATE COLUMNS here, so they are matched with equality — there
 * is no timezone to get wrong, unlike the collection sources.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertTriangle, ArrowLeft, FileCheck2, Loader2, Printer, RefreshCw } from 'lucide-react';
import '@/styles/print.css';

const rupees = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);

const todayIst = () => {
  const now = new Date();
  const ist = new Date(now.getTime() + (330 + now.getTimezoneOffset()) * 60000);
  return ist.toISOString().slice(0, 10);
};

const daysBetween = (from: string, to: string) =>
  Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000));

interface Row {
  id: string;
  visit_id: string | null;
  corporate: string | null;
  bill_amount: number | null;
  date_of_bill_preparation: string | null;
  date_of_submission: string | null;
  executive_who_submitted: string | null;
  billing_executive: string | null;
}

interface Group {
  key: string;
  count: number;
  amount: number;
}

const groupBy = (rows: Row[], pick: (r: Row) => string | null): Group[] => {
  const m = new Map<string, Group>();
  for (const r of rows) {
    const key = (pick(r) ?? '').trim() || 'Not recorded';
    const g = m.get(key) ?? { key, count: 0, amount: 0 };
    g.count += 1;
    g.amount += Number(r.bill_amount ?? 0) || 0;
    m.set(key, g);
  }
  return [...m.values()].sort((a, b) => b.amount - a.amount);
};

const DailyBillSubmissionReport: React.FC = () => {
  const navigate = useNavigate();
  const [date, setDate] = React.useState(todayIst);

  const submitted = useQuery({
    queryKey: ['bill-submissions', date],
    queryFn: async (): Promise<Row[]> => {
      const res = await (supabase as any)
        .from('bill_preparation')
        .select(
          'id,visit_id,corporate,bill_amount,date_of_bill_preparation,date_of_submission,executive_who_submitted,billing_executive',
        )
        .eq('date_of_submission', date);
      if (res.error) throw new Error(`bill_preparation: ${res.error.message}`);
      return (res.data ?? []) as Row[];
    },
  });

  const pending = useQuery({
    queryKey: ['bill-submissions-pending'],
    queryFn: async (): Promise<Row[]> => {
      const res = await (supabase as any)
        .from('bill_preparation')
        .select(
          'id,visit_id,corporate,bill_amount,date_of_bill_preparation,date_of_submission,executive_who_submitted,billing_executive',
        )
        .is('date_of_submission', null)
        .not('date_of_bill_preparation', 'is', null)
        .order('date_of_bill_preparation', { ascending: true })
        .limit(500);
      if (res.error) throw new Error(`bill_preparation (pending): ${res.error.message}`);
      return (res.data ?? []) as Row[];
    },
  });

  const rows = submitted.data ?? [];
  const dayTotal = rows.reduce((s, r) => s + (Number(r.bill_amount ?? 0) || 0), 0);
  const pendingRows = pending.data ?? [];
  const pendingTotal = pendingRows.reduce((s, r) => s + (Number(r.bill_amount ?? 0) || 0), 0);

  const failure = (submitted.error ?? pending.error) as Error | undefined;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-3 print:hidden">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Back">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <FileCheck2 className="h-6 w-6 text-blue-700" />
        <div>
          <h1 className="text-2xl font-semibold">Daily Bill Submission Report</h1>
          <p className="text-sm text-muted-foreground">
            Corporate bill files sent on a day, and everything still waiting to go
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <div>
          <label className="block text-xs text-muted-foreground mb-1" htmlFor="submission-date">
            Submitted on
          </label>
          <Input
            id="submission-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-44"
          />
        </div>
        <Button
          variant="outline"
          onClick={() => {
            submitted.refetch();
            pending.refetch();
          }}
          disabled={submitted.isFetching || pending.isFetching}
        >
          {submitted.isFetching || pending.isFetching ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          <span className="ml-2">Refresh</span>
        </Button>
        <Button variant="outline" onClick={() => window.print()}>
          <Printer className="h-4 w-4" />
          <span className="ml-2">Print</span>
        </Button>
      </div>

      {failure && (
        <Card className="border-destructive">
          <CardContent className="pt-6 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-destructive">Could not read the submission record.</p>
              <p className="text-sm text-muted-foreground mt-1">{failure.message}</p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Submitted this day</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">{rows.length}</p>
            <p className="text-xs text-muted-foreground mt-1">{rupees(dayTotal)} billed</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Awaiting submission</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-amber-700">{pendingRows.length}</p>
            <p className="text-xs text-muted-foreground mt-1">{rupees(pendingTotal)} prepared, not sent</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Oldest waiting</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">
              {pendingRows.length && pendingRows[0].date_of_bill_preparation
                ? `${daysBetween(pendingRows[0].date_of_bill_preparation, todayIst())} d`
                : '—'}
            </p>
            <p className="text-xs text-muted-foreground mt-1">since the bill was prepared</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">By corporate</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing submitted on this day.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Corporate</TableHead>
                    <TableHead className="text-right">Files</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groupBy(rows, (r) => r.corporate).map((g) => (
                    <TableRow key={g.key}>
                      <TableCell className="font-medium">{g.key}</TableCell>
                      <TableCell className="text-right">{g.count}</TableCell>
                      <TableCell className="text-right">{rupees(g.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">By executive</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing submitted on this day.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Submitted by</TableHead>
                    <TableHead className="text-right">Files</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groupBy(rows, (r) => r.executive_who_submitted).map((g) => (
                    <TableRow key={g.key}>
                      <TableCell className="font-medium">{g.key}</TableCell>
                      <TableCell className="text-right">{g.count}</TableCell>
                      <TableCell className="text-right">{rupees(g.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Prepared but not yet submitted ({pendingRows.length})</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {pending.isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground py-4">
              <Loader2 className="h-4 w-4 animate-spin" /> Reading…
            </div>
          ) : pendingRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing is waiting. Every prepared bill has gone out.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Waiting</TableHead>
                  <TableHead>Prepared</TableHead>
                  <TableHead>Visit</TableHead>
                  <TableHead>Corporate</TableHead>
                  <TableHead>Prepared by</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingRows.map((r) => {
                  const waited = r.date_of_bill_preparation
                    ? daysBetween(r.date_of_bill_preparation, todayIst())
                    : null;
                  return (
                    <TableRow key={r.id}>
                      <TableCell
                        className={waited !== null && waited > 30 ? 'text-destructive font-medium' : ''}
                      >
                        {waited === null ? '—' : `${waited} d`}
                      </TableCell>
                      <TableCell>{r.date_of_bill_preparation ?? '—'}</TableCell>
                      <TableCell className="font-mono text-xs">{r.visit_id ?? '—'}</TableCell>
                      <TableCell>{r.corporate ?? '—'}</TableCell>
                      <TableCell>{r.billing_executive ?? '—'}</TableCell>
                      <TableCell className="text-right">{rupees(Number(r.bill_amount ?? 0) || 0)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Source: bill_preparation. The pending list shows the 500 oldest and counts only bills that
        have a preparation date — a bill with neither date has not been worked on yet.
      </p>
    </div>
  );
};

export default DailyBillSubmissionReport;
