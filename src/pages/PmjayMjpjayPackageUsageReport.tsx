import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Eye, FileSpreadsheet, Package2, Search, Users } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/utils/fetchAllRows';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EnhancedDatePicker } from '@/components/ui/enhanced-date-picker';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type IpdScheme = 'PMJAY' | 'MJPJAY';

type VisitUsageRow = {
  id: string;
  visit_id: string | null;
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
  packageName: string;
  scheme: IpdScheme;
  admissionDate: string | null;
  dischargeDate: string | null;
};

type PackageSummary = {
  scheme: IpdScheme;
  packageName: string;
  packageCost: number | null;
  usedCount: number;
  patients: PatientUsageDetail[];
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

export default function PmjayMjpjayPackageUsageReport() {
  const [activeTab, setActiveTab] = useState<IpdScheme>('PMJAY');
  const [fromDate, setFromDate] = useState(DEFAULT_DATE);
  const [toDate, setToDate] = useState(DEFAULT_DATE);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPackage, setSelectedPackage] = useState<PackageSummary | null>(null);

  const hasInvalidDateRange = Boolean(fromDate && toDate && fromDate > toDate);

  const { data, isLoading, error } = useQuery({
    queryKey: ['pmjay-mjpjay-package-usage-report', fromDate, toDate],
    enabled: !hasInvalidDateRange,
    queryFn: async () => {
      const [visits, masterPackages] = await Promise.all([
        fetchAllRows<VisitUsageRow>(() =>
          supabase
            .from('visits')
            .select('id, visit_id, package_name, admission_date, discharge_date, corporate, insurance_type, patients(name, patients_id, corporate)')
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

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
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
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <CalendarDays className="h-5 w-5" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-2">
                <div className="text-sm font-medium text-gray-700">From Date</div>
                <EnhancedDatePicker
                  value={fromDate ? new Date(fromDate) : undefined}
                  onChange={(date) => setFromDate(date ? format(date, 'yyyy-MM-dd') : '')}
                  placeholder="From Date"
                />
              </div>
              <div className="space-y-2">
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

            <div className="w-full max-w-md">
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
              <Card>
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
              <Card>
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

            <Card>
              <CardHeader>
                <CardTitle>{scheme} Packages</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Package Name</TableHead>
                      <TableHead>Package Cost</TableHead>
                      <TableHead>Used Count</TableHead>
                      <TableHead className="w-[120px] text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading && (
                      <TableRow>
                        <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                          Loading package usage...
                        </TableCell>
                      </TableRow>
                    )}
                    {!isLoading && error && (
                      <TableRow>
                        <TableCell colSpan={4} className="py-10 text-center text-red-600">
                          {(error as Error).message || 'Unable to load package usage report.'}
                        </TableCell>
                      </TableRow>
                    )}
                    {!isLoading && !error && filteredData[scheme].length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                          No {scheme} package usage found for the selected date range.
                        </TableCell>
                      </TableRow>
                    )}
                    {!isLoading && !error && filteredData[scheme].map((row) => (
                      <TableRow key={`${row.scheme}-${row.packageName}`}>
                        <TableCell className="max-w-[420px] whitespace-normal font-medium text-gray-900">
                          {row.packageName}
                        </TableCell>
                        <TableCell>{formatCurrency(row.packageCost)}</TableCell>
                        <TableCell>{row.usedCount}</TableCell>
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
                <Card>
                  <CardContent className="p-4">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Package Cost</div>
                    <div className="mt-1 text-lg font-semibold text-gray-900">
                      {formatCurrency(selectedPackage.packageCost)}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Used Count</div>
                    <div className="mt-1 text-lg font-semibold text-gray-900">{selectedPackage.usedCount}</div>
                  </CardContent>
                </Card>
                <Card>
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
                  <TableHeader>
                    <TableRow>
                      <TableHead>Patient Name</TableHead>
                      <TableHead>Patient No</TableHead>
                      <TableHead>Visit ID</TableHead>
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
    </div>
  );
}
