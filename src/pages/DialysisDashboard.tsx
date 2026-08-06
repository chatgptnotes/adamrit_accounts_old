import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useTileAccess } from '@/hooks/useTileAccess';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Printer, Search, ClipboardList, Download, UserPlus, IndianRupee } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { patientKey, fetchBilledCycles, markCyclesBilled, CYCLES_PER_BILL, type DialysisTrackerRow } from '@/lib/nephroplus/dialysisTracker';
import { OpdStatisticsCards } from '@/components/opd/OpdStatisticsCards';
import { OpdPatientTable } from '@/components/opd/OpdPatientTable';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { DateRange } from 'react-day-picker';
import { format } from 'date-fns';
import { VisitRegistrationForm } from '@/components/VisitRegistrationForm';
import { PatientLookup } from '@/components/PatientLookup';

const DialysisDashboard = () => {
  const { hospitalConfig, user } = useAuth();
  const { canSeeTile } = useTileAccess();
  const [searchParams, setSearchParams] = useSearchParams();

  const isMarketingManager = user?.role === 'marketing_manager' || user?.role === 'superadmin' || user?.role === 'ca';

  // Patient selected for a new dialysis visit (from roster or lookup)
  const [selectedPatient, setSelectedPatient] = useState<{ id: string; name: string; patients_id?: string } | null>(null);
  const [isPatientLookupOpen, setIsPatientLookupOpen] = useState(false);
  const [isBillDueOpen, setIsBillDueOpen] = useState(false);
  const [markingKey, setMarkingKey] = useState<string | null>(null);
  const { toast } = useToast();

  // URL-persisted state
  const searchTerm = searchParams.get('search') || '';
  const startDate = searchParams.get('startDate') || '';
  const endDate = searchParams.get('endDate') || '';

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

  const setSearchTerm = (value: string) => updateParams({ search: value });

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

  // Fetch Dialysis patients
  const { data: dialysisPatients = [], isLoading, refetch } = useQuery({
    queryKey: ['dialysis-patients', hospitalConfig?.name, startDate, endDate],
    queryFn: async () => {
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
          relationship_managers!visits_relationship_manager_id_fkey (
            id,
            name,
            code
          )
        `)
        .eq('patient_type', 'Dialysis')
        .order('created_at', { ascending: false });

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

      if (hospitalConfig?.name) {
        query = query.eq('patients.hospital_name', hospitalConfig.name);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching dialysis patients:', error);
        throw error;
      }

      return data || [];
    },
    refetchInterval: 60000,
    staleTime: 30000,
  });

  // Roster of every patient who has ever had a dialysis visit
  const { data: rosterVisits = [], isLoading: isRosterLoading, refetch: refetchRoster } = useQuery({
    queryKey: ['dialysis-patient-roster', hospitalConfig?.name],
    queryFn: async () => {
      let query = supabase
        .from('visits')
        .select(`
          patient_id,
          visit_date,
          patients!inner (
            id,
            name,
            patients_id,
            gender,
            age,
            phone,
            corporate,
            hospital_name
          )
        `)
        .eq('patient_type', 'Dialysis')
        .order('visit_date', { ascending: false });

      if (hospitalConfig?.name) {
        query = query.eq('patients.hospital_name', hospitalConfig.name);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching dialysis patient roster:', error);
        throw error;
      }

      return data || [];
    },
    refetchInterval: 60000,
    staleTime: 30000,
  });

  // How many sittings each patient has already been billed for (bill = every 6 sittings)
  const { data: billedCyclesMap, refetch: refetchBilled } = useQuery({
    queryKey: ['dialysis-billed-cycles', hospitalConfig?.name],
    queryFn: () => fetchBilledCycles(hospitalConfig.name),
    enabled: !!hospitalConfig?.name,
    staleTime: 30000,
  });

  // Dedupe roster by patient, keeping last visit date, sitting count and billing status
  const rosterPatients = useMemo(() => {
    const byPatient = new Map<string, {
      patient: any;
      lastVisitDate: string | null;
      sittings: number;
    }>();
    rosterVisits.forEach((visit: any) => {
      if (!visit.patient_id || !visit.patients) return;
      const existing = byPatient.get(visit.patient_id);
      if (existing) {
        existing.sittings += 1;
        if (visit.visit_date && (!existing.lastVisitDate || visit.visit_date > existing.lastVisitDate)) {
          existing.lastVisitDate = visit.visit_date;
        }
      } else {
        byPatient.set(visit.patient_id, {
          patient: visit.patients,
          lastVisitDate: visit.visit_date || null,
          sittings: 1,
        });
      }
    });
    return Array.from(byPatient.values())
      .map((entry) => {
        const key = patientKey({
          patientsId: entry.patient.patients_id ?? null,
          patientName: entry.patient.name || '',
        });
        const billed = billedCyclesMap?.get(key) ?? 0;
        const unbilled = Math.max(0, entry.sittings - billed);
        return { ...entry, key, billed, unbilled, billDue: unbilled >= CYCLES_PER_BILL };
      })
      .sort((a, b) => (b.lastVisitDate || '').localeCompare(a.lastVisitDate || ''));
  }, [rosterVisits, billedCyclesMap]);

  // Patients who have completed a full cycle of 6 unbilled sittings
  const billDuePatients = useMemo(
    () => rosterPatients.filter((row) => row.billDue),
    [rosterPatients]
  );

  const handleMarkBilled = async (row: typeof rosterPatients[number]) => {
    const cyclesToBill = Math.floor(row.unbilled / CYCLES_PER_BILL) * CYCLES_PER_BILL;
    setMarkingKey(row.key);
    try {
      await markCyclesBilled(
        hospitalConfig.name,
        { key: row.key, patientName: row.patient.name || '' } as DialysisTrackerRow,
        row.billed + cyclesToBill
      );
      await refetchBilled();
      toast({
        title: 'Marked as billed',
        description: `${row.patient.name}: ${cyclesToBill} dialysis sittings marked as billed. Counting restarts for the next cycle.`,
      });
    } catch (error) {
      console.error('Error marking dialysis sittings billed:', error);
      toast({
        title: 'Error',
        description: 'Could not mark sittings as billed. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setMarkingKey(null);
    }
  };

  const handleNewDialysisVisit = (patient: { id: string; name: string; patients_id?: string }) => {
    setSelectedPatient({ id: patient.id, name: patient.name, patients_id: patient.patients_id });
  };

  const handleVisitFormClose = () => {
    setSelectedPatient(null);
    refetch();
    refetchRoster();
  };

  // Filter patients based on search term (date filtering is done at DB level)
  const filteredPatients = dialysisPatients.filter(patient => {
    const searchLower = searchTerm.toLowerCase();
    return !searchTerm || (
      patient.patients?.name?.toLowerCase().includes(searchLower) ||
      patient.patients?.patients_id?.toLowerCase().includes(searchLower) ||
      patient.visit_id?.toLowerCase().includes(searchLower) ||
      patient.token_number?.toString().includes(searchLower)
    );
  });

  const statistics = {
    waiting: filteredPatients.filter(p => p.status === 'waiting').length,
    inProgress: filteredPatients.filter(p => p.status === 'in_progress').length,
    completed: filteredPatients.filter(p => p.status === 'completed').length,
    total: filteredPatients.length
  };

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
    XLSX.utils.book_append_sheet(wb, ws, 'Dialysis Patients');
    XLSX.writeFile(wb, `Dialysis_Patients_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header - hidden in print */}
      <Card className="border-0 shadow-none print:hidden">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ClipboardList className="h-8 w-8" />
              <div>
                <CardTitle className="text-2xl font-bold">DIALYSIS PATIENT DASHBOARD</CardTitle>
                <p className="text-sm text-muted-foreground">Total Dialysis Patients: {statistics.total}</p>
                {/* Date display for print */}
                <p className="hidden print:block text-sm text-gray-700 mt-1">
                  Date: {startDate ? new Date(startDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : 'All'}
                  {endDate ? ` - ${new Date(endDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}` : ''}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 print:hidden">
              <Button
                size="sm"
                onClick={() => setIsPatientLookupOpen(true)}
                className="flex items-center gap-1 text-xs h-8 bg-blue-600 hover:bg-blue-700"
              >
                <UserPlus className="h-3 w-3" />
                New Dialysis Visit
              </Button>
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
              <DateRangePicker
                date={dateRange}
                onDateChange={handleDateRangeChange}
              />
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Statistics Cards */}
      <div className="print:hidden">
        <OpdStatisticsCards statistics={statistics} canSeeTile={canSeeTile} totalLabel="Total Dialysis Today" />
      </div>

      {/* Payment due after every 6 sittings */}
      <Card
        className={`print:hidden ${billDuePatients.length > 0 ? 'border-red-300 bg-red-50 cursor-pointer hover:bg-red-100' : ''}`}
        onClick={() => billDuePatients.length > 0 && setIsBillDueOpen(true)}
      >
        <CardContent className="py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <IndianRupee className={`h-8 w-8 ${billDuePatients.length > 0 ? 'text-red-600' : 'text-muted-foreground'}`} />
            <div>
              <p className="font-semibold">
                {billDuePatients.length > 0
                  ? `Payment Due — ${billDuePatients.length} patient${billDuePatients.length > 1 ? 's' : ''} completed ${CYCLES_PER_BILL} dialysis sittings`
                  : `No completed ${CYCLES_PER_BILL}-sitting cycles pending billing`}
              </p>
              <p className="text-sm text-muted-foreground">
                Dialysis is billed after every {CYCLES_PER_BILL} sittings.
                {billDuePatients.length > 0 && ' Click to see the list.'}
              </p>
            </div>
          </div>
          {billDuePatients.length > 0 && (
            <Badge variant="destructive" className="text-base px-3">{billDuePatients.length}</Badge>
          )}
        </CardContent>
      </Card>

      {/* List of patients who completed the 6-dialysis cycle */}
      <Dialog open={isBillDueOpen} onOpenChange={setIsBillDueOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Patients who completed {CYCLES_PER_BILL} dialysis sittings — payment due</DialogTitle>
          </DialogHeader>
          {billDuePatients.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No patients pending billing
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50">
                    <TableHead>Patient Name</TableHead>
                    <TableHead>Patient ID</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Total Sittings</TableHead>
                    <TableHead>Unbilled</TableHead>
                    <TableHead>Last Dialysis</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {billDuePatients.map((row) => (
                    <TableRow key={row.key}>
                      <TableCell className="font-medium">{row.patient.name || '-'}</TableCell>
                      <TableCell>{row.patient.patients_id || '-'}</TableCell>
                      <TableCell>{row.patient.phone || '-'}</TableCell>
                      <TableCell className="text-center">{row.sittings}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant="destructive">{row.unbilled}</Badge>
                      </TableCell>
                      <TableCell>{row.lastVisitDate ? format(new Date(row.lastVisitDate), 'dd/MM/yyyy') : '-'}</TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={markingKey === row.key}
                          onClick={() => handleMarkBilled(row)}
                          className="text-xs h-8"
                        >
                          {markingKey === row.key
                            ? 'Saving...'
                            : `Mark ${Math.floor(row.unbilled / CYCLES_PER_BILL) * CYCLES_PER_BILL} billed`}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Patients Table */}
      <Card>
        <CardHeader>
          <CardTitle>DIALYSIS PATIENTS</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center items-center h-32">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : (
            <OpdPatientTable
              patients={filteredPatients}
              refetch={refetch}
              isMarketingManager={isMarketingManager}
              emptyMessage="No dialysis patients found for today"
            />
          )}
        </CardContent>
      </Card>

      {/* Dialysis patient roster - every patient who has done dialysis */}
      <Card className="print:hidden">
        <CardHeader>
          <CardTitle>DIALYSIS PATIENTS</CardTitle>
          <p className="text-sm text-muted-foreground">
            All patients who have taken dialysis. Use "New Dialysis Visit" when a patient comes again.
          </p>
        </CardHeader>
        <CardContent>
          {isRosterLoading ? (
            <div className="flex justify-center items-center h-32">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : rosterPatients.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No dialysis patients yet
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50">
                    <TableHead>Patient Name</TableHead>
                    <TableHead>Patient ID</TableHead>
                    <TableHead>Age/Gender</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Corporate</TableHead>
                    <TableHead>Last Dialysis</TableHead>
                    <TableHead>Total Sittings</TableHead>
                    <TableHead>{CYCLES_PER_BILL}-Sitting Cycle</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rosterPatients.map(({ patient, lastVisitDate, sittings, unbilled, billDue }) => (
                    <TableRow key={patient.id}>
                      <TableCell className="font-medium">{patient.name || '-'}</TableCell>
                      <TableCell>{patient.patients_id || '-'}</TableCell>
                      <TableCell>{patient.age ?? '-'} / {patient.gender || '-'}</TableCell>
                      <TableCell>{patient.phone || '-'}</TableCell>
                      <TableCell>{patient.corporate || '-'}</TableCell>
                      <TableCell>{lastVisitDate ? format(new Date(lastVisitDate), 'dd/MM/yyyy') : '-'}</TableCell>
                      <TableCell className="text-center">{sittings}</TableCell>
                      <TableCell>
                        {billDue ? (
                          <Badge variant="destructive">Bill due</Badge>
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            {CYCLES_PER_BILL - (unbilled % CYCLES_PER_BILL)} more
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleNewDialysisVisit(patient)}
                          className="flex items-center gap-1 text-xs h-8"
                        >
                          <UserPlus className="h-3 w-3" />
                          New Dialysis Visit
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Search any patient to start a dialysis visit */}
      <PatientLookup
        isOpen={isPatientLookupOpen}
        onClose={() => setIsPatientLookupOpen(false)}
        onPatientSelected={(patient) => {
          setIsPatientLookupOpen(false);
          handleNewDialysisVisit(patient);
        }}
      />

      {/* Visit registration pre-set to Dialysis */}
      {selectedPatient && (
        <VisitRegistrationForm
          isOpen={true}
          onClose={handleVisitFormClose}
          patient={selectedPatient}
          defaultPatientType="Dialysis"
        />
      )}
    </div>
  );
};

export default DialysisDashboard;
