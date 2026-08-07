import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Activity, CalendarClock, ChevronLeft, ChevronRight, Download, FileSpreadsheet, Printer } from 'lucide-react';
import * as XLSX from 'xlsx';
import DialysisTracker from '@/components/nephroplus/DialysisTracker';
import {
  fetchDialysisCharges,
  groupByPatient,
  addMonths,
  currentMonthKey,
  longLabel,
  shortLabel,
  ymKey,
  INR,
  type DialysisCharge,
  type PatientRow,
  dialysisRate,
} from '@/lib/nephroplus/dialysisData';

export default function NephroPlus() {
  const { hospitalConfig } = useAuth();
  const { toast } = useToast();
  const hospitalName = hospitalConfig?.name ?? 'hope';

  const [charges, setCharges] = useState<DialysisCharge[]>([]);
  const [percentage, setPercentage] = useState(75);
  const [payAfterMonths, setPayAfterMonths] = useState(3);
  const [loading, setLoading] = useState(true);
  const [statementOpen, setStatementOpen] = useState(false);
  const [statementMode, setStatementMode] = useState<'monthly' | 'quarterly'>('monthly');

  const thisMonth = currentMonthKey();
  const payableMonth = useMemo(() => addMonths(thisMonth, -payAfterMonths), [thisMonth, payAfterMonths]);
  const [selectedMonth, setSelectedMonth] = useState(payableMonth);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCharges(await fetchDialysisCharges(hospitalName));
    } catch (err) {
      toast({
        title: 'Failed to load dialysis billing',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    }
    const { data } = await supabase
      .from('dialysis_payout_config')
      .select('percentage, pay_after_months')
      .eq('hospital_name', hospitalName)
      .maybeSingle();
    if (data) {
      setPercentage(Number(data.percentage) || 0);
      setPayAfterMonths(Number(data.pay_after_months) || 3);
    }
    setLoading(false);
  }, [hospitalName, toast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setSelectedMonth(payableMonth); }, [payableMonth]);

  const savePercentage = async (value: number) => {
    const { error } = await supabase
      .from('dialysis_payout_config')
      .upsert(
        { hospital_name: hospitalName, percentage: value, pay_after_months: payAfterMonths, updated_at: new Date().toISOString() },
        { onConflict: 'hospital_name' }
      );
    if (error) toast({ title: 'Could not save %', description: error.message, variant: 'destructive' });
  };

  const pct = (n: number) => (n * percentage) / 100;

  const rows = useMemo<PatientRow[]>(
    () => groupByPatient(charges.filter((c) => c.visitDate.slice(0, 7) === selectedMonth)),
    [charges, selectedMonth]
  );

  const totals = useMemo(
    () => rows.reduce(
      (acc, r) => ({
        price: acc.price + r.price,
        sessions: acc.sessions + r.sessions,
        privateCollection: acc.privateCollection + (r.category === 'Private' ? r.price : 0),
        governmentReceivable: acc.governmentReceivable + (r.category === 'Private' ? 0 : r.price),
        pay: acc.pay + pct(r.price),
      }),
      { price: 0, sessions: 0, privateCollection: 0, governmentReceivable: 0, pay: 0 }
    ),
    [rows, percentage]
  );

  const payableThisMonth = useMemo(
    () => pct(charges.filter((c) => c.visitDate.slice(0, 7) === payableMonth).reduce((s, c) => s + c.amount, 0)),
    [charges, payableMonth, percentage]
  );

  const statementMonths = useMemo(
    () => statementMode === 'monthly' ? [selectedMonth] : [addMonths(selectedMonth, -2), addMonths(selectedMonth, -1), selectedMonth],
    [selectedMonth, statementMode]
  );
  const statementRows = useMemo(
    () => groupByPatient(charges.filter((c) => statementMonths.includes(c.visitDate.slice(0, 7)))),
    [charges, statementMonths]
  );
  const statementTotals = useMemo(
    () => statementRows.reduce(
      (acc, r) => ({
        sessions: acc.sessions + r.sessions,
        grossRevenue: acc.grossRevenue + r.price,
        privateCollection: acc.privateCollection + (r.category === 'Private' ? r.price : 0),
        governmentReceivable: acc.governmentReceivable + (r.category === 'Private' ? 0 : r.price),
        nephroPlusPayable: acc.nephroPlusPayable + pct(r.price),
      }),
      { sessions: 0, grossRevenue: 0, privateCollection: 0, governmentReceivable: 0, nephroPlusPayable: 0 }
    ),
    [statementRows, percentage]
  );
  const statementPeriod = statementMode === 'monthly' ? longLabel(selectedMonth) : `${shortLabel(statementMonths[0])} to ${shortLabel(selectedMonth)}`;
  const exportStatement = () => {
    if (!statementRows.length) { toast({ title: 'Nothing to export for this period' }); return; }
    const summary = [
      ['Revenue Share Statement'], ['Settlement Period', statementPeriod], ['Hospital Name', hospitalName], [],
      ['Particulars', 'Qty', 'Gross Revenue', 'Patient Collection', 'Government Receivable', 'NephroPlus Payable'],
      ['Dialysis Sessions', statementTotals.sessions, statementTotals.grossRevenue, statementTotals.privateCollection, statementTotals.governmentReceivable, statementTotals.nephroPlusPayable],
      ['Private Dialysis', statementRows.filter((r) => r.category === 'Private').reduce((n, r) => n + r.sessions, 0), statementTotals.privateCollection, statementTotals.privateCollection, 0, statementRows.filter((r) => r.category === 'Private').reduce((n, r) => n + pct(r.price), 0)],
      ['MJPJAY/Yojna Dialysis', statementRows.filter((r) => r.category !== 'Private').reduce((n, r) => n + r.sessions, 0), statementTotals.governmentReceivable, 0, statementTotals.governmentReceivable, statementRows.filter((r) => r.category !== 'Private').reduce((n, r) => n + pct(r.price), 0)],
      ['Total', statementTotals.sessions, statementTotals.grossRevenue, statementTotals.privateCollection, statementTotals.governmentReceivable, statementTotals.nephroPlusPayable],
    ];
    const details = statementRows.map((r) => ({ Category: r.category, 'Patient ID': r.patientsId ?? '', Patient: r.patientName, 'First Visit Date': r.date, Sessions: r.sessions, 'Rate Per Session': dialysisRate(r.category), 'Gross Revenue': r.price, 'Patient Collection': r.category === 'Private' ? r.price : 0, 'Government Receivable': r.category === 'Private' ? 0 : r.price, 'NephroPlus Payable': pct(r.price), Period: statementPeriod }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(summary), 'Summary');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(details), 'Working Details');
    XLSX.writeFile(workbook, `nephroplus-revenue-${statementMode}-${selectedMonth}.xlsx`);
  };

  const exportExcel = () => { setStatementMode('monthly'); setStatementOpen(true); };
  const printReport = () => {
    const body = rows
      .map((r) => `<tr><td>${r.date}</td><td>${r.patientName}${r.patientsId ? ` <span style="color:#777">(${r.patientsId})</span>` : ''}</td><td class="r">${INR.format(r.price)}</td><td class="r">${r.sessions}</td><td class="r np">${INR.format(pct(r.price))}</td></tr>`)
      .join('');
    const html = `<!doctype html><html><head><title>NephroPlus — ${longLabel(selectedMonth)}</title>
      <style>body{font-family:Arial,Helvetica,sans-serif;padding:24px;color:#111}
        h1{font-size:18px;margin:0 0 4px}.sub{color:#555;font-size:12px;margin:0 0 16px}
        table{width:100%;border-collapse:collapse;font-size:13px}
        th,td{border-bottom:1px solid #ddd;padding:7px 9px;text-align:left}.r{text-align:right}
        tfoot td{font-weight:bold;border-top:2px solid #333}.np{color:#b91c1c;font-weight:600}</style></head><body>
      <h1>NephroPlus Dialysis — ${longLabel(selectedMonth)}</h1>
      <p class="sub">Pay NephroPlus ${percentage}% of collected price · Paid ${payAfterMonths} months after visit · Generated ${new Date().toLocaleString('en-IN')}</p>
      <table><thead><tr><th>Date · Patient</th><th></th><th class="r">Price Paid</th><th class="r">Sessions</th><th class="r">Pay to NephroPlus</th></tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr><td colspan="2">TOTAL</td><td class="r">${INR.format(totals.price)}</td><td class="r">${totals.sessions}</td><td class="r np">${INR.format(totals.pay)}</td></tr></tfoot>
      </table></body></html>`;
    const w = window.open('', '_blank', 'width=1000,height=700');
    if (!w) { toast({ title: 'Allow pop-ups to print', variant: 'destructive' }); return; }
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Activity className="h-7 w-7 text-rose-600" />
        <div>
          <h1 className="text-2xl font-bold">NephroPlus Dialysis</h1>
          <p className="text-sm text-muted-foreground">Dialysis patients &amp; what Hope pays NephroPlus</p>
        </div>
      </div>

      <Tabs defaultValue="dialysis" className="space-y-6">
        <TabsList>
          <TabsTrigger value="dialysis">Dialysis</TabsTrigger>
          <TabsTrigger value="settlement">Monthly Settlement</TabsTrigger>
        </TabsList>

        <TabsContent value="dialysis" className="space-y-6">
          <DialysisTracker charges={charges} hospitalName={hospitalName} chargesLoading={loading} />
        </TabsContent>

        <TabsContent value="settlement" className="space-y-6">
      {/* Payout % setting */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-x-3 gap-y-2 p-4 text-sm">
          <span>We pay NephroPlus</span>
          <Input
            type="number" min="0" max="100"
            className="h-9 w-24 text-right"
            value={percentage}
            onChange={(e) => setPercentage(Number(e.target.value) || 0)}
            onBlur={() => savePercentage(percentage)}
          />
          <span>% of the price collected, paid</span>
          <Input
            type="number" min="0" max="12"
            className="h-9 w-16 text-right"
            value={payAfterMonths}
            onChange={(e) => setPayAfterMonths(Number(e.target.value) || 0)}
            onBlur={() => savePercentage(percentage)}
          />
          <span>months after the patient's visit.</span>
        </CardContent>
      </Card>

      {/* Pay-this-month headline */}
      <Card className="border-rose-200 bg-rose-50/60">
        <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="rounded-full bg-rose-100 p-3"><CalendarClock className="h-6 w-6 text-rose-600" /></div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-rose-700">Pay this month ({longLabel(thisMonth)})</p>
              <p className="text-sm text-muted-foreground">for patients who came in {longLabel(payableMonth)} ({payAfterMonths} months ago)</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <p className="text-3xl font-bold text-rose-600">{loading ? '…' : INR.format(payableThisMonth)}</p>
            {selectedMonth !== payableMonth && (
              <Button variant="outline" size="sm" onClick={() => setSelectedMonth(payableMonth)}>View list</Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Month nav + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" onClick={() => setSelectedMonth((m) => addMonths(m, -1))}><ChevronLeft className="h-4 w-4" /></Button>
          <span className="min-w-32 text-center font-semibold">{longLabel(selectedMonth)}</span>
          <Button variant="outline" size="icon" onClick={() => setSelectedMonth((m) => addMonths(m, 1))}><ChevronRight className="h-4 w-4" /></Button>
          <Button variant="outline" size="sm" onClick={() => setSelectedMonth(ymKey(new Date()))}>This month</Button>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => { setStatementMode('monthly'); setStatementOpen(true); }}><FileSpreadsheet className="mr-2 h-4 w-4" /> Revenue Statement</Button>
          <Button variant="outline" size="sm" onClick={printReport} disabled={rows.length === 0}><Printer className="mr-2 h-4 w-4" /> Print</Button>
          <Button size="sm" onClick={exportExcel} disabled={rows.length === 0}><Download className="mr-2 h-4 w-4" /> Excel</Button>
        </div>
      </div>

      {/* Patient table */}
      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date &amp; Patient</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Gross Revenue</TableHead>
              <TableHead className="text-right">Sessions</TableHead>
              <TableHead className="text-right">Pay to NephroPlus</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={4} className="py-6 text-center text-muted-foreground">Loading…</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={4} className="py-6 text-center text-muted-foreground">No dialysis patients in {longLabel(selectedMonth)}. Use ◀ ▶ to find a month.</TableCell></TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.key}>
                  <TableCell>
                    <span className="font-medium">{r.patientName}</span>
                    <span className="block text-xs text-muted-foreground">{r.date}{r.patientsId ? ` · ${r.patientsId}` : ''}</span>
                  </TableCell>
                  <TableCell><span className={r.category === 'Private' ? 'font-medium text-emerald-700' : 'font-medium text-blue-700'}>{r.category}</span></TableCell>
                  <TableCell className="text-right">{INR.format(r.price)}</TableCell>
                  <TableCell className="text-right">{r.sessions}</TableCell>
                  <TableCell className="text-right font-semibold text-rose-600">{INR.format(pct(r.price))}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
          {rows.length > 0 && (
            <tfoot>
              <TableRow className="border-t-2 font-bold">
                <TableCell>TOTAL — {shortLabel(selectedMonth)}</TableCell>
                <TableCell className="text-right">{INR.format(totals.price)}</TableCell>
                <TableCell className="text-right">{totals.sessions}</TableCell>
                <TableCell className="text-right text-rose-600">{INR.format(totals.pay)}</TableCell>
              </TableRow>
            </tfoot>
          )}
        </Table>
      </div>

      <Dialog open={statementOpen} onOpenChange={setStatementOpen}>
        <DialogContent className="max-w-6xl">
          <DialogHeader><DialogTitle>Revenue Statement - {statementPeriod}</DialogTitle></DialogHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-2">
              <Button variant={statementMode === 'monthly' ? 'default' : 'outline'} size="sm" onClick={() => setStatementMode('monthly')}>Monthly</Button>
              <Button variant={statementMode === 'quarterly' ? 'default' : 'outline'} size="sm" onClick={() => setStatementMode('quarterly')}>3-month settlement</Button>
            </div>
            <Button onClick={exportStatement}><Download className="mr-2 h-4 w-4" /> Download Excel</Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Sessions</p><p className="text-xl font-bold">{statementTotals.sessions}</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Gross revenue</p><p className="text-xl font-bold">{INR.format(statementTotals.grossRevenue)}</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Private collection</p><p className="text-xl font-bold text-emerald-700">{INR.format(statementTotals.privateCollection)}</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Government receivable</p><p className="text-xl font-bold text-blue-700">{INR.format(statementTotals.governmentReceivable)}</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">NephroPlus payable</p><p className="text-xl font-bold text-rose-600">{INR.format(statementTotals.nephroPlusPayable)}</p></CardContent></Card>
          </div>
          <div className="max-h-[48vh] overflow-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Patient</TableHead><TableHead>Category</TableHead><TableHead className="text-right">Sessions</TableHead><TableHead className="text-right">Rate</TableHead><TableHead className="text-right">Gross Revenue</TableHead><TableHead className="text-right">NephroPlus</TableHead></TableRow></TableHeader><TableBody>{statementRows.map((r) => <TableRow key={`${r.key}-${r.date}`}><TableCell>{r.date}</TableCell><TableCell>{r.patientName}<span className="block text-xs text-muted-foreground">{r.patientsId ?? ''}</span></TableCell><TableCell>{r.category}</TableCell><TableCell className="text-right">{r.sessions}</TableCell><TableCell className="text-right">{INR.format(dialysisRate(r.category))}</TableCell><TableCell className="text-right">{INR.format(r.price)}</TableCell><TableCell className="text-right text-rose-600">{INR.format(pct(r.price))}</TableCell></TableRow>)}</TableBody></Table></div>
        </DialogContent>
      </Dialog>        </TabsContent>
      </Tabs>
    </div>
  );
}