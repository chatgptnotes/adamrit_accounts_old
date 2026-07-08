import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Receipt, Pencil, Trash2, Search, User, Loader2, Download, Filter, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { IntimationCell } from '@/components/bill-workflow/IntimationCell';
import BillSubmissionForm, { BillSubmission, PatientData } from '@/components/BillSubmissionForm';
import {
  useBillSubmissions,
  useCreateBillSubmission,
  useUpdateBillSubmission,
  useDeleteBillSubmission,
} from '@/hooks/useBillSubmissions';
import * as XLSX from 'xlsx';
import { BillWorkflowBoard } from '@/components/bill-workflow/BillWorkflowBoard';
import type { BillStatus } from '@/components/bill-workflow/types';
import { formatDateOnly, formatDateOnlyForDisplay, parseDateOnly } from '@/utils/dateOnly';
import { KanbanSquare } from 'lucide-react';

const BillSubmissionPage: React.FC = () => {
  const { hospitalConfig } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();

  // URL-persisted state
  const searchTerm = searchParams.get('search') || '';
  const corporateFilter = searchParams.get('corporate') || 'all';
  const dateFrom = searchParams.get('from') || '';
  const dateTo = searchParams.get('to') || '';
  const currentPage = parseInt(searchParams.get('page') || '1');
  const itemsPerPage = 10;

  // Helper to update URL params
  const updateParams = (updates: Record<string, string | null>) => {
    const newParams = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([key, value]) => {
      if (value === null || value === '' || (key === 'corporate' && value === 'all') || (key === 'page' && value === '1')) {
        newParams.delete(key);
      } else {
        newParams.set(key, value);
      }
    });
    setSearchParams(newParams, { replace: true });
  };

  // Setter functions
  const setSearchTerm = (value: string) => updateParams({ search: value, page: '1' });
  const setCorporateFilter = (value: string) => updateParams({ corporate: value, page: '1' });
  const setDateFrom = (value: string) => updateParams({ from: value, page: '1' });
  const setDateTo = (value: string) => updateParams({ to: value, page: '1' });
  const setCurrentPage = (value: number) => updateParams({ page: value.toString() });

  // Non-persisted state
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'table' | 'board'>('board');
  const [editData, setEditData] = useState<BillSubmission | null>(null);
  const [selectedPatient, setSelectedPatient] = useState<PatientData | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  // Patient lookup search state
  const [patientLookupTerm, setPatientLookupTerm] = useState('');
  const [selectedPatientForLookup, setSelectedPatientForLookup] = useState<any>(null);
  const [showPatientLookupDropdown, setShowPatientLookupDropdown] = useState(false);
  const patientLookupRef = useRef<HTMLDivElement>(null);

  // Fetch bill submissions from Supabase, filtered by hospital
  const { data: submissions = [], isLoading } = useBillSubmissions(hospitalConfig?.name);

  // Get unique corporate values for filter dropdown
  const uniqueCorporates = useMemo(() => {
    const corporates = submissions
      .map((s: any) => s.patient_corporate)
      .filter((c: string) => c && c.trim() !== '');
    return [...new Set(corporates)].sort();
  }, [submissions]);

  // Filter submissions based on filters
  const filteredSubmissions = useMemo(() => {
    return submissions.filter((submission: any) => {
      // Corporate filter
      if (corporateFilter !== 'all' && submission.patient_corporate !== corporateFilter) {
        return false;
      }

      // Date filter - filters by "Expect to Receive Payment" date
      if (dateFrom && submission.expected_payment_date) {
        if (submission.expected_payment_date < dateFrom) {
          return false;
        }
      }
      if (dateTo && submission.expected_payment_date) {
        if (submission.expected_payment_date > dateTo) {
          return false;
        }
      }

      return true;
    });
  }, [submissions, corporateFilter, dateFrom, dateTo]);

  // Pagination calculations
  const totalPages = Math.ceil(filteredSubmissions.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedSubmissions = filteredSubmissions.slice(startIndex, endIndex);

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
  }, [corporateFilter, dateFrom, dateTo]);

  // Export to Excel function
  const handleExportExcel = () => {
    const exportData = filteredSubmissions.map((s: any) => ({
      'Bill No.': s.bill_no || '-',
      'Visit ID': s.visit_id,
      'Patient Name': s.patient_name,
      'Corporate': s.patient_corporate || '-',
      'Date of Admission': s.admission_date || '-',
      'Intimation Date': s.intimation_date || '-',
      'Date of Discharge': s.discharge_date || '-',
      'Bill Amount': s.bill_amount || 0,
      'Submitted By': s.executive_who_submitted || '-',
      'Submission Date': s.date_of_submission || '-',
      'Expected Payment Date': s.expected_payment_date || '-',
      'Received Amount': s.received_amount || 0,
      'Deduction Amount': s.deduction_amount || 0,
      'TDS Amount': s.tds_amount || 0,
      'Amount Received On': s.received_date || '-',
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Intimation + Bill Submissions');
    XLSX.writeFile(wb, `Bill_Submissions_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  // Export Received Amount report
  const handleExportReceivedAmount = () => {
    const exportData = filteredSubmissions.map((s: any) => ({
      'Visit ID': s.visit_id,
      'Name': s.patient_name,
      'Corporate': s.patient_corporate || '-',
      'Bill Amount': s.bill_amount || 0,
      'Received Amount': s.received_amount || 0,
      'Deduction Amount': s.deduction_amount || 0,
      'TDS Amount': s.tds_amount || 0,
      'Received Amount On Date': s.received_date || '-',
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Received Amount Report');
    XLSX.writeFile(wb, `Received_Amount_Report_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  // Clear all filters
  const handleClearFilters = () => {
    setCorporateFilter('all');
    setDateFrom('');
    setDateTo('');
  };
  const createMutation = useCreateBillSubmission();
  const updateMutation = useUpdateBillSubmission();
  const deleteMutation = useDeleteBillSubmission();

  // Search visits from database with patient info, filtered by hospital
  const { data: visits = [], isLoading: isSearching } = useQuery({
    queryKey: ['visits-search', searchTerm, hospitalConfig?.name],
    queryFn: async () => {
      let query = supabase
        .from('visits')
        .select(`
          id,
          visit_id,
          patients!inner(
            id,
            name,
            corporate,
            hospital_name
          )
        `)
        .ilike('patients.name', `%${searchTerm}%`);

      // Filter by hospital if provided
      if (hospitalConfig?.name) {
        query = query.eq('patients.hospital_name', hospitalConfig.name);
      }

      const { data, error } = await query.limit(10);

      if (error) throw error;
      return data || [];
    },
    enabled: searchTerm.length >= 2,
  });

  // Patient lookup search query
  const { data: patientLookupResults = [], isLoading: isPatientLookupSearching } = useQuery({
    queryKey: ['patient-lookup-search', patientLookupTerm, hospitalConfig?.name],
    queryFn: async () => {
      let query = supabase
        .from('visits')
        .select(`
          id,
          visit_id,
          admission_date,
          discharge_date,
          patients!inner(
            id,
            name,
            corporate,
            hospital_name
          )
        `)
        .ilike('patients.name', `%${patientLookupTerm}%`);

      if (hospitalConfig?.name) {
        query = query.eq('patients.hospital_name', hospitalConfig.name);
      }

      const { data, error } = await query.limit(10);
      if (error) throw error;
      return data || [];
    },
    enabled: patientLookupTerm.length >= 2,
  });

  // Fetch bill details for selected patient
  const { data: patientBillDetails = [], isLoading: isBillLoading } = useQuery({
    queryKey: ['patient-bill-details', selectedPatientForLookup?.visit_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bill_preparation' as any)
        .select('*')
        .eq('visit_id', selectedPatientForLookup?.visit_id);

      if (error) throw error;
      return data || [];
    },
    enabled: !!selectedPatientForLookup?.visit_id,
  });

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
      if (patientLookupRef.current && !patientLookupRef.current.contains(event.target as Node)) {
        setShowPatientLookupDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleQuickAdd = (status: BillStatus) => {
    const searchInput = document.querySelector<HTMLInputElement>('input[placeholder="Search patient by name to add bill submission..."]');
    if (searchInput) {
      searchInput.focus();
      searchInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const handlePatientSelect = async (visit: any) => {
    setShowDropdown(false);
    setSearchTerm('');

    // Check if a bill_preparation record already exists for this visit
    const { data: existing } = await supabase
      .from('bill_preparation' as any)
      .select('*')
      .eq('visit_id', visit.visit_id)
      .maybeSingle();

    if (existing) {
      // Load existing record as edit data so we don't overwrite saved dates
      setSelectedPatient(null);
      setEditData({
        id: existing.id,
        visitId: existing.visit_id || '',
        patientName: visit.patients?.name || '',
        corporate: existing.corporate || visit.patients?.corporate || '',
        billAmount: Number(existing.bill_amount) || 0,
        submittedBy: existing.executive_who_submitted || '',
        submissionDate: existing.date_of_submission || '',
        intimationDate: existing.intimation_date || '',
        expectedPaymentDate: existing.expected_payment_date || '',
        receivedAmount: Number(existing.received_amount) || 0,
        deductionAmount: Number(existing.deduction_amount) || 0,
        tdsAmount: Number(existing.tds_amount) || 0,
        receivedDate: existing.received_date || '',
      });
    } else {
      // No existing record — open fresh form
      setEditData(null);
      setSelectedPatient({
        visitId: visit.visit_id || '',
        patientName: visit.patients?.name || '',
        corporate: visit.patients?.corporate || '',
      });
    }
    setIsFormOpen(true);
  };

  // Handle patient lookup selection
  const handlePatientLookupSelect = (visit: any) => {
    setSelectedPatientForLookup({
      visit_id: visit.visit_id,
      patient_name: visit.patients?.name || '',
      corporate: visit.patients?.corporate || '',
      admission_date: visit.admission_date || '',
      discharge_date: visit.discharge_date || '',
    });
    setShowPatientLookupDropdown(false);
    setPatientLookupTerm('');
  };

  // Clear patient lookup
  const handleClearPatientLookup = () => {
    setSelectedPatientForLookup(null);
    setPatientLookupTerm('');
  };

  const handleEdit = (submission: any) => {
    setSelectedPatient(null);
    // Map database fields to form fields
    setEditData({
      id: submission.id,
      visitId: submission.visit_id || '',
      patientName: submission.patient_name || '',
      corporate: submission.corporate || submission.patient_corporate || '',
      billAmount: Number(submission.bill_amount) || 0,
      submittedBy: submission.executive_who_submitted || '',
      submissionDate: submission.date_of_submission || '',
      intimationDate: submission.intimation_date || '',
      expectedPaymentDate: submission.expected_payment_date || '',
      receivedAmount: Number(submission.received_amount) || 0,
      deductionAmount: Number(submission.deduction_amount) || 0,
      tdsAmount: Number(submission.tds_amount) || 0,
      receivedDate: submission.received_date || '',
    });
    setIsFormOpen(true);
  };

  const handleDelete = (id: string) => {
    if (confirm('Are you sure you want to delete this record?')) {
      deleteMutation.mutate(id);
    }
  };

  const handleSave = (data: BillSubmission) => {
    // Map form fields to database fields (patient_name comes via join, not stored)
    const dbData = {
      visit_id: data.visitId,
      corporate: data.corporate,
      bill_amount: data.billAmount,
      executive_who_submitted: data.submittedBy,
      date_of_submission: data.submissionDate,
      intimation_date: data.intimationDate || undefined,
      expected_payment_date: data.expectedPaymentDate,
      received_amount: data.receivedAmount,
      deduction_amount: data.deductionAmount,
      tds_amount: data.tdsAmount,
      received_date: data.receivedDate,
    };

    if (editData) {
      updateMutation.mutate({ id: data.id, ...dbData });
    } else {
      createMutation.mutate(dbData);
    }
    setSelectedPatient(null);
  };

  const handleFormClose = () => {
    setIsFormOpen(false);
    setSelectedPatient(null);
    setEditData(null);
  };

  const formatDate = (dateString: string) => {
    return formatDateOnlyForDisplay(dateString, 'dd/MM/yyyy');
  };

  const handleIntimationDateChange = async (id: string, d: Date | undefined) => {
    const iso = d ? formatDateOnly(d) : null;
    const { error } = await (supabase as any)
      .from('bill_preparation')
      .update({ intimation_date: iso })
      .eq('id', id);
    if (error) {
      toast.error(`Failed to save intimation date: ${error.message}`);
      return;
    }
    queryClient.invalidateQueries({ queryKey: ['bill-submissions'] });
    toast.success('Intimation date updated.');
  };

  const formatAmount = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(amount || 0);
  };

  return (
    <div className={viewMode === 'board' ? 'h-full flex flex-col' : 'p-6'}>
      <div className={`flex items-center gap-3 ${viewMode === 'board' ? 'mb-2 flex-shrink-0 px-2' : 'mb-6'}`}>
        <Receipt className="h-8 w-8 text-primary" />
        <h1 className="text-2xl font-bold">Intimation + Bill Submissions</h1>
      </div>

      <Card className={viewMode === 'board' ? 'flex-1 min-h-0 flex flex-col border-0 shadow-none' : ''}>
        {viewMode === 'table' && (
          <CardHeader>
            <CardTitle>Intimation + Bill Submissions</CardTitle>
          </CardHeader>
        )}
        <CardContent className={viewMode === 'board' ? 'pt-2 flex-1 min-h-0 flex flex-col' : ''}>
          {/* Patient Search */}
          <div className="relative mb-4" ref={searchRef}>
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search patient by name to add bill submission..."
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setShowDropdown(e.target.value.length >= 2);
                }}
                onFocus={() => searchTerm.length >= 2 && setShowDropdown(true)}
                className="max-w-md"
              />
            </div>

            {/* Search Results Dropdown */}
            {showDropdown && (
              <div className="absolute z-50 mt-1 w-full max-w-md bg-white border rounded-md shadow-lg">
                {isSearching ? (
                  <div className="p-3 text-center text-gray-500">Searching...</div>
                ) : visits.length === 0 ? (
                  <div className="p-3 text-center text-gray-500">No visits found</div>
                ) : (
                  <ul className="max-h-60 overflow-auto">
                    {visits.map((visit) => (
                      <li
                        key={visit.id}
                        className="px-4 py-3 hover:bg-gray-100 cursor-pointer border-b last:border-b-0"
                        onClick={() => handlePatientSelect(visit)}
                      >
                        <div className="flex items-center gap-3">
                          <User className="h-5 w-5 text-gray-400" />
                          <div>
                            <div className="font-medium">{visit.patients?.name}</div>
                            <div className="text-sm text-gray-500">
                              Visit ID: {visit.visit_id || 'N/A'} | Corporate: {visit.patients?.corporate || 'N/A'}
                            </div>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* Filters Section */}
          <div className="flex flex-wrap items-end gap-4 mb-4 p-4 bg-gray-50 rounded-lg">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-gray-500" />
              <span className="text-sm font-medium text-gray-700">Filters:</span>
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-gray-500">Corporate</Label>
              <Select value={corporateFilter} onValueChange={setCorporateFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="All Corporates" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Corporates</SelectItem>
                  {uniqueCorporates.map((corporate: string) => (
                    <SelectItem key={corporate} value={corporate}>
                      {corporate}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-gray-500">From Date</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-[150px]"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-gray-500">To Date</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-[150px]"
              />
            </div>

            <Button variant="outline" size="sm" onClick={handleClearFilters}>
              Clear Filters
            </Button>

            {/* Patient Lookup Search */}
            <div className="relative ml-4" ref={patientLookupRef}>
              <div className="space-y-1">
                <Label className="text-xs text-gray-500">Patient Lookup</Label>
                <div className="flex items-center gap-2">
                  <Search className="h-4 w-4 text-gray-400" />
                  <Input
                    placeholder="Search patient..."
                    value={patientLookupTerm}
                    onChange={(e) => {
                      setPatientLookupTerm(e.target.value);
                      setShowPatientLookupDropdown(e.target.value.length >= 2);
                    }}
                    onFocus={() => patientLookupTerm.length >= 2 && setShowPatientLookupDropdown(true)}
                    className="w-[200px]"
                  />
                </div>
              </div>

              {/* Patient Lookup Dropdown */}
              {showPatientLookupDropdown && (
                <div className="absolute z-50 mt-1 w-full bg-white border rounded-md shadow-lg">
                  {isPatientLookupSearching ? (
                    <div className="p-3 text-center text-gray-500">Searching...</div>
                  ) : patientLookupResults.length === 0 ? (
                    <div className="p-3 text-center text-gray-500">No patients found</div>
                  ) : (
                    <ul className="max-h-60 overflow-auto">
                      {patientLookupResults.map((visit: any) => (
                        <li
                          key={visit.id}
                          className="px-4 py-3 hover:bg-gray-100 cursor-pointer border-b last:border-b-0"
                          onClick={() => handlePatientLookupSelect(visit)}
                        >
                          <div className="flex items-center gap-3">
                            <User className="h-5 w-5 text-gray-400" />
                            <div>
                              <div className="font-medium">{visit.patients?.name}</div>
                              <div className="text-sm text-gray-500">
                                Visit ID: {visit.visit_id || 'N/A'} | {visit.patients?.corporate || 'N/A'}
                              </div>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            <div className="ml-auto flex gap-2">
              <Button
                variant={viewMode === 'board' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setViewMode(viewMode === 'board' ? 'table' : 'board')}
              >
                <KanbanSquare className="h-4 w-4 mr-1" />
                {viewMode === 'board' ? 'Table' : 'Board'}
              </Button>
              <Button onClick={handleExportReceivedAmount} className="bg-blue-600 hover:bg-blue-700">
                <Download className="h-4 w-4 mr-2" />
                Received Amount
              </Button>
              <Button onClick={handleExportExcel} className="bg-green-600 hover:bg-green-700">
                <Download className="h-4 w-4 mr-2" />
                Export to Excel
              </Button>
            </div>
          </div>

          {/* Patient Lookup Details Card */}
          {selectedPatientForLookup && (
            <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-4">
                  <User className="h-6 w-6 text-blue-600" />
                  <div>
                    <h3 className="font-semibold text-lg">{selectedPatientForLookup.patient_name}</h3>
                    <p className="text-sm text-gray-600">
                      Visit ID: {selectedPatientForLookup.visit_id} | Corporate: {selectedPatientForLookup.corporate || 'N/A'}
                    </p>
                    <p className="text-sm text-gray-600">
                      Admission: {formatDate(selectedPatientForLookup.admission_date)} | Discharge: {formatDate(selectedPatientForLookup.discharge_date)}
                    </p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={handleClearPatientLookup}>
                  <X className="h-4 w-4" />
                </Button>
              </div>

              {/* Bill Details */}
              <div className="mt-3">
                <h4 className="text-sm font-medium text-gray-700 mb-2">Billing Information:</h4>
                {isBillLoading ? (
                  <div className="text-center py-2">
                    <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                  </div>
                ) : patientBillDetails.length === 0 ? (
                  <p className="text-sm text-gray-500">No billing records found for this patient.</p>
                ) : (
                  <div className="space-y-3">
                    {patientBillDetails.map((bill: any) => (
                      <div key={bill.id} className="bg-white rounded border p-3">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                          <div>
                            <span className="text-gray-500 text-xs">Bill Amount</span>
                            <p className="font-medium">{formatAmount(bill.bill_amount)}</p>
                          </div>
                          <div>
                            <span className="text-gray-500 text-xs">Intimation Date</span>
                            <div className="mt-0.5">
                              <IntimationCell
                                value={bill.intimation_date ? parseDateOnly(bill.intimation_date) : undefined}
                                onChange={(d) => handleIntimationDateChange(bill.id, d)}
                              />
                            </div>
                          </div>
                          <div>
                            <span className="text-gray-500 text-xs">Submitted By</span>
                            <p className="font-medium">{bill.executive_who_submitted || '-'}</p>
                          </div>
                          <div>
                            <span className="text-gray-500 text-xs">Submission Date</span>
                            <p className="font-medium">{formatDate(bill.date_of_submission)}</p>
                          </div>
                          <div>
                            <span className="text-gray-500 text-xs">Expected Payment</span>
                            <p className="font-medium">{formatDate(bill.expected_payment_date)}</p>
                          </div>
                          <div>
                            <span className="text-gray-500 text-xs">Received Amount</span>
                            <p className="font-medium">{formatAmount(bill.received_amount)}</p>
                          </div>
                          <div>
                            <span className="text-gray-500 text-xs">Deduction</span>
                            <p className="font-medium">{formatAmount(bill.deduction_amount)}</p>
                          </div>
                          <div>
                            <span className="text-gray-500 text-xs">TDS</span>
                            <p className="font-medium">{formatAmount(bill.tds_amount)}</p>
                          </div>
                          <div>
                            <span className="text-gray-500 text-xs">Received On</span>
                            <p className="font-medium">{formatDate(bill.received_date)}</p>
                          </div>
                          <div className="flex items-end">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleEdit({
                                ...bill,
                                patient_name: selectedPatientForLookup.patient_name,
                                corporate: selectedPatientForLookup.corporate,
                              })}
                              title="Edit"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {viewMode === 'table' ? (
            <>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Bill No.</TableHead>
                      <TableHead>Visit ID</TableHead>
                      <TableHead>Patient Name</TableHead>
                      <TableHead>Corporate</TableHead>
                      <TableHead>Date of Admission</TableHead>
                      <TableHead>Intimation Date</TableHead>
                      <TableHead>Date of Discharge</TableHead>
                      <TableHead className="text-right">Bill Amount</TableHead>
                      <TableHead className="text-right">Yojna / Corporate Bill</TableHead>
                      <TableHead>Submitted By</TableHead>
                      <TableHead>Submission Date</TableHead>
                      <TableHead>Expect to Receive Payment</TableHead>
                      <TableHead className="text-right">Received Amount</TableHead>
                      <TableHead className="text-right">Deduction Amount</TableHead>
                      <TableHead className="text-right">TDS</TableHead>
                      <TableHead>Amount Received On</TableHead>
                      <TableHead className="text-center">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      <TableRow>
                        <TableCell colSpan={17} className="text-center py-8">
                          <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                        </TableCell>
                      </TableRow>
                    ) : filteredSubmissions.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={17} className="text-center py-8 text-gray-500">
                          {submissions.length === 0
                            ? 'No bill submissions yet. Search for a patient above to create one.'
                            : 'No records match the selected filters.'}
                        </TableCell>
                      </TableRow>
                    ) : (
                      paginatedSubmissions.map((submission: any) => (
                        <TableRow key={submission.id}>
                          <TableCell className="font-medium text-blue-600">{submission.bill_no || '-'}</TableCell>
                          <TableCell className="font-medium">{submission.visit_id}</TableCell>
                          <TableCell>{submission.patient_name}</TableCell>
                          <TableCell>{submission.patient_corporate || '-'}</TableCell>
                          <TableCell>{formatDate(submission.admission_date)}</TableCell>
                          <TableCell>
                            <IntimationCell
                              value={submission.intimation_date ? parseDateOnly(submission.intimation_date) : undefined}
                              onChange={(d) => handleIntimationDateChange(submission.id, d)}
                            />
                          </TableCell>
                          <TableCell>{formatDate(submission.discharge_date)}</TableCell>
                          <TableCell className="text-right">{formatAmount(submission.bill_amount)}</TableCell>
                          <TableCell className="text-right">
                            <Link
                              to={submission.bill_link}
                              className={submission.bill_total != null
                                ? 'text-blue-600 hover:underline font-medium'
                                : 'text-gray-400 hover:underline'}
                            >
                              {submission.bill_total != null ? formatAmount(submission.bill_total) : '-'}
                            </Link>
                          </TableCell>
                          <TableCell>{submission.executive_who_submitted || '-'}</TableCell>
                          <TableCell>{formatDate(submission.date_of_submission)}</TableCell>
                          <TableCell>{formatDate(submission.expected_payment_date)}</TableCell>
                          <TableCell className="text-right">{formatAmount(submission.received_amount)}</TableCell>
                          <TableCell className="text-right">{formatAmount(submission.deduction_amount)}</TableCell>
                          <TableCell className="text-right">{formatAmount(submission.tds_amount)}</TableCell>
                          <TableCell>{formatDate(submission.received_date)}</TableCell>
                          <TableCell>
                            <div className="flex justify-center gap-2">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleEdit(submission)}
                                title="Edit"
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              {filteredSubmissions.length > 0 && (
                <div className="flex items-center justify-between mt-4">
                  <div className="text-sm text-gray-600">
                    Showing {startIndex + 1} to {Math.min(endIndex, filteredSubmissions.length)} of {filteredSubmissions.length} records
                    {totalPages > 1 && <span className="ml-2">| Page {currentPage} of {totalPages}</span>}
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
            </>
          ) : (
            <BillWorkflowBoard
              submissions={filteredSubmissions}
              isLoading={isLoading}
              onEdit={handleEdit}
              onQuickAdd={handleQuickAdd}
            />
          )}
        </CardContent>
      </Card>

      <BillSubmissionForm
        open={isFormOpen}
        onClose={handleFormClose}
        onSave={handleSave}
        editData={editData}
        prefilledPatient={selectedPatient}
      />
    </div>
  );
};

export default BillSubmissionPage;
