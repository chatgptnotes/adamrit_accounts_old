import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { AlertTriangle, ChevronDown, Download, FileSpreadsheet, Package, RefreshCw, Search } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

type ExpiryStatus = 'EXPIRED' | 'EXPIRING_SOON' | 'NEAR_EXPIRY' | 'GOOD';
type InventoryExportScope = 'ALL' | 'EXPIRED' | 'EXPIRING_SOON' | 'OUT_OF_STOCK' | 'LOW_STOCK';

interface InventoryBatchRow {
  batch_inventory_id: string;
  hospital_name: string;
  medicine_id: string;
  medicine_name: string;
  generic_name: string | null;
  batch_number: string;
  expiry_date: string;
  current_stock: number;
  purchase_price: number | null;
  mrp: number | null;
  supplier_name: string | null;
  rack_number: string | null;
  shelf_location: string | null;
  purchase_value: number;
  mrp_value: number;
  days_to_expiry: number;
  expiry_status: ExpiryStatus;
}

interface InventorySummaryRow {
  hospital_name: string;
  medicine_id: string;
  medicine_name: string;
  generic_name: string | null;
  on_hand_quantity: number;
  available_quantity: number;
  batch_count: number;
  nearest_expiry: string | null;
  expired_batch_count: number;
  expiring_soon_batch_count: number;
  near_expiry_batch_count: number;
  purchase_value: number;
  mrp_value: number;
}

const numeric = (value: unknown) => Number(value || 0);

const formatCurrency = (amount: number) => new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 0,
}).format(amount);

const formatDate = (date: string | null) => date
  ? new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${date}T00:00:00`))
  : '—';

const expiryBadge = (status: ExpiryStatus) => {
  const classes: Record<ExpiryStatus, string> = {
    EXPIRED: 'bg-red-100 text-red-800',
    EXPIRING_SOON: 'bg-orange-100 text-orange-800',
    NEAR_EXPIRY: 'bg-yellow-100 text-yellow-800',
    GOOD: 'bg-green-100 text-green-800',
  };
  return <Badge className={classes[status]}>{status.replace('_', ' ')}</Badge>;
};

const PharmacyReports: React.FC = () => {
  const { hospitalConfig } = useAuth();
  const hospitalName = hospitalConfig?.fullName || '';
  const [summaryRows, setSummaryRows] = useState<InventorySummaryRow[]>([]);
  const [batchRows, setBatchRows] = useState<InventoryBatchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [expiryFilter, setExpiryFilter] = useState<'ALL' | ExpiryStatus>('ALL');
  const [supplierFilter, setSupplierFilter] = useState('ALL');
  const [stockStatusFilter, setStockStatusFilter] = useState<'ALL' | 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK'>('ALL');
  const [lowStockThreshold, setLowStockThreshold] = useState('20');
  const medicineSummaryRef = useRef<HTMLDivElement>(null);
  const batchDetailRef = useRef<HTMLDivElement>(null);

  const loadReport = async () => {
    if (!hospitalName) return;
    setLoading(true);
    const [summaryResult, batchResult] = await Promise.all([
      supabase.from('v_pharmacy_inventory_summary_report').select('*').eq('hospital_name', hospitalName).order('medicine_name'),
      supabase.from('v_pharmacy_inventory_batch_report').select('*').eq('hospital_name', hospitalName).order('expiry_date'),
    ]);
    setLoading(false);

    if (summaryResult.error || batchResult.error) {
      console.error('Unable to load pharmacy inventory report', summaryResult.error || batchResult.error);
      toast.error('Unable to load the inventory report. Please apply the reporting migration first.');
      return;
    }

    setSummaryRows((summaryResult.data || []).map((row: any) => ({
      ...row,
      on_hand_quantity: numeric(row.on_hand_quantity), available_quantity: numeric(row.available_quantity),
      batch_count: numeric(row.batch_count), expired_batch_count: numeric(row.expired_batch_count),
      expiring_soon_batch_count: numeric(row.expiring_soon_batch_count), near_expiry_batch_count: numeric(row.near_expiry_batch_count),
      purchase_value: numeric(row.purchase_value), mrp_value: numeric(row.mrp_value),
    })));
    setBatchRows((batchResult.data || []).map((row: any) => ({
      ...row,
      current_stock: numeric(row.current_stock), purchase_price: numeric(row.purchase_price), mrp: numeric(row.mrp),
      purchase_value: numeric(row.purchase_value), mrp_value: numeric(row.mrp_value), days_to_expiry: numeric(row.days_to_expiry),
    })));
  };

  useEffect(() => { loadReport(); }, [hospitalName]);

  const threshold = Math.max(0, numeric(lowStockThreshold));
  const suppliers = useMemo(() => [...new Set(batchRows.map(row => row.supplier_name).filter(Boolean) as string[])].sort(), [batchRows]);
  const matchesSearch = (name: string, generic?: string | null, batch?: string | null) =>
    [name, generic, batch].filter(Boolean).join(' ').toLowerCase().includes(search.trim().toLowerCase());

  const summaryStatus = (row: InventorySummaryRow) => {
    if (row.available_quantity <= 0) return 'OUT_OF_STOCK';
    if (row.available_quantity <= threshold) return 'LOW_STOCK';
    return 'IN_STOCK';
  };
  const filteredSummary = useMemo(() => summaryRows.filter(row =>
    matchesSearch(row.medicine_name, row.generic_name)
    && (stockStatusFilter === 'ALL' || summaryStatus(row) === stockStatusFilter)
  ), [summaryRows, search, stockStatusFilter, threshold]);
  const filteredBatches = useMemo(() => batchRows.filter(row =>
    matchesSearch(row.medicine_name, row.generic_name, row.batch_number)
    && (expiryFilter === 'ALL' || row.expiry_status === expiryFilter)
    && (supplierFilter === 'ALL' || row.supplier_name === supplierFilter)
  ), [batchRows, search, expiryFilter, supplierFilter]);

  const stockStatus = (row: InventorySummaryRow) => {
    if (summaryStatus(row) === 'OUT_OF_STOCK') return <Badge className="bg-red-100 text-red-800">OUT OF STOCK</Badge>;
    if (summaryStatus(row) === 'LOW_STOCK') return <Badge className="bg-orange-100 text-orange-800">LOW STOCK</Badge>;
    return <Badge className="bg-green-100 text-green-800">IN STOCK</Badge>;
  };

  const alerts = useMemo(() => ({
    outOfStock: filteredSummary.filter(row => row.available_quantity <= 0),
    lowStock: filteredSummary.filter(row => row.available_quantity > 0 && row.available_quantity <= threshold),
    expired: filteredBatches.filter(row => row.current_stock > 0 && row.expiry_status === 'EXPIRED'),
    expiringSoon: filteredBatches.filter(row => row.current_stock > 0 && row.expiry_status === 'EXPIRING_SOON'),
    nearExpiry: filteredBatches.filter(row => row.current_stock > 0 && row.expiry_status === 'NEAR_EXPIRY'),
  }), [filteredSummary, filteredBatches, threshold]);

  const totals = useMemo(() => ({
    medicinesInStock: filteredSummary.filter(row => row.available_quantity > 0).length,
    availableQuantity: filteredSummary.reduce((sum, row) => sum + row.available_quantity, 0),
    purchaseValue: filteredSummary.reduce((sum, row) => sum + row.purchase_value, 0),
    mrpValue: filteredSummary.reduce((sum, row) => sum + row.mrp_value, 0),
  }), [filteredSummary]);

  const showStockStatus = (status: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK') => {
    setSearch('');
    setSupplierFilter('ALL');
    setExpiryFilter('ALL');
    setStockStatusFilter(status);
    window.setTimeout(() => medicineSummaryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };

  const showExpiryStatus = (status: ExpiryStatus) => {
    setSearch('');
    setSupplierFilter('ALL');
    setStockStatusFilter('ALL');
    setExpiryFilter(status);
    window.setTimeout(() => batchDetailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };

  const exportReport = (scope: InventoryExportScope) => {
    const exportLabels: Record<InventoryExportScope, string> = {
      ALL: 'All Inventory', EXPIRED: 'Expired Stock', EXPIRING_SOON: 'Expiring Soon Stock', OUT_OF_STOCK: 'Out of Stock', LOW_STOCK: 'Low Stock',
    };
    let exportSummary = summaryRows;
    let exportBatches = batchRows;
    if (scope === 'EXPIRED' || scope === 'EXPIRING_SOON') {
      exportBatches = batchRows.filter(row => row.current_stock > 0 && row.expiry_status === scope);
      const medicineIds = new Set(exportBatches.map(row => row.medicine_id));
      exportSummary = summaryRows.filter(row => medicineIds.has(row.medicine_id));
    } else if (scope === 'OUT_OF_STOCK' || scope === 'LOW_STOCK') {
      exportSummary = summaryRows.filter(row => summaryStatus(row) === scope);
      const medicineIds = new Set(exportSummary.map(row => row.medicine_id));
      exportBatches = batchRows.filter(row => medicineIds.has(row.medicine_id));
    }
    const workbook = XLSX.utils.book_new();
    const summarySheet = XLSX.utils.json_to_sheet(exportSummary.map(row => ({
      Medicine: row.medicine_name, Generic: row.generic_name || '', 'Available Qty': row.available_quantity,
      'On-hand Qty': row.on_hand_quantity, Batches: row.batch_count, 'Nearest Expiry': row.nearest_expiry || '',
      'Purchase Value': row.purchase_value, 'MRP Value': row.mrp_value,
      Status: row.available_quantity <= 0 ? 'OUT OF STOCK' : row.available_quantity <= threshold ? 'LOW STOCK' : 'IN STOCK',
    })));
    const batchesSheet = XLSX.utils.json_to_sheet(exportBatches.map(row => ({
      Medicine: row.medicine_name, Generic: row.generic_name || '', Batch: row.batch_number, Expiry: row.expiry_date,
      'Days to Expiry': row.days_to_expiry, Stock: row.current_stock, 'Purchase Price': row.purchase_price || 0,
      MRP: row.mrp || 0, 'Purchase Value': row.purchase_value, 'MRP Value': row.mrp_value,
      Supplier: row.supplier_name || '', Rack: row.rack_number || '', Shelf: row.shelf_location || '', 'Expiry Status': row.expiry_status,
    })));
    const alertRows = [
      ...exportSummary.filter(row => summaryStatus(row) === 'OUT_OF_STOCK').map(row => ({ Alert: 'OUT OF STOCK', Medicine: row.medicine_name, Batch: '', Stock: row.available_quantity, Expiry: '' })),
      ...exportSummary.filter(row => summaryStatus(row) === 'LOW_STOCK').map(row => ({ Alert: 'LOW STOCK', Medicine: row.medicine_name, Batch: '', Stock: row.available_quantity, Expiry: '' })),
      ...exportBatches.filter(row => row.current_stock > 0 && ['EXPIRED', 'EXPIRING_SOON', 'NEAR_EXPIRY'].includes(row.expiry_status)).map(row => ({ Alert: row.expiry_status.replace('_', ' '), Medicine: row.medicine_name, Batch: row.batch_number, Stock: row.current_stock, Expiry: row.expiry_date })),
    ];
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Medicine Breakdown');
    XLSX.utils.book_append_sheet(workbook, batchesSheet, 'Batch Details');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(alertRows), 'Alerts');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ Export: exportLabels[scope], Hospital: hospitalName, 'Low-stock Threshold': threshold, 'Medicine Records': exportSummary.length, 'Batch Records': exportBatches.length }]), 'Export Info');
    XLSX.writeFile(workbook, `Pharmacy_${exportLabels[scope].replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const cards = [
    { title: 'Medicines in Stock', value: totals.medicinesInStock.toLocaleString(), color: 'text-blue-600', onClick: () => showStockStatus('IN_STOCK') },
    { title: 'Available Quantity', value: totals.availableQuantity.toLocaleString(), color: 'text-indigo-600' },
    { title: 'Purchase Value', value: formatCurrency(totals.purchaseValue), color: 'text-green-600' },
    { title: 'MRP Value', value: formatCurrency(totals.mrpValue), color: 'text-emerald-600' },
    { title: 'Low Stock', value: alerts.lowStock.length.toLocaleString(), color: 'text-orange-600', onClick: () => showStockStatus('LOW_STOCK') },
    { title: 'Out of Stock', value: alerts.outOfStock.length.toLocaleString(), color: 'text-red-600', onClick: () => showStockStatus('OUT_OF_STOCK') },
    { title: 'Expired', value: alerts.expired.length.toLocaleString(), color: 'text-red-600', onClick: () => showExpiryStatus('EXPIRED') },
    { title: 'Expiring Soon', value: alerts.expiringSoon.length.toLocaleString(), color: 'text-orange-600', onClick: () => showExpiryStatus('EXPIRING_SOON') },
  ];

  return <div className="space-y-6">
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div className="flex items-center gap-3"><Package className="h-6 w-6 text-primary" /><div><h2 className="text-2xl font-bold">Pharmacy Inventory Report</h2><p className="text-sm text-muted-foreground">Live batch-wise stock, valuation, and expiry alerts for {hospitalName || 'your hospital'}</p></div></div>
      <div className="flex gap-2"><Button variant="outline" onClick={loadReport} disabled={loading}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button><DropdownMenu><DropdownMenuTrigger asChild><Button disabled={loading}><Download className="mr-2 h-4 w-4" />Export Excel<ChevronDown className="ml-2 h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-56"><DropdownMenuItem onSelect={() => exportReport('ALL')}>All Inventory</DropdownMenuItem><DropdownMenuItem onSelect={() => exportReport('EXPIRED')}>Expired Stock</DropdownMenuItem><DropdownMenuItem onSelect={() => exportReport('EXPIRING_SOON')}>Expiring Soon (next 30 days)</DropdownMenuItem><DropdownMenuItem onSelect={() => exportReport('OUT_OF_STOCK')}>Out of Stock</DropdownMenuItem><DropdownMenuItem onSelect={() => exportReport('LOW_STOCK')}>Low Stock (≤ {threshold})</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>
    </div>

    <Card><CardContent className="pt-6"><div className="grid gap-3 lg:grid-cols-6">
      <div className="relative lg:col-span-2"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input className="pl-9" placeholder="Search medicine, generic name, or batch number" value={search} onChange={event => setSearch(event.target.value)} /></div>
      <select className="rounded-md border bg-background px-3 py-2 text-sm" value={supplierFilter} onChange={event => setSupplierFilter(event.target.value)}><option value="ALL">All suppliers</option>{suppliers.map(supplier => <option key={supplier} value={supplier}>{supplier}</option>)}</select>
      <select className="rounded-md border bg-background px-3 py-2 text-sm" value={expiryFilter} onChange={event => setExpiryFilter(event.target.value as 'ALL' | ExpiryStatus)}><option value="ALL">All expiry statuses</option><option value="EXPIRED">Expired</option><option value="EXPIRING_SOON">Expiring within 30 days</option><option value="NEAR_EXPIRY">Expiring within 90 days</option><option value="GOOD">Healthy stock</option></select>
      <select className="rounded-md border bg-background px-3 py-2 text-sm" value={stockStatusFilter} onChange={event => setStockStatusFilter(event.target.value as 'ALL' | 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK')}><option value="ALL">All stock statuses</option><option value="IN_STOCK">In stock</option><option value="LOW_STOCK">Low stock</option><option value="OUT_OF_STOCK">Out of stock</option></select>
      <div><label className="mb-1 block text-xs font-medium text-muted-foreground">Low-stock threshold (pieces)</label><Input min="0" type="number" value={lowStockThreshold} onChange={event => setLowStockThreshold(event.target.value)} /></div>
    </div></CardContent></Card>

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map(({ title, value, color, onClick }) => onClick ? <button key={title} type="button" onClick={onClick} className="text-left"><Card className="h-full transition-shadow hover:shadow-md"><CardContent className="pt-5"><p className="text-sm text-muted-foreground">{title}</p><p className={`mt-1 text-2xl font-bold ${color}`}>{value}</p><p className="mt-1 text-xs text-muted-foreground">Click to view</p></CardContent></Card></button> : <Card key={title}><CardContent className="pt-5"><p className="text-sm text-muted-foreground">{title}</p><p className={`mt-1 text-2xl font-bold ${color}`}>{value}</p></CardContent></Card>)}</div>

    <div className="grid gap-4 lg:grid-cols-3">
      <AlertCard title="Out of Stock" items={alerts.outOfStock.map(row => `${row.medicine_name} (${row.available_quantity})`)} className="border-red-200" />
      <AlertCard title={`Low Stock (≤ ${threshold})`} items={alerts.lowStock.map(row => `${row.medicine_name} (${row.available_quantity})`)} className="border-orange-200" />
      <AlertCard title="Expiry Alerts" items={[...alerts.expired.map(row => `${row.medicine_name} — expired`), ...alerts.expiringSoon.map(row => `${row.medicine_name} — ${row.days_to_expiry} days`), ...alerts.nearExpiry.map(row => `${row.medicine_name} — ${row.days_to_expiry} days`)]} className="border-yellow-200" />
    </div>

    <div ref={medicineSummaryRef}><Card><CardHeader><CardTitle>Medicine Stock Summary</CardTitle></CardHeader><CardContent className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Medicine</TableHead><TableHead>Available / On-hand</TableHead><TableHead>Batches</TableHead><TableHead>Nearest Expiry</TableHead><TableHead>Purchase Value</TableHead><TableHead>MRP Value</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{filteredSummary.map(row => <TableRow key={row.medicine_id}><TableCell><div className="font-medium">{row.medicine_name}</div><div className="text-xs text-muted-foreground">{row.generic_name || '—'}</div></TableCell><TableCell>{row.available_quantity} / {row.on_hand_quantity}</TableCell><TableCell>{row.batch_count}</TableCell><TableCell>{formatDate(row.nearest_expiry)}</TableCell><TableCell>{formatCurrency(row.purchase_value)}</TableCell><TableCell>{formatCurrency(row.mrp_value)}</TableCell><TableCell>{stockStatus(row)}</TableCell></TableRow>)}{!loading && filteredSummary.length === 0 && <EmptyRow colSpan={7} />}</TableBody></Table></CardContent></Card></div>

    <div ref={batchDetailRef}><Card><CardHeader><CardTitle>Batch Stock Detail</CardTitle></CardHeader><CardContent className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Medicine / Batch</TableHead><TableHead>Expiry</TableHead><TableHead>Stock</TableHead><TableHead>Purchase / MRP</TableHead><TableHead>Supplier</TableHead><TableHead>Location</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{filteredBatches.map(row => <TableRow key={row.batch_inventory_id}><TableCell><div className="font-medium">{row.medicine_name}</div><div className="text-xs text-muted-foreground">Batch: {row.batch_number}</div></TableCell><TableCell>{formatDate(row.expiry_date)}<div className="text-xs text-muted-foreground">{row.days_to_expiry} days</div></TableCell><TableCell>{row.current_stock}</TableCell><TableCell>{formatCurrency(row.purchase_price || 0)} / {formatCurrency(row.mrp || 0)}</TableCell><TableCell>{row.supplier_name || '—'}</TableCell><TableCell>{[row.rack_number, row.shelf_location].filter(Boolean).join(' / ') || '—'}</TableCell><TableCell>{expiryBadge(row.expiry_status)}</TableCell></TableRow>)}{!loading && filteredBatches.length === 0 && <EmptyRow colSpan={7} />}</TableBody></Table></CardContent></Card></div>
  </div>;
};

const AlertCard = ({ title, items, className }: { title: string; items: string[]; className: string }) => <Card className={className}><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4" />{title}</CardTitle></CardHeader><CardContent>{items.length ? <ul className="space-y-1 text-sm">{items.slice(0, 5).map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}{items.length > 5 && <li className="text-muted-foreground">+{items.length - 5} more</li>}</ul> : <p className="text-sm text-muted-foreground">No alerts</p>}</CardContent></Card>;

const EmptyRow = ({ colSpan }: { colSpan: number }) => <TableRow><TableCell colSpan={colSpan} className="py-10 text-center text-muted-foreground"><FileSpreadsheet className="mx-auto mb-2 h-6 w-6" />No inventory records match these filters.</TableCell></TableRow>;

export default PharmacyReports;
