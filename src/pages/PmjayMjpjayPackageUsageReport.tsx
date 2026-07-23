import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Eye, FileSpreadsheet, Package2, Printer, Search, Users } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/utils/fetchAllRows';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EnhancedDatePicker } from '@/components/ui/enhanced-date-picker';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type IpdScheme = 'PMJAY' | 'MJPJAY';

type VisitUsageRow = {
  id: string;
  visit_id: string | null;
  package_code: string | null;
  package_name: string | null;
  admission_date: string | null;
  discharge_date: string | null;
  corporate: string | null;
  insurance_type: string | null;
  patients: {
    name: string | null;
    patients_id: string | null;
    corporate: string | null;
  } | null;
};

type MasterPackageRow = {
  scheme: string;
  treatment_plan: string | null;
  package_price: number | null;
  created_at: string | null;
};

type PatientUsageDetail = {
  visitKey: string;
  visitId: string;
  patientName: string;
  patientNo: string;
  packageCode: string;
  packageName: string;
  scheme: IpdScheme;
  admissionDate: string | null;
  dischargeDate: string | null;
};

type PackageSummary = {
  scheme: IpdScheme;
  packageCode: string;
  packageName: string;
  packageCost: number | null;
  usedCount: number;
  patients: PatientUsageDetail[];
};

type PrintSelectionState = {
  pmjaySummary: boolean;
  mjpjaySummary: boolean;
  patientDetails: boolean;
};

const DEFAULT_DATE = format(new Date(), 'yyyy-MM-dd');

const normalizeSchemeText = (value: unknown): string =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[–—-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const getIpdScheme = (visit: VisitUsageRow): IpdScheme | null => {
  const text = [
    visit.insurance_type,
    visit.corporate,
    visit.patients?.corporate,
  ]
    .map(normalizeSchemeText)
    .filter(Boolean)
    .join(' ');

  if (/(mjp(jay|jy)|mahatma jyotir?ao|mahatma jyotiba|phule)/i.test(text)) return 'MJPJAY';
  if (/(pm ?jay|ab pm ?jay|ayushman|pradhan mantri jan arogya)/i.test(text)) return 'PMJAY';
  return null;
};

const normalizePackageName = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const formatDateDisplay = (value: string | null) => {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : format(date, 'dd/MM/yyyy');
};

const formatCurrency = (value: number | null) => {
  if (value == null) return '-';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(value);
};

const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export default function PmjayMjpjayPackageUsageReport() {
  const [activeTab, setActiveTab] = useState<IpdScheme>('PMJAY');
  const [fromDate, setFromDate] = useState(DEFAULT_DATE);
  const [toDate, setToDate] = useState(DEFAULT_DATE);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPackage, setSelectedPackage] = useState<PackageSummary | null>(null);
  const [isPrintDialogOpen, setIsPrintDialogOpen] = useState(false);
  const [printSelections, setPrintSelections] = useState<PrintSelectionState>({
    pmjaySummary: true,
    mjpjaySummary: true,
    patientDetails: true,
  });

  const hasInvalidDateRange = Boolean(fromDate && toDate && fromDate > toDate);

  const { data, isLoading, error } = useQuery({
    queryKey: ['pmjay-mjpjay-package-usage-report', fromDate, toDate],
    enabled: !hasInvalidDateRange,
    queryFn: async () => {
      const [visits, masterPackages] = await Promise.all([
        fetchAllRows<VisitUsageRow>(() =>
          supabase
            .from('visits')
            .select('id, visit_id, package_code, package_name, admission_date, discharge_date, corporate, insurance_type, patients(name, patients_id, corporate)')
            .gte('admission_date', fromDate)
            .lte('admission_date', toDate)
            .not('package_name', 'is', null)
            .order('admission_date', { ascending: false }),
        ),
        fetchAllRows<MasterPackageRow>(() =>
          supabase
            .from('pmjay_mjpjay_packages')
            .select('scheme, treatment_plan, package_price, created_at')
            .in('scheme', ['PMJAY', 'MJPJAY'])
            .eq('is_active', true)
            .order('treatment_plan', { ascending: true })
            .order('created_at', { ascending: false }),
        ),
      ]);

      const packagePriceMap = new Map<string, number | null>();
      for (const pkg of masterPackages) {
        const plan = pkg.treatment_plan?.trim();
        const scheme = pkg.scheme === 'PMJAY' || pkg.scheme === 'MJPJAY' ? pkg.scheme : null;
        if (!plan || !scheme) continue;
        const key = `${scheme}:${normalizePackageName(plan)}`;
        if (!packagePriceMap.has(key)) {
          packagePriceMap.set(key, pkg.package_price);
        }
      }

      const summaryMap = new Map<string, PackageSummary>();
      for (const visit of visits) {
        const packageName = visit.package_name?.trim();
        if (!packageName) continue;
        const scheme = getIpdScheme(visit);
        if (!scheme) continue;

        const key = `${scheme}:${normalizePackageName(packageName)}`;
        const detail: PatientUsageDetail = {
          visitKey: visit.id,
          visitId: visit.visit_id || '-',
          patientName: visit.patients?.name?.trim() || 'Unknown',
          patientNo: visit.patients?.patients_id?.trim() || '-',
          packageCode: visit.package_code?.trim() || '-',
          packageName,
          scheme,
          admissionDate: visit.admission_date,
          dischargeDate: visit.discharge_date,
        };

        const existing = summaryMap.get(key);
        if (existing) {
          existing.usedCount += 1;
          existing.patients.push(detail);
          continue;
        }

        summaryMap.set(key, {
          scheme,
          packageCode: visit.package_code?.trim() || '-',
          packageName,
          packageCost: packagePriceMap.get(key) ?? null,
          usedCount: 1,
          patients: [detail],
        });
      }

      const grouped: Record<IpdScheme, PackageSummary[]> = {
        PMJAY: [],
        MJPJAY: [],
      };

      for (const summary of summaryMap.values()) {
        summary.patients.sort((left, right) => {
          const leftDate = left.admissionDate || '';
          const rightDate = right.admissionDate || '';
          return rightDate.localeCompare(leftDate) || left.patientName.localeCompare(right.patientName);
        });
        grouped[summary.scheme].push(summary);
      }

      for (const scheme of ['PMJAY', 'MJPJAY'] as const) {
        grouped[scheme].sort((left, right) =>
          right.usedCount - left.usedCount ||
          left.packageName.localeCompare(right.packageName),
        );
      }

      return grouped;
    },
  });

  const filteredData = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    const base = data || { PMJAY: [], MJPJAY: [] };
    if (!term) return base;

    const filterSummary = (rows: PackageSummary[]) =>
      rows.filter((row) =>
        row.packageName.toLowerCase().includes(term) ||
        row.patients.some((patient) =>
          patient.patientName.toLowerCase().includes(term) ||
          patient.patientNo.toLowerCase().includes(term) ||
          patient.visitId.toLowerCase().includes(term),
        ),
      );

    return {
      PMJAY: filterSummary(base.PMJAY),
      MJPJAY: filterSummary(base.MJPJAY),
    };
  }, [data, searchTerm]);

  const activeRows = filteredData[activeTab];
  const totalPackages = activeRows.length;
  const totalUses = activeRows.reduce((sum, row) => sum + row.usedCount, 0);
  const hasAnySummaryRows = filteredData.PMJAY.length > 0 || filteredData.MJPJAY.length > 0;
  const hasPrintablePatients = Boolean(selectedPackage && selectedPackage.patients.length > 0);
  const hasAnyPrintSelection =
    (printSelections.pmjaySummary && filteredData.PMJAY.length > 0) ||
    (printSelections.mjpjaySummary && filteredData.MJPJAY.length > 0) ||
    (printSelections.patientDetails && hasPrintablePatients);

  const openPrintDialog = () => {
    setPrintSelections({
      pmjaySummary: true,
      mjpjaySummary: true,
      patientDetails: true,
    });
    setIsPrintDialogOpen(true);
  };

  const renderSummaryTable = (scheme: IpdScheme, rows: PackageSummary[]) => `
    <section class="section">
      <div class="section-header">
        <div>
          <div class="section-kicker">Summary Table</div>
          <div class="section-title">${escapeHtml(scheme)} Package Usage</div>
        </div>
        <div class="section-stats">
          <div class="stat-chip">
            <span class="stat-label">Packages</span>
            <span class="stat-value">${escapeHtml(rows.length)}</span>
          </div>
          <div class="stat-chip">
            <span class="stat-label">Used Count</span>
            <span class="stat-value">${escapeHtml(rows.reduce((sum, row) => sum + row.usedCount, 0))}</span>
          </div>
        </div>
      </div>
      <table>
        <colgroup>
          <col style="width: 28%" />
          <col style="width: 16%" />
          <col style="width: 20%" />
          <col style="width: 10%" />
          <col style="width: 26%" />
        </colgroup>
        <thead>
          <tr>
            <th>Package Name</th>
            <th>Package Code</th>
            <th class="number">Package Cost</th>
            <th class="number">Used Count</th>
            <th>Patient Names</th>
          </tr>
        </thead>
        <tbody>
          ${
            rows.length > 0
              ? rows
                  .map(
                    (row) => `
              <tr>
                <td>${escapeHtml(row.packageName)}</td>
                <td>${escapeHtml(row.packageCode)}</td>
                <td class="number">${escapeHtml(formatCurrency(row.packageCost))}</td>
                <td class="number">${escapeHtml(row.usedCount)}</td>
                <td>${escapeHtml(row.patients.map((patient) => patient.patientName).join(', ') || '-')}</td>
              </tr>`,
                  )
                  .join('')
              : '<tr><td colspan="5">No records found.</td></tr>'
          }
        </tbody>
      </table>
    </section>
  `;

  const renderPatientsTable = (summary: PackageSummary) => `
    <section class="section">
      <div class="section-header">
        <div>
          <div class="section-kicker">Patient Detail Table</div>
          <div class="section-title">${escapeHtml(summary.scheme)} Patients - ${escapeHtml(summary.packageName)}</div>
        </div>
        <div class="section-stats">
          <div class="stat-chip">
            <span class="stat-label">Rows</span>
            <span class="stat-value">${escapeHtml(summary.patients.length)}</span>
          </div>
          <div class="stat-chip">
            <span class="stat-label">Package Cost</span>
            <span class="stat-value">${escapeHtml(formatCurrency(summary.packageCost))}</span>
          </div>
        </div>
      </div>
      <table>
        <colgroup>
          <col style="width: 18%" />
          <col style="width: 12%" />
          <col style="width: 12%" />
          <col style="width: 14%" />
          <col style="width: 24%" />
          <col style="width: 8%" />
          <col style="width: 12%" />
        </colgroup>
        <thead>
          <tr>
            <th>Patient Name</th>
            <th>Patient No</th>
            <th>Visit ID</th>
            <th>Package Code</th>
            <th>Package Name</th>
            <th>Scheme</th>
            <th>Admission Date</th>
          </tr>
        </thead>
        <tbody>
          ${
            summary.patients.length > 0
              ? summary.patients
                  .map(
                    (patient) => `
              <tr>
                <td>${escapeHtml(patient.patientName)}</td>
                <td>${escapeHtml(patient.patientNo)}</td>
                <td>${escapeHtml(patient.visitId)}</td>
                <td>${escapeHtml(patient.packageCode)}</td>
                <td>${escapeHtml(patient.packageName)}</td>
                <td>${escapeHtml(patient.scheme)}</td>
                <td>${escapeHtml(formatDateDisplay(patient.admissionDate))}</td>
              </tr>`,
                  )
                  .join('')
              : '<tr><td colspan="7">No patient records found.</td></tr>'
          }
        </tbody>
      </table>
    </section>
  `;

  const handlePrint = () => {
    const sections: string[] = [];
    if (printSelections.pmjaySummary) sections.push(renderSummaryTable('PMJAY', filteredData.PMJAY));
    if (printSelections.mjpjaySummary) sections.push(renderSummaryTable('MJPJAY', filteredData.MJPJAY));
    if (printSelections.patientDetails && selectedPackage) sections.push(renderPatientsTable(selectedPackage));
    if (sections.length === 0) return;

    const printWindow = window.open('', '_blank', 'width=1200,height=800');
    if (!printWindow) return;

    printWindow.document.write(`
      <!doctype html>
      <html>
        <head>
          <title>PMJAY / MJPJAY Package Usage Report</title>
          <style>
            @page { size: A4 landscape; margin: 8mm; }
            body { font-family: Arial, sans-serif; margin: 0; color: #111827; }
            .report-shell { border: 1px solid #d1d5db; padding: 14px 16px; border-radius: 12px; }
            .report-header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; margin-bottom: 12px; border-bottom: 2px solid #e5e7eb; padding-bottom: 10px; }
            .report-kicker { font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: #2563eb; font-weight: 700; margin-bottom: 4px; }
            h1 { margin: 0 0 4px 0; font-size: 22px; line-height: 1.2; }
            .report-subtitle { margin: 0; font-size: 12px; color: #4b5563; }
            .meta { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; min-width: 340px; }
            .meta-card { border: 1px solid #dbe3ef; background: #f8fafc; border-radius: 10px; padding: 8px 10px; }
            .meta-label { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b; margin-bottom: 4px; }
            .meta-value { display: block; font-size: 13px; font-weight: 700; color: #0f172a; }
            .section { margin-top: 16px; break-inside: auto; page-break-inside: auto; }
            .section-header { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; margin-bottom: 8px; }
            .section-kicker { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b; margin-bottom: 4px; }
            .section-title { font-size: 16px; font-weight: 700; line-height: 1.3; }
            .section-stats { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
            .stat-chip { min-width: 98px; border: 1px solid #dbe3ef; background: #f8fafc; border-radius: 10px; padding: 7px 9px; text-align: right; }
            .stat-label { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b; margin-bottom: 2px; }
            .stat-value { display: block; font-size: 13px; font-weight: 700; color: #0f172a; }
            table { width: 100%; border-collapse: collapse; table-layout: fixed; }
            th, td { border: 1px solid #d1d5db; padding: 6px 8px; text-align: left; vertical-align: top; word-break: break-word; line-height: 1.25; }
            th { background: #eff6ff; color: #0f172a; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
            td { font-size: 11px; }
            tbody tr:nth-child(even) { background: #fafafa; }
            .number { text-align: right; white-space: nowrap; }
            @media print {
              body { margin: 0; }
              .report-shell { border: 0; padding: 0; border-radius: 0; }
              .section:first-of-type { margin-top: 0; }
              .section-header, thead { break-inside: avoid; page-break-inside: avoid; }
              table { font-size: 10px; }
              tr { break-inside: avoid; page-break-inside: avoid; }
            }
          </style>
        </head>
        <body>
          <div class="report-shell">
            <div class="report-header">
              <div>
                <div class="report-kicker">Package Usage Report</div>
                <h1>PMJAY / MJPJAY Package Usage</h1>
                <p class="report-subtitle">Filtered package summary and patient-wise usage tables for the selected period.</p>
              </div>
              <div class="meta">
                <div class="meta-card">
                  <span class="meta-label">From Date</span>
                  <span class="meta-value">${escapeHtml(formatDateDisplay(fromDate))}</span>
                </div>
                <div class="meta-card">
                  <span class="meta-label">To Date</span>
                  <span class="meta-value">${escapeHtml(formatDateDisplay(toDate))}</span>
                </div>
                <div class="meta-card">
                  <span class="meta-label">Printed</span>
                  <span class="meta-value">${escapeHtml(new Date().toLocaleString('en-IN'))}</span>
                </div>
              </div>
            </div>
            ${sections.join('')}
          </div>
          <script>
            window.onload = function () {
              setTimeout(function () { window.print(); }, 150);
            };
          <\/script>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    setIsPrintDialogOpen(false);
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-gradient-to-r from-white via-slate-50 to-blue-50 p-5 shadow-sm md:flex-row md:items-start md:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-primary">
            <FileSpreadsheet className="h-6 w-6" />
            <span className="text-sm font-semibold uppercase tracking-wide">Package Usage Report</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">PMJAY / MJPJAY Package Usage</h1>
          <p className="text-sm text-muted-foreground">
            Track package-wise usage counts and open the patient list behind each package.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={openPrintDialog}
          disabled={hasInvalidDateRange || !hasAnySummaryRows}
        >
          <Printer className="mr-2 h-4 w-4" />
          Print
        </Button>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <CalendarDays className="h-5 w-5" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="flex flex-wrap items-end gap-4">
              <div className="min-w-[180px] space-y-2">
                <div className="text-sm font-medium text-gray-700">From Date</div>
                <EnhancedDatePicker
                  value={fromDate ? new Date(fromDate) : undefined}
                  onChange={(date) => setFromDate(date ? format(date, 'yyyy-MM-dd') : '')}
                  placeholder="From Date"
                />
              </div>
              <div className="min-w-[180px] space-y-2">
                <div className="text-sm font-medium text-gray-700">To Date</div>
                <EnhancedDatePicker
                  value={toDate ? new Date(toDate) : undefined}
                  onChange={(date) => setToDate(date ? format(date, 'yyyy-MM-dd') : '')}
                  placeholder="To Date"
                />
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  setFromDate(DEFAULT_DATE);
                  setToDate(DEFAULT_DATE);
                }}
              >
                Reset to Today
              </Button>
            </div>

            <div className="w-full">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search package, patient, patient no, or visit id"
                  className="pl-9"
                />
              </div>
            </div>
          </div>

          {hasInvalidDateRange && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              From Date cannot be later than To Date.
            </div>
          )}
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as IpdScheme)} className="space-y-4">
        <TabsList className="grid w-full max-w-sm grid-cols-2">
          <TabsTrigger value="PMJAY">PMJAY</TabsTrigger>
          <TabsTrigger value="MJPJAY">MJPJAY</TabsTrigger>
        </TabsList>

        {(['PMJAY', 'MJPJAY'] as const).map((scheme) => (
          <TabsContent key={scheme} value={scheme} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Card className="shadow-sm">
                <CardContent className="flex items-center gap-4 p-5">
                  <div className="rounded-full bg-primary/10 p-3 text-primary">
                    <Package2 className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Packages</div>
                    <div className="text-2xl font-bold text-gray-900">
                      {scheme === activeTab ? totalPackages : filteredData[scheme].length}
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card className="shadow-sm">
                <CardContent className="flex items-center gap-4 p-5">
                  <div className="rounded-full bg-emerald-100 p-3 text-emerald-700">
                    <Users className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Used Count</div>
                    <div className="text-2xl font-bold text-gray-900">
                      {scheme === activeTab
                        ? totalUses
                        : filteredData[scheme].reduce((sum, row) => sum + row.usedCount, 0)}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card className="shadow-sm">
              <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle>{scheme} Packages</CardTitle>
                <div className="text-sm text-muted-foreground">
                  {filteredData[scheme].length} packages · {filteredData[scheme].reduce((sum, row) => sum + row.usedCount, 0)} uses
                </div>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <colgroup>
                    <col className="w-[38%]" />
                    <col className="w-[18%]" />
                    <col className="w-[16%]" />
                    <col className="w-[12%]" />
                    <col className="w-[16%]" />
                  </colgroup>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Package Name</TableHead>
                      <TableHead>Package Code</TableHead>
                      <TableHead className="text-right">Package Cost</TableHead>
                      <TableHead className="text-right">Used Count</TableHead>
                      <TableHead className="w-[120px] text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading && (
                      <TableRow>
                        <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                          Loading package usage...
                        </TableCell>
                      </TableRow>
                    )}
                    {!isLoading && error && (
                      <TableRow>
                        <TableCell colSpan={5} className="py-10 text-center text-red-600">
                          {(error as Error).message || 'Unable to load package usage report.'}
                        </TableCell>
                      </TableRow>
                    )}
                    {!isLoading && !error && filteredData[scheme].length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                          No {scheme} package usage found for the selected date range.
                        </TableCell>
                      </TableRow>
                    )}
                    {!isLoading && !error && filteredData[scheme].map((row) => (
                      <TableRow key={`${row.scheme}-${row.packageName}`}>
                        <TableCell className="max-w-[420px] whitespace-normal font-medium text-gray-900">
                          {row.packageName}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-slate-700">{row.packageCode}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatCurrency(row.packageCost)}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.usedCount}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="outline" size="sm" onClick={() => setSelectedPackage(row)}>
                            <Eye className="mr-2 h-4 w-4" />
                            View Patients
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>

      <Dialog open={!!selectedPackage} onOpenChange={(open) => !open && setSelectedPackage(null)}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {selectedPackage?.scheme} Patients - {selectedPackage?.packageName}
            </DialogTitle>
          </DialogHeader>

          {selectedPackage && (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <Card className="shadow-sm">
                  <CardContent className="p-4">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Package Cost</div>
                    <div className="mt-1 text-lg font-semibold text-gray-900">
                      {formatCurrency(selectedPackage.packageCost)}
                    </div>
                  </CardContent>
                </Card>
                <Card className="shadow-sm">
                  <CardContent className="p-4">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Used Count</div>
                    <div className="mt-1 text-lg font-semibold text-gray-900">{selectedPackage.usedCount}</div>
                  </CardContent>
                </Card>
                <Card className="shadow-sm">
                  <CardContent className="p-4">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Date Range</div>
                    <div className="mt-1 text-sm font-medium text-gray-900">
                      {formatDateDisplay(fromDate)} to {formatDateDisplay(toDate)}
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div className="overflow-x-auto">
                <Table>
                  <colgroup>
                    <col className="w-[18%]" />
                    <col className="w-[12%]" />
                    <col className="w-[12%]" />
                    <col className="w-[14%]" />
                    <col className="w-[22%]" />
                    <col className="w-[10%]" />
                    <col className="w-[12%]" />
                  </colgroup>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Patient Name</TableHead>
                      <TableHead>Patient No</TableHead>
                      <TableHead>Visit ID</TableHead>
                      <TableHead>Package Code</TableHead>
                      <TableHead>Package Name</TableHead>
                      <TableHead>Scheme</TableHead>
                      <TableHead>Admission Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedPackage.patients.map((patient) => (
                      <TableRow key={patient.visitKey}>
                        <TableCell className="font-medium text-gray-900">{patient.patientName}</TableCell>
                        <TableCell>{patient.patientNo}</TableCell>
                        <TableCell>{patient.visitId}</TableCell>
                        <TableCell className="font-mono text-xs text-slate-700">{patient.packageCode}</TableCell>
                        <TableCell className="max-w-[320px] whitespace-normal">{patient.packageName}</TableCell>
                        <TableCell>{patient.scheme}</TableCell>
                        <TableCell>{formatDateDisplay(patient.admissionDate)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={isPrintDialogOpen} onOpenChange={setIsPrintDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Select Tables To Print</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-muted-foreground">
              All available tables are selected by default. Uncheck any table you do not want to print.
            </div>

            <label className="flex items-start gap-3 rounded-lg border p-3">
              <Checkbox
                checked={printSelections.pmjaySummary}
                onCheckedChange={(checked) =>
                  setPrintSelections((prev) => ({ ...prev, pmjaySummary: checked === true }))
                }
                disabled={filteredData.PMJAY.length === 0}
              />
              <div>
                <div className="font-medium text-gray-900">PMJAY Summary</div>
                <div className="text-sm text-muted-foreground">
                  {filteredData.PMJAY.length} package rows
                </div>
              </div>
            </label>

            <label className="flex items-start gap-3 rounded-lg border p-3">
              <Checkbox
                checked={printSelections.mjpjaySummary}
                onCheckedChange={(checked) =>
                  setPrintSelections((prev) => ({ ...prev, mjpjaySummary: checked === true }))
                }
                disabled={filteredData.MJPJAY.length === 0}
              />
              <div>
                <div className="font-medium text-gray-900">MJPJAY Summary</div>
                <div className="text-sm text-muted-foreground">
                  {filteredData.MJPJAY.length} package rows
                </div>
              </div>
            </label>

            <label className="flex items-start gap-3 rounded-lg border p-3">
              <Checkbox
                checked={printSelections.patientDetails}
                onCheckedChange={(checked) =>
                  setPrintSelections((prev) => ({ ...prev, patientDetails: checked === true }))
                }
                disabled={!hasPrintablePatients}
              />
              <div>
                <div className="font-medium text-gray-900">Selected Package Patients</div>
                <div className="text-sm text-muted-foreground">
                  {selectedPackage
                    ? `${selectedPackage.patients.length} patient rows from ${selectedPackage.packageName}`
                    : 'Open any package patient list to include it in print'}
                </div>
              </div>
            </label>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsPrintDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handlePrint} disabled={!hasAnyPrintSelection}>
              <Printer className="mr-2 h-4 w-4" />
              Print Selected
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
