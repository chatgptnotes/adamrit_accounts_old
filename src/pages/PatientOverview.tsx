import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows, fetchAllByIn } from '@/utils/fetchAllRows';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowUpDown, ChevronDown, ChevronUp, Plus } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

type SortConfig = {
  key: string;
  direction: 'asc' | 'desc' | null;
};

const PatientOverview = () => {
  const { hospitalConfig } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Use URL params for tab state persistence
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'call-today';

  const setActiveTab = (tab: string) => {
    setSearchParams({ tab });
  };
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [entriesPerPage, setEntriesPerPage] = useState('10');
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: '', direction: null });
  const [selectedHospital, setSelectedHospital] = useState<string>(hospitalConfig?.name || 'all');

  // Pagination states
  const [currentPageCallToday, setCurrentPageCallToday] = useState(1);
  const [currentPageAllPatient, setCurrentPageAllPatient] = useState(1);
  const [currentPageHistory, setCurrentPageHistory] = useState(1);

  // State to store form data for each visit
  const [callRecordData, setCallRecordData] = useState<Record<string, any>>({});
  const [telecallers, setTelecallers] = useState<string[]>(['Dolly', 'Nisha', 'Diksha']);
  const [showAddTelecaller, setShowAddTelecaller] = useState(false);
  const [newTelecallerName, setNewTelecallerName] = useState('');

  const [budgetAmounts, setBudgetAmounts] = useState<string[]>([
    '₹50,000', '₹60,000', '₹70,000', '₹80,000', '₹90,000', '₹100,000',
    '₹110,000', '₹120,000', '₹130,000', '₹140,000', '₹150,000', '₹160,000',
    '₹170,000', '₹180,000', '₹190,000', '₹200,000'
  ]);
  const [showAddBudget, setShowAddBudget] = useState(false);
  const [newBudgetAmount, setNewBudgetAmount] = useState('');

  const [dispositions, setDispositions] = useState<string[]>([
    'Not Reachable', 'Negative Feedback', 'Positive Feedback', 'Not Interested',
    'Busy', 'Follow-Up', 'Deceased', 'QR Code', 'Private Patient', 'Under Scheme',
    'Other', 'Wrong Number', 'Appointments', 'Visit Done'
  ]);
  const [showAddDisposition, setShowAddDisposition] = useState(false);
  const [newDisposition, setNewDisposition] = useState('');

  const [subDispositions, setSubDispositions] = useState<string[]>([
    'Mobile Number Not Reachable', 'Out of Network', 'Invalid Number', 'Number Does Not Exist',
    'Not in Service', 'Switched Off', 'Ringing, No Answer', 'Medicine Ineffective, Suggested Hospital Change',
    'Unsatisfactory Treatment', 'No Longer Visiting the Hospital', 'Seeking Treatment at Another Facility',
    'Poor Staff Behavior', 'Doctor Not Treating Properly', 'Hospital Services Poor',
    'Hygiene and Cleanliness Issues in Hospital', 'Lack of Proper Communication from Staff',
    'Treatment Effective, Patient Feeling Better', 'Doctors and Staff Behavior Was Good',
    'Quick and Efficient Services', 'Clean and Well-Maintained Facilities', 'Hospital Recommended to Others',
    'Good Communication and Patient Support', 'Patient Satisfied with Overall Experience',
    'Do Not Call Again', 'Not Interested in Discussion', 'Visiting Another Hospital',
    'Prefer Not to Share Information', 'Currently Busy', 'Driving, Request to Call Later',
    'Request to Call Back Later', 'Will Notify Later', 'Request to Call After a Specific Time',
    'Follow-Up After 1 Week', 'Follow-Up After 2 Days', 'Follow-Up After 2 Weeks',
    'Follow-Up After 2 Months', 'Patient Confirmed Reaching Hospital', 'Follow-Up for Feedback Post-Treatment',
    'Patient Has Passed Away', 'Death Confirmed at Hospital', 'QR Code Successfully Generated',
    'Interested in QR Code Generation', 'Not Interested in QR Code Generation',
    'Receiving Treatment as Private Patient', 'Requested No Schemes', 'Treatment at Full Cost',
    'Ayushman Bharat Card Holder', 'ESIC Treatment', 'MJPJAY (Mahatma Jyotiba Phule Jan Arogya Yojana) Treatment',
    'PMJAY (Pradhan Mantri Jan Arogya Yojana) Treatment',
    'Beneficiary of Other State or Central Government Health Scheme',
    'Requested Information About Scheme Coverage', 'Language Barrier, Unable to Communicate',
    'Contact Details Updated', 'Request for Additional Information', 'Incorrect Number'
  ]);
  const [showAddSubDisposition, setShowAddSubDisposition] = useState(false);
  const [newSubDisposition, setNewSubDisposition] = useState('');

  const [updateReasons, setUpdateReasons] = useState<string[]>([
    'Follow-up Required',
    'Emergency',
    'Routine Check',
    'Medication Review',
    'Treatment Update',
    'Discharge Follow-up'
  ]);
  const [showAddUpdateReason, setShowAddUpdateReason] = useState(false);
  const [newUpdateReason, setNewUpdateReason] = useState('');

  // State to track update reason edits for All Patient tab
  const [patientUpdateReasons, setPatientUpdateReasons] = useState<Record<string, string>>({});

  // Update selectedHospital when hospitalConfig changes
  useEffect(() => {
    if (hospitalConfig?.name) {
      setSelectedHospital(hospitalConfig.name);
    }
  }, [hospitalConfig]);

  // Fetch call records for Call Today tab (patients discharged within the last 5 days)
  const { data: todayVisits = [], isLoading: loadingToday } = useQuery({
    queryKey: ['patient-overview-today', selectedHospital],
    queryFn: async () => {
      const today = new Date();
      const fiveDaysAgo = new Date(today);
      fiveDaysAgo.setDate(today.getDate() - 5);

      const todayStr = today.toISOString().split('T')[0];
      const fiveDaysAgoStr = fiveDaysAgo.toISOString().split('T')[0];

      // First, get visits discharged in the last 5 days
      let visitsQuery = supabase
        .from('visits')
        .select(`
          id,
          discharge_date,
          reason_for_visit,
          visit_type,
          relation_with_employee,
          patients!inner (
            id,
            name,
            patients_id,
            phone,
            hospital_name
          )
        `)
        .not('discharge_date', 'is', null)
        .gte('discharge_date', fiveDaysAgoStr)
        .lte('discharge_date', todayStr);

      if (selectedHospital && selectedHospital !== 'all') {
        visitsQuery = visitsQuery.eq('patients.hospital_name', selectedHospital);
      }

      const { data: visits, error: visitsError } = await visitsQuery;
      if (visitsError) throw visitsError;

      if (!visits || visits.length === 0) return [];

      // Get call records for these visits
      const visitIds = visits.map(v => v.id);
      const { data: callRecords, error: callError } = await supabase
        .from('patient_call_records')
        .select('*')
        .in('visit_id', visitIds);

      if (callError) throw callError;

      // Merge visit data with call records
      const mergedData = visits.map(visit => {
        const callRecord = callRecords?.find(cr => cr.visit_id === visit.id);
        return {
          ...visit,
          call_record: callRecord || null,
          // Use saved data if available, otherwise use visit data
          budget_amount: callRecord?.budget_amount,
          follow_up_date: callRecord?.follow_up_date,
          called_on: callRecord?.called_on,
          disposition: callRecord?.disposition,
          sub_disposition: callRecord?.sub_disposition,
          remark: callRecord?.remark,
          telecaller_name: callRecord?.telecaller_name,
        };
      });

      return mergedData.sort((a, b) =>
        new Date(b.discharge_date).getTime() - new Date(a.discharge_date).getTime()
      );
    },
    enabled: activeTab === 'call-today'
  });

  // Fetch all patients for All Patient tab with their discharge reasons
  const { data: allPatients = [], isLoading: loadingAll } = useQuery({
    queryKey: ['patient-overview-all', selectedHospital],
    queryFn: async () => {
      const data = await fetchAllRows<any>(() => {
        let query = supabase
          .from('patients')
          .select(`
            *,
            visits!inner (
              id,
              visit_id,
              discharge_date,
              created_at
            )
          `)
          .order('created_at', { ascending: false });

        if (selectedHospital && selectedHospital !== 'all') {
          query = query.eq('hospital_name', selectedHospital);
        }
        return query;
      });

      if (!data || data.length === 0) return [];

      // Get visit_ids for all patients
      const visitIds = data.flatMap(p => p.visits?.map((v: any) => v.visit_id) || []);

      // Fetch final_payments data for these visits
      const finalPayments = await fetchAllByIn<{ visit_id: string; reason_of_discharge: string | null }>(
        visitIds,
        (chunk) => supabase.from('final_payments').select('visit_id, reason_of_discharge').in('visit_id', chunk)
      );

      // Map reason_of_discharge to patients
      const patientsWithReasons = data.map(patient => {
        const latestVisit = patient.visits?.[0];
        const finalPayment = finalPayments?.find((fp: any) => fp.visit_id === latestVisit?.visit_id);

        return {
          ...patient,
          latest_visit: latestVisit,
          reason_of_discharge: finalPayment?.reason_of_discharge,
          discharge_date: latestVisit?.discharge_date,
          visited_date: latestVisit?.created_at
        };
      });

      return patientsWithReasons;
    },
    enabled: activeTab === 'all-patient'
  });

  // Fetch available hospitals
  const { data: hospitals = [] } = useQuery({
    queryKey: ['hospitals-list'],
    queryFn: async () => {
      const data = await fetchAllRows<{ hospital_name: string }>(() => supabase
        .from('patients')
        .select('hospital_name')
        .not('hospital_name', 'is', null));

      // Get unique hospital names
      const uniqueHospitals = [...new Set(data?.map(p => p.hospital_name))];
      return uniqueHospitals.filter(h => h) as string[];
    }
  });

  // Fetch call history from patient_call_records table
  const { data: callHistory = [], isLoading: loadingHistory } = useQuery({
    queryKey: ['patient-overview-history', selectedHospital, fromDate, toDate],
    queryFn: async () => {
      let query = supabase
        .from('patient_call_records')
        .select('*')
        .order('call_date', { ascending: false });

      if (selectedHospital && selectedHospital !== 'all') {
        query = query.eq('hospital_name', selectedHospital);
      }

      if (fromDate) {
        query = query.gte('call_date', fromDate);
      }

      if (toDate) {
        query = query.lte('call_date', toDate);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    enabled: activeTab === 'last-call-history'
  });

  const handleClearFilter = () => {
    setFromDate('');
    setToDate('');
  };

  const handleAddTelecaller = () => {
    if (newTelecallerName.trim() && !telecallers.includes(newTelecallerName.trim())) {
      setTelecallers([...telecallers, newTelecallerName.trim()]);
      setNewTelecallerName('');
      setShowAddTelecaller(false);
    }
  };

  const handleAddBudget = () => {
    if (newBudgetAmount.trim() && !budgetAmounts.includes(newBudgetAmount.trim())) {
      setBudgetAmounts([...budgetAmounts, newBudgetAmount.trim()]);
      setNewBudgetAmount('');
      setShowAddBudget(false);
    }
  };

  const handleAddDisposition = () => {
    if (newDisposition.trim() && !dispositions.includes(newDisposition.trim())) {
      setDispositions([...dispositions, newDisposition.trim()]);
      setNewDisposition('');
      setShowAddDisposition(false);
    }
  };

  const handleAddSubDisposition = () => {
    if (newSubDisposition.trim() && !subDispositions.includes(newSubDisposition.trim())) {
      setSubDispositions([...subDispositions, newSubDisposition.trim()]);
      setNewSubDisposition('');
      setShowAddSubDisposition(false);
    }
  };

  const handleAddUpdateReason = () => {
    if (newUpdateReason.trim() && !updateReasons.includes(newUpdateReason.trim())) {
      setUpdateReasons([...updateReasons, newUpdateReason.trim()]);
      setNewUpdateReason('');
      setShowAddUpdateReason(false);
    }
  };

  // Mutation to update reason of discharge in final_payments table
  const updateReasonMutation = useMutation({
    mutationFn: async ({ visitId, reason }: { visitId: string; reason: string }) => {
      // Check if final_payment record exists for this visit
      const { data: existing } = await supabase
        .from('final_payments')
        .select('id')
        .eq('visit_id', visitId)
        .single();

      if (existing) {
        // Update existing record
        const { data, error } = await supabase
          .from('final_payments')
          .update({ reason_of_discharge: reason })
          .eq('visit_id', visitId)
          .select()
          .single();

        if (error) throw error;
        return data;
      } else {
        // If no final_payment record exists, we can't update
        throw new Error('No final payment record found for this visit');
      }
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Update reason saved successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['patient-overview-all'] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update reason",
        variant: "destructive",
      });
    }
  });

  const handleUpdateReason = (patient: any) => {
    const reason = patientUpdateReasons[patient.id];
    if (!reason) {
      toast({
        title: "Error",
        description: "Please select an update reason",
        variant: "destructive",
      });
      return;
    }

    updateReasonMutation.mutate({
      visitId: patient.latest_visit?.visit_id,
      reason: reason
    });
  };

  // Mutation to save call record
  const saveCallRecordMutation = useMutation({
    mutationFn: async (data: any) => {
      const { data: { user } } = await supabase.auth.getUser();

      // Check if record already exists for this visit today
      const today = new Date().toISOString().split('T')[0];
      const { data: existing } = await supabase
        .from('patient_call_records')
        .select('id')
        .eq('visit_id', data.visit_id)
        .eq('call_date', today)
        .single();

      const callRecord = {
        visit_id: data.visit_id,
        patient_id: data.patient_id,
        patient_name: data.patient_name,
        patient_phone: data.patient_phone,
        hospital_name: data.hospital_name,
        call_date: today,
        called_on: data.called_on || new Date().toISOString(),
        discharge_date: data.discharge_date,
        budget_amount: data.budget_amount,
        disposition: data.disposition,
        sub_disposition: data.sub_disposition,
        follow_up_date: data.follow_up_date,
        follow_up_required: !!data.follow_up_date,
        relationship_man: data.relationship_man,
        diagnosis_surgery: data.diagnosis_surgery,
        admission_type: data.admission_type,
        department: data.department,
        telecaller_name: data.telecaller_name,
        update_reason: data.update_reason,
        remark: data.remark,
        call_status: 'completed',
        created_by: user?.id,
        updated_by: user?.id
      };

      // If record exists, update it; otherwise insert
      if (existing) {
        const { data: result, error } = await supabase
          .from('patient_call_records')
          .update(callRecord)
          .eq('id', existing.id)
          .select()
          .single();

        if (error) throw error;
        return result;
      } else {
        const { data: result, error } = await supabase
          .from('patient_call_records')
          .insert([callRecord])
          .select()
          .single();

        if (error) throw error;
        return result;
      }
    },
    onSuccess: (data, variables) => {
      toast({
        title: "Success",
        description: "Call record saved successfully",
      });

      // Clear the form data for this visit after successful save
      setCallRecordData(prev => {
        const newData = { ...prev };
        delete newData[variables.visit_id];
        return newData;
      });

      queryClient.invalidateQueries({ queryKey: ['patient-overview-today'] });
      queryClient.invalidateQueries({ queryKey: ['patient-overview-all'] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save call record",
        variant: "destructive",
      });
    }
  });

  // Handle form field changes
  const updateCallRecordField = (visitId: string, field: string, value: any) => {
    setCallRecordData(prev => ({
      ...prev,
      [visitId]: {
        ...prev[visitId],
        [field]: value
      }
    }));
  };

  // Handle save button click
  const handleSaveCallRecord = (visit: any) => {
    const recordData = callRecordData[visit.id] || {};

    const dataToSave = {
      visit_id: visit.id,
      patient_id: visit.patients?.id,
      patient_name: visit.patients?.name,
      patient_phone: visit.patients?.phone,
      hospital_name: visit.patients?.hospital_name,
      discharge_date: visit.discharge_date,
      relationship_man: visit.relation_with_employee,
      diagnosis_surgery: visit.reason_for_visit,
      admission_type: visit.visit_type,
      ...recordData
    };

    saveCallRecordMutation.mutate(dataToSave);
  };

  const handleSort = (key: string) => {
    let direction: 'asc' | 'desc' | null = 'asc';
    if (sortConfig.key === key) {
      if (sortConfig.direction === 'asc') {
        direction = 'desc';
      } else if (sortConfig.direction === 'desc') {
        direction = null;
      }
    }
    setSortConfig({ key, direction });
  };

  const handleHospitalFilter = () => {
    // Reset pagination first before changing hospital
    setCurrentPageCallToday(1);
    setCurrentPageAllPatient(1);
    setCurrentPageHistory(1);

    const allHospitals = [hospitalConfig?.name || 'all', ...hospitals.filter(h => h !== hospitalConfig?.name), 'all'];
    const currentIndex = allHospitals.indexOf(selectedHospital);
    const nextIndex = (currentIndex + 1) % allHospitals.length;
    setSelectedHospital(allHospitals[nextIndex]);
  };

  const getHospitalFilterIcon = () => {
    if (selectedHospital === 'all') {
      return <ArrowUpDown className="ml-2 h-4 w-4 inline" />;
    }
    return <ChevronDown className="ml-2 h-4 w-4 inline" />;
  };

  const getSortIcon = (key: string) => {
    if (sortConfig.key !== key) {
      return <ArrowUpDown className="ml-2 h-4 w-4 inline" />;
    }
    if (sortConfig.direction === 'asc') {
      return <ChevronUp className="ml-2 h-4 w-4 inline" />;
    }
    if (sortConfig.direction === 'desc') {
      return <ChevronDown className="ml-2 h-4 w-4 inline" />;
    }
    return <ArrowUpDown className="ml-2 h-4 w-4 inline" />;
  };

  const sortData = (data: any[], key: string) => {
    if (!sortConfig.direction) return data;

    return [...data].sort((a, b) => {
      let aValue = a[key];
      let bValue = b[key];

      // Handle nested patient data
      if (key.includes('.')) {
        const keys = key.split('.');
        aValue = keys.reduce((obj, k) => obj?.[k], a);
        bValue = keys.reduce((obj, k) => obj?.[k], b);
      }

      if (aValue === null || aValue === undefined) return 1;
      if (bValue === null || bValue === undefined) return -1;

      if (sortConfig.direction === 'asc') {
        return aValue > bValue ? 1 : -1;
      } else {
        return aValue < bValue ? 1 : -1;
      }
    });
  };

  // Pagination helper functions
  const getPaginatedData = (data: any[], currentPage: number) => {
    const itemsPerPage = parseInt(entriesPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    return data.slice(startIndex, endIndex);
  };

  const getTotalPages = (dataLength: number) => {
    return Math.ceil(dataLength / parseInt(entriesPerPage));
  };

  const renderPagination = (currentPage: number, totalPages: number, setCurrentPage: (page: number) => void) => {
    if (totalPages <= 1) return null;

    return (
      <div className="flex items-center justify-between mt-4">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
          disabled={currentPage === 1}
        >
          Previous
        </Button>
        <span className="text-sm">
          Page {currentPage} of {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage === totalPages}
        >
          Next
        </Button>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Patient Overview Station</h1>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <div className="bg-card p-4 rounded-t-lg border border-b-0">
          <div className="flex items-center justify-between">
            <TabsList className="bg-muted">
              <TabsTrigger value="call-today">
                Call Today
              </TabsTrigger>
              <TabsTrigger value="all-patient">
                All Patient
              </TabsTrigger>
              <TabsTrigger value="last-call-history">
                Last Call History
              </TabsTrigger>
            </TabsList>

            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">From:</span>
              <Input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-40"
              />
              <span className="text-sm font-medium">To:</span>
              <Input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-40"
              />
              <Button onClick={handleClearFilter} variant="outline">
                Clear
              </Button>
            </div>
          </div>
        </div>

        {/* Call Today Tab */}
        <TabsContent value="call-today" className="mt-0 border border-t-0 rounded-b-lg p-6 bg-card">
          <div className="mb-4">
            <h3 className="text-lg font-semibold mb-4">Today Call Information</h3>
            <div className="flex items-center gap-2 mb-4">
              <span>Show</span>
              <Select value={entriesPerPage} onValueChange={setEntriesPerPage}>
                <SelectTrigger className="w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="25">25</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                </SelectContent>
              </Select>
              <span>entries</span>
              <div className="ml-auto">
                <Input
                  placeholder="Search..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-64"
                />
              </div>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="">S.No.</TableHead>
                  <TableHead
                    className=" cursor-pointer"
                    onClick={() => handleSort('discharge_date')}
                  >
                    Call Date{getSortIcon('discharge_date')}
                  </TableHead>
                  <TableHead
                    className=" cursor-pointer"
                    onClick={() => handleSort('patients.name')}
                  >
                    Patient Name{getSortIcon('patients.name')}
                  </TableHead>
                  <TableHead
                    className=" cursor-pointer"
                    onClick={() => handleSort('patients.phone')}
                  >
                    Phone{getSortIcon('patients.phone')}
                  </TableHead>
                  <TableHead
                    className=" cursor-pointer"
                    onClick={() => handleSort('relation_with_employee')}
                  >
                    Relationship Man{getSortIcon('relation_with_employee')}
                  </TableHead>
                  <TableHead
                    className=" cursor-pointer"
                    onClick={() => handleSort('reason_for_visit')}
                  >
                    Diagnosis/Surgery{getSortIcon('reason_for_visit')}
                  </TableHead>
                  <TableHead
                    className=" cursor-pointer"
                    onClick={() => handleSort('visit_type')}
                  >
                    Admission Type{getSortIcon('visit_type')}
                  </TableHead>
                  <TableHead className="">Department</TableHead>
                  <TableHead
                    className=" cursor-pointer"
                    onClick={handleHospitalFilter}
                  >
                    Hospital Name: {selectedHospital === 'all' ? 'All' : selectedHospital}{getHospitalFilterIcon()}
                  </TableHead>
                  <TableHead className="">Budget Amount</TableHead>
                  <TableHead className="">Follow Up On</TableHead>
                  <TableHead className="">Called On</TableHead>
                  <TableHead className="">Disposition</TableHead>
                  <TableHead className="">Sub Disposition</TableHead>
                  <TableHead className="">Remark</TableHead>
                  <TableHead className="">Telecaller</TableHead>
                  <TableHead className="">Update Disposition</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingToday ? (
                  <TableRow>
                    <TableCell colSpan={16} className="text-center py-8">
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : todayVisits.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={16} className="text-center py-8">
                      No records found
                    </TableCell>
                  </TableRow>
                ) : (
                  getPaginatedData(sortData(todayVisits, sortConfig.key), currentPageCallToday).map((visit, index) => (
                    <TableRow key={visit.id}>
                      <TableCell>
                        {((currentPageCallToday - 1) * parseInt(entriesPerPage)) + index + 1}
                      </TableCell>
                      <TableCell>{visit.discharge_date ? new Date(visit.discharge_date).toLocaleDateString() : '-'}</TableCell>
                      <TableCell className="text-blue-600 hover:underline cursor-pointer">
                        {visit.patients?.name}
                      </TableCell>
                      <TableCell>{visit.patients?.phone || '-'}</TableCell>
                      <TableCell>{visit.relation_with_employee || '-'}</TableCell>
                      <TableCell className="max-w-[200px] truncate">{visit.reason_for_visit}</TableCell>
                      <TableCell>{visit.visit_type}</TableCell>
                      <TableCell>-</TableCell>
                      <TableCell>{visit.patients?.hospital_name}</TableCell>
                      <TableCell>
                        <Select
                          value={visit.budget_amount || callRecordData[visit.id]?.budget_amount}
                          onValueChange={(value) => updateCallRecordField(visit.id, 'budget_amount', value)}
                        >
                          <SelectTrigger className="w-[140px] h-8">
                            <SelectValue placeholder="Select Budget Amount" />
                          </SelectTrigger>
                          <SelectContent>
                            {budgetAmounts.map((amount) => (
                              <SelectItem key={amount} value={amount}>
                                {amount}
                              </SelectItem>
                            ))}
                            <div className="relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none hover:bg-accent hover:text-accent-foreground">
                              <button
                                onClick={() => setShowAddBudget(true)}
                                className="w-full text-left text-blue-600 font-semibold flex items-center"
                              >
                                <Plus className="h-4 w-4 mr-2" />
                                Add New Budget
                              </button>
                            </div>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Input
                          type="date"
                          className="w-[130px] h-8"
                          value={visit.follow_up_date || callRecordData[visit.id]?.follow_up_date || ''}
                          onChange={(e) => updateCallRecordField(visit.id, 'follow_up_date', e.target.value)}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="date"
                          className="w-[130px] h-8"
                          value={visit.called_on ? new Date(visit.called_on).toISOString().split('T')[0] : callRecordData[visit.id]?.called_on || new Date().toISOString().split('T')[0]}
                          onChange={(e) => updateCallRecordField(visit.id, 'called_on', e.target.value)}
                        />
                      </TableCell>
                      <TableCell>
                        <Select
                          value={visit.disposition || callRecordData[visit.id]?.disposition}
                          onValueChange={(value) => updateCallRecordField(visit.id, 'disposition', value)}
                        >
                          <SelectTrigger className="w-[160px] h-8">
                            <SelectValue placeholder="Select Disposition" />
                          </SelectTrigger>
                          <SelectContent>
                            {dispositions.map((disp) => (
                              <SelectItem key={disp} value={disp}>
                                {disp}
                              </SelectItem>
                            ))}
                            <div className="relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none hover:bg-accent hover:text-accent-foreground">
                              <button
                                onClick={() => setShowAddDisposition(true)}
                                className="w-full text-left text-blue-600 font-semibold flex items-center"
                              >
                                <Plus className="h-4 w-4 mr-2" />
                                Add New Disposition
                              </button>
                            </div>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={visit.sub_disposition || callRecordData[visit.id]?.sub_disposition}
                          onValueChange={(value) => updateCallRecordField(visit.id, 'sub_disposition', value)}
                        >
                          <SelectTrigger className="w-[200px] h-8">
                            <SelectValue placeholder="Select Sub-Disposition" />
                          </SelectTrigger>
                          <SelectContent className="max-h-[300px] overflow-y-auto">
                            {subDispositions.map((subDisp) => (
                              <SelectItem key={subDisp} value={subDisp}>
                                {subDisp}
                              </SelectItem>
                            ))}
                            <div className="relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none hover:bg-accent hover:text-accent-foreground">
                              <button
                                onClick={() => setShowAddSubDisposition(true)}
                                className="w-full text-left text-blue-600 font-semibold flex items-center"
                              >
                                <Plus className="h-4 w-4 mr-2" />
                                Add New Sub-Disposition
                              </button>
                            </div>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Input
                          type="text"
                          placeholder="Remark"
                          className="w-[150px] h-8"
                          value={visit.remark || callRecordData[visit.id]?.remark || ''}
                          onChange={(e) => updateCallRecordField(visit.id, 'remark', e.target.value)}
                        />
                      </TableCell>
                      <TableCell>
                        <Select
                          value={visit.telecaller_name || callRecordData[visit.id]?.telecaller_name}
                          onValueChange={(value) => updateCallRecordField(visit.id, 'telecaller_name', value)}
                        >
                          <SelectTrigger className="w-[120px] h-8">
                            <SelectValue placeholder="Select Telecaller" />
                          </SelectTrigger>
                          <SelectContent>
                            {telecallers.map((name) => (
                              <SelectItem key={name} value={name}>
                                {name}
                              </SelectItem>
                            ))}
                            <div className="relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none hover:bg-accent hover:text-accent-foreground">
                              <button
                                onClick={() => setShowAddTelecaller(true)}
                                className="w-full text-left text-blue-600 font-semibold flex items-center"
                              >
                                <Plus className="h-4 w-4 mr-2" />
                                Add New Telecaller
                              </button>
                            </div>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          onClick={() => handleSaveCallRecord(visit)}
                          disabled={saveCallRecordMutation.isPending}
                        >
                          {saveCallRecordMutation.isPending ? 'Saving...' : 'Save'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          <div className="mt-4 text-sm text-gray-600">
            Showing {((currentPageCallToday - 1) * parseInt(entriesPerPage)) + 1} to {Math.min(currentPageCallToday * parseInt(entriesPerPage), todayVisits.length)} of {todayVisits.length} entries
          </div>
          {renderPagination(currentPageCallToday, getTotalPages(todayVisits.length), setCurrentPageCallToday)}
        </TabsContent>

        {/* All Patient Tab */}
        <TabsContent value="all-patient" className="mt-0 border border-t-0 rounded-b-lg p-6 bg-card">
          <div className="mb-4">
            <h3 className="text-lg font-semibold mb-4">All Patient</h3>
            <div className="flex items-center gap-2 mb-4">
              <span>Show</span>
              <Select value={entriesPerPage} onValueChange={setEntriesPerPage}>
                <SelectTrigger className="w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="25">25</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                </SelectContent>
              </Select>
              <span>entries</span>
              <div className="ml-auto">
                <Input
                  placeholder="Search..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-64"
                />
              </div>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="">S.No.</TableHead>
                  <TableHead
                    className=" cursor-pointer"
                    onClick={() => handleSort('name')}
                  >
                    Name{getSortIcon('name')}
                  </TableHead>
                  <TableHead
                    className=" cursor-pointer"
                    onClick={() => handleSort('patients_id')}
                  >
                    Patient ID{getSortIcon('patients_id')}
                  </TableHead>
                  <TableHead
                    className=" cursor-pointer"
                    onClick={() => handleSort('phone')}
                  >
                    Mobile{getSortIcon('phone')}
                  </TableHead>
                  <TableHead
                    className=" cursor-pointer"
                    onClick={handleHospitalFilter}
                  >
                    Hospital Name: {selectedHospital === 'all' ? 'All' : selectedHospital}{getHospitalFilterIcon()}
                  </TableHead>
                  <TableHead
                    className=" cursor-pointer"
                    onClick={() => handleSort('created_at')}
                  >
                    Visited Date{getSortIcon('created_at')}
                  </TableHead>
                  <TableHead className="">Discharge Date</TableHead>
                  <TableHead className="">Relationship Manager</TableHead>
                  <TableHead className="">Called On</TableHead>
                  <TableHead className="">Update Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingAll ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-8">
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : allPatients.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-8">
                      No records found
                    </TableCell>
                  </TableRow>
                ) : (
                  getPaginatedData(sortData(allPatients, sortConfig.key), currentPageAllPatient).map((patient, index) => (
                    <TableRow key={patient.id}>
                      <TableCell>
                        {((currentPageAllPatient - 1) * parseInt(entriesPerPage)) + index + 1}
                      </TableCell>
                      <TableCell>{patient.name}</TableCell>
                      <TableCell>{patient.patients_id}</TableCell>
                      <TableCell>{patient.phone || '-'}</TableCell>
                      <TableCell>{patient.hospital_name}</TableCell>
                      <TableCell>{patient.visited_date ? new Date(patient.visited_date).toLocaleDateString() : '-'}</TableCell>
                      <TableCell>{patient.discharge_date ? new Date(patient.discharge_date).toLocaleDateString() : '-'}</TableCell>
                      <TableCell>-</TableCell>
                      <TableCell>-</TableCell>
                      <TableCell>
                        {patient.reason_of_discharge ? (
                          <div className="flex items-center gap-2">
                            <span className="text-sm">{patient.reason_of_discharge}</span>
                            <Select
                              value={patientUpdateReasons[patient.id] || patient.reason_of_discharge}
                              onValueChange={(value) => setPatientUpdateReasons(prev => ({ ...prev, [patient.id]: value }))}
                            >
                              <SelectTrigger className="w-[150px] h-8">
                                <SelectValue placeholder="Select Reason" />
                              </SelectTrigger>
                              <SelectContent>
                                {updateReasons.map((reason) => (
                                  <SelectItem key={reason} value={reason}>
                                    {reason}
                                  </SelectItem>
                                ))}
                                <div className="relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none hover:bg-accent hover:text-accent-foreground">
                                  <button
                                    onClick={() => setShowAddUpdateReason(true)}
                                    className="w-full text-left text-blue-600 font-semibold flex items-center"
                                  >
                                    <Plus className="h-4 w-4 mr-2" />
                                    Add New Reason
                                  </button>
                                </div>
                              </SelectContent>
                            </Select>
                            <Button
                              size="sm"
                              onClick={() => handleUpdateReason(patient)}
                              disabled={updateReasonMutation.isPending}
                            >
                              Update
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <Select
                              value={patientUpdateReasons[patient.id]}
                              onValueChange={(value) => setPatientUpdateReasons(prev => ({ ...prev, [patient.id]: value }))}
                            >
                              <SelectTrigger className="w-[150px] h-8">
                                <SelectValue placeholder="Select Reason" />
                              </SelectTrigger>
                              <SelectContent>
                                {updateReasons.map((reason) => (
                                  <SelectItem key={reason} value={reason}>
                                    {reason}
                                  </SelectItem>
                                ))}
                                <div className="relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none hover:bg-accent hover:text-accent-foreground">
                                  <button
                                    onClick={() => setShowAddUpdateReason(true)}
                                    className="w-full text-left text-blue-600 font-semibold flex items-center"
                                  >
                                    <Plus className="h-4 w-4 mr-2" />
                                    Add New Reason
                                  </button>
                                </div>
                              </SelectContent>
                            </Select>
                            <Button
                              size="sm"
                              onClick={() => handleUpdateReason(patient)}
                              disabled={updateReasonMutation.isPending}
                            >
                              Update
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          <div className="mt-4 text-sm text-gray-600">
            Showing {((currentPageAllPatient - 1) * parseInt(entriesPerPage)) + 1} to {Math.min(currentPageAllPatient * parseInt(entriesPerPage), allPatients.length)} of {allPatients.length} entries
          </div>
          {renderPagination(currentPageAllPatient, getTotalPages(allPatients.length), setCurrentPageAllPatient)}
        </TabsContent>

        {/* Last Call History Tab */}
        <TabsContent value="last-call-history" className="mt-0 border border-t-0 rounded-b-lg p-6 bg-card">
          <div className="mb-4">
            <h3 className="text-lg font-semibold mb-4">Last Call History</h3>
            <div className="flex items-center gap-2 mb-4">
              <span>Select Date:</span>
              <Input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-40"
              />
              <Button onClick={handleClearFilter} className="bg-blue-500 hover:bg-blue-600">
                Filter
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead
                    className=" cursor-pointer"
                    onClick={() => handleSort('visit_date')}
                  >
                    Date{getSortIcon('visit_date')}
                  </TableHead>
                  <TableHead
                    className=" cursor-pointer"
                    onClick={() => handleSort('patients.name')}
                  >
                    Patient Name{getSortIcon('patients.name')}
                  </TableHead>
                  <TableHead
                    className=" cursor-pointer"
                    onClick={handleHospitalFilter}
                  >
                    Hospital Name: {selectedHospital === 'all' ? 'All' : selectedHospital}{getHospitalFilterIcon()}
                  </TableHead>
                  <TableHead
                    className=" cursor-pointer"
                    onClick={() => handleSort('disposition')}
                  >
                    Disposition{getSortIcon('disposition')}
                  </TableHead>
                  <TableHead
                    className=" cursor-pointer"
                    onClick={() => handleSort('sub_disposition')}
                  >
                    Sub Disposition{getSortIcon('sub_disposition')}
                  </TableHead>
                  <TableHead
                    className=" cursor-pointer"
                    onClick={() => handleSort('follow_up_date')}
                  >
                    Follow-up Date{getSortIcon('follow_up_date')}
                  </TableHead>
                  <TableHead
                    className=" cursor-pointer"
                    onClick={() => handleSort('remark')}
                  >
                    Remark{getSortIcon('remark')}
                  </TableHead>
                  <TableHead
                    className=" cursor-pointer"
                    onClick={() => handleSort('telecaller_name')}
                  >
                    Call assigned To{getSortIcon('telecaller_name')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingHistory ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8">
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : callHistory.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8">
                      No records found
                    </TableCell>
                  </TableRow>
                ) : (
                  getPaginatedData(sortData(callHistory, sortConfig.key), currentPageHistory).map((record) => (
                    <TableRow key={record.id}>
                      <TableCell>{record.call_date ? new Date(record.call_date).toLocaleDateString() : '-'}</TableCell>
                      <TableCell>{record.patient_name || '-'}</TableCell>
                      <TableCell>{record.hospital_name || '-'}</TableCell>
                      <TableCell>{record.disposition || '-'}</TableCell>
                      <TableCell>{record.sub_disposition || '-'}</TableCell>
                      <TableCell>{record.follow_up_date ? new Date(record.follow_up_date).toLocaleDateString() : '-'}</TableCell>
                      <TableCell>{record.remark || '-'}</TableCell>
                      <TableCell>{record.telecaller_name || '-'}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          <div className="mt-4 text-sm text-gray-600">
            Showing {((currentPageHistory - 1) * parseInt(entriesPerPage)) + 1} to {Math.min(currentPageHistory * parseInt(entriesPerPage), callHistory.length)} of {callHistory.length} entries
          </div>
          {renderPagination(currentPageHistory, getTotalPages(callHistory.length), setCurrentPageHistory)}
        </TabsContent>
      </Tabs>

      {/* Add Telecaller Dialog */}
      <Dialog open={showAddTelecaller} onOpenChange={setShowAddTelecaller}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Telecaller</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Input
              placeholder="Enter telecaller name"
              value={newTelecallerName}
              onChange={(e) => setNewTelecallerName(e.target.value)}
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  handleAddTelecaller();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddTelecaller(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddTelecaller}>
              Add Telecaller
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Budget Amount Dialog */}
      <Dialog open={showAddBudget} onOpenChange={setShowAddBudget}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Budget Amount</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Input
              placeholder="Enter budget amount (e.g., ₹250,000)"
              value={newBudgetAmount}
              onChange={(e) => setNewBudgetAmount(e.target.value)}
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  handleAddBudget();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddBudget(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddBudget}>
              Add Budget Amount
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Disposition Dialog */}
      <Dialog open={showAddDisposition} onOpenChange={setShowAddDisposition}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Disposition</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Input
              placeholder="Enter disposition"
              value={newDisposition}
              onChange={(e) => setNewDisposition(e.target.value)}
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  handleAddDisposition();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDisposition(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddDisposition}>
              Add Disposition
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Sub-Disposition Dialog */}
      <Dialog open={showAddSubDisposition} onOpenChange={setShowAddSubDisposition}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Sub-Disposition</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Input
              placeholder="Enter sub-disposition"
              value={newSubDisposition}
              onChange={(e) => setNewSubDisposition(e.target.value)}
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  handleAddSubDisposition();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddSubDisposition(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddSubDisposition}>
              Add Sub-Disposition
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Update Reason Dialog */}
      <Dialog open={showAddUpdateReason} onOpenChange={setShowAddUpdateReason}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Update Reason</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Input
              placeholder="Enter update reason"
              value={newUpdateReason}
              onChange={(e) => setNewUpdateReason(e.target.value)}
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  handleAddUpdateReason();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddUpdateReason(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddUpdateReason}>
              Add Update Reason
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PatientOverview;
