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
import { Printer, Search, ClipboardList, Download, UserPlus, IndianRupee, Circle } from 'lucide-react';
import { DIALYSIS_SESSION_BILLING_QUERY_KEY, loadDialysisBillableSessions, pendingDialysisPatients } from '@/lib/dialysisSessionBilling';
import { OpdStatisticsCards } from '@/components/opd/OpdStatisticsCards';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { DateRange } from 'react-day-picker';
import { format } from 'date-fns';
import { VisitRegistrationForm } from '@/components/VisitRegistrationForm';
import { PatientLookup } from '@/components/PatientLookup';

const DialysisDashboard = () => {
  const { hospitalConfig } = useAuth();
  const { canSeeTile } = useTileAccess();
  const [searchParams, setSearchParams] = useSearchParams();

  // Patient selected for a new dialysis visit (from roster or lookup)
  const [selectedPatient, setSelectedPatient] = useState<{ id: string; name: string; patients_id?: string } | null>(null);
  const [isPatientLookupOpen, setIsPatientLookupOpen] = useState(false);
  const [isBillDueOpen, setIsBillDueOpen] = useState(false);

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

  // Billing is completed per dialysis visit date.
  const { data: billedSessions = [] } = useQuery({
    queryKey: [DIALYSIS_SESSION_BILLING_QUERY_KEY, hospitalConfig?.name],
    queryFn: () => loadDialysisBillableSessions(hospitalConfig.name),
    enabled: !!hospitalConfig?.name,
    staleTime: 30000,
  });

  // Dedupe roster by patient, keeping the date-by-date billing status.
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
        const patientSessions = billedSessions.filter((session) => session.patientId === entry.patient.id);
        const unbilled = patientSessions.filter((session) => !session.billed).length;
        return { ...entry, unbilled, hasUnbilledDates: unbilled > 0 };
      })
      .sort((a, b) => (b.lastVisitDate || '').localeCompare(a.lastVisitDate || ''));
  }, [rosterVisits, billedSessions]);

  // A reminder appears once a patient has three unbilled dialysis dates.
  const billDuePatients = useMemo(
    () => pendingDialysisPatients(billedSessions),
    [billedSessions]
  );

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

      {/* Early billing reminder after three unbilled dialysis dates */}
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
                  ? `Billing reminder — ${billDuePatients.length} patient${billDuePatients.length > 1 ? 's' : ''} has 3 or more unbilled dialysis dates`
                  : 'No completed 6-sitting cycles pending billing'}
              </p>
              <p className="text-sm text-muted-foreground">
                Each dialysis date can be billed separately.
                {billDuePatients.length > 0 && ' Click to see the list.'}
              </p>
            </div>
          </div>
          {billDuePatients.length > 0 && (
            <Badge variant="destructive" className="text-base px-3">{billDuePatients.length}</Badge>
          )}
        </CardContent>
      </Card>

      {/* Pending per-date dialysis billing list */}
      <Dialog open={isBillDueOpen} onOpenChange={setIsBillDueOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Patients with 3 or more unbilled dialysis dates</DialogTitle>
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
                    <TableHead>Unbilled Dates</TableHead>
                    <TableHead>Latest Dialysis</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {billDuePatients.map((sessions) => {
                    const patient = sessions[0];
                    return (
                    <TableRow key={patient.patientId}>
                      <TableCell className="font-medium">{patient.patientName}</TableCell>
                      <TableCell>{patient.patientsId || '-'}</TableCell>
                      <TableCell className="text-center"><Badge variant="destructive">{sessions.length}</Badge></TableCell>
                      <TableCell>{format(new Date(patient.visitDate), 'dd/MM/yyyy')}</TableCell>
                    </TableRow>
                  )})}
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
            filteredPatients.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">No dialysis patients found for today</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-gray-50">
                      <TableHead>Visit ID</TableHead>
                      <TableHead>Patient Name</TableHead>
                      <TableHead>Gender/Age</TableHead>
                      <TableHead>Doctor</TableHead>
                      <TableHead>Dialysis Date</TableHead>
                      <TableHead className="text-center">Billed</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredPatients.map((patient: any) => {
                      const billed = billedSessions.find((session) => session.id === patient.id)?.billed ?? false;
                      return (
                        <TableRow key={patient.id}>
                          <TableCell className="font-mono text-sm text-blue-600">{patient.visit_id || '-'}</TableCell>
                          <TableCell><p className="font-medium">{patient.patients?.name || '-'}</p><p className="text-xs text-muted-foreground">{patient.patients?.patients_id || ''}</p></TableCell>
                          <TableCell>{patient.patients?.gender || '-'} / {patient.patients?.age ?? '-'}</TableCell>
                          <TableCell>{patient.appointment_with || '-'}</TableCell>
                          <TableCell>{patient.visit_date ? format(new Date(patient.visit_date), 'dd/MM/yyyy') : '-'}</TableCell>
                          <TableCell className="text-center"><span title={billed ? 'Billed done' : 'Billing pending'} className={`inline-block h-3 w-3 rounded-full ${billed ? 'bg-emerald-500' : 'bg-red-500'}`} /></TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )
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
                    <TableHead>Billed</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rosterPatients.map(({ patient, lastVisitDate, sittings, unbilled, hasUnbilledDates }) => (
                    <TableRow key={patient.id}>
                      <TableCell className="font-medium">{patient.name || '-'}</TableCell>
                      <TableCell>{patient.patients_id || '-'}</TableCell>
                      <TableCell>{patient.age ?? '-'} / {patient.gender || '-'}</TableCell>
                      <TableCell>{patient.phone || '-'}</TableCell>
                      <TableCell>{patient.corporate || '-'}</TableCell>
                      <TableCell>{lastVisitDate ? format(new Date(lastVisitDate), 'dd/MM/yyyy') : '-'}</TableCell>
                      <TableCell className="text-center">{sittings}</TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-2 text-sm font-medium" title={hasUnbilledDates ? `${unbilled} dialysis date${unbilled === 1 ? '' : 's'} pending billing` : 'All dialysis dates billed'}>
                          <Circle className={`h-3 w-3 fill-current ${hasUnbilledDates ? 'text-red-500' : 'text-emerald-500'}`} />
                          {hasUnbilledDates ? `${unbilled} pending` : 'Done'}
                        </span>
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
