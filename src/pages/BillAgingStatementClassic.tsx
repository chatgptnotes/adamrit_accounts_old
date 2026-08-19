import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import * as XLSX from 'xlsx';
import {
  ArrowLeft,
  FileSpreadsheet,
  Printer,
  Search,
  Filter,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  RefreshCw,
  Calendar,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useBillAgingReport } from '@/hooks/useBillAgingReport';
import { BillAgingRecord, BillAgingStatus } from '@/types/billAging';
import { AgingBucket } from '@/types/accounting';
import '@/styles/print.css';
import { knownSchemeShortName } from '@/lib/schemeShortName';

const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

const formatDate = (dateString: string | null): string => {
  if (!dateString) return '-';
  try {
    return format(new Date(dateString), 'dd/MM/yyyy');
  } catch {
    return '-';
  }
};

// Status badge colors
const getStatusBadgeClass = (status: BillAgingStatus): string => {
  switch (status) {
    case 'Pending':
      return 'bg-yellow-100 text-yellow-800 border-yellow-300';
    case 'Received':
      return 'bg-green-100 text-green-800 border-green-300';
    case 'Partial':
      return 'bg-orange-100 text-orange-800 border-orange-300';
    case 'Overdue':
      return 'bg-red-100 text-red-800 border-red-300';
    default:
      return 'bg-gray-100 text-gray-800 border-gray-300';
  }
};

// Aging bucket badge colors
const getAgingBucketBadgeClass = (bucket: AgingBucket): string => {
  switch (bucket) {
    case '0-30':
      return 'bg-green-100 text-green-800 border-green-300';
    case '31-60':
      return 'bg-blue-100 text-blue-800 border-blue-300';
    case '61-90':
      return 'bg-yellow-100 text-yellow-800 border-yellow-300';
    case '91-180':
      return 'bg-orange-100 text-orange-800 border-orange-300';
    case '181-365':
      return 'bg-red-100 text-red-800 border-red-300';
    case '365+':
      return 'bg-purple-100 text-purple-800 border-purple-300';
    default:
      return 'bg-gray-100 text-gray-800 border-gray-300';
  }
};

// Aging bucket order (most days first)
const AGING_BUCKET_ORDER: AgingBucket[] = ['365+', '181-365', '91-180', '61-90', '31-60', '0-30'];

// Corporate short name mapping for print format
const getCorporateShortName = (fullName: string): string => {
  return knownSchemeShortName(fullName) || fullName;
};

// Heading row colors based on aging severity
const getHeadingRowClass = (bucket: AgingBucket): string => {
  switch (bucket) {
    case '365+':
    case '181-365':
      return 'bg-red-100 hover:bg-red-100 border-t-2 border-red-300';
    case '91-180':
    case '61-90':
      return 'bg-orange-100 hover:bg-orange-100 border-t-2 border-orange-300';
    case '31-60':
      return 'bg-yellow-100 hover:bg-yellow-100 border-t-2 border-yellow-300';
    case '0-30':
      return 'bg-blue-100 hover:bg-blue-100 border-t-2 border-blue-300';
    default:
      return 'bg-gray-100';
  }
};

// Print heading row colors
const getPrintHeadingRowClass = (bucket: AgingBucket): string => {
  switch (bucket) {
    case '365+':
    case '181-365':
      return 'bg-red-200';
    case '91-180':
    case '61-90':
      return 'bg-orange-200';
    case '31-60':
      return 'bg-yellow-200';
    case '0-30':
      return 'bg-blue-200';
    default:
      return 'bg-gray-200';
  }
};

const BillAgingStatementClassic: React.FC = () => {
  const navigate = useNavigate();
  const { hospitalConfig } = useAuth();

  const {
    data,
    isLoading,
    filters,
    setFilters,
    sortConfig,
    handleSort,
    resetFilters,
    summary,
    corporates,
    hospitals,
    refetch,
  } = useBillAgingReport(hospitalConfig?.name);

  // URL-persisted pagination state
  const [searchParams, setSearchParams] = useSearchParams();
  const currentPage = parseInt(searchParams.get('page') || '1');
  const itemsPerPage = parseInt(searchParams.get('perPage') || '10');

  // Helper to update URL params
  const updateParams = (updates: Record<string, string | null>) => {
    const newParams = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([key, value]) => {
      if (value === null || value === '' || (key === 'page' && value === '1') || (key === 'perPage' && value === '10')) {
        newParams.delete(key);
      } else {
        newParams.set(key, value);
      }
    });
    setSearchParams(newParams, { replace: true });
  };

  const setCurrentPage = (value: number) => updateParams({ page: value.toString() });
  const setItemsPerPage = (value: number) => updateParams({ perPage: value.toString(), page: '1' });

  // Pagination calculations
  const totalPages = Math.ceil(data.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedData = data.slice(startIndex, endIndex);

  // Group data by aging bucket
  const groupedData = useMemo(() => {
    const grouped: Record<AgingBucket, BillAgingRecord[]> = {
      '365+': [],
      '181-365': [],
      '91-180': [],
      '61-90': [],
      '31-60': [],
      '0-30': [],
    };

    data.forEach(record => {
      grouped[record.aging_bucket].push(record);
    });

    return grouped;
  }, [data]);

  // Pagination navigation functions
  const goToFirstPage = () => setCurrentPage(1);
  const goToLastPage = () => setCurrentPage(totalPages);
  const goToPreviousPage = () => setCurrentPage(Math.max(1, currentPage - 1));
  const goToNextPage = () => setCurrentPage(Math.min(totalPages, currentPage + 1));

  const getPageNumbers = () => {
    const pages: number[] = [];
    const maxVisiblePages = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
    const endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
    if (endPage - startPage < maxVisiblePages - 1) {
      startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }
    for (let i = startPage; i <= endPage; i++) {
      pages.push(i);
    }
    return pages;
  };

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [filters]);

  // Export to Excel
  const handleExportExcel = () => {
    const exportData = data.map((record, index) => ({
      'Sr. No.': index + 1,
      'Bill No.': record.bill_no || '-',
      'Visit ID': record.visit_id,
      'Claim ID': record.claim_id || '-',
      'Patient Name': record.patient_name,
      'Corporate/TPA': record.corporate || '-',
      'Hospital': record.hospital_name || '-',
      'Bill Amount': record.bill_amount,
      'Received Amount': record.received_amount,
      'Deduction': record.deduction_amount,
      'TDS': record.tds_amount,
      'Outstanding': record.outstanding_amount,
      'Submission Date': formatDate(record.date_of_submission),
      'Received Date': formatDate(record.received_date),
      'Days': record.days_outstanding,
      'Aging Bucket': record.aging_bucket,
      'Status': record.status,
    }));

    // Add summary row
    exportData.push({
      'Sr. No.': '' as any,
      'Bill No.': '',
      'Visit ID': 'TOTAL',
      'Claim ID': '',
      'Patient Name': `${summary.total_bills} Bills`,
      'Corporate/TPA': '',
      'Hospital': '',
      'Bill Amount': summary.total_bill_amount,
      'Received Amount': summary.total_received_amount,
      'Deduction': 0,
      'TDS': 0,
      'Outstanding': summary.total_outstanding_amount,
      'Submission Date': '',
      'Received Date': '',
      'Days': summary.average_days_to_payment as any,
      'Aging Bucket': 'Avg Days' as any,
      'Status': '' as any,
    });

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Bill Aging Statement');
    XLSX.writeFile(wb, `Bill_Aging_Statement_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  // Print report
  const handlePrint = () => {
    window.print();
  };

  // Render sort icon
  const renderSortIcon = (column: keyof BillAgingRecord) => {
    if (sortConfig.column !== column) {
      return <ChevronUp className="h-4 w-4 opacity-30" />;
    }
    return sortConfig.direction === 'asc' ? (
      <ChevronUp className="h-4 w-4" />
    ) : (
      <ChevronDown className="h-4 w-4" />
    );
  };

  return (
    <div className="container mx-auto p-4 space-y-4 print:p-0">
      {/* Header - hide on print */}
      <div className="flex items-center justify-between print:hidden">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Corporate Bill Aging Statement</h1>
            <p className="text-muted-foreground text-sm">
              Track bills from submission to payment receipt
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate('/bill-aging-statement')}>
            Tally View
          </Button>
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button variant="outline" onClick={handleExportExcel}>
            <FileSpreadsheet className="h-4 w-4 mr-2" />
            Export Excel
          </Button>
          <Button variant="outline" onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-2" />
            Print
          </Button>
          <Button variant="outline" onClick={() => navigate('/expected-payment-date-report')}>
            <Calendar className="h-4 w-4 mr-2" />
            Expected Date Report
          </Button>
        </div>
      </div>

      {/* Print Header - show only on print */}
      <div className="hidden print:block text-center mb-4">
        <h1 className="text-xl font-bold">{hospitalConfig?.name || 'Hospital'}</h1>
        <h2 className="text-lg">Corporate Bill Aging Statement</h2>
        <p className="text-sm">Generated on: {format(new Date(), 'dd/MM/yyyy HH:mm')}</p>
      </div>

      {/* Filters - hide on print */}
      <Card className="print:hidden">
        <CardHeader className="py-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Filter className="h-4 w-4" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            {/* Hospital Filter */}
            <div>
              <label className="text-xs text-muted-foreground">Hospital</label>
              <Select
                value={filters.hospital}
                onValueChange={(value) => setFilters({ ...filters, hospital: value })}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="All Hospitals" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Hospitals</SelectItem>
                  {hospitals.map((h) => (
                    <SelectItem key={h} value={h}>
                      {h}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Corporate Filter */}
            <div>
              <label className="text-xs text-muted-foreground">Corporate/TPA</label>
              <Select
                value={filters.corporate}
                onValueChange={(value) => setFilters({ ...filters, corporate: value })}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="All Corporates" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Corporates</SelectItem>
                  {corporates.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Status Filter */}
            <div>
              <label className="text-xs text-muted-foreground">Status</label>
              <Select
                value={filters.status}
                onValueChange={(value) => setFilters({ ...filters, status: value })}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="All Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="Pending">Pending</SelectItem>
                  <SelectItem value="Received">Received</SelectItem>
                  <SelectItem value="Partial">Partial</SelectItem>
                  <SelectItem value="Overdue">Overdue</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Aging Bucket Filter */}
            <div>
              <label className="text-xs text-muted-foreground">Aging Bucket</label>
              <Select
                value={filters.agingBucket}
                onValueChange={(value) => setFilters({ ...filters, agingBucket: value })}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="All Buckets" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Buckets</SelectItem>
                  <SelectItem value="0-30">0-30 Days</SelectItem>
                  <SelectItem value="31-60">31-60 Days</SelectItem>
                  <SelectItem value="61-90">61-90 Days</SelectItem>
                  <SelectItem value="91-180">91-180 Days</SelectItem>
                  <SelectItem value="181-365">181-365 Days</SelectItem>
                  <SelectItem value="365+">365+ Days</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Date From */}
            <div>
              <label className="text-xs text-muted-foreground">From Date</label>
              <Input
                type="date"
                className="h-9"
                value={filters.dateFrom}
                onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
              />
            </div>

            {/* Date To */}
            <div>
              <label className="text-xs text-muted-foreground">To Date</label>
              <Input
                type="date"
                className="h-9"
                value={filters.dateTo}
                onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })}
              />
            </div>

            {/* Search */}
            <div>
              <label className="text-xs text-muted-foreground">Search</label>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Visit ID, Claim ID, Patient..."
                  className="h-9 pl-8"
                  value={filters.searchTerm}
                  onChange={(e) => setFilters({ ...filters, searchTerm: e.target.value })}
                />
              </div>
            </div>
          </div>

          <div className="mt-3 flex justify-end">
            <Button variant="outline" size="sm" onClick={resetFilters}>
              Clear Filters
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 no-print">
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">Total Bills</div>
            <div className="text-xl font-bold">{summary.total_bills}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">Pending</div>
            <div className="text-xl font-bold text-yellow-600">{summary.total_pending}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">Received</div>
            <div className="text-xl font-bold text-green-600">{summary.total_received}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">Overdue</div>
            <div className="text-xl font-bold text-red-600">{summary.total_overdue}</div>
          </CardContent>
        </Card>
        <Card className="bg-blue-50">
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">Total Outstanding</div>
            <div className="text-xl font-bold text-blue-600">
              {formatCurrency(summary.total_outstanding_amount)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Aging Bucket Summary */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2 no-print">
        {summary.buckets.map((bucket) => (
          <Card
            key={bucket.bucket}
            className={`cursor-pointer transition-all ${
              filters.agingBucket === bucket.bucket ? 'ring-2 ring-primary' : ''
            }`}
            onClick={() =>
              setFilters({
                ...filters,
                agingBucket: filters.agingBucket === bucket.bucket ? 'all' : bucket.bucket,
              })
            }
          >
            <CardContent className="p-2 text-center">
              <Badge className={getAgingBucketBadgeClass(bucket.bucket)} variant="outline">
                {bucket.bucket} days
              </Badge>
              <div className="text-lg font-semibold mt-1">{bucket.count}</div>
              <div className="text-xs text-muted-foreground">
                {formatCurrency(bucket.total_outstanding_amount)}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Data Table - Screen only (paginated) */}
      <Card className="print:hidden no-print">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="w-12 text-center">Sr.</TableHead>
                    <TableHead
                      className="cursor-pointer hover:bg-muted"
                      onClick={() => handleSort('bill_no')}
                    >
                      <div className="flex items-center gap-1">
                        Bill No. {renderSortIcon('bill_no')}
                      </div>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer hover:bg-muted"
                      onClick={() => handleSort('visit_id')}
                    >
                      <div className="flex items-center gap-1">
                        Visit ID {renderSortIcon('visit_id')}
                      </div>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer hover:bg-muted"
                      onClick={() => handleSort('claim_id')}
                    >
                      <div className="flex items-center gap-1">
                        Claim ID {renderSortIcon('claim_id')}
                      </div>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer hover:bg-muted"
                      onClick={() => handleSort('patient_name')}
                    >
                      <div className="flex items-center gap-1">
                        Patient Name {renderSortIcon('patient_name')}
                      </div>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer hover:bg-muted"
                      onClick={() => handleSort('corporate')}
                    >
                      <div className="flex items-center gap-1">
                        Corporate {renderSortIcon('corporate')}
                      </div>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer hover:bg-muted text-right"
                      onClick={() => handleSort('bill_amount')}
                    >
                      <div className="flex items-center justify-end gap-1">
                        Bill Amt {renderSortIcon('bill_amount')}
                      </div>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer hover:bg-muted text-right"
                      onClick={() => handleSort('received_amount')}
                    >
                      <div className="flex items-center justify-end gap-1">
                        Received {renderSortIcon('received_amount')}
                      </div>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer hover:bg-muted text-right"
                      onClick={() => handleSort('deduction_amount')}
                    >
                      <div className="flex items-center justify-end gap-1">
                        Deduction {renderSortIcon('deduction_amount')}
                      </div>
                    </TableHead>
                    <TableHead className="text-right">TDS</TableHead>
                    <TableHead
                      className="cursor-pointer hover:bg-muted text-right"
                      onClick={() => handleSort('outstanding_amount')}
                    >
                      <div className="flex items-center justify-end gap-1">
                        Outstanding {renderSortIcon('outstanding_amount')}
                      </div>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer hover:bg-muted"
                      onClick={() => handleSort('date_of_submission')}
                    >
                      <div className="flex items-center gap-1">
                        Submit Date {renderSortIcon('date_of_submission')}
                      </div>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer hover:bg-muted"
                      onClick={() => handleSort('expected_payment_date')}
                    >
                      <div className="flex items-center gap-1">
                        Exp. Payment {renderSortIcon('expected_payment_date')}
                      </div>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer hover:bg-muted"
                      onClick={() => handleSort('received_date')}
                    >
                      <div className="flex items-center gap-1">
                        Recv Date {renderSortIcon('received_date')}
                      </div>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer hover:bg-muted text-center"
                      onClick={() => handleSort('days_outstanding')}
                    >
                      <div className="flex items-center justify-center gap-1">
                        Days {renderSortIcon('days_outstanding')}
                      </div>
                    </TableHead>
                    <TableHead className="text-center">Aging</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={16} className="text-center py-8 text-muted-foreground">
                        No records found
                      </TableCell>
                    </TableRow>
                  ) : (
                    (() => {
                      let serialNo = 0;
                      return AGING_BUCKET_ORDER.map((bucket) => {
                        const bucketRecords = groupedData[bucket];
                        if (bucketRecords.length === 0) return null;

                        return (
                          <React.Fragment key={bucket}>
                            {/* Bucket Heading Row */}
                            <TableRow className={getHeadingRowClass(bucket)}>
                              <TableCell colSpan={16} className="py-3">
                                <div className="flex items-center gap-2">
                                  <Badge
                                    className={`${getAgingBucketBadgeClass(bucket)} text-sm px-3 py-1`}
                                    variant="outline"
                                  >
                                    {bucket} Days
                                  </Badge>
                                  <span className="font-semibold text-gray-700">
                                    ({bucketRecords.length} {bucketRecords.length === 1 ? 'patient' : 'patients'})
                                  </span>
                                </div>
                              </TableCell>
                            </TableRow>
                            {/* Patient Rows for this bucket */}
                            {bucketRecords.map((record) => {
                              serialNo++;
                              return (
                                <TableRow key={record.id} className="hover:bg-muted/30">
                                  <TableCell className="text-center text-muted-foreground">
                                    {serialNo}
                                  </TableCell>
                                  <TableCell className="font-medium text-blue-700">{record.bill_no || '-'}</TableCell>
                                  <TableCell className="font-medium">{record.visit_id}</TableCell>
                                  <TableCell className="font-medium">{record.claim_id || '-'}</TableCell>
                                  <TableCell>{record.patient_name}</TableCell>
                                  <TableCell>{record.corporate || '-'}</TableCell>
                                  <TableCell className="text-right">
                                    {formatCurrency(record.bill_amount)}
                                  </TableCell>
                                  <TableCell className="text-right text-green-600">
                                    {formatCurrency(record.received_amount)}
                                  </TableCell>
                                  <TableCell className="text-right text-orange-600">
                                    {formatCurrency(record.deduction_amount)}
                                  </TableCell>
                                  <TableCell className="text-right text-purple-600">
                                    {formatCurrency(record.tds_amount)}
                                  </TableCell>
                                  <TableCell className="text-right font-medium text-blue-600">
                                    {formatCurrency(record.outstanding_amount)}
                                  </TableCell>
                                  <TableCell>{formatDate(record.date_of_submission)}</TableCell>
                                  <TableCell>{formatDate(record.expected_payment_date)}</TableCell>
                                  <TableCell>{formatDate(record.received_date)}</TableCell>
                                  <TableCell className="text-center">{record.days_outstanding}</TableCell>
                                  <TableCell className="text-center">
                                    <Badge
                                      className={getAgingBucketBadgeClass(record.aging_bucket)}
                                      variant="outline"
                                    >
                                      {record.aging_bucket}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="text-center">
                                    <Badge className={getStatusBadgeClass(record.status)} variant="outline">
                                      {record.status}
                                    </Badge>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </React.Fragment>
                        );
                      });
                    })()
                  )}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Pagination Controls */}
          {data.length > 0 && (
            <div className="flex items-center justify-between p-4 border-t">
              <div className="flex items-center gap-4 text-sm text-gray-600">
                <span>
                  Showing {startIndex + 1} to {Math.min(endIndex, data.length)} of {data.length} records
                  {totalPages > 1 && <span className="ml-2">| Page {currentPage} of {totalPages}</span>}
                </span>
                <div className="flex items-center gap-2">
                  <span>Items per page:</span>
                  <Select
                    value={itemsPerPage.toString()}
                    onValueChange={(val) => {
                      setItemsPerPage(Number(val));
                      setCurrentPage(1);
                    }}
                  >
                    <SelectTrigger className="w-20 h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="10">10</SelectItem>
                      <SelectItem value="20">20</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                      <SelectItem value="100">100</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="sm" onClick={goToFirstPage} disabled={currentPage === 1}>
                    <ChevronsLeft className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="sm" onClick={goToPreviousPage} disabled={currentPage === 1}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  {getPageNumbers().map((pageNum) => (
                    <Button
                      key={pageNum}
                      variant={currentPage === pageNum ? "default" : "outline"}
                      size="sm"
                      onClick={() => setCurrentPage(pageNum)}
                    >
                      {pageNum}
                    </Button>
                  ))}
                  <Button variant="outline" size="sm" onClick={goToNextPage} disabled={currentPage === totalPages}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="sm" onClick={goToLastPage} disabled={currentPage === totalPages}>
                    <ChevronsRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Print Table - Shows ALL records (hidden on screen, visible on print) */}
      <div className="hidden print:block">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-12 text-center">Sr.</TableHead>
              <TableHead>Bill No.</TableHead>
              <TableHead>Visit ID</TableHead>
              <TableHead>Claim ID</TableHead>
              <TableHead>Patient Name</TableHead>
              <TableHead>Corporate</TableHead>
              <TableHead className="text-right">Bill Amt</TableHead>
              <TableHead>Submit Date</TableHead>
              <TableHead className="text-center">Days</TableHead>
              <TableHead className="text-center">Aging</TableHead>
              <TableHead className="text-center">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(() => {
              let serialNo = 0;
              return AGING_BUCKET_ORDER.map((bucket) => {
                const bucketRecords = groupedData[bucket];
                if (bucketRecords.length === 0) return null;

                return (
                  <React.Fragment key={bucket}>
                    {/* Bucket Heading Row */}
                    <TableRow className={getPrintHeadingRowClass(bucket)}>
                      <TableCell colSpan={11} className="py-2 font-bold">
                        {bucket} Days ({bucketRecords.length} {bucketRecords.length === 1 ? 'patient' : 'patients'})
                      </TableCell>
                    </TableRow>
                    {/* Patient Rows */}
                    {bucketRecords.map((record) => {
                      serialNo++;
                      return (
                        <TableRow key={record.id}>
                          <TableCell className="text-center">{serialNo}</TableCell>
                          <TableCell className="font-medium text-blue-700">{record.bill_no || '-'}</TableCell>
                          <TableCell className="font-medium">{record.visit_id}</TableCell>
                          <TableCell className="font-medium">{record.claim_id || '-'}</TableCell>
                          <TableCell>{record.patient_name}</TableCell>
                          <TableCell>{getCorporateShortName(record.corporate || '-')}</TableCell>
                          <TableCell className="text-right">{formatCurrency(record.bill_amount)}</TableCell>
                          <TableCell>{formatDate(record.date_of_submission)}</TableCell>
                          <TableCell className="text-center">{record.days_outstanding}</TableCell>
                          <TableCell className="text-center">{record.aging_bucket}</TableCell>
                          <TableCell className="text-center">{record.status}</TableCell>
                        </TableRow>
                      );
                    })}
                  </React.Fragment>
                );
              });
            })()}
          </TableBody>
        </Table>
      </div>

      {/* Footer Summary - for print */}
      <div className="hidden print:block mt-4 text-sm">
        <div className="flex justify-between border-t pt-2">
          <span>Total Bills: {summary.total_bills}</span>
          <span>Total Bill Amount: {formatCurrency(summary.total_bill_amount)}</span>
        </div>
      </div>
    </div>
  );
};

export default BillAgingStatementClassic;
