import { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useTileAccess } from '@/hooks/useTileAccess';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Printer, Search, ClipboardList, Download } from 'lucide-react';
import { OpdStatisticsCards } from '@/components/opd/OpdStatisticsCards';
import { OpdPatientTable } from '@/components/opd/OpdPatientTable';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { DateRange } from 'react-day-picker';
import { format } from 'date-fns';

const TodaysOpd = () => {
  const { hospitalConfig, user } = useAuth();
  const { canSeeTile } = useTileAccess();
  const [searchParams, setSearchParams] = useSearchParams();
  
  // Check if current user is a marketing manager or superadmin
  const isMarketingManager = user?.role === 'marketing_manager' || user?.role === 'superadmin';

  // State for referral report preview modal
  const [isReferralReportOpen, setIsReferralReportOpen] = useState(false);

  // State for unpaid referral report modal
  const [isUnpaidReportOpen, setIsUnpaidReportOpen] = useState(false);

  // State for DOA payments (individual payments with dates)
  const [doaPayments, setDoaPayments] = useState<Record<string, Array<{
    amount: number;
    payment_date: string;
    notes: string | null;
    referral_payment_status: string | null;
  }>>>({});

  // Net amount paid by the patient for each visit. This is deliberately kept
  // separate from DOA payments: the latter are payments made to a referrer,
  // not payments received from the patient.
  const [patientPaidTotals, setPatientPaidTotals] = useState<Record<string, number>>({});

  // URL-persisted state
  const searchTerm = searchParams.get('search') || '';
  const corporateFilter = searchParams.get('corporate') || '';
  const startDate = searchParams.get('startDate') || '';
  const endDate = searchParams.get('endDate') || '';

  // Helper to update URL params
  const updateParams = (updates: Record<string, string | null>) => {
    const newParams = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([key, value]) => {
      if (value === null || value === '') {
        newParams.delete(key);
      } else {
        newParams.set(key, value);
      }
    });
    setSearchParams(newParams, { replace: true });
  };

  // Setter functions
  const setSearchTerm = (value: string) => updateParams({ search: value });
  const setCorporateFilter = (value: string) => updateParams({ corporate: value });

  // Date range state
  const dateRange: DateRange | undefined = useMemo(() => {
    if (!startDate && !endDate) return undefined;
    return {
      from: startDate ? new Date(startDate) : undefined,
      to: endDate ? new Date(endDate) : undefined,
    };
  }, [startDate, endDate]);

  const handleDateRangeChange = (range: DateRange | undefined) => {
    updateParams({
      startDate: range?.from ? format(range.from, 'yyyy-MM-dd') : null,
      endDate: range?.to ? format(range.to, 'yyyy-MM-dd') : null,
    });
  };

  // Fetch corporates from corporate table
  const { data: corporates = [] } = useQuery({
    queryKey: ['corporates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('corporate')
        .select('id, name')
        .order('name', { ascending: true });

      if (error) {
        console.error('Error fetching corporates:', error);
        return [];
      }

      return data || [];
    }
  });

  // Fetch OPD patients
  const { data: opdPatients = [], isLoading, refetch } = useQuery({
    queryKey: ['opd-patients', hospitalConfig?.name, startDate, endDate],
    queryFn: async () => {

      // Build query with date filtering at database level
      let query = supabase
        .from('visits')
        .select(`
          *,
          patients!inner (
            id,
            name,
            gender,
            age,
            date_of_birth,
            patients_id,
            insurance_person_no,
            corporate,
            phone,
            address,
            city_town
          ),
          referees (
            id,
            name
          ),
          relationship_managers (
            id,
            name,
            code
          )
        `)
        .eq('patient_type', 'OPD')
        .order('created_at', { ascending: false });

      // Apply date filter at database level
      if (startDate) {
        query = query.gte('visit_date', startDate);
      }
      if (endDate) {
        query = query.lte('visit_date', endDate);
      }

      // If no date range, default to today
      if (!startDate && !endDate) {
        const today = new Date().toISOString().split('T')[0];
        query = query.eq('visit_date', today);
      }

      // Only apply hospital filter if hospitalConfig exists
      if (hospitalConfig?.name) {
        query = query.eq('patients.hospital_name', hospitalConfig.name);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching OPD patients:', error);
        throw error;
      }


      // Debug: Check comments in fetched data
      console.log('📊 Sample OPD patient data (first patient):', data?.[0]);
      console.log('💬 Comments in first patient:', data?.[0]?.comments);

      // Log all patients with comments
      const patientsWithComments = data?.filter(v => v.comments) || [];
      console.log(`📝 Found ${patientsWithComments.length} patients with comments out of ${data?.length || 0} total patients`);
      if (patientsWithComments.length > 0) {
        console.log('💭 Patients with comments:', patientsWithComments.map(v => ({
          id: v.id,
          visit_id: v.visit_id,
          patient_name: v.patients?.name,
          comments: v.comments
        })));
      }

      // If you want to filter by today only, uncomment this:
      // const today = new Date();
      // today.setHours(0, 0, 0, 0);
      // const todayPatients = data?.filter(patient => {
      //   const visitDate = new Date(patient.created_at || patient.visit_date);
      //   visitDate.setHours(0, 0, 0, 0);
      //   return visitDate.getTime() === today.getTime();
      // }) || [];
      // return todayPatients;

      return data || [];
    },
    refetchInterval: 60000,
    staleTime: 30000,
  });

  // Filter patients based on search term and corporate (date filtering is done at DB level)
  const filteredPatients = opdPatients.filter(patient => {
    const searchLower = searchTerm.toLowerCase();
    const matchesSearch = !searchTerm || (
      patient.patients?.name?.toLowerCase().includes(searchLower) ||
      patient.patients?.patients_id?.toLowerCase().includes(searchLower) ||
      patient.visit_id?.toLowerCase().includes(searchLower) ||
      patient.token_number?.toString().includes(searchLower)
    );

    const matchesCorporate = !corporateFilter ||
      patient.patients?.corporate?.trim().toLowerCase() === corporateFilter.trim().toLowerCase();

    return matchesSearch && matchesCorporate;
  });

  // Calculate statistics from filtered patients (to match displayed data)
  const statistics = {
    waiting: filteredPatients.filter(p => p.status === 'waiting').length,
    inProgress: filteredPatients.filter(p => p.status === 'in_progress').length,
    completed: filteredPatients.filter(p => p.status === 'completed').length,
    total: filteredPatients.length
  };

  // Fetch payment data for the referral report.
  useEffect(() => {
    const fetchReferralReportPayments = async () => {
      if (!opdPatients || opdPatients.length === 0) {
        setDoaPayments({});
        setPatientPaidTotals({});
        return;
      }

      const visitUuids = opdPatients.map((p: any) => p.id).filter(Boolean) as string[];
      const visitIds = opdPatients.map((p: any) => p.visit_id).filter(Boolean) as string[];
      if (visitUuids.length === 0 || visitIds.length === 0) {
        setDoaPayments({});
        setPatientPaidTotals({});
        return;
      }

      try {
        const [doaResult, advanceResult, finalResult] = await Promise.all([
          supabase
            .from('referee_doa_payments')
            .select('visit_id, amount, payment_date, notes, referral_payment_status')
            .in('visit_id', visitUuids)
            .order('payment_date', { ascending: false }),
          supabase
            .from('advance_payment')
            .select('visit_id, advance_amount, is_refund')
            .in('visit_id', visitIds)
            .eq('status', 'ACTIVE'),
          supabase
            .from('final_payments')
            .select('visit_id, amount')
            .in('visit_id', visitIds),
        ]);

        const { data: doaData, error: doaError } = doaResult;

        if (doaError) {
          console.error('Error fetching DOA payments:', doaError);
        } else if (doaData) {
          const doaByVisit: Record<string, Array<{
            amount: number;
            payment_date: string;
            notes: string | null;
            referral_payment_status: string | null;
          }>> = {};
          doaData.forEach((payment: any) => {
            if (payment.visit_id) {
              if (!doaByVisit[payment.visit_id]) {
                doaByVisit[payment.visit_id] = [];
              }
              doaByVisit[payment.visit_id].push({
                amount: Number(payment.amount),
                payment_date: payment.payment_date,
                notes: payment.notes,
                referral_payment_status: payment.referral_payment_status
              });
            }
          });
          setDoaPayments(doaByVisit);
        }

        if (advanceResult.error) {
          console.error('Error fetching advance payments for referral report:', advanceResult.error);
        }
        if (finalResult.error) {
          console.error('Error fetching final payments for referral report:', finalResult.error);
        }

        // An advance refund is stored as a separate advance_payment row. Deduct
        // it so the report shows the net amount actually retained for the visit.
        const paidTotals: Record<string, number> = {};
        (advanceResult.data || []).forEach((payment) => {
          if (!payment.visit_id) return;
          const amount = Number(payment.advance_amount) || 0;
          paidTotals[payment.visit_id] = (paidTotals[payment.visit_id] || 0) +
            (payment.is_refund ? -amount : amount);
        });
        (finalResult.data || []).forEach((payment) => {
          if (!payment.visit_id) return;
          paidTotals[payment.visit_id] = (paidTotals[payment.visit_id] || 0) +
            (Number(payment.amount) || 0);
        });
        setPatientPaidTotals(paidTotals);
      } catch (error) {
        console.error('Error fetching referral report payments:', error);
      }
    };

    fetchReferralReportPayments();
  }, [opdPatients]);

  const handlePrintList = () => {
    window.print();
  };

  const handleExportToExcel = () => {
    const excelData = filteredPatients.map(patient => ({
      'Name': patient.patients?.name || '',
      'Phone number': patient.patients?.phone || ''
    }));

    const ws = XLSX.utils.json_to_sheet(excelData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'OPD Patients');
    XLSX.writeFile(wb, `OPD_Patients_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  // Open Referral Report Preview Modal
  const handleOpenReferralReport = () => {
    setIsReferralReportOpen(true);
  };

  // Print Referral Report
  const handlePrintReferralReport = () => {
    const printContent = document.getElementById('opd-referral-report-content');
    if (printContent) {
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(`
          <html>
            <head>
              <title>Referral Amount Summary - ${format(new Date(), 'dd MMM yyyy')}</title>
              <style>
                body {
                  font-family: Arial, sans-serif;
                  padding: 20px;
                  font-size: 12px;
                  margin: 0;
                }
                h1 { text-align: center; margin-bottom: 5px; font-size: 18px; }
                .subtitle { text-align: center; color: #666; margin-bottom: 15px; font-size: 11px; }
                .header-info {
                  display: flex;
                  justify-content: space-between;
                  margin-bottom: 15px;
                  padding: 8px;
                  background: #f5f5f5;
                  font-size: 10px;
                }
                table { width: 100%; border-collapse: collapse; margin-top: 10px; }
                th, td { border: 1px solid #000; padding: 6px; text-align: left; font-size: 10px; }
                th { background-color: #f0f0f0; font-weight: bold; }
                tr:nth-child(even) { background-color: #f9f9f9; }
                .text-right { text-align: right; }
                @media print {
                  body { margin: 0; }
                  @page { margin: 0.5in; size: A4 landscape; }
                }
              </style>
            </head>
            <body>
              <h1>Referral Amount Summary</h1>
              <p class="subtitle">OPD Patients - Referral Details</p>
              <div class="header-info">
                <span><strong>Print Date:</strong> ${format(new Date(), 'dd MMM yyyy, hh:mm a')}</span>
                <span><strong>Total Records:</strong> ${referralReportPatients.length}</span>
              </div>
              ${printContent.innerHTML}
            </body>
          </html>
        `);
        printWindow.document.close();
        printWindow.print();
        printWindow.close();
      }
    }
  };

  // Filter for unpaid referral patients (excludes DIRECT referrals and patients with paid status)
  const unpaidReferralPatients = filteredPatients.filter(patient => {
    // Exclude DIRECT referrals
    const refereeName = patient.referees?.name?.toUpperCase();
    const rmName = patient.relationship_managers?.name?.toUpperCase();
    if (refereeName === 'DIRECT' || rmName === 'DIRECT') {
      return false;
    }

    // Check if any payment has "Spot paid" or "Backing paid" status
    const patientPayments = doaPayments[patient.id] || [];
    const hasPaidStatus = patientPayments.some(
      payment => payment.referral_payment_status === 'Spot paid' ||
                 payment.referral_payment_status === 'Backing paid'
    );
    if (hasPaidStatus) {
      return false;
    }

    // Original condition - only show truly unpaid patients
    return (!patient.referral_payment_status || patient.referral_payment_status === 'Unpaid') &&
           patientPayments.length === 0;
  });

  // Filter for referral report (excludes DIRECT referrals)
  const referralReportPatients = filteredPatients.filter(patient => {
    const refereeName = patient.referees?.name?.toUpperCase();
    const rmName = patient.relationship_managers?.name?.toUpperCase();
    // Exclude DIRECT referrals
    if (refereeName === 'DIRECT' || rmName === 'DIRECT') {
      return false;
    }
    return true;
  });

  const getRefereeDoaAmount = (patient: { visit_id?: string | null }) => {
    const totalPaid = patientPaidTotals[patient.visit_id || ''];
    return totalPaid === undefined ? undefined : totalPaid * 0.25;
  };

  // Open Unpaid Referral Report Modal
  const handleOpenUnpaidReport = () => {
    setIsUnpaidReportOpen(true);
  };

  // Print Unpaid Referral Report
  const handlePrintUnpaidReport = () => {
    const printContent = document.getElementById('opd-unpaid-report-content');
    if (printContent) {
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(`
          <html>
            <head>
              <title>Unpaid Referral Amount Summary - ${format(new Date(), 'dd MMM yyyy')}</title>
              <style>
                body {
                  font-family: Arial, sans-serif;
                  padding: 20px;
                  font-size: 12px;
                  margin: 0;
                }
                h1 { text-align: center; margin-bottom: 5px; font-size: 18px; }
                .subtitle { text-align: center; color: #666; margin-bottom: 15px; font-size: 11px; }
                .header-info {
                  display: flex;
                  justify-content: space-between;
                  margin-bottom: 15px;
                  padding: 8px;
                  background: #f5f5f5;
                  font-size: 10px;
                }
                table { width: 100%; border-collapse: collapse; margin-top: 10px; }
                th, td { border: 1px solid #000; padding: 6px; text-align: left; font-size: 10px; }
                th { background-color: #f0f0f0; font-weight: bold; }
                tr:nth-child(even) { background-color: #f9f9f9; }
                .text-right { text-align: right; }
                @media print {
                  body { margin: 0; }
                  @page { margin: 0.5in; size: A4 landscape; }
                }
              </style>
            </head>
            <body>
              <h1>Unpaid Referral Amount Summary</h1>
              <p class="subtitle">OPD Patients - Unpaid Referral Details</p>
              <div class="header-info">
                <span><strong>Print Date:</strong> ${format(new Date(), 'dd MMM yyyy, hh:mm a')}</span>
                <span><strong>Total Unpaid:</strong> ${unpaidReferralPatients.length}</span>
              </div>
              ${printContent.innerHTML}
            </body>
          </html>
        `);
        printWindow.document.close();
        printWindow.print();
        printWindow.close();
      }
    }
  };

  // Debug: Check if there are any visits in the database
  useEffect(() => {
    const checkVisits = async () => {
      const { data: allVisits, error } = await supabase
        .from('visits')
        .select('id, visit_id, patient_type, created_at')
        .limit(10);


      const { data: opdVisits, error: opdError } = await supabase
        .from('visits')
        .select('id, visit_id, patient_type')
        .eq('patient_type', 'OPD')
        .limit(5);

    };

    checkVisits();
  }, []);

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header - hidden in print */}
      <Card className="border-0 shadow-none print:hidden">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ClipboardList className="h-8 w-8" />
              <div>
                <CardTitle className="text-2xl font-bold">OPD PATIENT DASHBOARD</CardTitle>
                <p className="text-sm text-muted-foreground">Total OPD Patients: {statistics.total}</p>
                {/* Date display for print */}
                <p className="hidden print:block text-sm text-gray-700 mt-1">
                  Date: {startDate ? new Date(startDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : 'All'}
                  {endDate ? ` - ${new Date(endDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}` : ''}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 print:hidden">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                <Input
                  placeholder="Search patients..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-7 w-[200px] h-8 text-xs"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handlePrintList}
                className="flex items-center gap-1 text-xs h-8"
              >
                <Printer className="h-3 w-3" />
                Print List
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportToExcel}
                className="flex items-center gap-1 text-xs h-8"
              >
                <Download className="h-3 w-3" />
                Export XLS
              </Button>
              {/* Only show referral-related buttons for marketing managers */}
              {isMarketingManager && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleOpenReferralReport}
                    className="flex items-center gap-1 text-xs h-8"
                  >
                    <Download className="h-3 w-3" />
                    Referral Report
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleOpenUnpaidReport}
                    className="flex items-center gap-1 text-xs h-8 text-red-600 border-red-300 hover:bg-red-50"
                  >
                    <Download className="h-3 w-3" />
                    Unpaid Referral
                  </Button>
                </>
              )}
              <DateRangePicker
                date={dateRange}
                onDateChange={handleDateRangeChange}
              />
              <select
                value={corporateFilter}
                onChange={(e) => setCorporateFilter(e.target.value)}
                className="h-8 text-xs border border-gray-300 rounded-md px-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Corporates</option>
                {corporates.map((corporate) => (
                  <option key={corporate.id} value={corporate.name}>
                    {corporate.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Statistics Cards */}
      <div className="print:hidden">
        <OpdStatisticsCards statistics={statistics} canSeeTile={canSeeTile} />
      </div>

      {/* Patients Table */}
      <Card>
        <CardHeader>
          <CardTitle>OPD PATIENTS</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center items-center h-32">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : (
            <OpdPatientTable patients={filteredPatients} refetch={refetch} isMarketingManager={isMarketingManager} />
          )}
        </CardContent>
      </Card>

      {/* Referral Report Preview Modal */}
      <Dialog open={isReferralReportOpen} onOpenChange={setIsReferralReportOpen}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>OPD Referral Report Preview</DialogTitle>
          </DialogHeader>

          <div id="opd-referral-report-content">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date of Admission</TableHead>
                  <TableHead>Visit ID</TableHead>
                  <TableHead>Patient Name</TableHead>
                  <TableHead>Referral Doctor/Relationship Manager</TableHead>
                  <TableHead>Referee DOA Amt (25%)</TableHead>
                  <TableHead>Total Amount Paid</TableHead>
                  <TableHead>Payment Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {referralReportPatients.map((patient) => (
                  <TableRow key={patient.id}>
                    <TableCell>{patient.visit_date || '-'}</TableCell>
                    <TableCell>{patient.visit_id || '-'}</TableCell>
                    <TableCell>{patient.patients?.name || '-'}</TableCell>
                    <TableCell>
                      <div>{patient.referees?.name || '-'}</div>
                      {patient.relationship_managers?.code && (
                        <div>{patient.relationship_managers.code}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      {getRefereeDoaAmount(patient) !== undefined
                        ? `₹${getRefereeDoaAmount(patient)!.toLocaleString()}`
                        : '-'}
                    </TableCell>
                    <TableCell>
                      {patientPaidTotals[patient.visit_id || ''] !== undefined
                        ? `₹${patientPaidTotals[patient.visit_id || ''].toLocaleString()}`
                        : '-'}
                    </TableCell>
                    <TableCell>{doaPayments[patient.id]?.[0]?.referral_payment_status || '-'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex justify-between items-center pt-4 border-t">
            <span className="text-sm text-muted-foreground">
              Total: {referralReportPatients.length} records
            </span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setIsReferralReportOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handlePrintReferralReport} className="bg-blue-600 hover:bg-blue-700">
                <Printer className="mr-2 h-4 w-4" />
                Print Report
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Unpaid Referral Report Modal */}
      <Dialog open={isUnpaidReportOpen} onOpenChange={setIsUnpaidReportOpen}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-red-600">Unpaid Referral Amount Summary</DialogTitle>
          </DialogHeader>

          <div id="opd-unpaid-report-content">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date of Admission</TableHead>
                  <TableHead>Visit ID</TableHead>
                  <TableHead>Patient Name</TableHead>
                  <TableHead>Referral Doctor/Relationship Manager</TableHead>
                  <TableHead>Referee DOA Amt (25%)</TableHead>
                  <TableHead>Total Amount Paid</TableHead>
                  <TableHead>Payment Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {unpaidReferralPatients.map((patient) => (
                  <TableRow key={patient.id}>
                    <TableCell>{patient.visit_date || '-'}</TableCell>
                    <TableCell>{patient.visit_id || '-'}</TableCell>
                    <TableCell>{patient.patients?.name || '-'}</TableCell>
                    <TableCell>
                      <div>{patient.referees?.name || '-'}</div>
                      {patient.relationship_managers?.code && (
                        <div>{patient.relationship_managers.code}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      {getRefereeDoaAmount(patient) !== undefined
                        ? `₹${getRefereeDoaAmount(patient)!.toLocaleString()}`
                        : '-'}
                    </TableCell>
                    <TableCell>
                      {patientPaidTotals[patient.visit_id || ''] !== undefined
                        ? `₹${patientPaidTotals[patient.visit_id || ''].toLocaleString()}`
                        : '-'}
                    </TableCell>
                    <TableCell className="text-red-600 font-medium">{doaPayments[patient.id]?.[0]?.referral_payment_status || '-'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex justify-between items-center pt-4 border-t">
            <span className="text-sm text-muted-foreground">
              Total Unpaid: {unpaidReferralPatients.length} records
            </span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setIsUnpaidReportOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handlePrintUnpaidReport} className="bg-red-600 hover:bg-red-700">
                <Printer className="mr-2 h-4 w-4" />
                Print Report
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TodaysOpd;
