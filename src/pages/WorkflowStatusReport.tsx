import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import * as XLSX from 'xlsx';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ArrowLeft, ArrowUpDown, Download, Search } from 'lucide-react';
import { WORKFLOW_REPORTS, WORKFLOW_STATUS_LABELS } from '@/lib/workflowStatus';

type SortKey = 'name' | 'patients_id' | 'visit_id' | 'status' | 'updated_at' | 'admission_date';

interface ReportRow {
  id: string;
  visit_id: string | null;
  workflow_status: string | null;
  workflow_status_updated_at: string | null;
  admission_date: string | null;
  discharge_date: string | null;
  patients: {
    name: string | null;
    patients_id: string | null;
    age: string | null;
    gender: string | null;
    corporate: string | null;
  } | null;
  diagnoses: { name: string | null } | null;
}

const WorkflowStatusReport = () => {
  const { reportKey } = useParams<{ reportKey: string }>();
  const navigate = useNavigate();
  const { hospitalConfig } = useAuth();

  const report = WORKFLOW_REPORTS.find((r) => r.key === reportKey);

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('updated_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['workflow-status-report', reportKey, hospitalConfig?.name],
    enabled: Boolean(report),
    queryFn: async () => {
      const data = await fetchAllRows((from, to) => {
        let query = supabase
          .from('visits')
          .select(`
          id,
          visit_id,
          workflow_status,
          workflow_status_updated_at,
          admission_date,
          discharge_date,
          patients!inner (
            name,
            patients_id,
            age,
            gender,
            corporate,
            hospital_name
          ),
          diagnoses!diagnosis_id (
            name
          )
        `)
          .in('workflow_status', report!.statuses);

        if (hospitalConfig?.name) {
          query = query.eq('patients.hospital_name', hospitalConfig.name);
        }

        return query.order('id').range(from, to);
      });
      return (data || []) as unknown as ReportRow[];
    },
  });

  const filteredRows = useMemo(() => {
    let result = rows;

    if (searchTerm.trim()) {
      const term = searchTerm.trim().toLowerCase();
      result = result.filter(
        (r) =>
          r.patients?.name?.toLowerCase().includes(term) ||
          r.patients?.patients_id?.toLowerCase().includes(term) ||
          r.visit_id?.toLowerCase().includes(term),
      );
    }

    if (statusFilter !== 'all') {
      result = result.filter((r) => r.workflow_status === statusFilter);
    }

    if (dateFrom) {
      result = result.filter(
        (r) => r.workflow_status_updated_at && r.workflow_status_updated_at >= dateFrom,
      );
    }
    if (dateTo) {
      // include the whole "to" day
      const toEnd = `${dateTo}T23:59:59`;
      result = result.filter(
        (r) => r.workflow_status_updated_at && r.workflow_status_updated_at <= toEnd,
      );
    }

    const getValue = (r: ReportRow): string => {
      switch (sortKey) {
        case 'name':
          return r.patients?.name || '';
        case 'patients_id':
          return r.patients?.patients_id || '';
        case 'visit_id':
          return r.visit_id || '';
        case 'status':
          return r.workflow_status || '';
        case 'admission_date':
          return r.admission_date || '';
        case 'updated_at':
        default:
          return r.workflow_status_updated_at || '';
      }
    };

    return [...result].sort((a, b) => {
      const cmp = getValue(a).localeCompare(getValue(b));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [rows, searchTerm, statusFilter, dateFrom, dateTo, sortKey, sortDir]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    rows.forEach((r) => {
      if (r.workflow_status) {
        counts[r.workflow_status] = (counts[r.workflow_status] || 0) + 1;
      }
    });
    return counts;
  }, [rows]);

  if (!report) {
    return (
      <div className="p-6">
        <p className="text-gray-500">Unknown report.</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate('/')}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Dashboard
        </Button>
      </div>
    );
  }

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const handleExport = () => {
    const exportData = filteredRows.map((r, i) => ({
      'Sr. No.': i + 1,
      'Patient Name': r.patients?.name || '',
      'Patient ID': r.patients?.patients_id || '',
      'Visit ID': r.visit_id || '',
      'Age': r.patients?.age || '',
      'Sex': r.patients?.gender || '',
      'Corporate': r.patients?.corporate || '',
      'Diagnosis': r.diagnoses?.name || '',
      'Admission Date': r.admission_date ? format(new Date(r.admission_date), 'dd/MM/yyyy') : '',
      'Status': WORKFLOW_STATUS_LABELS[r.workflow_status || ''] || r.workflow_status || '',
      'Last Updated': r.workflow_status_updated_at
        ? format(new Date(r.workflow_status_updated_at), 'dd/MM/yyyy HH:mm')
        : '',
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, report.title);
    XLSX.writeFile(wb, `${report.key}-report-${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
  };

  const sortableHead = (label: string, key: SortKey) => (
    <TableHead>
      <button
        type="button"
        className="flex items-center gap-1 font-medium hover:text-primary"
        onClick={() => handleSort(key)}
      >
        {label}
        <ArrowUpDown className="h-3 w-3" />
      </button>
    </TableHead>
  );

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => navigate('/')}>
              <ArrowLeft className="mr-1 h-4 w-4" /> Back
            </Button>
            <h1 className="text-2xl font-bold">{report.title}</h1>
          </div>
          <Button variant="outline" size="sm" onClick={handleExport} disabled={filteredRows.length === 0}>
            <Download className="mr-1 h-4 w-4" /> Export Excel
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">Total Patients</div>
              <div className="text-2xl font-bold">{rows.length}</div>
            </CardContent>
          </Card>
          {report.statuses.map((status) => (
            <Card key={status}>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground">{WORKFLOW_STATUS_LABELS[status]}</div>
                <div className="text-2xl font-bold">{statusCounts[status] || 0}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-white p-3">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search name / patient ID / visit ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-9 w-64 pl-8"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-9 w-48">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {report.statuses.map((status) => (
                <SelectItem key={status} value={status}>
                  {WORKFLOW_STATUS_LABELS[status]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1 text-sm text-gray-600">
            <span>Updated from</span>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-9 w-36"
            />
            <span>to</span>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-9 w-36"
            />
          </div>
          {(searchTerm || statusFilter !== 'all' || dateFrom || dateTo) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearchTerm('');
                setStatusFilter('all');
                setDateFrom('');
                setDateTo('');
              }}
            >
              Clear
            </Button>
          )}
          <span className="ml-auto text-sm text-gray-500">
            {filteredRows.length} of {rows.length} records
          </span>
        </div>

        <div className="rounded-lg border bg-white shadow-sm">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14">Sr. No.</TableHead>
                  {sortableHead('Patient Name', 'name')}
                  {sortableHead('Patient ID', 'patients_id')}
                  {sortableHead('Visit ID', 'visit_id')}
                  <TableHead>Age / Sex</TableHead>
                  <TableHead>Corporate</TableHead>
                  <TableHead>Diagnosis</TableHead>
                  {sortableHead('Admission Date', 'admission_date')}
                  {sortableHead('Status', 'status')}
                  {sortableHead('Last Updated', 'updated_at')}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={10} className="py-8 text-center">
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : filteredRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="py-8 text-center text-gray-500">
                      No patients found. Set the Status dropdown on the Advance Statement Report to
                      populate this report.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredRows.map((r, index) => {
                    const isPending = (r.workflow_status || '').endsWith('_pending');
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="text-center">{index + 1}</TableCell>
                        <TableCell className="font-medium">{r.patients?.name || 'N/A'}</TableCell>
                        <TableCell>{r.patients?.patients_id || 'N/A'}</TableCell>
                        <TableCell>{r.visit_id || 'N/A'}</TableCell>
                        <TableCell>
                          {r.patients?.age || '-'} / {r.patients?.gender || '-'}
                        </TableCell>
                        <TableCell>{r.patients?.corporate || '-'}</TableCell>
                        <TableCell>{r.diagnoses?.name || '-'}</TableCell>
                        <TableCell>
                          {r.admission_date ? format(new Date(r.admission_date), 'dd/MM/yyyy') : '-'}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={
                              isPending
                                ? 'border-amber-300 bg-amber-50 text-amber-700'
                                : 'border-emerald-300 bg-emerald-50 text-emerald-700'
                            }
                          >
                            {WORKFLOW_STATUS_LABELS[r.workflow_status || ''] || r.workflow_status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {r.workflow_status_updated_at
                            ? format(new Date(r.workflow_status_updated_at), 'dd/MM/yyyy HH:mm')
                            : '-'}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WorkflowStatusReport;
