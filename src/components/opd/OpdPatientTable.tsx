import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useNavigate } from 'react-router-dom';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { X, Check, Eye, FileText, UserCheck, Trash2, DollarSign, MessageSquare, FileTextIcon, Activity, ClipboardEdit, Circle, Loader2, ScanLine } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { VisitRegistrationForm } from '@/components/VisitRegistrationForm';
import { supabase } from '@/integrations/supabase/client';
import { useDebounce } from 'use-debounce';
import { useAuth } from '@/contexts/AuthContext';
import { printSticker } from '@/utils/stickerPrinter';
import { useQuery } from '@tanstack/react-query';
import { RefereeDoaPaymentModal } from '@/components/ipd/RefereeDoaPaymentModal';
import { MriOrderModal } from '@/components/ipd/MriOrderModal';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { calculateReferralAmount, formatIndianCurrency } from '@/utils/referralCalculator';
import { Checkbox } from '@/components/ui/checkbox';
import { format } from 'date-fns';
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface Patient {
  id: string;
  visit_id?: string;
  patient_id?: string;
  patients?: {
    id: string;
    name: string;
    gender?: string;
    age?: number;
    date_of_birth?: string;
    patients_id?: string;
    corporate?: string;
  };
  referees?: {
    id: string;
    name: string;
  };
  relationship_managers?: {
    id?: string;
    name?: string;
    code?: string;
  };
  referee_doa_amt_paid?: number | null;
  referral_payment_status?: string | null;
  visit_type?: string;
  appointment_with?: string;
  diagnosis?: string;
  reason_for_visit?: string;
  admit_to_hospital?: boolean;
  payment_received?: boolean;
  status?: string;
  comments?: string;
  discharge_summary?: string;
  is_discharged?: boolean;
  discharge_date?: string;
  discharge_intimation_at?: string | null;
}

interface OpdPatientTableProps {
  patients: Patient[];
  refetch?: () => void;
  isMarketingManager?: boolean;
  emptyMessage?: string;
}

// Referee DOA Amount Cell with Payment Modal and Referral Tooltip
const RefereeAmountCell = ({
  patient,
  onUpdate
}: {
  patient: Patient;
  onUpdate?: () => void;
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Fetch total payments for this visit
  const { data: payments = [], isLoading } = useQuery({
    queryKey: ['referee-doa-payments-total', patient.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('referee_doa_payments')
        .select('amount')
        .eq('visit_id', patient.id);

      if (error) {
        console.error('Error fetching payments:', error);
        return [];
      }
      return data || [];
    },
    staleTime: 30000
  });

  // Fetch Amount Paid Total from advance_payment table
  const { data: advancePayments } = useQuery({
    queryKey: ['advance-payment-total-opd', patient.visit_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('advance_payment')
        .select('advance_amount')
        .eq('visit_id', patient.visit_id)
        .eq('status', 'ACTIVE')
        .eq('is_refund', false);

      if (error) {
        console.error('Error fetching advance payments:', error);
        return [];
      }
      return data || [];
    },
    enabled: !!patient.visit_id,
    staleTime: 60000
  });

  // Calculate totals
  const totalPaid = payments.reduce((sum: number, p: any) => sum + Number(p.amount), 0);

  // Total Bill = Sum of advance payments
  const totalBillAmount = advancePayments?.reduce((sum: number, p: any) =>
    sum + (parseFloat(p.advance_amount?.toString() || '0') || 0), 0) || 0;

  // Referral calculation
  const billItems: Array<{ description: string; amount: number }> = [];
  const corporate = patient.patients?.corporate?.toLowerCase() || '';
  const isPrivate = !corporate || corporate === 'private' || corporate.trim() === '';
  const patientType = isPrivate ? 'Private' : 'Yojna';
  const referralBreakdown = calculateReferralAmount(billItems, patientType as 'Private' | 'Yojna', totalBillAmount);
  const remaining = Math.max(0, referralBreakdown.finalAmount - totalPaid);

  // Create visit object for modal (needs visit_id and patients)
  const visitForModal = {
    id: patient.id,
    visit_id: patient.visit_id || '',
    patients: patient.patients
  };

  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={totalPaid > 0 ? "default" : "outline"}
              size="sm"
              className={`h-6 px-2 text-xs ${totalPaid > 0 ? 'bg-green-600 hover:bg-green-700' : ''}`}
              onClick={() => setIsModalOpen(true)}
              disabled={isLoading}
            >
              {isLoading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : totalPaid > 0 ? (
                `₹${totalPaid.toLocaleString()}`
              ) : (
                'Pay'
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left" className="w-72 p-3 bg-white border shadow-lg">
            <div className="space-y-2 text-sm">
              {/* Total Bill Amount from advance_payment */}
              <div className="flex justify-between bg-blue-50 p-2 rounded font-bold text-blue-800">
                <span>Total Bill:</span>
                <span>{formatIndianCurrency(totalBillAmount)}</span>
              </div>

              <div className="font-semibold text-gray-800 border-b pb-1">
                Referral Calculation ({patientType})
              </div>

              <div className="flex justify-between">
                <span className="text-gray-600">Gross Amount:</span>
                <span className="font-medium">{formatIndianCurrency(referralBreakdown.grossAmount)}</span>
              </div>

              {Object.keys(referralBreakdown.deductions).length > 0 && (
                <div className="text-xs text-gray-500 pl-2 border-l-2 border-gray-200">
                  {Object.entries(referralBreakdown.deductions).map(([cat, amt]) => (
                    <div key={cat} className="flex justify-between">
                      <span>{cat}:</span>
                      <span>-{formatIndianCurrency(amt as number)}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex justify-between">
                <span className="text-gray-600">Total Deductions:</span>
                <span className="font-medium text-red-600">-{formatIndianCurrency(referralBreakdown.totalDeductions)}</span>
              </div>

              <div className="flex justify-between">
                <span className="text-gray-600">Net Amount:</span>
                <span className="font-medium">{formatIndianCurrency(referralBreakdown.netAmount)}</span>
              </div>

              <div className="flex justify-between font-bold text-green-700 border-t pt-1">
                <span>Referral ({referralBreakdown.referralPercentage}%):</span>
                <span>{formatIndianCurrency(referralBreakdown.finalAmount)}</span>
              </div>

              {referralBreakdown.capApplied !== 'none' && (
                <div className="text-xs text-orange-600">
                  Cap applied: {referralBreakdown.capApplied.replace('_', ' ')}
                </div>
              )}

              <div className="border-t pt-2 mt-2">
                <div className="flex justify-between text-blue-600">
                  <span>Paid:</span>
                  <span>{formatIndianCurrency(totalPaid)}</span>
                </div>
                <div className="flex justify-between font-bold">
                  <span>Remaining:</span>
                  <span className={remaining > 0 ? 'text-red-600' : 'text-green-600'}>
                    {formatIndianCurrency(remaining)}
                  </span>
                </div>
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <RefereeDoaPaymentModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        visit={visitForModal}
        onUpdate={onUpdate}
      />
    </>
  );
};

// Referral Payment Status Cell - displays latest referral_payment_status from referee_doa_payments
const ReferralPaymentStatusCell = ({ patient }: { patient: Patient }) => {
  const { data: latestStatus, isLoading } = useQuery({
    queryKey: ['referee-doa-payment-status', patient.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('referee_doa_payments')
        .select('referral_payment_status')
        .eq('visit_id', patient.id)
        .order('payment_date', { ascending: false })
        .limit(1);

      if (error) {
        console.error('Error fetching referral payment status:', error);
        return null;
      }
      return data?.[0]?.referral_payment_status || null;
    },
    staleTime: 30000
  });

  if (isLoading) {
    return <Loader2 className="h-3 w-3 animate-spin" />;
  }

  return <span className="text-xs">{latestStatus || '-'}</span>;
};

export const OpdPatientTable = ({ patients, refetch, isMarketingManager = false, emptyMessage = 'No OPD patients found for today' }: OpdPatientTableProps) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { isAdmin, user } = useAuth();

  // Allowed emails to see Referral Doctor/Relationship Manager column
  const ALLOWED_REFERRAL_COLUMN_EMAILS = [
    'marketingmanager@hope.com',
    'marketingmanager@ayushman.com'
  ];
  const canSeeReferralColumn = user?.role === 'superadmin' || user?.role === 'ca' || ALLOWED_REFERRAL_COLUMN_EMAILS.includes(user?.email?.toLowerCase() || '');

  const [selectedPatientForVisit, setSelectedPatientForVisit] = useState<Patient | null>(null);
  const [isVisitFormOpen, setIsVisitFormOpen] = useState(false);
  const [hiddenPatients, setHiddenPatients] = useState<Set<string>>(new Set());
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [selectedPatientForView, setSelectedPatientForView] = useState<Patient | null>(null);

  // Comment state management
  const [commentDialogs, setCommentDialogs] = useState<Record<string, boolean>>({});
  const [commentTexts, setCommentTexts] = useState<Record<string, string>>({});
  const [originalComments, setOriginalComments] = useState<Record<string, string>>({});
  const [savingComments, setSavingComments] = useState<Record<string, boolean>>({});
  const [savedComments, setSavedComments] = useState<Record<string, boolean>>({});

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [radiologyModalOpen, setRadiologyModalOpen] = useState(false);
  const [selectedVisitForRadiology, setSelectedVisitForRadiology] = useState<Patient | null>(null);

  const visiblePatients = patients.filter(patient => !hiddenPatients.has(patient.visit_id || ''));
  const totalPages = Math.ceil(visiblePatients.length / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedPatients = visiblePatients.slice(startIndex, endIndex);

  const goToPreviousPage = () => setCurrentPage(Math.max(1, currentPage - 1));
  const goToNextPage = () => setCurrentPage(Math.min(totalPages, currentPage + 1));

  const getPageNumbers = () => {
    const maxVisiblePages = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
    const endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
    if (endPage - startPage + 1 < maxVisiblePages) {
      startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }
    return Array.from({ length: endPage - startPage + 1 }, (_, i) => startPage + i);
  };

  // Reset page when patients change
  useEffect(() => { setCurrentPage(1); }, [patients]);

  // Advance payment status tracking
  const [advancePayments, setAdvancePayments] = useState<Record<string, number>>({});
  const [billTotals, setBillTotals] = useState<Record<string, number>>({});

  // Fetch advance payments and bill totals for all patients
  useEffect(() => {
    const fetchPaymentData = async () => {
      if (patients.length === 0) return;

      const visitIds = patients.map(p => p.visit_id).filter(Boolean) as string[];
      const patientIds = patients.map(p => p.patient_id || p.patients?.id).filter(Boolean) as string[];

      if (visitIds.length === 0) return;

      try {
        // Fetch advance payments
        const { data: advanceData, error: advanceError } = await supabase
          .from('advance_payment')
          .select('visit_id, advance_amount')
          .in('visit_id', visitIds);

        if (advanceError) {
          console.error('Error fetching advance payments:', advanceError);
        } else if (advanceData) {
          // Sum advance payments per visit_id
          const advanceSums: Record<string, number> = {};
          advanceData.forEach((payment: { visit_id: string; advance_amount: number }) => {
            if (payment.visit_id) {
              advanceSums[payment.visit_id] = (advanceSums[payment.visit_id] || 0) + (payment.advance_amount || 0);
            }
          });
          setAdvancePayments(advanceSums);
        }

        // Fetch bill totals
        const { data: billData, error: billError } = await supabase
          .from('bills')
          .select('patient_id, total_amount')
          .in('patient_id', patientIds);

        if (billError) {
          console.error('Error fetching bills:', billError);
        } else if (billData) {
          // Map bill totals by patient_id, then we'll map to visit_id
          const billMap: Record<string, number> = {};
          billData.forEach((bill: { patient_id: string; total_amount: number | null }) => {
            if (bill.patient_id) {
              billMap[bill.patient_id] = (billMap[bill.patient_id] || 0) + (bill.total_amount || 0);
            }
          });

          // Convert patient_id to visit_id mapping
          const billByVisit: Record<string, number> = {};
          patients.forEach(p => {
            const patientId = p.patient_id || p.patients?.id;
            if (patientId && p.visit_id && billMap[patientId]) {
              billByVisit[p.visit_id] = billMap[patientId];
            }
          });
          setBillTotals(billByVisit);
        }
      } catch (error) {
        console.error('Error fetching payment data:', error);
      }
    };

    fetchPaymentData();
  }, [patients]);

  // Discharge summary state management - removed (now uses dedicated page)

  // Comment handlers
  const handleCommentClick = (patient: Patient) => {
    console.log('🔔 Comment icon clicked for patient:', {
      id: patient.id,
      visit_id: patient.visit_id,
      patient_name: patient.patients?.name,
      comments: patient.comments,
      has_comments: !!patient.comments,
      comments_length: patient.comments?.length || 0
    });

    const existingComment = patient.comments || '';
    console.log('📄 Loading comment into textarea:', existingComment);

    // Load existing comment if any
    setCommentTexts(prev => ({
      ...prev,
      [patient.id]: existingComment
    }));

    // Store original comment to track changes
    setOriginalComments(prev => ({
      ...prev,
      [patient.id]: existingComment
    }));

    // Open dialog for this visit
    setCommentDialogs(prev => ({
      ...prev,
      [patient.id]: true
    }));

  };

  const handleCommentChange = (visitId: string, text: string) => {
    setCommentTexts(prev => ({
      ...prev,
      [visitId]: text
    }));
  };

  // Debounced function to auto-save comments
  const [debouncedCommentTexts] = useDebounce(commentTexts, 1500); // 1.5 seconds delay

  // Auto-save comments when debounced value changes
  useEffect(() => {
    Object.entries(debouncedCommentTexts).forEach(async ([visitId, text]) => {
      // Only save if dialog is open and text has actually changed from original
      const originalText = originalComments[visitId] || '';
      const hasChanged = text !== originalText;

      if (commentDialogs[visitId] && visitId && visitId !== 'undefined' && text !== undefined && hasChanged) {
        console.log('🔄 Attempting to save comment for visit:', visitId, 'Text:', text, 'Original:', originalText);
        setSavingComments(prev => ({ ...prev, [visitId]: true }));

        try {
          const { error, data } = await supabase
            .from('visits')
            .update({ comments: text })
            .eq('id', visitId)
            .select();

          if (error) {
            console.error('❌ Error saving comment:', error);
            console.error('Error details:', {
              visitId,
              text,
              errorMessage: error.message,
              errorCode: error.code
            });
            alert(`Failed to save comment: ${error.message}`);
            setSavingComments(prev => ({ ...prev, [visitId]: false }));
          } else {
            // Update the original comment after successful save
            setOriginalComments(prev => ({ ...prev, [visitId]: text }));
            // Show saved indicator
            setSavingComments(prev => ({ ...prev, [visitId]: false }));
            setSavedComments(prev => ({ ...prev, [visitId]: true }));
            // Refetch parent data to update the patient list with new comments
            if (refetch) {
              refetch();
            }
            // Hide saved indicator after 2 seconds
            setTimeout(() => {
              setSavedComments(prev => ({ ...prev, [visitId]: false }));
            }, 2000);
          }
        } catch (error) {
          console.error('❌ Exception while saving comment:', error);
          setSavingComments(prev => ({ ...prev, [visitId]: false }));
        }
      }
    });
  }, [debouncedCommentTexts, commentDialogs, originalComments]);

  // Discharge summary handlers - Navigate to dedicated page
  const handleDischargeSummaryClick = (patient: Patient) => {
    if (patient.visit_id) {
      navigate(`/discharge-summary-edit/${patient.visit_id}`);
    } else {
      alert('Visit ID not found for this patient');
    }
  };

  const handlePhysiotherapyBillClick = (patient: Patient) => {
    if (patient.visit_id) {
      navigate(`/physiotherapy-bill/${patient.visit_id}`);
    } else {
      alert('Visit ID not found for this patient');
    }
  };

  const handleAdmissionNotesClick = (patient: Patient) => {
    if (patient.visit_id) {
      navigate(`/opd-admission-notes/${patient.visit_id}`);
    } else {
      alert('Visit ID not found for this patient');
    }
  };

  // Discharge summary change handler - removed (now uses dedicated page)

  // Helper function to format dates
  const formatDate = (dateString?: string | Date | null) => {
    if (!dateString) return 'N/A';
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });
    } catch {
      return 'N/A';
    }
  };

  const calculateAge = (dateOfBirth?: string) => {
    if (!dateOfBirth) {
      return null;
    }

    try {
      const birthDate = new Date(dateOfBirth);

      // Check if date is valid
      if (isNaN(birthDate.getTime())) {
        return null;
      }

      const today = new Date();
      const age = today.getFullYear() - birthDate.getFullYear();
      const monthDiff = today.getMonth() - birthDate.getMonth();

      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        return age - 1;
      }
      return age;
    } catch (error) {
      console.error('Error calculating age:', error);
      return null;
    }
  };

  const handleVisitIdClick = (patientId: string | undefined, visitId: string | undefined) => {
    if (patientId && visitId) {
      navigate(`/patient-profile?patient=${patientId}&visit=${visitId}`);
    } else {
    }
  };

  const handleViewClick = (patient: Patient) => {
    // Open view dialog to show visit registration information
    setSelectedPatientForView(patient);
    setViewDialogOpen(true);
  };

  const handleEditClick = (patient: Patient) => {
    // Open Visit Registration Form with existing patient/visit data for editing
    setSelectedPatientForVisit({ ...patient, isEditMode: true });
    setIsVisitFormOpen(true);
  };

  const handleBillClick = (patient: Patient) => {
    console.log('💰 Bill icon clicked for patient:', {
      visit_id: patient.visit_id,
      patient_id: patient.patient_id || patient.patients?.id,
      patient_name: patient.patients?.name,
      payment_received: patient.payment_received
    });

    if (!patient.visit_id) {
      console.error('❌ Cannot navigate to bill: visit_id is missing');
      alert('Error: Visit ID is missing. Please contact support.');
      return;
    }

    // Validate visit_id format (should not be empty or just whitespace)
    if (patient.visit_id.trim() === '') {
      console.error('❌ Cannot navigate to bill: visit_id is empty');
      alert('Error: Invalid visit ID. Please contact support.');
      return;
    }

    navigate(`/final-bill/${patient.visit_id}`);
  };

  const handleDeleteClick = async (patient: Patient) => {
    if (patient.visit_id && window.confirm(`Are you sure you want to mark the visit for ${patient.patients?.name} as inactive? The record will be preserved for audit purposes.`)) {
      try {
        const { error } = await supabase
          .from('visits')
          .update({ status: 'inactive', updated_at: new Date().toISOString() })
          .eq('id', patient.id);

        if (error) {
          console.error('Error deactivating visit:', error);
          toast({
            title: "Error",
            description: "Failed to deactivate visit: " + error.message,
            variant: "destructive"
          });
          return;
        }

        // Hide from local state
        setHiddenPatients(prev => {
          const newSet = new Set(prev);
          newSet.add(patient.visit_id!);
          return newSet;
        });

        toast({
          title: "Success",
          description: `Visit for ${patient.patients?.name} marked as inactive`,
        });
      } catch (err) {
        console.error('Error deactivating visit:', err);
        toast({
          title: "Error",
          description: "Failed to deactivate visit",
          variant: "destructive"
        });
      }
    }
  };

  const handleRegisterVisitClick = (patient: Patient) => {
    setSelectedPatientForVisit({ ...patient, isEditMode: false });
    setIsVisitFormOpen(true);
  };

  const handleVisitFormClose = () => {
    setIsVisitFormOpen(false);
    setSelectedPatientForVisit(null);
  };

  const renderStatusIcon = (status?: boolean) => {
    if (status === true) {
      return <Check className="h-5 w-5 text-green-600" />;
    } else if (status === false) {
      return <X className="h-5 w-5 text-red-600" />;
    }
    return <X className="h-5 w-5 text-red-600" />;
  };

  const renderPaymentStatus = (patient: Patient) => {
    const paymentReceived = patient.payment_received;

    if (paymentReceived === true) {
      return (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={() => handleBillClick(patient)}
          title="Payment Received - View Bill"
        >
          <DollarSign className="h-4 w-4 text-green-600" />
        </Button>
      );
    } else if (paymentReceived === false) {
      return (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={() => handleBillClick(patient)}
          title="Payment Pending - View Bill"
        >
          <DollarSign className="h-4 w-4 text-red-600" />
        </Button>
      );
    }

    // Default state - show green dollar (same as IPD)
    return (
      <Button
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0"
        onClick={() => handleBillClick(patient)}
        title="View Bill"
      >
        <DollarSign className="h-4 w-4 text-green-600" />
      </Button>
    );
  };

  // Render advance payment status with color coding
  // Red: No payment, Orange: Partial/Advance payment, Green: Full payment
  const renderAdvancePaymentStatus = (patient: Patient) => {
    const visitId = patient.visit_id || '';
    const totalAdvance = advancePayments[visitId] || 0;
    const totalBill = billTotals[visitId] || 0;

    if (totalAdvance === 0) {
      // No payment made - Red
      return (
        <div className="flex justify-center" title="No payment received">
          <Circle className="h-4 w-4 text-red-600 fill-red-600" />
        </div>
      );
    } else if (totalBill > 0 && totalAdvance < totalBill) {
      // Partial payment (advance) - Orange
      return (
        <div className="flex justify-center" title={`Advance payment: ₹${totalAdvance.toLocaleString()} / ₹${totalBill.toLocaleString()}`}>
          <Circle className="h-4 w-4 text-orange-500 fill-orange-500" />
        </div>
      );
    } else {
      // Full payment - Green
      return (
        <div className="flex justify-center" title={`Full payment received: ₹${totalAdvance.toLocaleString()}`}>
          <Circle className="h-4 w-4 text-green-600 fill-green-600" />
        </div>
      );
    }
  };

  if (patients.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="bg-gray-50">
            {/* Print-only columns */}
            <TableHead className="hidden print:table-cell font-medium">Sr No.</TableHead>
            <TableHead className="hidden print:table-cell font-medium">Date</TableHead>
            {/* Screen-only columns */}
            <TableHead className="font-medium print:hidden">Visit ID</TableHead>
            <TableHead className="font-medium">Patient Name</TableHead>
            <TableHead className="font-medium print:hidden">Gender/Age</TableHead>
            <TableHead className="hidden print:table-cell font-medium">Age</TableHead>
            <TableHead className="hidden print:table-cell font-medium">Address</TableHead>
            <TableHead className="font-medium print:hidden">Visit Type</TableHead>
            <TableHead className="font-medium">Doctor</TableHead>
            <TableHead className="font-medium print:hidden">Diagnosis</TableHead>
            <TableHead className="text-center font-medium print:hidden">Payment Received</TableHead>
            <TableHead className="hidden print:table-cell font-medium">Paid Amount</TableHead>
            <TableHead className="font-medium print:hidden">Corporate</TableHead>
            <TableHead className="text-center font-medium print:hidden">Bill</TableHead>
            <TableHead className="text-center font-medium print:hidden">Admit To Hospital</TableHead>
            <TableHead className="text-center font-medium print:hidden">Admission Notes</TableHead>
            {canSeeReferralColumn && <TableHead className="font-medium print:hidden">Referral Doctor/Relationship Manager</TableHead>}
            {/* Only show referral-related columns for marketing managers */}
            {isMarketingManager && <TableHead className="font-medium print:hidden">Referee DOA_Amt Paid</TableHead>}
            {isMarketingManager && <TableHead className="font-medium print:hidden">Referral Payment</TableHead>}
            <TableHead className="text-center font-medium print:hidden">Physiotherapy Bill</TableHead>
            <TableHead className="text-center font-medium print:hidden">Discharge Intimation</TableHead>
            <TableHead className="text-center font-medium print:hidden">Stickers</TableHead>
            <TableHead className="text-center font-medium print:hidden">OPD Summary</TableHead>
            <TableHead className="text-center font-medium print:hidden">Radiology</TableHead>
            <TableHead className="text-center font-medium print:hidden">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {paginatedPatients.map((patient, index) => (
            <TableRow key={patient.id}>
              {/* Print-only: Sr No. */}
              <TableCell className="hidden print:table-cell text-center">
                {startIndex + index + 1}
              </TableCell>
              {/* Print-only: Date */}
              <TableCell className="hidden print:table-cell">
                {patient.created_at ? new Date(patient.created_at).toLocaleDateString('en-IN') : '-'}
              </TableCell>
              {/* Screen-only: Visit ID */}
              <TableCell className="font-mono text-sm print:hidden">
                <button
                  onClick={() => handleVisitIdClick(patient.patient_id || patient.patients?.id, patient.visit_id)}
                  className="text-blue-600 hover:text-blue-800 hover:underline font-medium transition-colors"
                >
                  {patient.visit_id || 'N/A'}
                </button>
              </TableCell>
              {/* Both: Patient Name */}
              <TableCell>
                <div>
                  <div className="font-medium">{patient.patients?.name || 'Unknown'}</div>
                  <div className="text-xs text-muted-foreground print:hidden">
                    {patient.patients?.patients_id || 'No ID'}
                  </div>
                </div>
              </TableCell>
              {/* Screen-only: Gender/Age */}
              <TableCell className="print:hidden">
                {(() => {
                  const gender = patient.patients?.gender || 'Unknown';

                  // First try to use the age field from database
                  if (patient.patients?.age !== undefined && patient.patients?.age !== null) {
                    return `${gender}/${patient.patients.age} Years`;
                  }

                  // Fallback to calculating from date_of_birth
                  const calculatedAge = calculateAge(patient.patients?.date_of_birth);
                  if (calculatedAge !== null) {
                    return `${gender}/${calculatedAge} Years`;
                  }

                  return `${gender}/Age N/A`;
                })()}
              </TableCell>
              {/* Print-only: Age */}
              <TableCell className="hidden print:table-cell">
                {patient.patients?.age !== undefined && patient.patients?.age !== null
                  ? `${patient.patients.age} Yrs`
                  : calculateAge(patient.patients?.date_of_birth) !== null
                    ? `${calculateAge(patient.patients?.date_of_birth)} Yrs`
                    : '-'}
              </TableCell>
              {/* Print-only: Location */}
              <TableCell className="hidden print:table-cell">
                {patient.patients?.address || patient.patients?.city_town || '-'}
              </TableCell>
              {/* Screen-only: Visit Type */}
              <TableCell className="print:hidden">
                <Badge variant="outline" className="capitalize">
                  {patient.visit_type || 'General'}
                </Badge>
              </TableCell>
              {/* Both: Doctor */}
              <TableCell>
                {patient.appointment_with || 'Not Assigned'}
              </TableCell>
              {/* Screen-only: Diagnosis */}
              <TableCell className="print:hidden">
                {patient.diagnosis || 'General'}
              </TableCell>
              {/* Screen-only: Payment Received status */}
              <TableCell className="text-center print:hidden">
                {renderAdvancePaymentStatus(patient)}
              </TableCell>
              {/* Print-only: Paid Amount */}
              <TableCell className="hidden print:table-cell text-right">
                {(() => {
                  const visitId = patient.visit_id;
                  const amount = advancePayments[visitId];
                  return amount ? `₹${amount}` : '-';
                })()}
              </TableCell>
              {/* Screen-only: Corporate */}
              <TableCell className="print:hidden">
                {patient.patients?.corporate || '-'}
              </TableCell>
              {/* Screen-only: Bill */}
              <TableCell className="text-center print:hidden">
                {renderPaymentStatus(patient)}
              </TableCell>
              {/* Screen-only: Admit To Hospital */}
              <TableCell className="text-center print:hidden">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => handleRegisterVisitClick(patient)}
                  title="Register Visit"
                >
                  <UserCheck className="h-4 w-4 text-blue-600" />
                </Button>
              </TableCell>
              {/* Screen-only: Admission Notes */}
              <TableCell className="text-center print:hidden">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => handleAdmissionNotesClick(patient)}
                  title="View/Add Admission Notes"
                >
                  <ClipboardEdit className="h-4 w-4 text-amber-600" />
                </Button>
              </TableCell>
              {/* Screen-only: Referral Doctor - Only for specific marketing managers */}
              {canSeeReferralColumn && (
                <TableCell className="print:hidden text-xs">
                  <div>{patient.referees?.name || '-'}</div>
                  {patient.relationship_managers?.code && (
                    <div>{patient.relationship_managers.code}</div>
                  )}
                </TableCell>
              )}
              {/* Screen-only: Referee Amount - Only show for marketing managers */}
              {isMarketingManager && (
                <TableCell className="print:hidden">
                  <RefereeAmountCell patient={patient} onUpdate={refetch} />
                </TableCell>
              )}
              {isMarketingManager && (
                <TableCell className="print:hidden">
                  <ReferralPaymentStatusCell patient={patient} />
                </TableCell>
              )}
              {/* Screen-only: Physiotherapy Bill */}
              <TableCell className="text-center print:hidden">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => handlePhysiotherapyBillClick(patient)}
                  title="View/Add Physiotherapy Bill"
                >
                  <Activity className="h-4 w-4 text-teal-600" />
                </Button>
              </TableCell>
              {/* Screen-only: Discharge Intimation */}
              <TableCell className="text-center print:hidden">
                {patient.discharge_intimation_at ? (
                  <div className="flex flex-col items-center gap-1">
                    <Checkbox checked={true} disabled className="data-[state=checked]:bg-green-600" />
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(patient.discharge_intimation_at), 'MMM dd, HH:mm')}
                    </span>
                  </div>
                ) : (
                  <Checkbox
                    checked={false}
                    onCheckedChange={async () => {
                      const now = new Date().toISOString();
                      try {
                        const { error } = await supabase
                          .from('visits')
                          .update({ discharge_intimation_at: now })
                          .eq('visit_id', patient.visit_id);
                        if (error) {
                          console.error('Error updating discharge intimation:', error);
                          return;
                        }
                        if (refetch) refetch();
                      } catch (error) {
                        console.error('Error:', error);
                      }
                    }}
                  />
                )}
              </TableCell>
              {/* Screen-only: Stickers */}
              <TableCell className="text-center print:hidden">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => printSticker({
                    patientName: patient.patients?.name || 'N/A',
                    uhid: patient.patients?.patients_id || 'N/A',
                    visitId: patient.visit_id || 'N/A',
                    age: patient.patients?.age?.toString() || 'N/A',
                    gender: patient.patients?.gender || 'N/A',
                    consultant: patient.appointment_with || 'N/A',
                    department: patient.visit_type || 'OPD',
                    tariff: patient.patients?.corporate || 'Private'
                  })}
                >
                  Print Sticker
                </Button>
              </TableCell>
              {/* Screen-only: OPD Summary */}
              <TableCell className="text-center print:hidden">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => handleDischargeSummaryClick(patient)}
                  title="View/Add OPD Summary"
                >
                  <FileTextIcon className="h-4 w-4 text-purple-600" />
                </Button>
              </TableCell>
              {/* Screen-only: Radiology */}
              <TableCell className="text-center print:hidden">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 hover:bg-violet-50"
                  onClick={() => { setSelectedVisitForRadiology(patient); setRadiologyModalOpen(true); }}
                  title="Add Radiology Order"
                >
                  <ScanLine className="h-4 w-4 text-violet-600" />
                </Button>
              </TableCell>
              {/* Screen-only: Actions */}
              <TableCell className="print:hidden">
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => handleViewClick(patient)}
                    title="View Patient"
                  >
                    <Eye className="h-4 w-4 text-blue-600" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => handleEditClick(patient)}
                    title="Edit Patient"
                  >
                    <FileText className="h-4 w-4 text-blue-600" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => handleCommentClick(patient)}
                    title="View/Add Comments"
                  >
                    <MessageSquare className="h-4 w-4 text-green-600" />
                  </Button>
                  {isAdmin && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0"
                      onClick={() => handleDeleteClick(patient)}
                      title="Mark Visit Inactive"
                    >
                      <Trash2 className="h-4 w-4 text-orange-600" />
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-2 py-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              Showing {startIndex + 1} to {Math.min(endIndex, visiblePatients.length)} of {visiblePatients.length} patients
            </span>
            <Select value={pageSize.toString()} onValueChange={(value) => { setPageSize(Number(value)); setCurrentPage(1); }}>
              <SelectTrigger className="w-20 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="25">25</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  onClick={goToPreviousPage}
                  className={currentPage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                />
              </PaginationItem>
              {getPageNumbers().map((pageNumber) => (
                <PaginationItem key={pageNumber}>
                  <PaginationLink
                    onClick={() => setCurrentPage(pageNumber)}
                    isActive={currentPage === pageNumber}
                    className="cursor-pointer"
                  >
                    {pageNumber}
                  </PaginationLink>
                </PaginationItem>
              ))}
              <PaginationItem>
                <PaginationNext
                  onClick={goToNextPage}
                  className={currentPage === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}

      {/* View Visit Dialog - Shows visit registration information in read-only format */}
      {selectedPatientForView && (
        <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-xl font-semibold text-blue-600">
                Visit Information
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              {/* Patient Information */}
              <div className="bg-gray-50 p-4 rounded-lg">
                <h3 className="font-semibold text-gray-700 mb-2">Patient Details</h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="font-medium text-gray-600">Name:</span> {selectedPatientForView.patients?.name || 'N/A'}
                  </div>
                  <div>
                    <span className="font-medium text-gray-600">Patient ID:</span> {selectedPatientForView.patients?.patients_id || 'N/A'}
                  </div>
                  <div>
                    <span className="font-medium text-gray-600">Gender:</span> {selectedPatientForView.patients?.gender || 'N/A'}
                  </div>
                  <div>
                    <span className="font-medium text-gray-600">Age:</span> {selectedPatientForView.patients?.age || 'N/A'} years
                  </div>
                </div>
              </div>

              {/* Visit Information */}
              <div className="bg-blue-50 p-4 rounded-lg">
                <h3 className="font-semibold text-blue-700 mb-2">Visit Details</h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="font-medium text-gray-600">Visit ID:</span> <span className="text-blue-600 font-mono">{selectedPatientForView.visit_id}</span>
                  </div>
                  <div>
                    <span className="font-medium text-gray-600">Visit Date:</span> {selectedPatientForView.visit_date ? new Date(selectedPatientForView.visit_date).toLocaleDateString() : 'N/A'}
                  </div>
                  <div>
                    <span className="font-medium text-gray-600">Visit Type:</span> {selectedPatientForView.visit_type || 'N/A'}
                  </div>
                  <div>
                    <span className="font-medium text-gray-600">Patient Type:</span> <span className="px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs">{selectedPatientForView.patient_type || 'OPD'}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="font-medium text-gray-600">Doctor/Appointment With:</span> {selectedPatientForView.appointment_with || 'Not specified'}
                  </div>
                  <div className="col-span-2">
                    <span className="font-medium text-gray-600">Reason for Visit:</span> {selectedPatientForView.reason_for_visit || 'N/A'}
                  </div>
                </div>
              </div>

              {/* Additional Information */}
              <div className="bg-green-50 p-4 rounded-lg">
                <h3 className="font-semibold text-green-700 mb-2">Additional Information</h3>
                <div className="space-y-2 text-sm">
                  <div>
                    <span className="font-medium text-gray-600">Status:</span>
                    <span className={`ml-2 px-2 py-1 rounded-full text-xs ${
                      selectedPatientForView.status === 'completed' ? 'bg-green-100 text-green-700' :
                      selectedPatientForView.status === 'in_progress' ? 'bg-yellow-100 text-yellow-700' :
                      selectedPatientForView.status === 'scheduled' ? 'bg-blue-100 text-blue-700' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {selectedPatientForView.status || 'N/A'}
                    </span>
                  </div>
                  <div>
                    <span className="font-medium text-gray-600">Diagnosis:</span> {selectedPatientForView.diagnosis || 'General'}
                  </div>
                  <div>
                    <span className="font-medium text-gray-600">Relation with Employee:</span> {selectedPatientForView.relation_with_employee || 'N/A'}
                  </div>
                  <div>
                    <span className="font-medium text-gray-600">Claim ID:</span> {selectedPatientForView.claim_id || 'N/A'}
                  </div>
                  <div>
                    <span className="font-medium text-gray-600">Referring Doctor:</span> {selectedPatientForView.referring_doctor || 'N/A'}
                  </div>
                </div>
              </div>

              {/* Timestamps */}
              <div className="bg-gray-50 p-4 rounded-lg">
                <h3 className="font-semibold text-gray-700 mb-2">Record Information</h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="font-medium text-gray-600">Created At:</span> {selectedPatientForView.created_at ? new Date(selectedPatientForView.created_at).toLocaleString() : 'N/A'}
                  </div>
                  <div>
                    <span className="font-medium text-gray-600">Updated At:</span> {selectedPatientForView.updated_at ? new Date(selectedPatientForView.updated_at).toLocaleString() : 'N/A'}
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex justify-end gap-2 pt-4 border-t">
                <Button
                  variant="outline"
                  onClick={() => {
                    setViewDialogOpen(false);
                    setSelectedPatientForView(null);
                  }}
                >
                  Close
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Visit Registration Form Dialog - Used for both Register Visit and Edit */}
      {selectedPatientForVisit && (
        <VisitRegistrationForm
          isOpen={isVisitFormOpen}
          onClose={handleVisitFormClose}
          patient={{
            id: selectedPatientForVisit.patient_id || selectedPatientForVisit.patients?.id || '',
            name: selectedPatientForVisit.patients?.name || 'Unknown',
            patients_id: selectedPatientForVisit.patients?.patients_id
          }}
          existingVisit={selectedPatientForVisit.isEditMode ? selectedPatientForVisit : undefined}  // Pass visit data only when editing
          editMode={selectedPatientForVisit.isEditMode || false}  // Set edit mode based on action
        />
      )}

      {/* Comment Dialogs */}
      {patients.map((patient) => (
        <Dialog
          key={patient.id}
          open={commentDialogs[patient.id] || false}
          onOpenChange={(open) => {
            setCommentDialogs(prev => ({
              ...prev,
              [patient.id]: open
            }));
          }}
        >
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Comments for {patient.patients?.name || 'Patient'}</DialogTitle>
              <DialogDescription className="text-xs">
                Visit ID: {patient.visit_id} | Auto-saves as you type
              </DialogDescription>
            </DialogHeader>

            <div className="relative">
              <textarea
                className="w-full min-h-[150px] p-3 border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 resize-vertical"
                placeholder="Add your comments here..."
                value={commentTexts[patient.id] || ''}
                onChange={(e) => handleCommentChange(patient.id, e.target.value)}
              />

              {/* Save indicators */}
              {savingComments[patient.id] && (
                <div className="absolute bottom-2 right-2 text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded border border-blue-200">
                  Saving...
                </div>
              )}
              {savedComments[patient.id] && !savingComments[patient.id] && (
                <div className="absolute bottom-2 right-2 text-xs text-green-600 bg-green-50 px-2 py-1 rounded border border-green-200">
                  ✓ Saved
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      ))}

      {/* OPD Summary Dialogs - removed (now uses dedicated page) */}

      {/* Radiology Order Modal */}
      {selectedVisitForRadiology && (
        <MriOrderModal
          isOpen={radiologyModalOpen}
          onClose={() => { setRadiologyModalOpen(false); setSelectedVisitForRadiology(null); }}
          department="OPD"
          visit={{
            id: selectedVisitForRadiology.id,
            visit_id: selectedVisitForRadiology.visit_id || '',
            patient_id: selectedVisitForRadiology.patient_id,
            appointment_with: selectedVisitForRadiology.appointment_with,
            patients: selectedVisitForRadiology.patients ? {
              id: selectedVisitForRadiology.patients.id,
              name: selectedVisitForRadiology.patients.name,
              patients_id: selectedVisitForRadiology.patients.patients_id,
              age: selectedVisitForRadiology.patients.age,
              gender: selectedVisitForRadiology.patients.gender,
            } : undefined,
          }}
        />
      )}
    </div>
  );
};
