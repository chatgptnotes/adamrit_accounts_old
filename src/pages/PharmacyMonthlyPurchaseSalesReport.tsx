import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { Download, Package, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface PurchaseRow { id: string; grn_number: string; grn_date: string; supplier_id: number | null; total_amount: number | string | null; invoice_number: string | null; }
interface SaleRow { sale_id: number; sale_date: string; patient_id: string | null; visit_id: string | null; patient_name: string | null; total_amount: number | string | null; payment_method: string | null; payment_status: string | null; }
interface SaleItemRow { sale_id: number; medication_name: string | null; generic_name: string | null; quantity: number | string | null; unit_price: number | string | null; total_price: number | string | null; }
interface VisitSchemeRow { visit_id: string; corporate: string | null; insurance_type: string | null; }
interface PatientSchemeRow { patients_id: string | null; corporate: string | null; }

const amount = (value: unknown) => Number(value || 0);
const formatCurrency = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value);
const monthLabel = (month: string) => new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(new Date(`${month}-01T00:00:00`));
const dateLabel = (date: string) => new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${date.slice(0, 10)}T00:00:00`));
const isYojnaCorporate = (value: string | null | undefined) => {
  const corporate = (value || '').toLowerCase().trim();
  return corporate.includes('yojana') || corporate.includes('mjpjy') || corporate.includes('ayushman') || corporate.includes('mahatma jyotiba') || corporate.includes('pmjay') || corporate.includes('ab-pmjay') || corporate.includes('ab pmjay') || corporate.includes('maharashtra yojana');
};

export default function PharmacyMonthlyPurchaseSalesReport() {
  const { hospitalConfig } = useAuth();
  const hospitalName = hospitalConfig?.name || '';
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [purchases, setPurchases] = useState<PurchaseRow[]>([]);
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [saleItems, setSaleItems] = useState<SaleItemRow[]>([]);
  const [visitSchemes, setVisitSchemes] = useState<VisitSchemeRow[]>([]);
  const [patientSchemes, setPatientSchemes] = useState<PatientSchemeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<{ type: 'ALL' | 'PURCHASE' | 'SALE'; date: string | null }>({ type: 'ALL', date: null });
  const [showYojnaBreakdown, setShowYojnaBreakdown] = useState(false);
  const sourceRecordsRef = useRef<HTMLDivElement>(null);
  const yojnaBreakdownRef = useRef<HTMLDivElement>(null);

  const monthRange = useMemo(() => {
    const [year, monthNumber] = month.split('-').map(Number);
    const start = `${month}-01`;
    const nextYear = monthNumber === 12 ? year + 1 : year;
    const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
    const next = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
    return { start, next };
  }, [month]);

  const loadReport = async () => {
    if (!hospitalName) return;
    setLoading(true);
    const [purchaseResult, saleResult] = await Promise.all([
      supabase.from('goods_received_notes').select('id, grn_number, grn_date, supplier_id, total_amount, invoice_number').eq('hospital_name', hospitalName).eq('status', 'POSTED').gte('grn_date', monthRange.start).lt('grn_date', monthRange.next).order('grn_date', { ascending: false }),
      supabase.from('pharmacy_sales').select('sale_id, sale_date, patient_id, visit_id, patient_name, total_amount, payment_method, payment_status').eq('hospital_name', hospitalName).gte('sale_date', `${monthRange.start}T00:00:00`).lt('sale_date', `${monthRange.next}T00:00:00`).order('sale_date', { ascending: false }),
    ]);
    if (purchaseResult.error || saleResult.error) {
      setLoading(false);
      console.error('Unable to load monthly pharmacy report', purchaseResult.error || saleResult.error);
      toast.error('Unable to load the monthly pharmacy report.');
      return;
    }
    const completedSales = ((saleResult.data || []) as SaleRow[]).filter(sale => !sale.payment_status || sale.payment_status === 'COMPLETED');
    setPurchases((purchaseResult.data || []) as PurchaseRow[]);
    setSales(completedSales);

    const visitIds = [...new Set(completedSales.map(sale => sale.visit_id).filter(Boolean) as string[])];
    const patientIds = [...new Set(completedSales.map(sale => sale.patient_id).filter(Boolean) as string[])];
    const fetchedVisits: VisitSchemeRow[] = [];
    const fetchedPatients: PatientSchemeRow[] = [];
    for (let index = 0; index < visitIds.length; index += 200) {
      const { data } = await supabase.from('visits').select('visit_id, corporate, insurance_type').in('visit_id', visitIds.slice(index, index + 200));
      fetchedVisits.push(...((data || []) as VisitSchemeRow[]));
    }
    for (let index = 0; index < patientIds.length; index += 200) {
      const { data } = await supabase.from('patients').select('patients_id, corporate').in('patients_id', patientIds.slice(index, index + 200));
      fetchedPatients.push(...((data || []) as PatientSchemeRow[]));
    }
    setVisitSchemes(fetchedVisits);
    setPatientSchemes(fetchedPatients);

    const saleIds = completedSales.map(sale => sale.sale_id);
    const allItems: SaleItemRow[] = [];
    for (let index = 0; index < saleIds.length; index += 200) {
      const { data, error } = await supabase.from('pharmacy_sale_items').select('sale_id, medication_name, generic_name, quantity, unit_price, total_price').in('sale_id', saleIds.slice(index, index + 200));
      if (error) {
        console.error('Unable to load pharmacy sale items', error);
        toast.error('Sales totals loaded, but medicine-wise breakup could not be loaded.');
        break;
      }
      allItems.push(...((data || []) as SaleItemRow[]));
    }
    setSaleItems(allItems);
    setLoading(false);
  };

  useEffect(() => { loadReport(); }, [hospitalName, monthRange.start, monthRange.next]);

  const purchaseTotal = purchases.reduce((total, row) => total + amount(row.total_amount), 0);
  const salesTotal = sales.reduce((total, row) => total + amount(row.total_amount), 0);
  const itemSalesTotal = saleItems.reduce((total, row) => total + amount(row.total_price), 0);
  const reconciliationVariance = salesTotal - itemSalesTotal;
  const netCashFlow = salesTotal - purchaseTotal;
  const visitSchemeMap = useMemo(() => new Map(visitSchemes.map(visit => [visit.visit_id, visit])), [visitSchemes]);
  const patientSchemeMap = useMemo(() => new Map(patientSchemes.filter(patient => patient.patients_id).map(patient => [patient.patients_id!, patient])), [patientSchemes]);
  const yojnaSales = useMemo(() => sales.filter(sale => {
    const visitScheme = sale.visit_id ? visitSchemeMap.get(sale.visit_id) : undefined;
    const patientScheme = sale.patient_id ? patientSchemeMap.get(sale.patient_id) : undefined;
    return isYojnaCorporate(visitScheme?.corporate) || isYojnaCorporate(visitScheme?.insurance_type) || isYojnaCorporate(patientScheme?.corporate);
  }), [sales, visitSchemeMap, patientSchemeMap]);
  const yojnaSalesTotal = yojnaSales.reduce((total, sale) => total + amount(sale.total_amount), 0);
  const yojnaPatientBreakup = useMemo(() => {
    const rows = new Map<string, { patientId: string; patientName: string; corporate: string; bills: number; amount: number }>();
    yojnaSales.forEach(sale => {
      const visitScheme = sale.visit_id ? visitSchemeMap.get(sale.visit_id) : undefined;
      const patientScheme = sale.patient_id ? patientSchemeMap.get(sale.patient_id) : undefined;
      const patientId = sale.patient_id || `walk-in-${sale.sale_id}`;
      const item = rows.get(patientId) || { patientId: sale.patient_id || '—', patientName: sale.patient_name || 'Walk-in', corporate: visitScheme?.corporate || visitScheme?.insurance_type || patientScheme?.corporate || 'Yojna', bills: 0, amount: 0 };
      item.bills += 1; item.amount += amount(sale.total_amount); rows.set(patientId, item);
    });
    return [...rows.values()].sort((a, b) => b.amount - a.amount);
  }, [yojnaSales, visitSchemeMap, patientSchemeMap]);
  const dailyRows = useMemo(() => {
    const daily = new Map<string, { date: string; purchase: number; sales: number; purchaseCount: number; saleCount: number }>();
    purchases.forEach(row => {
      const item = daily.get(row.grn_date) || { date: row.grn_date, purchase: 0, sales: 0, purchaseCount: 0, saleCount: 0 };
      item.purchase += amount(row.total_amount); item.purchaseCount += 1; daily.set(row.grn_date, item);
    });
    sales.forEach(row => {
      const date = row.sale_date.slice(0, 10);
      const item = daily.get(date) || { date, purchase: 0, sales: 0, purchaseCount: 0, saleCount: 0 };
      item.sales += amount(row.total_amount); item.saleCount += 1; daily.set(date, item);
    });
    return [...daily.values()].sort((a, b) => b.date.localeCompare(a.date));
  }, [purchases, sales]);
  const medicineBreakup = useMemo(() => {
    const items = new Map<string, { medicineName: string; genericName: string; quantity: number; value: number; bills: Set<number> }>();
    saleItems.forEach(item => {
      const medicineName = item.medication_name || 'Unnamed medicine';
      const genericName = item.generic_name || '';
      const key = `${medicineName}::${genericName}`;
      const summary = items.get(key) || { medicineName, genericName, quantity: 0, value: 0, bills: new Set<number>() };
      summary.quantity += amount(item.quantity); summary.value += amount(item.total_price); summary.bills.add(item.sale_id);
      items.set(key, summary);
    });
    return [...items.values()].map(item => ({ ...item, billCount: item.bills.size, averageRate: item.quantity ? item.value / item.quantity : 0 })).sort((a, b) => b.value - a.value);
  }, [saleItems]);
  const filteredPurchases = purchases.filter(row => (!sourceFilter.date || row.grn_date === sourceFilter.date) && (sourceFilter.type === 'ALL' || sourceFilter.type === 'PURCHASE'));
  const filteredSales = sales.filter(row => (!sourceFilter.date || row.sale_date.slice(0, 10) === sourceFilter.date) && (sourceFilter.type === 'ALL' || sourceFilter.type === 'SALE'));
  const showSourceRecords = (type: 'ALL' | 'PURCHASE' | 'SALE', date: string | null) => {
    setSourceFilter({ type, date });
    window.setTimeout(() => sourceRecordsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };
  const showYojnaSales = () => {
    setShowYojnaBreakdown(true);
    window.setTimeout(() => yojnaBreakdownRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };

  const exportReport = () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ Month: monthLabel(month), Hospital: hospitalConfig?.fullName || hospitalName, 'Purchase Total': purchaseTotal, 'Sales Total (Bills)': salesTotal, 'Yojna Sales Total': yojnaSalesTotal, 'Yojna Sales Bills': yojnaSales.length, 'Sales Total (Items)': itemSalesTotal, 'Reconciliation Variance': reconciliationVariance, 'Sales - Purchases': netCashFlow, 'Posted GRNs': purchases.length, 'Completed Sales': sales.length }]), 'Summary');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(dailyRows.map(row => ({ Date: row.date, 'Purchase Entries': row.purchaseCount, Purchases: row.purchase, 'Sales Bills': row.saleCount, Sales: row.sales, 'Sales - Purchases': row.sales - row.purchase }))), 'Daily Summary');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(purchases.map(row => ({ Date: row.grn_date, GRN: row.grn_number, Invoice: row.invoice_number || '', 'Supplier ID': row.supplier_id || '', Amount: amount(row.total_amount) }))), 'Purchases');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(sales.map(row => ({ Date: row.sale_date, 'Sale ID': row.sale_id, Patient: row.patient_name || 'Walk-in', 'Payment Method': row.payment_method || '', Amount: amount(row.total_amount) }))), 'Sales');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(medicineBreakup.map(row => ({ Medicine: row.medicineName, Generic: row.genericName, Quantity: row.quantity, Bills: row.billCount, 'Item Sales Value': row.value, 'Average Rate': row.averageRate }))), 'Medicine Breakup');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(yojnaPatientBreakup.map(row => ({ 'Patient ID': row.patientId, Patient: row.patientName, Scheme: row.corporate, Bills: row.bills, 'Sales Amount': row.amount }))), 'Yojna Patient Sales');
    XLSX.writeFile(workbook, `Pharmacy_Purchase_Sales_${month}.xlsx`);
  };

  const exportSourceRecords = () => {
    const workbook = XLSX.utils.book_new();
    if (sourceFilter.type !== 'SALE') XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(filteredPurchases.map(row => ({ Date: row.grn_date, GRN: row.grn_number, Invoice: row.invoice_number || '', 'Supplier ID': row.supplier_id || '', Status: 'POSTED', Amount: amount(row.total_amount) }))), 'Included Purchases');
    if (sourceFilter.type !== 'PURCHASE') XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(filteredSales.map(row => ({ Date: row.sale_date, 'Sale ID': row.sale_id, Patient: row.patient_name || 'Walk-in', 'Payment Method': row.payment_method || '', Status: row.payment_status || 'COMPLETED', Amount: amount(row.total_amount) }))), 'Included Sales');
    XLSX.writeFile(workbook, `Pharmacy_Source_Records_${month}${sourceFilter.date ? `_${sourceFilter.date}` : ''}.xlsx`);
  };

  return <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"><div className="flex items-center gap-3"><div className="rounded-xl bg-primary/10 p-2 text-primary"><Package className="h-6 w-6" /></div><div><h1 className="text-2xl font-bold text-gray-800">Monthly Pharmacy Purchase & Sales</h1><p className="text-sm text-gray-500">Posted GRN purchases and completed pharmacy sales for {hospitalConfig?.fullName || 'your hospital'}</p></div></div><div className="flex gap-2"><Button variant="outline" onClick={loadReport} disabled={loading}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button><Button onClick={exportReport} disabled={loading}><Download className="mr-2 h-4 w-4" />Export Excel</Button></div></div>
    <Card><CardContent className="flex flex-wrap items-end gap-3 pt-6"><div><label className="mb-1 block text-sm font-medium">Report month</label><Input type="month" value={month} onChange={event => setMonth(event.target.value)} /></div><p className="pb-2 text-sm text-muted-foreground">Click a total or day to view the exact records included.</p></CardContent></Card>
    <Card className="border-blue-200 bg-blue-50/40"><CardHeader className="pb-2"><CardTitle className="text-base">How this report is calculated</CardTitle></CardHeader><CardContent className="grid gap-3 text-sm text-muted-foreground md:grid-cols-2"><p><strong className="text-foreground">Purchases:</strong> sum of <code>goods_received_notes.total_amount</code> for <strong>POSTED</strong> GRNs dated in {monthLabel(month)} for {hospitalConfig?.fullName || hospitalName}.</p><p><strong className="text-foreground">Sales:</strong> sum of <code>pharmacy_sales.total_amount</code> for <strong>COMPLETED</strong> bills dated in {monthLabel(month)} for the same hospital. Cancelled, refunded, and pending-approval bills are excluded.</p></CardContent></Card>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5"><Metric title="Purchase Total" value={formatCurrency(purchaseTotal)} detail={`${purchases.length} posted GRNs — click to verify`} color="text-orange-600" onClick={() => showSourceRecords('PURCHASE', null)} /><Metric title="Sales Total" value={formatCurrency(salesTotal)} detail={`${sales.length} completed bills — click to verify`} color="text-green-600" onClick={() => showSourceRecords('SALE', null)} /><Metric title="Yojna Sales" value={formatCurrency(yojnaSalesTotal)} detail={`${yojnaSales.length} MJPJAY / PMJAY bills — click for patients`} color="text-purple-700" onClick={showYojnaSales} /><Metric title="Cash-flow Comparison" value={formatCurrency(netCashFlow)} detail="Sales minus purchases; not profit" color={netCashFlow >= 0 ? 'text-blue-600' : 'text-red-600'} /><Metric title="Report Month" value={monthLabel(month)} detail="Hospital-specific data" color="text-gray-800" /></div>
    <Card><CardHeader><CardTitle>Daily Purchase & Sales Summary</CardTitle></CardHeader><CardContent className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Posted GRNs</TableHead><TableHead>Purchases</TableHead><TableHead>Completed Bills</TableHead><TableHead>Sales</TableHead><TableHead>Sales − Purchases</TableHead></TableRow></TableHeader><TableBody>{dailyRows.map(row => <TableRow key={row.date} className="cursor-pointer hover:bg-muted/50" onClick={() => showSourceRecords('ALL', row.date)}><TableCell>{dateLabel(row.date)}</TableCell><TableCell>{row.purchaseCount}</TableCell><TableCell>{formatCurrency(row.purchase)}</TableCell><TableCell>{row.saleCount}</TableCell><TableCell>{formatCurrency(row.sales)}</TableCell><TableCell className={row.sales - row.purchase >= 0 ? 'text-green-700' : 'text-red-700'}>{formatCurrency(row.sales - row.purchase)}</TableCell></TableRow>)}{!loading && !dailyRows.length && <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">No posted GRNs or completed pharmacy sales for this month.</TableCell></TableRow>}</TableBody></Table></CardContent></Card>
    <div ref={sourceRecordsRef}><Card><CardHeader className="flex-row items-center justify-between"><div><CardTitle>Source Records Included</CardTitle><p className="mt-1 text-sm text-muted-foreground">{sourceFilter.date ? dateLabel(sourceFilter.date) : 'Entire selected month'} · {sourceFilter.type === 'ALL' ? 'Purchases and sales' : sourceFilter.type === 'PURCHASE' ? 'Purchases only' : 'Sales only'}</p></div><div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => setSourceFilter({ type: 'ALL', date: null })}>Clear</Button><Button size="sm" onClick={exportSourceRecords}><Download className="mr-2 h-4 w-4" />Export records</Button></div></CardHeader><CardContent><div className="grid gap-6 xl:grid-cols-2"><EntryTable title="Posted GRNs" rows={filteredPurchases} type="purchase" /><EntryTable title="Completed Sales Bills" rows={filteredSales} type="sale" /></div></CardContent></Card></div>
    {showYojnaBreakdown && <div ref={yojnaBreakdownRef}><Card className="border-purple-200"><CardHeader className="flex-row items-center justify-between"><div><CardTitle>Yojna Patient-wise Sales Breakdown</CardTitle><p className="mt-1 text-sm text-muted-foreground">Completed pharmacy sales for patients classified as MJPJAY, PMJAY, Ayushman, or another Yojna alias from their visit/patient corporate record.</p></div><Button variant="outline" size="sm" onClick={() => setShowYojnaBreakdown(false)}>Hide</Button></CardHeader><CardContent className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Patient</TableHead><TableHead>Patient ID</TableHead><TableHead>Scheme</TableHead><TableHead>Bills</TableHead><TableHead>Sales Amount</TableHead></TableRow></TableHeader><TableBody>{yojnaPatientBreakup.map(row => <TableRow key={row.patientId}><TableCell>{row.patientName}</TableCell><TableCell>{row.patientId}</TableCell><TableCell>{row.corporate}</TableCell><TableCell>{row.bills}</TableCell><TableCell>{formatCurrency(row.amount)}</TableCell></TableRow>)}{!yojnaPatientBreakup.length && <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted-foreground">No completed MJPJAY / PMJAY Yojna pharmacy sales were found for this month.</TableCell></TableRow>}</TableBody></Table></CardContent></Card></div>}
    <Card><CardHeader><CardTitle>Medicine-wise Sales Breakup</CardTitle><p className="text-sm font-normal text-muted-foreground">Derived from sale items belonging to the completed bills included above.</p></CardHeader><CardContent className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Medicine</TableHead><TableHead>Quantity Sold</TableHead><TableHead>Bills</TableHead><TableHead>Item Sales Value</TableHead><TableHead>Average Rate</TableHead></TableRow></TableHeader><TableBody>{medicineBreakup.map(row => <TableRow key={`${row.medicineName}-${row.genericName}`}><TableCell><div className="font-medium">{row.medicineName}</div><div className="text-xs text-muted-foreground">{row.genericName || '—'}</div></TableCell><TableCell>{row.quantity}</TableCell><TableCell>{row.billCount}</TableCell><TableCell>{formatCurrency(row.value)}</TableCell><TableCell>{formatCurrency(row.averageRate)}</TableCell></TableRow>)}{!loading && !medicineBreakup.length && <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted-foreground">No pharmacy sale items were found for the included completed bills.</TableCell></TableRow>}</TableBody></Table></CardContent></Card>
    <Card className={Math.abs(reconciliationVariance) < 0.01 ? 'border-green-200' : 'border-red-300'}><CardHeader><CardTitle>Sales Reconciliation</CardTitle></CardHeader><CardContent className="grid gap-3 text-sm md:grid-cols-3"><div><p className="text-muted-foreground">Bill-header sales total</p><p className="text-xl font-semibold">{formatCurrency(salesTotal)}</p></div><div><p className="text-muted-foreground">Medicine-item sales total</p><p className="text-xl font-semibold">{formatCurrency(itemSalesTotal)}</p></div><div><p className="text-muted-foreground">Variance</p><p className={`text-xl font-semibold ${Math.abs(reconciliationVariance) < 0.01 ? 'text-green-700' : 'text-red-700'}`}>{formatCurrency(reconciliationVariance)} {Math.abs(reconciliationVariance) < 0.01 ? '— Matched' : '— Review discounts, tax, or missing sale items'}</p></div></CardContent></Card>
  </div>;
}

function Metric({ title, value, detail, color, onClick }: { title: string; value: string; detail: string; color: string; onClick?: () => void }) { return onClick ? <button type="button" onClick={onClick} className="text-left"><Card className="h-full transition-shadow hover:shadow-md"><CardContent className="pt-5"><p className="text-sm text-muted-foreground">{title}</p><p className={`mt-1 text-2xl font-bold ${color}`}>{value}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></CardContent></Card></button> : <Card><CardContent className="pt-5"><p className="text-sm text-muted-foreground">{title}</p><p className={`mt-1 text-2xl font-bold ${color}`}>{value}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></CardContent></Card>; }

function EntryTable({ title, rows, type }: { title: string; rows: PurchaseRow[] | SaleRow[]; type: 'purchase' | 'sale' }) { return <Card><CardHeader><CardTitle>{title}</CardTitle></CardHeader><CardContent className="max-h-[420px] overflow-auto"><Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>{type === 'purchase' ? 'GRN / Invoice' : 'Sale / Patient'}</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader><TableBody>{rows.map(row => type === 'purchase' ? <TableRow key={(row as PurchaseRow).id}><TableCell>{dateLabel((row as PurchaseRow).grn_date)}</TableCell><TableCell><div>{(row as PurchaseRow).grn_number}</div><div className="text-xs text-muted-foreground">{(row as PurchaseRow).invoice_number || 'No invoice number'}</div></TableCell><TableCell className="text-right">{formatCurrency(amount((row as PurchaseRow).total_amount))}</TableCell></TableRow> : <TableRow key={(row as SaleRow).sale_id}><TableCell>{dateLabel((row as SaleRow).sale_date)}</TableCell><TableCell><div>Sale #{(row as SaleRow).sale_id}</div><div className="text-xs text-muted-foreground">{(row as SaleRow).patient_name || 'Walk-in'}</div></TableCell><TableCell className="text-right">{formatCurrency(amount((row as SaleRow).total_amount))}</TableCell></TableRow>)}{!rows.length && <TableRow><TableCell colSpan={3} className="py-8 text-center text-muted-foreground">No entries.</TableCell></TableRow>}</TableBody></Table></CardContent></Card>; }
