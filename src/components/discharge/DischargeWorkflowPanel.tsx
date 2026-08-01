import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { 
  CalendarIcon, 
  CheckCircle, 
  AlertCircle, 
  AlertTriangle,
  Clock, 
  FileText, 
  Shield, 
  Printer,
  XCircle,
  Download
} from 'lucide-react';
import { GatePassModal } from './GatePassModal';
import { logActivity } from '@/lib/activity-logger';

interface Visit {
  id: string;
  visit_id: string;
  discharge_date: string | null;
  patients: {
    id: string;
    name: string;
    patients_id: string;
    hospital_name?: string | null;
  };
}

interface DischargeChecklist {
  id?: string;
  visit_id: string;
  doctor_signature: boolean;
  discharge_summary_uploaded: boolean;
  nurse_clearance: boolean;
  pharmacy_clearance: boolean;
  final_bill_generated: boolean;
  final_bill_printed: boolean;
  payment_verified: boolean;
  gate_pass_generated: boolean;
  security_verification: boolean;
  patient_signature: boolean;
  discharge_mode: string;
  authorized_by?: string;
  notes?: string;
}

interface DischargeWorkflowPanelProps {
  visit: Visit;
  onClose?: () => void;
}

const DISCHARGE_MODES = [
  { value: 'recovery', label: 'Recovery' },
  { value: 'lama', label: 'LAMA (Leave Against Medical Advice)' },
  { value: 'death', label: 'Death' },
  { value: 'transfer', label: 'Transfer to Another Facility' },
  { value: 'discharge_on_request', label: 'Discharge on Request' }
];

export const DischargeWorkflowPanel: React.FC<DischargeWorkflowPanelProps> = ({ visit, onClose }) => {
  const [dischargeDate, setDischargeDate] = useState<Date | undefined>(
    visit.discharge_date ? new Date(visit.discharge_date) : undefined
  );
  const [useCurrentDate, setUseCurrentDate] = useState(false);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [isGatePassModalOpen, setIsGatePassModalOpen] = useState(false);
  const queryClient = useQueryClient();

  // Fetch discharge checklist
  const { data: checklist, isLoading: checklistLoading } = useQuery({
    queryKey: ['discharge-checklist', visit.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('discharge_checklist')
        .select('*')
        .eq('visit_id', visit.id)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      return data as DischargeChecklist | null;
    },
  });

  // The government portal requires the patient's photo and thumb impression to
  // be uploaded before they leave. The tablet's Arshiya tile enforces this;
  // this panel must too, or it becomes a bypass route.
  const { data: thumbConfirmation, isLoading: thumbConfirmationLoading } = useQuery({
    queryKey: ['discharge-thumb-confirmation', visit.patients.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('file_uploads')
        .select('id, file_name, file_url, created_at')
        .eq('category', 'discharge_thumb_confirmation')
        .eq('patient_id', visit.patients.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // Initialize or update checklist
  const createOrUpdateChecklistMutation = useMutation({
    mutationFn: async (updates: Partial<DischargeChecklist>) => {
      if (checklist?.id) {
        const { error } = await supabase
          .from('discharge_checklist')
          .update(updates)
          .eq('id', checklist.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('discharge_checklist')
          .insert({
            visit_id: visit.id,
            doctor_signature: false,
            discharge_summary_uploaded: false,
            nurse_clearance: false,
            pharmacy_clearance: false,
            final_bill_generated: false,
            final_bill_printed: false,
            payment_verified: false,
            gate_pass_generated: false,
            security_verification: false,
            patient_signature: false,
            discharge_mode: 'recovery',
            ...updates
          });
        if (error) throw error;
      }
      return updates;
    },
    onSuccess: (updates) => {
      queryClient.invalidateQueries({ queryKey: ['discharge-checklist', visit.id] });
      
      // Check if discharge is now complete and update currently-admitted-visits
      const updatedChecklist = { ...checklist, ...updates };
      const isNowFullyDischarged = 
        updatedChecklist.doctor_signature &&
        updatedChecklist.discharge_summary_uploaded &&
        updatedChecklist.nurse_clearance &&
        updatedChecklist.pharmacy_clearance &&
        updatedChecklist.final_bill_generated &&
        updatedChecklist.final_bill_printed &&
        updatedChecklist.payment_verified &&
        updatedChecklist.gate_pass_generated &&
        updatedChecklist.patient_signature &&
        dischargeDate;

      if (isNowFullyDischarged) {
        // Patient is now fully discharged, update the lists
        queryClient.invalidateQueries({ queryKey: ['currently-admitted-visits'] });
        queryClient.invalidateQueries({ queryKey: ['todays-ipd-visits'] });
        toast({
          title: "Patient Fully Discharged",
          description: `${visit.patients.name} has been successfully discharged and moved to discharged patients list.`,
        });
      }
    },
    onError: (error) => {
      console.error('❌ Checklist update failed:', error);
      toast({
        title: "Error",
        description: "Failed to update checklist. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Update discharge date
  const updateDischargeDateMutation = useMutation({
    mutationFn: async (date: Date) => {
      const { error } = await supabase
        .from('visits')
        .update({ discharge_date: date.toISOString() })
        .eq('id', visit.id);
      if (error) throw error;
    },
    onSuccess: () => {
      // Don't invalidate the currently-admitted-visits query to keep patient on the page
      toast({
        title: "Discharge Date Saved",
        description: "Please complete the discharge checklist below to proceed with discharge.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to save discharge date.",
        variant: "destructive",
      });
    },
  });

  // Generate gate pass
  const generateGatePassMutation = useMutation({
    mutationFn: async () => {
      if (!dischargeDate) throw new Error('Discharge date required');

      // Re-check at generation time so a stale screen cannot slip past the gate.
      const { data: confirmation, error: confirmationError } = await supabase
        .from('file_uploads')
        .select('id')
        .eq('category', 'discharge_thumb_confirmation')
        .eq('patient_id', visit.patients.id)
        .limit(1)
        .maybeSingle();
      if (confirmationError) throw confirmationError;
      if (!confirmation) {
        throw new Error('Portal thumb confirmation photo has not been uploaded for this patient');
      }

      // Generate gate pass number
      const { data: gatePassNumber, error: numberError } = await supabase
        .rpc('generate_gate_pass_number');
      
      if (numberError) throw numberError;

      const { error } = await supabase
        .from('gate_passes')
        .insert({
          gate_pass_number: gatePassNumber,
          visit_id: visit.id,
          patient_id: visit.patients.id,
          patient_name: visit.patients.name,
          discharge_date: dischargeDate.toISOString(),
          discharge_mode: checklist?.discharge_mode || 'recovery',
          bill_paid: checklist?.payment_verified || false,
          barcode_data: `${gatePassNumber}-${visit.visit_id}`,
        });

      if (error) throw error;

      // Update checklist
      await createOrUpdateChecklistMutation.mutateAsync({
        gate_pass_generated: true
      });

      return gatePassNumber;
    },
    onSuccess: (gatePassNumber) => {
      toast({
        title: "Gate Pass Generated",
        description: `Gate Pass ${gatePassNumber} has been generated successfully.`,
      });
      // Invalidate gate pass query to ensure fresh data
      queryClient.invalidateQueries({ queryKey: ['gate-pass', visit.visit_id] });
      // Open the gate pass modal after successful generation with a small delay
      setTimeout(() => {
        console.log('🚀 Opening Gate Pass Modal...');
        setIsGatePassModalOpen(true);
      }, 1000); // Increased delay to ensure data is loaded
      
      // Fallback: Try to open modal again after 2 seconds if it didn't open
      setTimeout(() => {
        if (!isGatePassModalOpen) {
          console.log('🔄 Fallback: Opening Gate Pass Modal again...');
          setIsGatePassModalOpen(true);
        }
      }, 2000);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error?.message || "Failed to generate gate pass.",
        variant: "destructive",
      });
    },
  });

  // Discharge patient mutation
  const dischargePatientMutation = useMutation({
    mutationFn: async () => {
      if (!dischargeDate) throw new Error('Discharge date required');

      console.log('🏥 Discharging patient:', visit.visit_id);

      // Check which hospital instance
      const isHopeInstance = visit.patients.hospital_name === 'hope';
      const isAyushmanInstance = visit.patients.hospital_name === 'ayushman';

      let nextDischargedSrNo: number | null = null;

      // Sr. No logic for Hope hospital
      if (isHopeInstance) {
        // First check if this visit already has a discharged_sr_no (from previous discharge)
        const { data: existingVisit } = await supabase
          .from('visits')
          .select('discharged_sr_no')
          .eq('id', visit.id)
          .single();

        if (existingVisit?.discharged_sr_no) {
          // Patient was previously discharged - keep their original Sr. No
          nextDischargedSrNo = parseInt(existingVisit.discharged_sr_no);
          console.log('📝 Hope: Keeping existing Discharged Sr. No:', nextDischargedSrNo);
        } else {
          // Get next Discharged Sr. No (auto-increment) for 'hope' instance only
          const { data: maxSrNoData } = await supabase
            .from('visits')
            .select('discharged_sr_no, patients!inner(hospital_name)')
            .eq('patients.hospital_name', 'hope')
            .not('discharged_sr_no', 'is', null)
            .order('discharged_sr_no', { ascending: false })
            .limit(1)
            .single();

          const maxSrNo = maxSrNoData?.discharged_sr_no ? parseInt(maxSrNoData.discharged_sr_no) : 0;
          nextDischargedSrNo = maxSrNo + 1;

          console.log('📝 Hope: Assigning new Discharged Sr. No:', nextDischargedSrNo);
        }
      }

      // Sr. No logic for Ayushman hospital
      if (isAyushmanInstance) {
        // First check if this visit already has a discharged_sr_no (from previous discharge)
        const { data: existingVisit } = await supabase
          .from('visits')
          .select('discharged_sr_no')
          .eq('id', visit.id)
          .single();

        if (existingVisit?.discharged_sr_no) {
          // Patient was previously discharged - keep their original Sr. No
          nextDischargedSrNo = parseInt(existingVisit.discharged_sr_no);
          console.log('📝 Ayushman: Keeping existing Discharged Sr. No:', nextDischargedSrNo);
        } else {
          // Get next Discharged Sr. No (auto-increment) for 'ayushman' instance only
          const { data: maxSrNoData } = await supabase
            .from('visits')
            .select('discharged_sr_no, patients!inner(hospital_name)')
            .eq('patients.hospital_name', 'ayushman')
            .not('discharged_sr_no', 'is', null)
            .order('discharged_sr_no', { ascending: false })
            .limit(1)
            .single();

          const maxSrNo = maxSrNoData?.discharged_sr_no ? parseInt(maxSrNoData.discharged_sr_no) : 0;
          nextDischargedSrNo = maxSrNo + 1;

          console.log('📝 Ayushman: Assigning new Discharged Sr. No:', nextDischargedSrNo);
        }
      }

      // Update visit with discharge date and Discharged Sr. No (if Hope or Ayushman)
      const updateData: any = {
        discharge_date: dischargeDate.toISOString(),
        status: 'discharged',
      };

      if (nextDischargedSrNo !== null) {
        updateData.discharged_sr_no = nextDischargedSrNo.toString();
      }

      const { error } = await supabase
        .from('visits')
        .update(updateData)
        .eq('id', visit.id);

      if (error) throw error;

    },
    onSuccess: () => {
      // Log patient discharge activity
      logActivity('patient_discharge', {
        patient_id: visit.patients.id,
        patients_id: visit.patients.patients_id,
        patient_name: visit.patients.name,
        visit_id: visit.visit_id,
      });

      toast({
        title: "Patient Discharged",
        description: `${visit.patients.name} has been successfully discharged.`,
      });
      // Invalidate queries to refresh the data
      queryClient.invalidateQueries({ queryKey: ['currently-admitted-visits'] });
      queryClient.invalidateQueries({ queryKey: ['discharge-checklist', visit.id] });
    },
    onError: (error) => {
      console.error('❌ Discharge failed:', error);
      toast({
        title: "Error",
        description: "Failed to discharge patient.",
        variant: "destructive",
      });
    },
  });

  const handleChecklistUpdate = (field: keyof DischargeChecklist, value: boolean | string) => {
    console.log('🔄 Updating checklist:', { field, value, visitId: visit.id });
    
    // Temporary local state update for testing
    if (checklist) {
      const updatedChecklist = { ...checklist, [field]: value };
      
      // Force re-render
      queryClient.setQueryData(['discharge-checklist', visit.id], updatedChecklist);
    }
    
    // Try database update
    try {
      createOrUpdateChecklistMutation.mutate({ [field]: value });
    } catch (error) {
      console.error('❌ Database update failed:', error);
    }
  };

  const handleDateChange = (date: Date | undefined) => {
    if (date) {
      setDischargeDate(date);
      updateDischargeDateMutation.mutate(date);
    }
  };

  const handleCurrentDateToggle = (checked: boolean) => {
    setUseCurrentDate(checked);
    if (checked) {
      const now = new Date();
      setDischargeDate(now);
      updateDischargeDateMutation.mutate(now);
    }
  };

  const isDischargeReady = checklist && 
    checklist.doctor_signature &&
    checklist.discharge_summary_uploaded &&
    checklist.nurse_clearance &&
    checklist.pharmacy_clearance &&
    checklist.final_bill_printed &&
    checklist.payment_verified &&
    checklist.patient_signature &&
    checklist.security_verification &&
    dischargeDate;

  // Gate pass generation - requires ALL checklist items to be completed + required fields
  // ACTIVATED FOR TESTING - Button will be enabled when checklist is complete
  const canGenerateGatePass = checklist && 
    checklist.doctor_signature &&
    checklist.discharge_summary_uploaded &&
    checklist.nurse_clearance &&
    checklist.pharmacy_clearance &&
    checklist.final_bill_generated &&
    checklist.final_bill_printed &&
    checklist.payment_verified &&
    checklist.patient_signature &&
    checklist.security_verification &&
    dischargeDate &&
    checklist.discharge_mode &&
    checklist.authorized_by &&
    checklist.authorized_by.trim() !== '' &&
    !thumbConfirmationLoading &&
    !!thumbConfirmation;

  const isPrintButtonsEnabled = !!dischargeDate; // Enable when discharge date is set
  const isChecklistEnabled = !!dischargeDate;

  // Calculate checklist completion percentage
  const checklistItems = [
    'doctor_signature',
    'discharge_summary_uploaded', 
    'nurse_clearance',
    'pharmacy_clearance',
    'final_bill_generated',
    'final_bill_printed',
    'payment_verified',
    'patient_signature',
    'security_verification'
  ];
  
  const completedItems = checklistItems.filter(item => 
    checklist?.[item as keyof DischargeChecklist] === true
  ).length;
  
  const completionPercentage = checklistItems.length > 0 
    ? Math.round((completedItems / checklistItems.length) * 100) 
    : 0;



  return (
    <TooltipProvider>
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Discharge Workflow - {visit.patients.name}
            <Badge variant="outline">{visit.visit_id}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Discharge Date Section */}
          <div className="space-y-4">
            <Label className="text-base font-semibold">Step 1: Discharge Date & Time</Label>
            <div className="flex items-center gap-4">
              <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-[280px] justify-start text-left font-normal"
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dischargeDate ? format(dischargeDate, "PPP") : "Select discharge date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={dischargeDate}
                    onSelect={(date) => {
                      handleDateChange(date);
                      setIsCalendarOpen(false);
                    }}
                    className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
              
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="current-date"
                  checked={useCurrentDate}
                  onCheckedChange={handleCurrentDateToggle}
                />
                <Label htmlFor="current-date">Use current date/time</Label>
              </div>
            </div>
          </div>

          {/* Discharge Checklist */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label className="text-base font-semibold">Step 2: Discharge Checklist</Label>
              {dischargeDate && (
                <Badge variant="outline" className="ml-2">
                  {completedItems}/{checklistItems.length} completed ({completionPercentage}%)
                </Badge>
              )}
            </div>
            
            {!dischargeDate && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <span className="text-sm font-medium text-amber-800">
                    Please select a discharge date first to enable the checklist
                  </span>
                </div>
              </div>
            )}
            
            {dischargeDate && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-blue-600" />
                  <span className="text-sm font-medium text-blue-800">
                    Complete all checklist items below to enable printing documents
                  </span>
                </div>
              </div>
            )}
            
            
            <div className={`grid grid-cols-1 md:grid-cols-2 gap-4 ${!isChecklistEnabled ? 'opacity-50 pointer-events-none' : ''}`}>
              {[
                { key: 'doctor_signature', label: 'Doctor Signature', icon: FileText },
                { key: 'discharge_summary_uploaded', label: 'Discharge Summary Uploaded', icon: FileText },
                { key: 'nurse_clearance', label: 'Nurse Clearance', icon: CheckCircle },
                { key: 'pharmacy_clearance', label: 'Pharmacy Clearance', icon: CheckCircle },
                { key: 'final_bill_generated', label: 'Final Bill Generated', icon: FileText },
                { key: 'final_bill_printed', label: 'Final Bill Printed', icon: Printer },
                { key: 'payment_verified', label: 'Payment Verified', icon: CheckCircle },
                { key: 'patient_signature', label: 'Patient Signature (P6, P2, IDs, Referral, Final Bill, Discharge Summary)', icon: FileText },
                { key: 'security_verification', label: 'Security Verification', icon: Shield },
              ].map(({ key, label, icon: Icon }) => (
                <div 
                  key={key} 
                  className="flex items-center space-x-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50"
                  onClick={() => {
                    if (!checklistLoading && isChecklistEnabled) {
                      const currentValue = checklist?.[key as keyof DischargeChecklist] as boolean || false;
                      console.log('🔄 Row clicked:', { key, currentValue, newValue: !currentValue });
                      handleChecklistUpdate(key as keyof DischargeChecklist, !currentValue);
                    }
                  }}
                >
                  <Checkbox
                    id={key}
                    checked={checklist?.[key as keyof DischargeChecklist] as boolean || false}
                    onCheckedChange={(checked) => {
                      console.log('🔄 Checkbox clicked:', { key, checked });
                      handleChecklistUpdate(key as keyof DischargeChecklist, checked as boolean);
                    }}
                    disabled={checklistLoading || !isChecklistEnabled}
                    className="w-4 h-4"
                  />
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <Label htmlFor={key} className="flex-1 cursor-pointer">{label}</Label>
                  {checklist?.[key as keyof DischargeChecklist] ? (
                    <CheckCircle className="h-4 w-4 text-green-500" />
                  ) : (
                    <XCircle className="h-4 w-4 text-red-500" />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Discharge Mode */}
          <div className={`space-y-2 ${!isChecklistEnabled ? 'opacity-50 pointer-events-none' : ''}`}>
            <Label htmlFor="discharge-mode">Discharge Mode</Label>
            <Select
              value={checklist?.discharge_mode || 'recovery'}
              onValueChange={(value) => handleChecklistUpdate('discharge_mode', value)}
              disabled={!isChecklistEnabled}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select discharge mode" />
              </SelectTrigger>
              <SelectContent>
                {DISCHARGE_MODES.map((mode) => (
                  <SelectItem key={mode.value} value={mode.value}>
                    {mode.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Authorized By */}
          <div className={`space-y-2 ${!isChecklistEnabled ? 'opacity-50 pointer-events-none' : ''}`}>
            <Label htmlFor="authorized-by">Authorized By</Label>
            <Input
              id="authorized-by"
              value={checklist?.authorized_by || ''}
              onChange={(e) => handleChecklistUpdate('authorized_by', e.target.value)}
              placeholder="Enter authorizing doctor/staff name"
              disabled={!isChecklistEnabled}
            />
          </div>

          {/* Notes */}
          <div className={`space-y-2 ${!isChecklistEnabled ? 'opacity-50 pointer-events-none' : ''}`}>
            <Label htmlFor="notes">Discharge Notes</Label>
            <Textarea
              id="notes"
              value={checklist?.notes || ''}
              onChange={(e) => handleChecklistUpdate('notes', e.target.value)}
              placeholder="Enter any additional discharge notes..."
              rows={3}
              disabled={!isChecklistEnabled}
            />
          </div>

          {/* Status Indicator */}
          <div className="flex items-center gap-2 p-4 rounded-lg bg-muted">
            {isDischargeReady ? (
              <>
                <CheckCircle className="h-5 w-5 text-green-500" />
                <span className="font-medium text-green-700">Ready for Discharge</span>
              </>
            ) : !dischargeDate ? (
              <>
                <AlertCircle className="h-5 w-5 text-amber-500" />
                <span className="font-medium text-amber-700">Please Select Discharge Date</span>
              </>
            ) : (
              <>
                <AlertCircle className="h-5 w-5 text-amber-500" />
                <span className="font-medium text-amber-700">
                  Discharge Checklist Incomplete ({completedItems}/{checklistItems.length} completed)
                </span>
              </>
            )}
          </div>

          {/* Print Buttons - Step 3 */}
          <div className="space-y-4">
            <Label className="text-base font-semibold">Step 3: Print Documents</Label>
            <div className={`flex flex-wrap gap-3 ${!isPrintButtonsEnabled ? 'opacity-50' : ''}`}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    disabled={!isPrintButtonsEnabled}
                    onClick={() => window.open(`/discharge-summary/${visit.visit_id}`, '_blank')}
                  >
                    <Printer className="mr-2 h-4 w-4" />
                    Discharge Summary
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {!isPrintButtonsEnabled ? "Please select a discharge date first" : "Print discharge summary"}
                </TooltipContent>
              </Tooltip>
              
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    disabled={!isPrintButtonsEnabled}
                    onClick={() => window.open(`/pvi-form/${visit.visit_id}`, '_blank')}
                  >
                    <FileText className="mr-2 h-4 w-4" />
                    PVI Form (Feedback)
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {!isPrintButtonsEnabled ? "Please select a discharge date first" : "Print PVI form"}
                </TooltipContent>
              </Tooltip>
              
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    disabled={!isPrintButtonsEnabled || !checklist?.gate_pass_generated}
                    onClick={() => setIsGatePassModalOpen(true)}
                  >
                    <Shield className="mr-2 h-4 w-4" />
                    Gate Pass
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {!isPrintButtonsEnabled 
                    ? "Please select a discharge date first" 
                    : !checklist?.gate_pass_generated 
                    ? "Please generate gate pass first by completing all checklist items"
                    : "View and print gate pass"}
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    disabled={!isPrintButtonsEnabled}
                    onClick={() => {/* TODO: Add final bill print functionality */}}
                  >
                    <FileText className="mr-2 h-4 w-4" />
                    Final Bill
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {!isPrintButtonsEnabled ? "Please select a discharge date first" : "Print final bill"}
                </TooltipContent>
              </Tooltip>
            </div>
          </div>

          {/* Generate Gate Pass Button */}
          {canGenerateGatePass && !checklist?.gate_pass_generated && (
            <div className="space-y-3">
              <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                  <span className="text-sm font-medium text-green-800">
                    All checklist items completed! Gate Pass can now be generated.
                  </span>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={() => {
                    console.log('🚀 Generate Gate Pass button clicked!');
                    console.log('📋 Checklist data:', checklist);
                    console.log('📅 Discharge date:', dischargeDate);
                    generateGatePassMutation.mutate();
                  }}
                  disabled={generateGatePassMutation.isPending}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                >
                  <Shield className="mr-2 h-4 w-4" />
                  {generateGatePassMutation.isPending ? 'Generating...' : 'Generate Gate Pass'}
                </Button>
                <Button
                  onClick={() => {
                    console.log('🖨️ Print Gate Pass button clicked!');
                    window.open(`/gate-pass/${visit.visit_id}`, '_blank');
                  }}
                  variant="outline"
                  className="bg-green-600 hover:bg-green-700 text-white border-green-600"
                >
                  <Printer className="mr-2 h-4 w-4" />
                  Print
                </Button>
                <Button
                  onClick={() => {
                    console.log('👁️ View Gate Pass button clicked!');
                    setIsGatePassModalOpen(true);
                  }}
                  variant="outline"
                  className="bg-purple-600 hover:bg-purple-700 text-white border-purple-600"
                >
                  <Shield className="mr-2 h-4 w-4" />
                  View
                </Button>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex justify-end gap-3 pt-6 border-t">
            <Button
              variant="outline"
              onClick={onClose}
              className="min-w-[100px]"
            >
              Close
            </Button>
            <Button
              onClick={() => {
                toast({
                  title: "Changes Saved",
                  description: "All discharge workflow changes have been saved successfully.",
                });
              }}
              className="min-w-[100px] bg-green-600 hover:bg-green-700 text-white"
            >
              Save Changes
            </Button>
          </div>

          {/* Show what's needed for gate pass */}
          {!canGenerateGatePass && dischargeDate && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-amber-600" />
                <span className="text-sm font-medium text-amber-800">
                  To generate Gate Pass: Complete ALL checklist items above (9/9 required) + Fill required fields (Authorized By) + Upload the portal thumb confirmation photo
                </span>
              </div>
              {(!checklist?.authorized_by || checklist.authorized_by.trim() === '') && (
                <div className="mt-2 text-sm text-amber-700">
                  • Missing: Authorized By field
                </div>
              )}
              {!thumbConfirmationLoading && !thumbConfirmation && (
                <div className="mt-2 text-sm text-amber-700">
                  • Missing: Portal thumb confirmation photo (upload it from the tablet's Advance Statement Arshiya tile)
                </div>
              )}
            </div>
          )}

          {/* Gate Pass Modal */}
          <GatePassModal
            visitId={visit.visit_id}
            isOpen={isGatePassModalOpen}
            onClose={() => setIsGatePassModalOpen(false)}
            onDischarge={() => {
              console.log('🏥 Discharge function called from GatePassModal');
              dischargePatientMutation.mutate();
              setIsGatePassModalOpen(false);
            }}
          />
        </CardContent>
      </Card>
    </TooltipProvider>
  );
};