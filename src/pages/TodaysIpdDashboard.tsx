import { useState, useEffect, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import { ExtensionDaysCell } from '@/components/ipd/ExtensionDaysCell';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows, fetchAllByIn } from '@/utils/fetchAllRows';
import { toast } from "@/hooks/use-toast";
import { Button } from '@/components/ui/button';
import { EnhancedDatePicker } from '@/components/ui/enhanced-date-picker';
import { Input } from '@/components/ui/input';
import { useDebounce } from 'use-debounce';
import { Badge } from '@/components/ui/badge';
import { Eye, FileText, Search, Calendar, DollarSign, Trash2, FolderOpen, FolderX, CheckCircle, XCircle, Clock, MinusCircle, RotateCcw, Printer, Filter, MessageSquare, ClipboardList, ArrowUpDown, Circle, ChevronLeft, ChevronRight, Upload, Bell, Download, Loader2, Brain, FlaskConical } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { format, subDays } from 'date-fns';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { EditPatientDialog } from '@/components/EditPatientDialog';
import { VisitRegistrationForm } from '@/components/VisitRegistrationForm';
import { DocumentUploadDialog } from '@/components/DocumentUploadDialog';
import { usePatients } from '@/hooks/usePatients';
import { CascadingBillingStatusDropdown } from '@/components/shared/CascadingBillingStatusDropdown';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuSeparator, DropdownMenuItem, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ColumnPickerModal } from '@/components/print/ColumnPickerModal';
import { PrintPreview } from '@/components/print/PrintPreview';
import { usePrintColumns } from '@/hooks/usePrintColumns';
import { IPD_PRINT_COLUMNS, IPD_PRINT_PRESETS, generateIPDFilterSummary } from '@/config/ipdPrintColumns';
import { printSticker } from '@/utils/stickerPrinter';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { DateRange } from 'react-day-picker';
import '@/styles/print.css';
import { RefereeDoaPaymentModal } from '@/components/ipd/RefereeDoaPaymentModal';
import { MriOrderModal } from '@/components/ipd/MriOrderModal';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { calculateReferralAmount, formatIndianCurrency } from '@/utils/referralCalculator';
import { formatDateOnly, formatDateOnlyForDisplay, parseDateOnly } from '@/utils/dateOnly';
import { formatDialysisPatientName } from '@/utils/dialysisPatientName';

type IpdScheme = 'PMJAY' | 'MJPJAY';

const normalizeSchemeText = (value: unknown): string =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[–—-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const getIpdScheme = (visit: any): IpdScheme | null => {
  const text = [
    visit?.insurance_type,
    visit?.corporate,
    visit?.patients?.corporate,
  ].map(normalizeSchemeText).filter(Boolean).join(' ');

  if (/(mjp(jay|jy)|mahatma jyotir?ao|mahatma jyotiba|phule)/i.test(text)) return 'MJPJAY';
  if (/(pm ?jay|ab pm ?jay|ayushman|pradhan mantri jan arogya)/i.test(text)) return 'PMJAY';
  return null;
};

const getVisitSurgeries = (visit: any): any[] => Array.isArray(visit?.visit_surgeries) ? visit.visit_surgeries : [];

const getSurgeryNames = (visit: any): string[] => getVisitSurgeries(visit)
  .flatMap((surgery) => [
    surgery?.cghs_surgery?.name,
    surgery?.yojana_mh_procedures?.procedure_name,
    surgery?.yojana_mh_procedures?.procedure_label,
    surgery?.yojana_mh_procedures?.package_name,
    visit?.package_name,
  ])
  .filter(Boolean)
  .map(String);

const getSurgeryCodes = (visit: any): string[] => getVisitSurgeries(visit)
  .flatMap((surgery) => [
    surgery?.cghs_surgery?.code,
    surgery?.yojana_mh_procedures?.procedure_code,
    surgery?.yojana_mh_procedures?.package_code,
    visit?.cghs_code,
  ])
  .filter(Boolean)
  .map(String);

const getSurgeryCategories = (visit: any): string[] => getVisitSurgeries(visit)
  .flatMap((surgery) => [
    surgery?.cghs_surgery?.category,
    surgery?.yojana_mh_procedures?.specialty,
    surgery?.yojana_mh_procedures?.medical_or_surgical,
  ])
  .filter(Boolean)
  .map(String);

const getSurgeryStatuses = (visit: any): string[] => getVisitSurgeries(visit)
  .flatMap((surgery) => [surgery?.status, surgery?.sanction_status])
  .filter(Boolean)
  .map(String);

// Referee DOA Amount Cell with Payment Modal and Referral Tooltip
const IpdRefereeAmountCell = ({
  visit,
  onUpdate,
  billTotal = 0,
  totalPaid = 0,
  advanceTotal = 0
}: {
  visit: any;
  onUpdate?: () => void;
  billTotal?: number;
  // Both totals come pre-batched from the dashboard (doaPaidTotals /
  // advancePaymentData.activeTotals) instead of two queries per rendered row.
  totalPaid?: number;
  advanceTotal?: number;
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Total Bill = Sum of ACTIVE non-refund advance payments
  const totalBillAmount = advanceTotal;

  // Empty bill items (no financial_summary needed)
  const billItems: Array<{ description: string; amount: number }> = [];

  // Determine patient type (Private or Yojna)
  const corporate = visit.patients?.corporate?.toLowerCase() || '';
  const isPrivate = !corporate || corporate === 'private' || corporate.trim() === '';
  const patientType = isPrivate ? 'Private' : 'Yojna';

  // Calculate referral using totalBillAmount from bill_preparation
  const referralBreakdown = calculateReferralAmount(billItems, patientType as 'Private' | 'Yojna', totalBillAmount);
  const remaining = Math.max(0, referralBreakdown.finalAmount - totalPaid);

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
            >
              {totalPaid > 0 ? (
                `₹${totalPaid.toLocaleString()}`
              ) : (
                'Pay'
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left" className="w-72 p-3 bg-white border shadow-lg">
            <div className="space-y-2 text-sm">
              {/* Total Bill Amount from bill_preparation.bill_amount */}
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
        visit={visit}
        onUpdate={onUpdate}
      />
    </>
  );
};

// Lab Reports panel shown inside the IPD dashboard dialog
const LabReportsPanel = ({ visitId }: { visitId: string }) => {
  const { data: labTests = [], isLoading } = useQuery({
    queryKey: ['ipd-lab-reports', visitId],
    queryFn: async () => {
      if (!visitId) return [];
      const { data, error } = await supabase
        .from('visit_labs')
        .select(`
          id,
          status,
          ordered_date,
          result_value,
          lab(name, category, sub_specialty)
        `)
        .eq('visit_id', visitId)
        .order('ordered_date', { ascending: false });
      if (error) { console.error('Lab reports fetch error:', error); return []; }
      return data || [];
    },
    enabled: !!visitId,
  });

  const getStatusColor = (status: string) => {
    switch ((status || '').toLowerCase()) {
      case 'completed': case 'done': case 'result_entered': return 'bg-green-100 text-green-800';
      case 'collected': case 'in_progress': return 'bg-yellow-100 text-yellow-800';
      case 'cancelled': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  if (isLoading) return <div className="py-8 text-center text-muted-foreground">Loading lab reports…</div>;
  if (labTests.length === 0) return <div className="py-8 text-center text-muted-foreground">No lab tests found for this visit.</div>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b bg-gray-50">
            <th className="text-left py-2 px-3 font-medium">#</th>
            <th className="text-left py-2 px-3 font-medium">Test Name</th>
            <th className="text-left py-2 px-3 font-medium">Category</th>
            <th className="text-left py-2 px-3 font-medium">Status</th>
            <th className="text-left py-2 px-3 font-medium">Result</th>
            <th className="text-left py-2 px-3 font-medium">Date</th>
          </tr>
        </thead>
        <tbody>
          {labTests.map((row: any, idx: number) => (
            <tr key={row.id} className="border-b hover:bg-gray-50">
              <td className="py-2 px-3 text-muted-foreground">{idx + 1}</td>
              <td className="py-2 px-3 font-medium">{row.lab?.name || '—'}</td>
              <td className="py-2 px-3 text-muted-foreground">{row.lab?.category || row.lab?.sub_specialty || '—'}</td>
              <td className="py-2 px-3">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getStatusColor(row.status)}`}>
                  {row.status || 'Pending'}
                </span>
              </td>
              <td className="py-2 px-3">{row.result_value ? String(row.result_value).substring(0, 60) : '—'}</td>
              <td className="py-2 px-3 text-muted-foreground">
                {row.ordered_date ? new Date(row.ordered_date).toLocaleDateString('en-GB') : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const TodaysIpdDashboard = () => {
  const { isAdmin, hospitalConfig, user } = useAuth();
  const navigate = useNavigate();
  
  // Check if current user is a marketing manager
  const isMarketingManager = user?.role === 'marketing_manager' || user?.role === 'superadmin';

  // Receptionists get the Actions column (view/edit/comments/upload/revoke),
  // but NOT the destructive delete ("Mark Visit Inactive"), which stays admin-only.
  const isReceptionist = user?.role === 'receptionist' || user?.role === 'reception';

  // Roles allowed to see the Actions column at all
  const canSeeActionsColumn = isAdmin || isMarketingManager || isReceptionist;

  // Allowed emails to see Referral Doctor/Relationship Manager column
  const ALLOWED_REFERRAL_COLUMN_EMAILS = [
    'marketingmanager@hope.com',
    'marketingmanager@ayushman.com'
  ];
  const canSeeReferralColumn = user?.role === 'superadmin' || ALLOWED_REFERRAL_COLUMN_EMAILS.includes(user?.email?.toLowerCase() || '');

  const [searchParams, setSearchParams] = useSearchParams();

  // URL-persisted state
  const searchTerm = searchParams.get('search') || '';
  const [localSearchTerm, setLocalSearchTerm] = useState(searchTerm);
  const billingExecutiveFilter = searchParams.get('executive') || '';
  const billingStatusFilter = searchParams.get('billingStatus') || '';
  const bunchFilter = searchParams.get('bunch') || '';
  const corporateFilter = searchParams.get('corporate') || '';
  const schemeFilter = searchParams.get('scheme') || '';
  const surgerySearchFilter = searchParams.get('surgerySearch') || '';
  const surgeryCategoryFilter = searchParams.get('surgeryCategory') || '';
  const surgeryCodeFilter = searchParams.get('surgeryCode') || '';
  const surgeryStatusFilter = searchParams.get('surgeryStatus') || '';
  const surgeryApprovalFilter = searchParams.get('surgeryApproval') || '';
  const surgeryDateStatusFilter = searchParams.get('surgeryDateStatus') || '';
  const treatmentTypeFilter = searchParams.get('treatmentType') || '';
  const currentPage = parseInt(searchParams.get('page') || '1');
  const itemsPerPage = parseInt(searchParams.get('perPage') || '10');
  const hideColumns = searchParams.get('hideColumns') === 'true';
  const sortBy = (searchParams.get('sortBy') || 'latest') as 'sr_no' | 'sr_no_desc' | 'latest' | 'oldest' | 'name_asc' | 'name_desc' | 'visit_id_asc' | 'visit_id_desc';
  const fileStatusFilter = searchParams.get('fileStatus')?.split(',').filter(Boolean) || [];
  const condonationSubmissionFilter = searchParams.get('condSub')?.split(',').filter(Boolean) || [];
  const condonationIntimationFilter = searchParams.get('condInt')?.split(',').filter(Boolean) || [];
  const paymentStatusFilter = searchParams.get('payStatus')?.split(',').filter(Boolean) || [];
  const extensionOfStayFilter = searchParams.get('extStay')?.split(',').filter(Boolean) || [];
  const additionalApprovalsFilter = searchParams.get('addApproval')?.split(',').filter(Boolean) || [];
  // Default window: last 10 days (typical IPD stay). An explicit range from the
  // picker overrides it; searching (2+ chars) looks across ALL dates regardless.
  const hasExplicitRange = searchParams.has('startDate') || searchParams.has('endDate');
  const startDate = searchParams.get('startDate') || (hasExplicitRange ? '' : format(subDays(new Date(), 10), 'yyyy-MM-dd'));
  const endDate = searchParams.get('endDate') || (hasExplicitRange ? '' : format(new Date(), 'yyyy-MM-dd'));

  // Helper to update URL params
  const updateParams = (updates: Record<string, string | null>) => {
    const newParams = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([key, value]) => {
      if (value === null || value === '' || value === '1' && key === 'page') {
        newParams.delete(key);
      } else {
        newParams.set(key, value);
      }
    });
    setSearchParams(newParams, { replace: true });
  };

  // Debounce search input to avoid lag on every keystroke
  useEffect(() => {
    const timer = setTimeout(() => {
      if (localSearchTerm !== searchTerm) {
        updateParams({ search: localSearchTerm, page: '1' });
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [localSearchTerm]);

  // Sync URL → local state when URL changes externally (e.g., Clear Filters)
  useEffect(() => {
    setLocalSearchTerm(searchTerm);
  }, [searchTerm]);

  // Setter functions for URL-persisted state
  const setSearchTerm = (value: string) => updateParams({ search: value, page: '1' });
  const setBillingExecutiveFilter = (value: string) => updateParams({ executive: value, page: '1' });
  const setBillingStatusFilter = (value: string) => updateParams({ billingStatus: value, page: '1' });
  const setBunchFilter = (value: string) => updateParams({ bunch: value, page: '1' });
  const setCorporateFilter = (value: string) => updateParams({ corporate: value, page: '1' });
  const setSchemeFilter = (value: string) => updateParams({ scheme: value, page: '1' });
  const setSurgerySearchFilter = (value: string) => updateParams({ surgerySearch: value, page: '1' });
  const setSurgeryCategoryFilter = (value: string) => updateParams({ surgeryCategory: value, page: '1' });
  const setSurgeryCodeFilter = (value: string) => updateParams({ surgeryCode: value, page: '1' });
  const setSurgeryStatusFilter = (value: string) => updateParams({ surgeryStatus: value, page: '1' });
  const setSurgeryApprovalFilter = (value: string) => updateParams({ surgeryApproval: value, page: '1' });
  const setSurgeryDateStatusFilter = (value: string) => updateParams({ surgeryDateStatus: value, page: '1' });
  const setTreatmentTypeFilter = (value: string) => updateParams({ treatmentType: value || null, page: '1' });
  const setCurrentPage = (value: number) => updateParams({ page: value.toString() });
  const setItemsPerPage = (value: number) => updateParams({ perPage: value.toString(), page: '1' });
  const setHideColumns = (value: boolean) => updateParams({ hideColumns: value ? 'true' : null });
  const setSortBy = (value: string) => updateParams({ sortBy: value });
  const setFileStatusFilter = (value: string[]) => updateParams({ fileStatus: value.length ? value.join(',') : null });
  const setCondonationSubmissionFilter = (value: string[]) => updateParams({ condSub: value.length ? value.join(',') : null });
  const setCondonationIntimationFilter = (value: string[]) => updateParams({ condInt: value.length ? value.join(',') : null });
  const setPaymentStatusFilter = (value: string[]) => updateParams({ payStatus: value.length ? value.join(',') : null });
  const setExtensionOfStayFilter = (value: string[]) => updateParams({ extStay: value.length ? value.join(',') : null });
  const setAdditionalApprovalsFilter = (value: string[]) => updateParams({ addApproval: value.length ? value.join(',') : null });

  // Date range for filtering
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
      page: '1'
    });
  };

  const [labReportVisit, setLabReportVisit] = useState<{ visitId: string; patientName: string } | null>(null);

  // Non-persisted state (UI state that shouldn't persist)
  const [showEditPatientDialog, setShowEditPatientDialog] = useState(false);
  const [selectedPatientForEdit, setSelectedPatientForEdit] = useState(null);
  const [showVisitEditDialog, setShowVisitEditDialog] = useState(false);
  const [selectedVisitForEdit, setSelectedVisitForEdit] = useState<any>(null);
  const [showDocumentUploadDialog, setShowDocumentUploadDialog] = useState(false);
  const [selectedVisitForDocument, setSelectedVisitForDocument] = useState<any>(null);
  const [selectedPatientForView, setSelectedPatientForView] = useState<any>(null);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [srNo, setSrNo] = useState('');
  const [billingExecutiveInputs, setBillingExecutiveInputs] = useState({});
  const [billingStatusInputs, setBillingStatusInputs] = useState({});
  const [bunchNumberInputs, setBunchNumberInputs] = useState({});
  const [referralLetterStatus, setReferralLetterStatus] = useState<Record<string, boolean>>({});
  const referralDebounceMap = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [commentDialogs, setCommentDialogs] = useState<Record<string, boolean>>({});
  const [commentTexts, setCommentTexts] = useState<Record<string, string>>({});
  const [originalComments, setOriginalComments] = useState<Record<string, string>>({});
  const [savingComments, setSavingComments] = useState<Record<string, boolean>>({});
  const [savedComments, setSavedComments] = useState<Record<string, boolean>>({});

  // MRI Order Modal State
  const [mriModalOpen, setMriModalOpen] = useState(false);
  const [selectedVisitForMri, setSelectedVisitForMri] = useState<any>(null);

  // Getpass Notification Modal State
  const [isNotificationModalOpen, setIsNotificationModalOpen] = useState(false);
  const [selectedVisitForNotification, setSelectedVisitForNotification] = useState<any>(null);
  const [notificationReason, setNotificationReason] = useState('');
  const [notificationCustomReason, setNotificationCustomReason] = useState('');
  const [notificationPendingAmount, setNotificationPendingAmount] = useState('');

  const queryClient = useQueryClient();

  // Save notification mutation
  const saveNotificationMutation = useMutation({
    mutationFn: async (data: {
      visit_id: string;
      patient_id: string;
      patient_name: string;
      reason: string;
      custom_reason: string | null;
      pending_amount: number;
    }) => {
      const { error } = await supabase
        .from('gatepass_notifications')
        .insert(data);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Notification saved successfully" });
      setIsNotificationModalOpen(false);
      setNotificationReason('');
      setNotificationCustomReason('');
      setNotificationPendingAmount('');
    },
    onError: (error: any) => {
      toast({ title: "Error saving notification", description: error.message, variant: "destructive" });
    }
  });

  // Handle save notification
  const handleSaveNotification = () => {
    if (!notificationReason) {
      toast({ title: "Please select a reason", variant: "destructive" });
      return;
    }
    if (!notificationPendingAmount) {
      toast({ title: "Please enter pending amount", variant: "destructive" });
      return;
    }

    saveNotificationMutation.mutate({
      visit_id: selectedVisitForNotification.visit_id,
      patient_id: selectedVisitForNotification.patients?.id,
      patient_name: selectedVisitForNotification.patients?.name,
      reason: notificationReason,
      custom_reason: notificationReason === 'other' ? notificationCustomReason : null,
      pending_amount: parseFloat(notificationPendingAmount)
    });
  };

  // Only diagnoses + the update mutation are used here — skip the full
  // patients list query (this page has its own todays-visits query).
  const { diagnoses, updatePatient } = usePatients({ listEnabled: false });

  // Advance payment status tracking
  const [billTotals, setBillTotals] = useState<Record<string, number>>({});
  const [intimationDates, setIntimationDates] = useState<Record<string, string | null>>({});
  const [doaPayments, setDoaPayments] = useState<Record<string, Array<{
    amount: number;
    payment_date: string;
    notes: string | null;
    referral_payment_status: string | null;
  }>>>({});

  // Print functionality
  const [showPrintPreview, setShowPrintPreview] = useState(false);

  // Referral report preview modal
  const [isReferralReportOpen, setIsReferralReportOpen] = useState(false);

  // Unpaid referral report modal
  const [isUnpaidReportOpen, setIsUnpaidReportOpen] = useState(false);

  const {
    selectedIds: printSelectedIds,
    setSelectedIds: setPrintSelectedIds,
    settings: printSettings,
    setSettings: setPrintSettings,
    isPickerOpen: isPrintPickerOpen,
    setIsPickerOpen: setIsPrintPickerOpen,
    openPicker: openPrintPicker
  } = usePrintColumns('ipd-dashboard', IPD_PRINT_COLUMNS);

  // Reusable multi-select column filter using DropdownMenu
  const ColumnFilter = ({ options, selected, onChange }: { options: string[]; selected: string[]; onChange: (v: string[]) => void }) => {
    const toggleValue = (value: string) => {
      onChange(selected.includes(value) ? selected.filter(v => v !== value) : [...selected, value]);
    };
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-7 px-2">
            <Filter className="h-3 w-3 mr-1" />
            {selected.length ? `${selected.length} selected` : 'All'}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuItem onClick={() => onChange([])}>Clear</DropdownMenuItem>
          <DropdownMenuSeparator />
          {options.map((opt) => (
            <DropdownMenuCheckboxItem key={opt} checked={selected.includes(opt)} onCheckedChange={() => toggleValue(opt)}>
              {opt}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  // Custom component for billing executive dropdown with options
  const BillingExecutiveInput = ({ visit, isAdmin }) => {
    const [selectedValue, setSelectedValue] = useState(visit.billing_executive || '');
    const [debouncedValue] = useDebounce(selectedValue, 2000); // 2 seconds delay

    const billingExecutiveOptions = [
      'Dr.B.K.Murali',
      'Ruby',
      'Shrikant',
      'Gaurav',
      'Dr. Swapnil',
      'Dr.Sachin',
      'Dr.Shiraj',
      'Dr. Sharad',
      'Shashank',
      'Shweta',
      'Suraj',
      'Nitin',
      'Sonali',
      'Ruchika',
      'Pragati',
      'Rachana',
      'Kashish',
      'Aman',
      'Dolly',
      'Ruchi',
      'Gayatri',
      'Noor',
      'Nisha',
      'Diksha',
      'Ayush',
      'Kiran',
      'Pratik',
      'Azhar',
      'Tejas',
      'Abhishek',
      'Chandrprakash'
    ];




    useEffect(() => {
      if (!isAdmin) return; // do not submit changes when not admin
      if (debouncedValue !== (visit.billing_executive || '')) {
        handleBillingExecutiveSubmit(visit.visit_id, debouncedValue);
      }
    }, [isAdmin, debouncedValue, visit.billing_executive, visit.visit_id]);

    return (
      <select
        value={selectedValue}
        onChange={(e) => setSelectedValue(e.target.value)}
        disabled={!isAdmin}
        className="w-32 h-8 text-sm border border-gray-300 rounded-md px-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="">Select Executive</option>
        {billingExecutiveOptions.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  };

  // Custom component for billing status dropdown - now using shared cascading dropdown
  const BillingStatusDropdown = ({ visit, disabled = false }) => {
    if (disabled) {
      return (
        <div className="text-xs">
          <div>{visit.billing_status || '-'}</div>
          {visit.billing_sub_status ? (
            <div className="text-muted-foreground">{visit.billing_sub_status}</div>
          ) : null}
        </div>
      );
    }
    return (
      <CascadingBillingStatusDropdown
        visit={visit}
        queryKey={['todays-ipd-visits']}
        onUpdate={() => refetch()}
      />
    );
  };

  // Custom component for bunch number input with debouncing
  const BunchNumberInput = ({ visit, isAdmin }) => {
    const [selectedValue, setSelectedValue] = useState(visit.bunch_no || '');
    const [debouncedValue] = useDebounce(selectedValue, 2000); // 2 seconds delay

    useEffect(() => {
      if (debouncedValue !== (visit.bunch_no || '')) {
        handleBunchNumberSubmit(visit.visit_id, debouncedValue);
      }
    }, [debouncedValue, visit.bunch_no, visit.visit_id]);

    if (!isAdmin) return <span className="text-sm">{visit.bunch_no || '-'}</span>;
    return (
      <Input
        value={selectedValue}
        onChange={(e) => setSelectedValue(e.target.value)}
        placeholder="Enter Bunch No"
        className="w-24 h-8 text-sm"
      />
    );
  };

  // Custom component for Claim ID input with debouncing
  const ClaimIdInput = ({ visit }) => {
    const [value, setValue] = useState(visit.claim_id || '');
    const [debouncedValue] = useDebounce(value, 7000);

    useEffect(() => {
      if (debouncedValue !== (visit.claim_id || '')) {
        handleClaimIdSubmit(visit.visit_id, debouncedValue);
      }
    }, [debouncedValue, visit.claim_id, visit.visit_id]);

    // Sync with server updates
    useEffect(() => {
      setValue(visit.claim_id || '');
    }, [visit.claim_id]);

    return (
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => handleClaimIdSubmit(visit.visit_id, value)}
        placeholder="Enter Claim ID"
        className="w-36 h-8 text-sm"
      />
    );
  };

  // Custom component for Registration ID input with debouncing
  const RegistrationIdInput = ({ visit }) => {
    const registrationId = visit.yojana_registration_id || '';
    const visitRowId = visit.id;
    const [value, setValue] = useState(registrationId);
    const [debouncedValue] = useDebounce(value, 7000);

    useEffect(() => {
      if (debouncedValue !== registrationId) {
        handleRegistrationIdSubmit(visitRowId, debouncedValue);
      }
    }, [debouncedValue, registrationId, visitRowId]);

    // Sync with server updates
    useEffect(() => {
      setValue(registrationId);
    }, [registrationId]);

    return (
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => handleRegistrationIdSubmit(visitRowId, value)}
        placeholder="Enter Registration ID"
        className="w-40 h-8 text-sm"
      />
    );
  };

  // Custom component for ESIC UHID input with debouncing
  const EsicUhidInput = ({ visit }) => {
    const [value, setValue] = useState(visit.esic_uh_id || '');
    const [debouncedValue] = useDebounce(value, 7000);

    useEffect(() => {
      if (debouncedValue !== (visit.esic_uh_id || '')) {
        handleEsicUhidSubmit(visit.visit_id, debouncedValue);
      }
    }, [debouncedValue, visit.esic_uh_id, visit.visit_id]);

    // Sync with server updates
    useEffect(() => {
      setValue(visit.esic_uh_id || '');
    }, [visit.esic_uh_id]);

    return (
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => handleEsicUhidSubmit(visit.visit_id, value)}
        placeholder="Enter ESIC UHID"
        className="w-40 h-8 text-sm"
      />
    );
  };

  // File Status Toggle Component
  const FileStatusToggle = ({ visit }) => {
    const [fileStatus, setFileStatus] = useState(visit.file_status || 'available');

    const handleToggleFileStatus = async () => {
      const newStatus = fileStatus === 'available' ? 'missing' : 'available';
      setFileStatus(newStatus);

      try {
        const { error } = await supabase
          .from('visits')
          .update({ file_status: newStatus })
          .eq('visit_id', visit.visit_id);

        if (error) {
          console.error('Error updating file status:', error);
          // Revert the state on error
          setFileStatus(fileStatus);
          return;
        }

        refetch(); // Refresh the data
      } catch (error) {
        console.error('Error updating file status:', error);
        setFileStatus(fileStatus);
      }
    };

    return (
      <Button
        variant="ghost"
        size="sm"
        className={`h-8 w-20 p-2 text-xs font-medium transition-all duration-200 ${
          fileStatus === 'available'
            ? 'bg-green-50 text-green-700 hover:bg-green-100 border border-green-200'
            : 'bg-red-50 text-red-700 hover:bg-red-100 border border-red-200'
        }`}
        onClick={handleToggleFileStatus}
        title={fileStatus === 'available' ? 'File Available - Click to mark as Missing' : 'File Missing - Click to mark as Available'}
      >
        {fileStatus === 'available' ? (
          <>
            <FolderOpen className="h-3 w-3 mr-1" />
            Available
          </>
        ) : (
          <>
            <FolderX className="h-3 w-3 mr-1" />
            Missing
          </>
        )}
      </Button>
    );
  };

  // Condonation Delay Claim Toggle Component
  const CondonationDelayToggle = ({ visit }) => {
    const [condonationStatus, setCondonationStatus] = useState(visit.condonation_delay_claim || 'not_present');

    const handleToggleCondonation = async () => {
      const newStatus = condonationStatus === 'present' ? 'not_present' : 'present';
      setCondonationStatus(newStatus);

      try {
        const { error } = await supabase
          .from('visits')
          .update({ condonation_delay_claim: newStatus })
          .eq('visit_id', visit.visit_id);

        if (error) {
          console.error('Error updating condonation delay claim:', error);
          // Revert the state on error
          setCondonationStatus(condonationStatus);
          return;
        }

        refetch(); // Refresh the data
      } catch (error) {
        console.error('Error updating condonation delay claim:', error);
        setCondonationStatus(condonationStatus);
      }
    };

    return (
      <Button
        variant="ghost"
        size="sm"
        className={`h-8 w-20 p-2 text-xs font-medium transition-all duration-200 ${
          condonationStatus === 'present'
            ? 'bg-green-50 text-green-700 hover:bg-green-100 border border-green-200'
            : 'bg-red-50 text-red-700 hover:bg-red-100 border border-red-200'
        }`}
        onClick={handleToggleCondonation}
        title={condonationStatus === 'present' ? 'Condonation Present - Click to mark as Not Present' : 'Condonation Not Present - Click to mark as Present'}
      >
        {condonationStatus === 'present' ? (
          <>
            <CheckCircle className="h-3 w-3 mr-1" />
            Present
          </>
        ) : (
          <>
            <XCircle className="h-3 w-3 mr-1" />
            Not Present
          </>
        )}
      </Button>
    );
  };

  // Condonation Delay Intimation Toggle Component
  const CondonationDelayIntimationToggle = ({ visit }) => {
    const [intimationStatus, setIntimationStatus] = useState(visit.condonation_delay_intimation || 'not_present');

    const handleToggleIntimation = async () => {
      const newStatus = intimationStatus === 'present' ? 'not_present' : 'present';
      setIntimationStatus(newStatus);

      try {
        const { error } = await supabase
          .from('visits')
          .update({ condonation_delay_intimation: newStatus })
          .eq('visit_id', visit.visit_id);

        if (error) {
          console.error('Error updating condonation delay intimation:', error);
          // Revert the state on error
          setIntimationStatus(intimationStatus);
          return;
        }

        refetch(); // Refresh the data
      } catch (error) {
        console.error('Error updating condonation delay intimation:', error);
        setIntimationStatus(intimationStatus);
      }
    };

    return (
      <Button
        variant="ghost"
        size="sm"
        className={`h-8 w-20 p-2 text-xs font-medium transition-all duration-200 ${
          intimationStatus === 'present'
            ? 'bg-green-50 text-green-700 hover:bg-green-100 border border-green-200'
            : 'bg-red-50 text-red-700 hover:bg-red-100 border border-red-200'
        }`}
        onClick={handleToggleIntimation}
        title={intimationStatus === 'present' ? 'Intimation Present - Click to mark as Not Present' : 'Intimation Not Present - Click to mark as Present'}
      >
        {intimationStatus === 'present' ? (
          <>
            <CheckCircle className="h-3 w-3 mr-1" />
            Present
          </>
        ) : (
          <>
            <XCircle className="h-3 w-3 mr-1" />
            Not Present
          </>
        )}
      </Button>
    );
  };

  // Extension of Stay 3-State Toggle Component
  const ExtensionOfStayToggle = ({ visit }) => {
    const [extensionStatus, setExtensionStatus] = useState(visit.extension_of_stay || 'not_required');

    const handleToggleExtension = async () => {
      let newStatus: 'not_required' | 'taken' | 'not_taken';
      if (extensionStatus === 'not_required') {
        newStatus = 'taken';
      } else if (extensionStatus === 'taken') {
        newStatus = 'not_taken';
      } else {
        newStatus = 'not_required';
      }

      setExtensionStatus(newStatus);

      try {
        const { error } = await supabase
          .from('visits')
          .update({ extension_of_stay: newStatus })
          .eq('visit_id', visit.visit_id);

        if (error) {
          console.error('Error updating extension of stay:', error);
          setExtensionStatus(extensionStatus);
          return;
        }

        refetch();
      } catch (error) {
        console.error('Error updating extension of stay:', error);
        setExtensionStatus(extensionStatus);
      }
    };

    const getStatusConfig = () => {
      switch (extensionStatus) {
        case 'taken':
          return {
            className: 'bg-green-50 text-green-700 hover:bg-green-100 border border-green-200',
            icon: <CheckCircle className="h-3 w-3 mr-1" />,
            text: 'Taken'
          };
        case 'not_taken':
          return {
            className: 'bg-red-50 text-red-700 hover:bg-red-100 border border-red-200',
            icon: <XCircle className="h-3 w-3 mr-1" />,
            text: 'Not Taken'
          };
        default:
          return {
            className: 'bg-gray-50 text-gray-700 hover:bg-gray-100 border border-gray-200',
            icon: <MinusCircle className="h-3 w-3 mr-1" />,
            text: 'Not Required'
          };
      }
    };

    const config = getStatusConfig();

    return (
      <Button
        variant="ghost"
        size="sm"
        className={`h-8 w-20 p-2 text-xs font-medium transition-all duration-200 ${config.className}`}
        onClick={handleToggleExtension}
        title={`Extension of Stay: ${config.text} - Click to cycle through states`}
      >
        {config.icon}
        {config.text}
      </Button>
    );
  };

  // Additional Approvals 3-State Toggle Component
  const AdditionalApprovalsToggle = ({ visit }) => {
    const [approvalsStatus, setApprovalsStatus] = useState(visit.additional_approvals || 'not_required');

    const handleToggleApprovals = async () => {
      let newStatus: 'not_required' | 'taken' | 'not_taken';
      if (approvalsStatus === 'not_required') {
        newStatus = 'taken';
      } else if (approvalsStatus === 'taken') {
        newStatus = 'not_taken';
      } else {
        newStatus = 'not_required';
      }

      setApprovalsStatus(newStatus);

      try {
        const { error } = await supabase
          .from('visits')
          .update({ additional_approvals: newStatus })
          .eq('visit_id', visit.visit_id);

        if (error) {
          console.error('Error updating additional approvals:', error);
          setApprovalsStatus(approvalsStatus);
          return;
        }

        refetch();
      } catch (error) {
        console.error('Error updating additional approvals:', error);
        setApprovalsStatus(approvalsStatus);
      }
    };

    const getStatusConfig = () => {
      switch (approvalsStatus) {
        case 'taken':
          return {
            className: 'bg-green-50 text-green-700 hover:bg-green-100 border border-green-200',
            icon: <CheckCircle className="h-3 w-3 mr-1" />,
            text: 'Taken'
          };
        case 'not_taken':
          return {
            className: 'bg-red-50 text-red-700 hover:bg-red-100 border border-red-200',
            icon: <XCircle className="h-3 w-3 mr-1" />,
            text: 'Not Taken'
          };
        default:
          return {
            className: 'bg-gray-50 text-gray-700 hover:bg-gray-100 border border-gray-200',
            icon: <MinusCircle className="h-3 w-3 mr-1" />,
            text: 'Not Required'
          };
      }
    };

    const config = getStatusConfig();

    return (
      <Button
        variant="ghost"
        size="sm"
        className={`h-8 w-20 p-2 text-xs font-medium transition-all duration-200 ${config.className}`}
        onClick={handleToggleApprovals}
        title={`Additional Approvals: ${config.text} - Click to cycle through states`}
      >
        {config.icon}
        {config.text}
      </Button>
    );
  };

  // Photos Dropdown Component
  const PhotosDropdown = ({ visit }) => {
    const photosOptions = ['P2-Form', 'P6-Form', 'Patient Photo Geotag'];

    const [selectedPhotos, setSelectedPhotos] = useState(() => {
      const photosDoc = visit.photos_documents;
      if (photosDoc && typeof photosDoc === 'object' && Array.isArray(photosDoc.selected)) {
        return photosDoc.selected;
      }
      return [];
    });

    const handlePhotoToggle = async (option) => {
      const newSelected = selectedPhotos.includes(option)
        ? selectedPhotos.filter(item => item !== option)
        : [...selectedPhotos, option];

      setSelectedPhotos(newSelected);

      try {
        const { error } = await supabase
          .from('visits')
          .update({
            photos_documents: {
              selected: newSelected,
              updated_at: new Date().toISOString()
            }
          })
          .eq('visit_id', visit.visit_id);

        if (error) {
          console.error('Error updating photos:', error);
          setSelectedPhotos(selectedPhotos);
          return;
        }

        refetch();
      } catch (error) {
        console.error('Error updating photos:', error);
        setSelectedPhotos(selectedPhotos);
      }
    };

    const getButtonStyle = () => {
      if (selectedPhotos.length === photosOptions.length) {
        return 'bg-green-50 text-green-700 hover:bg-green-100 border border-green-200';
      } else if (selectedPhotos.length > 0) {
        return 'bg-orange-50 text-orange-700 hover:bg-orange-100 border border-orange-200';
      }
      return 'bg-red-50 text-red-700 hover:bg-red-100 border border-red-200';
    };

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={`h-6 w-12 p-1 text-xs font-medium transition-all duration-200 ${getButtonStyle()}`}
            title={`Photos: ${selectedPhotos.length}/${photosOptions.length} selected`}
          >
            {selectedPhotos.length}/${photosOptions.length}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          {photosOptions.map((option) => (
            <DropdownMenuCheckboxItem
              key={option}
              checked={selectedPhotos.includes(option)}
              onCheckedChange={() => handlePhotoToggle(option)}
            >
              {option}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  // Sign Dropdown Component
  const SignDropdown = ({ visit }) => {
    const signOptions = ['Referral', 'Entitlement', 'IP-Details', 'P2-Form', 'P6-Form', 'Final-Bill', 'E-pehchan Card', 'Doctor Sign'];

    const [selectedSigns, setSelectedSigns] = useState(() => {
      const signDoc = visit.sign_documents;
      if (signDoc && typeof signDoc === 'object' && Array.isArray(signDoc.selected)) {
        return signDoc.selected;
      }
      return [];
    });

    const handleSignToggle = async (option) => {
      const newSelected = selectedSigns.includes(option)
        ? selectedSigns.filter(item => item !== option)
        : [...selectedSigns, option];

      setSelectedSigns(newSelected);

      try {
        const { error } = await supabase
          .from('visits')
          .update({
            sign_documents: {
              selected: newSelected,
              updated_at: new Date().toISOString()
            }
          })
          .eq('visit_id', visit.visit_id);

        if (error) {
          console.error('Error updating signs:', error);
          setSelectedSigns(selectedSigns);
          return;
        }

        refetch();
      } catch (error) {
        console.error('Error updating signs:', error);
        setSelectedSigns(selectedSigns);
      }
    };

    const getButtonStyle = () => {
      if (selectedSigns.length === signOptions.length) {
        return 'bg-green-50 text-green-700 hover:bg-green-100 border border-green-200';
      } else if (selectedSigns.length > 0) {
        return 'bg-orange-50 text-orange-700 hover:bg-orange-100 border border-orange-200';
      }
      return 'bg-red-50 text-red-700 hover:bg-red-100 border border-red-200';
    };

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={`h-6 w-12 p-1 text-xs font-medium transition-all duration-200 ${getButtonStyle()}`}
            title={`Signs: ${selectedSigns.length}/${signOptions.length} selected`}
          >
            {selectedSigns.length}/${signOptions.length}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          {signOptions.map((option) => (
            <DropdownMenuCheckboxItem
              key={option}
              checked={selectedSigns.includes(option)}
              onCheckedChange={() => handleSignToggle(option)}
            >
              {option}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  // Hospital Stamp Dropdown Component
  const HospitalStampDropdown = ({ visit }) => {
    const hospitalStampOptions = ['Final Bill', 'Discharge Summary', 'P2-Form with Sign', 'P6-Form', 'OT-Notes'];

    const [selectedHospitalStamps, setSelectedHospitalStamps] = useState(() => {
      const stampDoc = visit.hospital_stamp_documents;
      if (stampDoc && typeof stampDoc === 'object' && Array.isArray(stampDoc.selected)) {
        return stampDoc.selected;
      }
      return [];
    });

    const handleHospitalStampToggle = async (option) => {
      const newSelected = selectedHospitalStamps.includes(option)
        ? selectedHospitalStamps.filter(item => item !== option)
        : [...selectedHospitalStamps, option];

      setSelectedHospitalStamps(newSelected);

      try {
        const { error } = await supabase
          .from('visits')
          .update({
            hospital_stamp_documents: {
              selected: newSelected,
              updated_at: new Date().toISOString()
            }
          })
          .eq('visit_id', visit.visit_id);

        if (error) {
          console.error('Error updating hospital stamps:', error);
          setSelectedHospitalStamps(selectedHospitalStamps);
          return;
        }

        refetch();
      } catch (error) {
        console.error('Error updating hospital stamps:', error);
        setSelectedHospitalStamps(selectedHospitalStamps);
      }
    };

    const getButtonStyle = () => {
      if (selectedHospitalStamps.length === hospitalStampOptions.length) {
        return 'bg-green-50 text-green-700 hover:bg-green-100 border border-green-200';
      } else if (selectedHospitalStamps.length > 0) {
        return 'bg-orange-50 text-orange-700 hover:bg-orange-100 border border-orange-200';
      }
      return 'bg-red-50 text-red-700 hover:bg-red-100 border border-red-200';
    };

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={`h-6 w-12 p-1 text-xs font-medium transition-all duration-200 ${getButtonStyle()}`}
            title={`Hospital Stamps: ${selectedHospitalStamps.length}/${hospitalStampOptions.length} selected`}
          >
            {selectedHospitalStamps.length}/${hospitalStampOptions.length}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          {hospitalStampOptions.map((option) => (
            <DropdownMenuCheckboxItem
              key={option}
              checked={selectedHospitalStamps.includes(option)}
              onCheckedChange={() => handleHospitalStampToggle(option)}
            >
              {option}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  // Dr Surgeon Stamp Dropdown Component
  const DrSurgeonStampDropdown = ({ visit }) => {
    const drSurgeonStampOptions = ['Discharge Summary', 'OT Notes'];

    const [selectedDrSurgeonStamps, setSelectedDrSurgeonStamps] = useState(() => {
      const stampDoc = visit.dr_surgeon_stamp_documents;
      if (stampDoc && typeof stampDoc === 'object' && Array.isArray(stampDoc.selected)) {
        return stampDoc.selected;
      }
      return [];
    });

    const handleDrSurgeonStampToggle = async (option) => {
      const newSelected = selectedDrSurgeonStamps.includes(option)
        ? selectedDrSurgeonStamps.filter(item => item !== option)
        : [...selectedDrSurgeonStamps, option];

      setSelectedDrSurgeonStamps(newSelected);

      try {
        const { error } = await supabase
          .from('visits')
          .update({
            dr_surgeon_stamp_documents: {
              selected: newSelected,
              updated_at: new Date().toISOString()
            }
          })
          .eq('visit_id', visit.visit_id);

        if (error) {
          console.error('Error updating dr surgeon stamps:', error);
          setSelectedDrSurgeonStamps(selectedDrSurgeonStamps);
          return;
        }

        refetch();
      } catch (error) {
        console.error('Error updating dr surgeon stamps:', error);
        setSelectedDrSurgeonStamps(selectedDrSurgeonStamps);
      }
    };

    const getButtonStyle = () => {
      if (selectedDrSurgeonStamps.length === drSurgeonStampOptions.length) {
        return 'bg-green-50 text-green-700 hover:bg-green-100 border border-green-200';
      } else if (selectedDrSurgeonStamps.length > 0) {
        return 'bg-orange-50 text-orange-700 hover:bg-orange-100 border border-orange-200';
      }
      return 'bg-red-50 text-red-700 hover:bg-red-100 border border-red-200';
    };

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={`h-6 w-12 p-1 text-xs font-medium transition-all duration-200 ${getButtonStyle()}`}
            title={`Dr/Surgeon Stamps: ${selectedDrSurgeonStamps.length}/${drSurgeonStampOptions.length} selected`}
          >
            {selectedDrSurgeonStamps.length}/${drSurgeonStampOptions.length}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          {drSurgeonStampOptions.map((option) => (
            <DropdownMenuCheckboxItem
              key={option}
              checked={selectedDrSurgeonStamps.includes(option)}
              onCheckedChange={() => handleDrSurgeonStampToggle(option)}
            >
              {option}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  // Photos Count Button Component
  const PhotosCountButton = ({ visit }) => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const photosOptions = ['P2-Form', 'P6-Form', 'Patient Photo Geotag'];

    const selectedCount = visit.photos_documents?.selected?.length || 0;
    const totalCount = photosOptions.length;

    const getButtonStyle = () => {
      return 'bg-white text-black hover:bg-gray-50 border border-gray-300';
    };

    return (
      <>
        <Button
          variant="ghost"
          size="sm"
          className={`h-6 w-12 p-1 text-xs font-medium transition-all duration-200 cursor-pointer ${getButtonStyle()}`}
          onClick={() => setIsModalOpen(true)}
          title={`Photos: ${selectedCount}/${totalCount} selected - Click to manage`}
        >
          {selectedCount}/{totalCount}
        </Button>
        <DocumentModal
          visit={visit}
          docType="photos"
          options={photosOptions}
          title="Photos Documents"
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
        />
      </>
    );
  };

  // Sign Count Button Component
  const SignCountButton = ({ visit }) => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const signOptions = ['Referral', 'Entitlement', 'IP-Details', 'P2-Form', 'P6-Form', 'Final-Bill', 'E-pehchan Card', 'Doctor Sign'];

    const selectedCount = visit.sign_documents?.selected?.length || 0;
    const totalCount = signOptions.length;

    const getButtonStyle = () => {
      return 'bg-white text-black hover:bg-gray-50 border border-gray-300';
    };

    return (
      <>
        <Button
          variant="ghost"
          size="sm"
          className={`h-6 w-12 p-1 text-xs font-medium transition-all duration-200 cursor-pointer ${getButtonStyle()}`}
          onClick={() => setIsModalOpen(true)}
          title={`Sign: ${selectedCount}/${totalCount} selected - Click to manage`}
        >
          {selectedCount}/{totalCount}
        </Button>
        <DocumentModal
          visit={visit}
          docType="sign"
          options={signOptions}
          title="Sign Documents"
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
        />
      </>
    );
  };

  // Hospital Stamp Count Button Component
  const HospitalStampCountButton = ({ visit }) => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const hospitalStampOptions = ['Final Bill', 'Discharge Summary', 'P2-Form with Sign', 'P6-Form', 'OT-Notes'];

    const selectedCount = visit.hospital_stamp_documents?.selected?.length || 0;
    const totalCount = hospitalStampOptions.length;

    const getButtonStyle = () => {
      return 'bg-white text-black hover:bg-gray-50 border border-gray-300';
    };

    return (
      <>
        <Button
          variant="ghost"
          size="sm"
          className={`h-6 w-12 p-1 text-xs font-medium transition-all duration-200 cursor-pointer ${getButtonStyle()}`}
          onClick={() => setIsModalOpen(true)}
          title={`Hospital Stamp: ${selectedCount}/${totalCount} selected - Click to manage`}
        >
          {selectedCount}/{totalCount}
        </Button>
        <DocumentModal
          visit={visit}
          docType="hospital_stamp"
          options={hospitalStampOptions}
          title="Hospital Stamp Documents"
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
        />
      </>
    );
  };

  // Dr Surgeon Stamp Count Button Component
  const DrSurgeonStampCountButton = ({ visit }) => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const drSurgeonStampOptions = ['Discharge Summary', 'OT Notes'];

    const selectedCount = visit.dr_surgeon_stamp_documents?.selected?.length || 0;
    const totalCount = drSurgeonStampOptions.length;

    const getButtonStyle = () => {
      return 'bg-white text-black hover:bg-gray-50 border border-gray-300';
    };

    return (
      <>
        <Button
          variant="ghost"
          size="sm"
          className={`h-6 w-12 p-1 text-xs font-medium transition-all duration-200 cursor-pointer ${getButtonStyle()}`}
          onClick={() => setIsModalOpen(true)}
          title={`Dr/Surgeon Stamp: ${selectedCount}/${totalCount} selected - Click to manage`}
        >
          {selectedCount}/{totalCount}
        </Button>
        <DocumentModal
          visit={visit}
          docType="dr_surgeon_stamp"
          options={drSurgeonStampOptions}
          title="Dr/Surgeon Stamp Documents"
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
        />
      </>
    );
  };

  // Document Modal Component
  const DocumentModal = ({ visit, docType, options, title, isOpen, onClose }) => {
    const [selectedItems, setSelectedItems] = useState(() => {
      const doc = visit[`${docType}_documents`];
      if (doc && typeof doc === 'object' && Array.isArray(doc.selected)) {
        return doc.selected;
      }
      return [];
    });

    const handleToggleItem = async (option) => {
      const newSelected = selectedItems.includes(option)
        ? selectedItems.filter(item => item !== option)
        : [...selectedItems, option];

      setSelectedItems(newSelected);

      try {
        const { error } = await supabase
          .from('visits')
          .update({
            [`${docType}_documents`]: {
              selected: newSelected,
              updated_at: new Date().toISOString()
            }
          })
          .eq('visit_id', visit.visit_id);

        if (error) {
          console.error(`Error updating ${docType}:`, error);
          setSelectedItems(selectedItems);
          return;
        }

        refetch();
      } catch (error) {
        console.error(`Error updating ${docType}:`, error);
        setSelectedItems(selectedItems);
      }
    };

    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {title} ({selectedItems.length}/{options.length} selected)
            </DialogTitle>
            <DialogDescription>
              Select the documents that are available for this patient visit.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 max-h-64 overflow-y-auto">
            {options.map((option) => (
              <div key={option} className="flex items-center space-x-2">
                <Checkbox
                  id={option}
                  checked={selectedItems.includes(option)}
                  onCheckedChange={() => handleToggleItem(option)}
                />
                <label
                  htmlFor={option}
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                >
                  {option}
                </label>
              </div>
            ))}
          </div>
          <div className="flex justify-end pt-4">
            <Button onClick={onClose} variant="outline">
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
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

  // Load the complete surgery/package master list so the surgery filter is not
  // limited to names appearing in the current date range.
  const { data: surgeryMasterNames = [] } = useQuery({
    queryKey: ['ipd-surgery-filter-options'],
    queryFn: async () => {
      const [cghsResult, yojanaResult, pmjayResult] = await Promise.all([
        supabase.from('cghs_surgery').select('name').eq('is_active', true).order('name'),
        supabase.from('yojana_mh_procedures').select('procedure_name, procedure_label, package_name').order('package_name'),
        supabase.from('pmjay_mjpjay_packages').select('treatment_plan').eq('is_active', true).order('treatment_plan'),
      ]);

      if (cghsResult.error) console.error('Error fetching CGHS surgery filter options:', cghsResult.error);
      if (yojanaResult.error) console.error('Error fetching Yojana surgery filter options:', yojanaResult.error);
      if (pmjayResult.error) console.error('Error fetching PMJAY/MJPJAY surgery filter options:', pmjayResult.error);

      return Array.from(new Set([
        ...(cghsResult.data || []).map((row: any) => row.name),
        ...(yojanaResult.data || []).flatMap((row: any) => [row.procedure_name, row.procedure_label, row.package_name]),
        ...(pmjayResult.data || []).map((row: any) => row.treatment_plan),
      ].filter(Boolean).map(String))).sort((a, b) => a.localeCompare(b));
    },
  });

  // Search of 2+ chars widens the fetch to ALL dates so the 10-day default
  // window never hides a searched patient (searchTerm is already URL-debounced).
  const activeSearch = searchTerm.trim().length >= 2 ? searchTerm.trim() : '';

  const { data: todaysVisits = [], isLoading, refetch } = useQuery({
    queryKey: ['todays-visits', hospitalConfig?.name, startDate, endDate, activeSearch],
    // Keep prior results rendered while a new search/date-range key fetches,
    // so the isLoading early-return doesn't unmount the page (and the search
    // input doesn't lose focus) on every keystroke.
    placeholderData: keepPreviousData,
    queryFn: async () => {
      console.log('🏥 TodaysIpdDashboard: Fetching visits for hospital:', hospitalConfig?.name);

      // All-time search: resolve matching patients hospital-wide (name/ID/phone),
      // then fetch their IPD visits plus any visit whose ID matches, undated.
      let searchOr: string | null = null;
      if (activeSearch) {
        // Strip PostgREST .or() delimiters so typed commas/parens can't break the filter
        const safeSearch = activeSearch.replace(/[,()]/g, '');
        let patientQuery = supabase
          .from('patients')
          .select('id')
          .or(`name.ilike.%${safeSearch}%,patients_id.ilike.%${safeSearch}%,phone.ilike.%${safeSearch}%`)
          .limit(50);
        if (hospitalConfig?.name) {
          patientQuery = patientQuery.eq('hospital_name', hospitalConfig.name);
        }
        const { data: matchedPatients, error: searchError } = await patientQuery;
        if (searchError) {
          console.error('Error searching patients for IPD dashboard:', searchError);
        }
        const orParts = [
          `visit_id.ilike.%${safeSearch}%`,
          `yojana_registration_id.ilike.%${safeSearch}%`,
        ];
        if (matchedPatients?.length) {
          orParts.push(`patient_id.in.(${matchedPatients.map(p => p.id).join(',')})`);
        }
        searchOr = orParts.join(',');
      }

      // Build a FRESH query for each page (Supabase builders are single-use) so a hospital
      // with >1000 IPD visits is never silently truncated.
      const buildVisitsQuery = () => {
        let query = supabase
          .from('visits')
          .select(`
            *,
            discharge_date,
            patients!inner(
              id,
              name,
              patients_id,
              insurance_person_no,
              hospital_name,
              corporate,
              age,
              gender,
              phone,
              emergency_contact_name,
              emergency_contact_mobile
            ),
            referees!referring_doctor_id (
              id,
              name
            ),
            relationship_managers (
              id,
              name,
              code
            ),
            diagnoses!diagnosis_id (
              id,
              name
            ),
            visit_surgeries (
              id,
              status,
              sanction_status,
              cghs_surgery (
                id,
                name,
                code,
                category
              ),
              yojana_mh_procedures (
                id,
                procedure_code,
                procedure_name,
                procedure_label,
                package_code,
                package_name,
                specialty,
                medical_or_surgical
              )
            )
          `)
          .eq('patient_type', 'IPD')
          .order('sr_no', { ascending: true, nullsFirst: false })
          .order('visit_date', { ascending: true });

        // Apply hospital filter if hospitalConfig exists
        if (hospitalConfig?.name) {
          query = query.eq('patients.hospital_name', hospitalConfig.name);
        }

        if (searchOr) {
          // Search mode: all dates, matched patients/visit-IDs only
          query = query.or(searchOr);
        } else {
          // Apply date range filter (with time component for proper timestamp comparison)
          if (startDate) {
            query = query.gte('visit_date', `${startDate}T00:00:00`);
          }
          if (endDate) {
            query = query.lte('visit_date', `${endDate}T23:59:59`);
          }
        }
        return query;
      };

      // Cap search-mode fetches: a short term could match many historical visits
      const data = await fetchAllRows(buildVisitsQuery, 1000, searchOr ? { maxRows: 2000 } : undefined);


      // Debug: Check comments and discharge_date in fetched data
      console.log('📊 Sample visit data (first visit):', data?.[0]);
      console.log('💬 Comments in first visit:', data?.[0]?.comments);
      console.log('📅 Discharge date in first visit:', data?.[0]?.discharge_date);

      // Log all visits with discharge dates
      const visitsWithDischargeDate = data?.filter(v => v.discharge_date) || [];
      console.log(`📅 Found ${visitsWithDischargeDate.length} visits with discharge_date out of ${data?.length || 0} total visits`);

      // Log all visits with comments
      const visitsWithComments = data?.filter(v => v.comments) || [];
      console.log(`📝 Found ${visitsWithComments.length} visits with comments out of ${data?.length || 0} total visits`);
      if (visitsWithComments.length > 0) {
        console.log('💭 Visits with comments:', visitsWithComments.map(v => ({
          id: v.id,
          visit_id: v.visit_id,
          patient_name: v.patients?.name,
          comments: v.comments
        })));
      }

      // Fetch final_payments for these visits (chunked + paged so a long visit list is safe)
      const visitIds = data?.map(v => v.visit_id) || [];
      const finalPayments = await fetchAllByIn<{ visit_id: string; id: string }>(
        visitIds,
        (chunk) => supabase.from('final_payments').select('visit_id, id').in('visit_id', chunk)
      );

      // Add final_payment status to each visit
      const visitsWithPaymentStatus = (data || []).map(visit => ({
        ...visit,
        has_final_payment: finalPayments?.some(fp => fp.visit_id === visit.visit_id) || false
      }));

      // Sort manually to ensure patients with sr_no come first, then patients without sr_no
      const sortedData = visitsWithPaymentStatus.sort((a, b) => {
        // If both have sr_no, sort numerically
        if (a.sr_no && b.sr_no) {
          return parseInt(a.sr_no) - parseInt(b.sr_no);
        }
        // If only a has sr_no, a comes first (starting)
        if (a.sr_no && !b.sr_no) {
          return -1;
        }
        // If only b has sr_no, b comes first (starting)
        if (!a.sr_no && b.sr_no) {
          return 1;
        }
        // If neither has sr_no, both go to end, maintain original order
        return 0;
      });

      return sortedData;
    }
  });

  // Advance payments — own query so it refetches when invalidated by FinalBill /
  // AdvancePaymentModal flows. Prefix-matches the ['advance-payment-total'] key
  // already invalidated after a payment is saved.
  const dashboardVisitIds = useMemo(
    () => (todaysVisits || []).map(v => v.visit_id).filter(Boolean).sort() as string[],
    [todaysVisits]
  );

  const { data: advancePaymentData = { totals: {}, activeTotals: {} } } = useQuery<{
    totals: Record<string, number>;
    activeTotals: Record<string, number>;
  }>({
    queryKey: ['advance-payment-total', 'dashboard', dashboardVisitIds],
    queryFn: async () => {
      if (dashboardVisitIds.length === 0) return { totals: {}, activeTotals: {} };
      let data: { visit_id: string; advance_amount: number; status: string | null; is_refund: boolean | null }[] = [];
      try {
        data = await fetchAllByIn(dashboardVisitIds, (chunk) =>
          supabase.from('advance_payment').select('visit_id, advance_amount, status, is_refund').in('visit_id', chunk));
      } catch (error) {
        console.error('Error fetching advance payments:', error);
        return { totals: {}, activeTotals: {} };
      }
      // totals: every row (drives the payment-status dots, as before).
      // activeTotals: ACTIVE non-refund rows only (what IpdRefereeAmountCell
      // previously fetched per displayed row).
      const totals: Record<string, number> = {};
      const activeTotals: Record<string, number> = {};
      (data || []).forEach((payment) => {
        if (!payment.visit_id) return;
        totals[payment.visit_id] = (totals[payment.visit_id] || 0) + (payment.advance_amount || 0);
        if (payment.status === 'ACTIVE' && payment.is_refund === false) {
          activeTotals[payment.visit_id] = (activeTotals[payment.visit_id] || 0) +
            (parseFloat(payment.advance_amount?.toString() || '0') || 0);
        }
      });
      return { totals, activeTotals };
    },
    enabled: dashboardVisitIds.length > 0,
  });
  const advancePayments = advancePaymentData.totals;

  // Fetch bill totals, intimation dates, and DOA payments for status columns
  useEffect(() => {
    const fetchPaymentData = async () => {
      if (!todaysVisits || todaysVisits.length === 0) return;

      const visitIds = todaysVisits.map(v => v.visit_id).filter(Boolean) as string[];
      const patientIds = todaysVisits.map(v => v.patient_id || v.patients?.id).filter(Boolean) as string[];

      if (visitIds.length === 0) return;

      try {
        // Fetch bill totals
        try {
          const billData = await fetchAllByIn<{ patient_id: string; total_amount: number | null }>(
            patientIds,
            (chunk) => supabase.from('bills').select('patient_id, total_amount').in('patient_id', chunk)
          );
          const billMap: Record<string, number> = {};
          billData.forEach((bill) => {
            if (bill.patient_id) {
              billMap[bill.patient_id] = (billMap[bill.patient_id] || 0) + (bill.total_amount || 0);
            }
          });

          const billByVisit: Record<string, number> = {};
          todaysVisits.forEach(v => {
            const patientId = v.patient_id || v.patients?.id;
            if (patientId && v.visit_id && billMap[patientId]) {
              billByVisit[v.visit_id] = billMap[patientId];
            }
          });
          setBillTotals(billByVisit);
        } catch (billError) {
          console.error('Error fetching bills:', billError);
        }

        // Fetch intimation dates from bill_preparation
        try {
          const intimationData = await fetchAllByIn<{ visit_id: string; intimation_date: string | null }>(
            visitIds,
            (chunk) => supabase.from('bill_preparation').select('visit_id, intimation_date').in('visit_id', chunk)
          );
          const intimationMap: Record<string, string | null> = {};
          intimationData.forEach(item => {
            if (item.visit_id) {
              intimationMap[item.visit_id] = item.intimation_date || null;
            }
          });
          setIntimationDates(intimationMap);
        } catch (intimationError) {
          console.error('Error fetching intimation dates:', intimationError);
        }

        // Fetch DOA payments for referral report (with dates for detailed display)
        const visitUuids = todaysVisits.map(v => v.id).filter(Boolean) as string[];
        if (visitUuids.length > 0) {
          try {
            const doaData = await fetchAllByIn<any>(
              visitUuids,
              (chunk) => supabase
                .from('referee_doa_payments')
                .select('visit_id, amount, payment_date, notes, referral_payment_status')
                .in('visit_id', chunk)
                .order('payment_date', { ascending: false })
            );
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
          } catch (doaError) {
            console.error('Error fetching DOA payments:', doaError);
          }
        }
      } catch (error) {
        console.error('Error fetching payment data:', error);
      }
    };

    fetchPaymentData();
  }, [todaysVisits]);

  // Per-visit paid totals derived from the batched DOA payments — replaces the
  // per-row referee_doa_payments query IpdRefereeAmountCell used to fire.
  const doaPaidTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    Object.entries(doaPayments).forEach(([visitUuid, payments]) => {
      totals[visitUuid] = (payments || []).reduce((sum, p) => sum + Number(p.amount || 0), 0);
    });
    return totals;
  }, [doaPayments]);

  // Function to check if referral letter is uploaded for a visit
  const checkReferralLetterUploaded = async (visitId: string, patientName?: string) => {
    try {
      // First try by visit_id
      const { data, error } = await supabase
        .from('patient_documents')
        .select('is_uploaded')
        .eq('visit_id', visitId)
        .eq('document_type_id', 1) // Referral Letter from ESIC is document type 1
        .eq('is_uploaded', true)
        .single();

      if (data) return true;

      return false;
    } catch (error) {
      console.error('Error checking referral letter:', error);
      return false;
    }
  };

  // Function to check if visit is within 24 hours
  const isWithin24Hours = (visitDate: string) => {
    if (!visitDate) return false;
    
    const visitTime = new Date(visitDate).getTime();
    const currentTime = Date.now();
    const twentyFourHours = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
    
    return (currentTime - visitTime) <= twentyFourHours;
  };

  // Function to get remaining time until 24 hours
  const getRemainingTime = (visitDate: string) => {
    if (!visitDate) return '';
    
    const visitTime = new Date(visitDate).getTime();
    const currentTime = Date.now();
    const twentyFourHours = 24 * 60 * 60 * 1000;
    const elapsedTime = currentTime - visitTime;
    const remainingTime = twentyFourHours - elapsedTime;
    
    if (remainingTime <= 0) return '';
    
    const hours = Math.floor(remainingTime / (60 * 60 * 1000));
    const minutes = Math.floor((remainingTime % (60 * 60 * 1000)) / (60 * 1000));
    
    return `${hours}h ${minutes}m remaining`;
  };

  // Pure status string used by both the renderer and the column filter.
  const getPaymentStatus = (visit: any): 'Full' | 'Partial' | 'None' => {
    const vid = visit.visit_id || '';
    const totalAdvance = advancePayments[vid] || 0;
    const totalBill = billTotals[vid] || 0;
    if (totalAdvance === 0) return 'None';
    if (totalBill > 0 && totalAdvance < totalBill) return 'Partial';
    return 'Full';
  };

  // Render advance payment status with color coding
  // Red: No payment, Orange: Partial/Advance payment, Green: Full payment
  const renderAdvancePaymentStatus = (visit: any) => {
    const visitId = visit.visit_id || '';
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

  // Intimation status dot. Red = not done; click it to pick a date, which saves
  // to bill_preparation and turns the dot green. Click the green dot to change.
  const IntimationDateToggle = ({ visit }: { visit: any }) => {
    const visitId = visit.visit_id || '';
    const intimationDate = intimationDates[visitId];
    const [editing, setEditing] = useState(false);
    const [saving, setSaving] = useState(false);

    const save = async (date: Date | undefined) => {
      if (!visitId) return;
      setSaving(true);
      const iso = date ? formatDateOnly(date) : null;
      const { error } = await (supabase as any)
        .from('bill_preparation')
        .upsert({ visit_id: visitId, intimation_date: iso }, { onConflict: 'visit_id' });
      setSaving(false);
      if (error) {
        toast({ title: 'Failed to save intimation date', description: error.message, variant: 'destructive' });
        return;
      }
      setIntimationDates(prev => ({ ...prev, [visitId]: iso }));
      setEditing(false);
    };

    if (editing) {
      return (
        <div className="flex items-center justify-center gap-1">
          <EnhancedDatePicker
            value={intimationDate ? parseDateOnly(intimationDate) : undefined}
            onChange={save}
            placeholder="Select date"
            isDOB={false}
            defaultOpen
            disabled={saving}
            className="w-[130px]"
          />
          <button
            type="button"
            onClick={() => setEditing(false)}
            title="Cancel"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            ✕
          </button>
        </div>
      );
    }

    if (intimationDate) {
      return (
        <button
          type="button"
          onClick={() => setEditing(true)}
          title="Intimation done — click to change"
          className="mx-auto inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200 transition-colors hover:bg-emerald-100"
        >
          <Circle className="h-2.5 w-2.5 text-green-600 fill-green-600" />
          {formatDateOnlyForDisplay(intimationDate, 'dd/MM/yyyy')}
        </button>
      );
    }

    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        title="Intimation date not added — click to add"
        className="flex w-full justify-center"
      >
        <Circle className="h-4 w-4 text-red-600 fill-red-600 transition-transform hover:scale-110" />
      </button>
    );
  };

  const renderIntimationStatus = (visit: any) => <IntimationDateToggle visit={visit} />;

  // Load referral letter status for all visits — batched (one query per 200
  // visits instead of 1-2 per visit), same semantics as checkReferralLetterUploaded.
  useEffect(() => {
    const loadReferralLetterStatus = async () => {
      if (!todaysVisits || todaysVisits.length === 0) return;

      try {
        const visitIds = todaysVisits.map(v => v.visit_id).filter(Boolean) as string[];
        const uploadedDocs = await fetchAllByIn<{ visit_id: string }>(visitIds, (chunk) => supabase
          .from('patient_documents')
          .select('visit_id')
          .in('visit_id', chunk)
          .eq('document_type_id', 1)
          .eq('is_uploaded', true));
        const uploadedByVisit = new Set(uploadedDocs.map(d => d.visit_id));

        // Fallback for documents saved without a visit_id: match by patient name
        const missingNames = todaysVisits
          .filter(v => !uploadedByVisit.has(v.visit_id))
          .map(v => v.patients?.name)
          .filter(Boolean) as string[];
        const fallbackDocs = missingNames.length > 0
          ? await fetchAllByIn<{ patient_name: string }>(missingNames, (chunk) => supabase
              .from('patient_documents')
              .select('patient_name')
              .in('patient_name', chunk)
              .eq('document_type_id', 1)
              .eq('is_uploaded', true))
          : [];
        const uploadedByName = new Set(fallbackDocs.map(d => d.patient_name));

        const statusMap: Record<string, boolean> = {};
        todaysVisits.forEach(visit => {
          statusMap[visit.visit_id] = uploadedByVisit.has(visit.visit_id) ||
            (!!visit.patients?.name && uploadedByName.has(visit.patients.name));
        });
        setReferralLetterStatus(statusMap);
      } catch (error) {
        console.error('Error loading referral letter status:', error);
      }
    };

    loadReferralLetterStatus();
  }, [todaysVisits]);

  // Real-time subscription to patient_documents table for referral letter updates
  useEffect(() => {
    const channel = supabase
      .channel('referral-letter-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'patient_documents',
          filter: 'document_type_id=eq.1' // Only referral letters
        },
        (payload: any) => {
          const visitId = payload.new?.visit_id || payload.old?.visit_id;
          const patientName = payload.new?.patient_name || payload.old?.patient_name;
          if (!visitId) return;
          // Debounce per visitId to absorb rapid successive uploads for the same visit
          const existing = referralDebounceMap.current.get(visitId);
          if (existing) clearTimeout(existing);
          referralDebounceMap.current.set(visitId, setTimeout(async () => {
            referralDebounceMap.current.delete(visitId);
            const isUploaded = await checkReferralLetterUploaded(visitId, patientName);
            setReferralLetterStatus(prev => ({ ...prev, [visitId]: isUploaded }));
          }, 1000));
        }
      )
      .subscribe();

    return () => {
      referralDebounceMap.current.forEach(t => clearTimeout(t));
      referralDebounceMap.current.clear();
      supabase.removeChannel(channel);
    };
  }, []);

  // Compute unique options for column filters from current data
  const fileStatusOptions = useMemo(() => Array.from(new Set((todaysVisits || []).map((v) => v.file_status).filter(Boolean))) as string[], [todaysVisits]);
  const condonationSubmissionOptions = useMemo(() => Array.from(new Set((todaysVisits || []).map((v) => v.condonation_delay_claim).filter(Boolean))) as string[], [todaysVisits]);
  const condonationIntimationOptions = useMemo(() => Array.from(new Set((todaysVisits || []).map((v) => v.condonation_delay_intimation).filter(Boolean))) as string[], [todaysVisits]);
  const paymentStatusOptions = ['Full', 'Partial', 'None'];
  const extensionOfStayOptions = useMemo(() => Array.from(new Set((todaysVisits || []).map((v) => v.extension_of_stay).filter(Boolean))) as string[], [todaysVisits]);
  const additionalApprovalsOptions = useMemo(() => Array.from(new Set((todaysVisits || []).map((v) => v.additional_approvals).filter(Boolean))) as string[], [todaysVisits]);
  const surgeryNameOptions = useMemo(() => Array.from(new Set([
    ...surgeryMasterNames,
    ...(todaysVisits || []).flatMap((visit) => getSurgeryNames(visit)),
  ])).sort((a, b) => a.localeCompare(b)), [surgeryMasterNames, todaysVisits]);
  const surgeryCategoryOptions = useMemo(() => Array.from(new Set((todaysVisits || []).flatMap((visit) => getSurgeryCategories(visit)))).sort((a, b) => a.localeCompare(b)), [todaysVisits]);
  const surgeryCodeOptions = useMemo(() => Array.from(new Set((todaysVisits || []).flatMap((visit) => getSurgeryCodes(visit)))).sort((a, b) => a.localeCompare(b)), [todaysVisits]);
  const surgeryStatusOptions = useMemo(() => Array.from(new Set((todaysVisits || []).flatMap((visit) => getSurgeryStatuses(visit)))).sort((a, b) => a.localeCompare(b)), [todaysVisits]);
  const surgeryApprovalOptions = useMemo(() => Array.from(new Set((todaysVisits || []).map((visit) => visit.surgical_approval).filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b))), [todaysVisits]);

  const filteredVisits = useMemo(() => {
    // First, filter the visits
    const filtered = (todaysVisits || []).filter(visit => {
      const searchLower = searchTerm.toLowerCase();
      const matchesSearch = !searchTerm ||
        visit.patients?.name?.toLowerCase().includes(searchLower) ||
        visit.visit_id?.toLowerCase().includes(searchLower) ||
        visit.appointment_with?.toLowerCase().includes(searchLower) ||
        visit.patients?.patients_id?.toLowerCase().includes(searchLower) ||
        visit.patients?.insurance_person_no?.toLowerCase().includes(searchLower) ||
        visit.patients?.phone?.toLowerCase().includes(searchLower) ||
        visit.patients?.corporate?.toLowerCase().includes(searchLower) ||
        (visit.sr_no != null && String(visit.sr_no).includes(searchLower)) ||
        (visit.bunch_no != null && String(visit.bunch_no).includes(searchLower));

      const matchesBillingExecutive = !billingExecutiveFilter ||
        visit.billing_executive?.toLowerCase().trim() === billingExecutiveFilter.toLowerCase().trim();

      const matchesBillingStatus = !billingStatusFilter ||
        visit.billing_status?.toLowerCase().trim() === billingStatusFilter.toLowerCase().trim();

      const matchesBunch = !bunchFilter ||
        (visit.bunch_no != null && String(visit.bunch_no) === bunchFilter);

      const matchesCorporate = !corporateFilter ||
        (corporateFilter.toLowerCase() === 'private'
          ? (!visit.patients?.corporate || visit.patients?.corporate?.toLowerCase().trim() === 'private')
          : visit.patients?.corporate?.toLowerCase().trim() === corporateFilter.toLowerCase().trim());

      const matchesScheme = !schemeFilter || getIpdScheme(visit) === schemeFilter;

      const surgeryNames = getSurgeryNames(visit);
      const surgeryCodes = getSurgeryCodes(visit);
      const surgeryCategories = getSurgeryCategories(visit);
      const surgeryStatuses = getSurgeryStatuses(visit);
      const legacySurgeryNames = [visit.package_name, visit.sst_treatment, visit.reason_for_visit].filter(Boolean).map(String);
      const hasSurgeryData = surgeryNames.length > 0 || surgeryCodes.length > 0 || surgeryCategories.length > 0 || legacySurgeryNames.length > 0 || Boolean(visit.surgery_date);
      const matchesSurgerySearch = !surgerySearchFilter || [...surgeryNames, ...legacySurgeryNames].some((value) => value.toLowerCase().includes(surgerySearchFilter.toLowerCase().trim()));
      const matchesSurgeryCategory = !surgeryCategoryFilter || surgeryCategories.some((value) => value.toLowerCase() === surgeryCategoryFilter.toLowerCase());
      const matchesSurgeryCode = !surgeryCodeFilter || surgeryCodes.some((value) => value.toLowerCase() === surgeryCodeFilter.toLowerCase());
      const matchesSurgeryStatus = !surgeryStatusFilter || surgeryStatuses.some((value) => value.toLowerCase() === surgeryStatusFilter.toLowerCase());
      const matchesSurgeryApproval = !surgeryApprovalFilter || String(visit.surgical_approval || '').toLowerCase() === surgeryApprovalFilter.toLowerCase() || surgeryStatuses.some((value) => value.toLowerCase() === surgeryApprovalFilter.toLowerCase());
      const matchesSurgeryDateStatus = !surgeryDateStatusFilter ||
        (surgeryDateStatusFilter === 'completed' ? Boolean(visit.surgery_date) :
          surgeryDateStatusFilter === 'pending' ? !visit.surgery_date && hasSurgeryData : true);


      const includeBy = (selected: string[], value?: string | null) =>
        selected.length === 0 || (value ? selected.includes(value) : false);

      const matchesFile = includeBy(fileStatusFilter, visit.file_status);
      const matchesCondSub = includeBy(condonationSubmissionFilter, visit.condonation_delay_claim);
      const matchesCondInt = includeBy(condonationIntimationFilter, visit.condonation_delay_intimation);
      const matchesPaymentStatus = includeBy(paymentStatusFilter, getPaymentStatus(visit));
      const matchesExtStay = includeBy(extensionOfStayFilter, visit.extension_of_stay);
      const matchesAddAppr = includeBy(additionalApprovalsFilter, visit.additional_approvals);

      const matchesTreatmentType = !treatmentTypeFilter || visit.treatment_type === treatmentTypeFilter;

      return matchesSearch && matchesBillingExecutive && matchesBillingStatus && matchesBunch && matchesCorporate && matchesScheme && matchesSurgerySearch && matchesSurgeryCategory && matchesSurgeryCode && matchesSurgeryStatus && matchesSurgeryApproval && matchesSurgeryDateStatus && matchesFile && matchesCondSub && matchesCondInt && matchesPaymentStatus && matchesExtStay && matchesAddAppr && matchesTreatmentType;
    });

    // Then, sort the filtered results
    const sorted = [...filtered].sort((a, b) => {
      switch (sortBy) {
        case 'sr_no':
          // Ascending order by sr_no (default)
          const srNoA = Number(a.sr_no) || 0;
          const srNoB = Number(b.sr_no) || 0;
          return srNoA - srNoB;

        case 'sr_no_desc':
          // Descending order by sr_no
          const srNoDescA = Number(a.sr_no) || 0;
          const srNoDescB = Number(b.sr_no) || 0;
          return srNoDescB - srNoDescA;

        case 'latest':
          // Latest first (newest visit_id or created_at)
          return (b.visit_id || '').localeCompare(a.visit_id || '');

        case 'oldest':
          // Oldest first
          return (a.visit_id || '').localeCompare(b.visit_id || '');

        case 'name_asc':
          // Patient name A-Z
          const nameA = a.patients?.name || '';
          const nameB = b.patients?.name || '';
          return nameA.localeCompare(nameB);

        case 'name_desc':
          // Patient name Z-A
          const nameDescA = a.patients?.name || '';
          const nameDescB = b.patients?.name || '';
          return nameDescB.localeCompare(nameDescA);

        case 'visit_id_asc':
          // Visit ID ascending
          return (a.visit_id || '').localeCompare(b.visit_id || '');

        case 'visit_id_desc':
          // Visit ID descending
          return (b.visit_id || '').localeCompare(a.visit_id || '');

        default:
          return 0;
      }
    });

    return sorted;
  }, [todaysVisits, searchTerm, billingExecutiveFilter, billingStatusFilter, bunchFilter, corporateFilter, schemeFilter, surgerySearchFilter, surgeryCategoryFilter, surgeryCodeFilter, surgeryStatusFilter, surgeryApprovalFilter, surgeryDateStatusFilter, treatmentTypeFilter, fileStatusFilter, condonationSubmissionFilter, condonationIntimationFilter, paymentStatusFilter, advancePayments, billTotals, extensionOfStayFilter, additionalApprovalsFilter, sortBy]);

  // Pagination calculations
  const totalPages = Math.ceil((filteredVisits?.length || 0) / itemsPerPage) || 1;
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedVisits = filteredVisits?.slice(startIndex, endIndex) || [];
  const startItem = filteredVisits?.length > 0 ? startIndex + 1 : 0;
  const endItem = Math.min(endIndex, filteredVisits?.length || 0);

  const formatTime = (dateString: string) => {
    return format(new Date(dateString), 'MMM dd, yyyy HH:mm');
  };

  const getStatusBadge = (status: string) => {
    const statusStyles = {
      'scheduled': 'bg-blue-100 text-blue-800',
      'in-progress': 'bg-yellow-100 text-yellow-800',
      'completed': 'bg-green-100 text-green-800',
      'cancelled': 'bg-red-100 text-red-800'
    };

    return (
      <Badge
        variant="secondary"
        className={statusStyles[status as keyof typeof statusStyles] || 'bg-gray-100 text-gray-800'}
      >
        {status || 'Scheduled'}
      </Badge>
    );
  };

  const handleVisitIdClick = (patientId: string, visitId: string) => {
    // Navigate to patient profile with the specific patient and visit selected
    navigate(`/patient-profile?patient=${patientId}&visit=${visitId}`);
  };

  const handleBillClick = async (visit) => {
    // Determine if this is an ESIC patient (has ESIC UHID or corporate field indicates ESIC)
    const isESICPatient = Boolean(visit.esic_uh_id) ||
                          visit.patients?.corporate?.toLowerCase().includes('esic') ||
                          visit.patients?.corporate?.toLowerCase() === 'esic';

    // For private patients, allow direct access to billing without referral document requirements
    if (!isESICPatient) {
      navigate(`/final-bill/${visit.visit_id}`);
      return;
    }

    // For ESIC patients only - check referral letter requirements
    const isReferralLetterUploaded = await checkReferralLetterUploaded(visit.visit_id, visit.patients?.name);
    const withinGracePeriod = isWithin24Hours(visit.visit_date || visit.created_at);

    // If within 24 hours, allow access even without referral letter
    if (withinGracePeriod) {
      navigate(`/final-bill/${visit.visit_id}`);
      return;
    }

    // After 24 hours, require referral letter for ESIC patients only
    if (!isReferralLetterUploaded) {
      // Show popup notification
      alert(`24-hour grace period has expired. Please upload the referral letter for patient ${visit.patients?.name} before accessing billing section.`);
      return;
    }

    // Navigate to final bill page with patient and visit data
    navigate(`/final-bill/${visit.visit_id}`);
  };

  const handleEditPatientClick = (visit) => {
    const patient = visit.patients;
    if (patient) {
      setSelectedVisitForEdit({
        patient: {
          id: patient.id,
          name: patient.name,
          patients_id: patient.patients_id,
        },
        visit: visit,
      });
      setShowVisitEditDialog(true);
    }
  };

  const handleSavePatient = (updatedPatient) => {
    updatePatient(updatedPatient);
    setShowEditPatientDialog(false);
    setSelectedPatientForEdit(null);
  };

  // Comment handlers
  const handleCommentClick = (visit: any) => {
    console.log('🔍 Opening comment dialog for visit:', visit.id);
    console.log('📋 Visit object:', visit);
    console.log('💬 Existing comment from visit.comments:', visit.comments);

    const existingComment = visit.comments || '';
    console.log('📝 Loading comment into dialog:', existingComment);

    // Load existing comment if any
    setCommentTexts(prev => ({
      ...prev,
      [visit.id]: existingComment
    }));

    // Store original comment to track changes
    setOriginalComments(prev => ({
      ...prev,
      [visit.id]: existingComment
    }));

    // Open dialog for this visit
    setCommentDialogs(prev => ({
      ...prev,
      [visit.id]: true
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
            // Hide saved indicator after 2 seconds
            setTimeout(() => {
              setSavedComments(prev => ({ ...prev, [visitId]: false }));
            }, 2000);
            // Refresh the data to get updated comments
            refetch();
          }
        } catch (error) {
          console.error('❌ Exception while saving comment:', error);
          console.error('Exception details:', {
            visitId,
            text,
            error: error.message || error
          });
          alert(`Failed to save comment: ${error.message || error}`);
          setSavingComments(prev => ({ ...prev, [visitId]: false }));
        }
      }
    });
  }, [debouncedCommentTexts, commentDialogs, originalComments]);

  const handleSrNoSubmit = async (visitId: string, value: string) => {
    try {
      const { error } = await supabase
        .from('visits')
        .update({ sr_no: value })
        .eq('visit_id', visitId);

      if (error) {
        console.error('Error updating sr_no:', error);
        return;
      }

      refetch(); // Refresh the data
    } catch (error) {
      console.error('Error updating sr_no:', error);
    }
  };

  const handleBillingExecutiveSubmit = async (visitId: string, value: string) => {
    try {
      const { error } = await supabase
        .from('visits')
        .update({ billing_executive: value })
        .eq('visit_id', visitId);

      if (error) {
        console.error('Error updating billing_executive:', error);
        return;
      }

      refetch(); // Refresh the data
    } catch (error) {
      console.error('Error updating billing_executive:', error);
    }
  };

  const handleBillingStatusSubmit = async (visitId: string, value: string) => {
    console.log('🔄 Starting billing status update for visitId:', visitId, 'value:', value);
    try {
      const { error } = await supabase
        .from('visits')
        .update({ billing_status: value })
        .eq('visit_id', visitId);

      if (error) {
        console.error('❌ Error updating billing_status:', error);
        return;
      }

      refetch(); // Refresh the data
    } catch (error) {
      console.error('❌ Exception during billing_status update:', error);
    }
  };

  const handleBillingSubStatusSubmit = async (visitId: string, value: string) => {
    console.log('🔄 Starting billing sub status update for visitId:', visitId, 'value:', value);
    try {
      const { error } = await supabase
        .from('visits')
        .update({ billing_sub_status: value })
        .eq('visit_id', visitId);

      if (error) {
        console.error('❌ Error updating billing_sub_status:', error);
        return;
      }

      refetch(); // Refresh the data
    } catch (error) {
      console.error('❌ Exception during billing_sub_status update:', error);
    }
  };

  const handleClaimIdSubmit = async (visitId: string, value: string) => {
    try {
      const { error } = await supabase
        .from('visits')
        .update({ claim_id: value })
        .eq('visit_id', visitId);

      if (error) {
        console.error('Error updating claim_id:', error);
        return;
      }

      refetch();
    } catch (error) {
      console.error('Error updating claim_id:', error);
    }
  };

  const handleRegistrationIdSubmit = async (visitRowId: string | undefined, value: string) => {
    if (!visitRowId) return;

    try {
      const { error } = await supabase
        .from('visits')
        .update({ yojana_registration_id: value.trim() || null })
        .eq('id', visitRowId);

      if (error) {
        console.error('Error updating yojana_registration_id:', error);
        return;
      }

      refetch();
    } catch (error) {
      console.error('Error updating yojana_registration_id:', error);
    }
  };

  const handleEsicUhidSubmit = async (visitId: string, value: string) => {
    try {
      const { error } = await supabase
        .from('visits')
        .update({ esic_uh_id: value })
        .eq('visit_id', visitId);

      if (error) {
        console.error('Error updating esic_uh_id:', error);
        return;
      }

      refetch();
    } catch (error) {
      console.error('Error updating esic_uh_id:', error);
    }
  };

  const handleBunchNumberSubmit = async (visitId: string, value: string) => {
    try {
      const { error } = await supabase
        .from('visits')
        .update({ bunch_no: value })
        .eq('visit_id', visitId);

      if (error) {
        console.error('Error updating bunch_no:', error);
        return;
      }

      refetch(); // Refresh the data
    } catch (error) {
      console.error('Error updating bunch_no:', error);
    }
  };

  const handleRevokeDischarge = async (visitId: string, patientName: string) => {
    try {
      const { error } = await supabase
        .from('visits')
        .update({
          discharge_date: null
        })
        .eq('visit_id', visitId);

      if (error) {
        console.error('Error revoking discharge:', error);
        alert('Failed to revoke discharge. Please try again.');
        return;
      }

      refetch(); // Refresh the data
      alert(`Discharge revoked for ${patientName}. Patient moved back to currently admitted.`);
    } catch (error) {
      console.error('Error revoking discharge:', error);
      alert('Failed to revoke discharge. Please try again.');
    }
  };

  const handlePrint = () => {
    openPrintPicker();
  };

  const handleExportToExcel = () => {
    const excelData = filteredVisits.map(visit => ({
      'Name': formatDialysisPatientName(visit.patients?.name || '', visit),
      'Phone number': visit.patients?.phone || ''
    }));

    const ws = XLSX.utils.json_to_sheet(excelData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'IPD Patients');
    XLSX.writeFile(wb, `IPD_Patients_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  // Open Referral Report Preview Modal
  const handleOpenReferralReport = () => {
    setIsReferralReportOpen(true);
  };

  // Print Referral Report
  const handlePrintReferralReport = () => {
    const printContent = document.getElementById('ipd-referral-report-content');
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
              <p class="subtitle">IPD Patients - Referral Details</p>
              <div class="header-info">
                <span><strong>Print Date:</strong> ${format(new Date(), 'dd MMM yyyy, hh:mm a')}</span>
                <span><strong>Total Records:</strong> ${filteredVisits.length}</span>
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

  // Filter for unpaid referral visits (excludes DIRECT referrals and patients with paid status)
  const unpaidReferralVisits = filteredVisits.filter(visit => {
    // Exclude DIRECT referrals
    const refereeName = visit.referees?.name?.toUpperCase();
    const rmName = visit.relationship_managers?.name?.toUpperCase();
    if (refereeName === 'DIRECT' || rmName === 'DIRECT') {
      return false;
    }

    // Check if any payment has "Spot paid" or "Backing paid" status
    const visitPayments = doaPayments[visit.id] || [];
    const hasPaidStatus = visitPayments.some(
      payment => payment.referral_payment_status === 'Spot paid' ||
                 payment.referral_payment_status === 'Backing paid'
    );
    if (hasPaidStatus) {
      return false;
    }

    // Original condition - only show truly unpaid visits
    return (!visit.referral_payment_status || visit.referral_payment_status === 'Unpaid') &&
           visitPayments.length === 0;
  });

  // Filter for referral report (excludes DIRECT referrals)
  const referralReportVisits = filteredVisits.filter(visit => {
    const refereeName = visit.referees?.name?.toUpperCase();
    const rmName = visit.relationship_managers?.name?.toUpperCase();
    // Exclude DIRECT referrals
    if (refereeName === 'DIRECT' || rmName === 'DIRECT') {
      return false;
    }
    return true;
  });

  // Open Unpaid Referral Report Modal
  const handleOpenUnpaidReport = () => {
    setIsUnpaidReportOpen(true);
  };

  // Print Unpaid Referral Report
  const handlePrintUnpaidReport = () => {
    const printContent = document.getElementById('ipd-unpaid-referral-report-content');
    if (printContent) {
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(`
          <html>
            <head>
              <title>IPD Unpaid Referral Report - ${format(new Date(), 'dd MMM yyyy')}</title>
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
              <h1>IPD Unpaid Referral Report</h1>
              <p class="subtitle">IPD Patients - Unpaid Referral Details</p>
              <div class="header-info">
                <span><strong>Print Date:</strong> ${format(new Date(), 'dd MMM yyyy, hh:mm a')}</span>
                <span><strong>Total Unpaid:</strong> ${unpaidReferralVisits.length}</span>
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

  const handlePrintConfirm = () => {
    setIsPrintPickerOpen(false);
    setShowPrintPreview(true);
  };

  const handlePrintPreview = () => {
    setIsPrintPickerOpen(false);
    setShowPrintPreview(true);
  };

  const getCurrentFilters = () => {
    return generateIPDFilterSummary({
      searchTerm,
      billingExecutiveFilter,
      billingStatusFilter,
      bunchFilter,
      corporateFilter,
      fileStatusFilter,
      condonationSubmissionFilter,
      condonationIntimationFilter,
      extensionOfStayFilter,
      additionalApprovalsFilter
    });
  };

  const handleDeleteVisit = async (visitId: string) => {
    if (window.confirm('Are you sure you want to mark this visit as inactive? The record will be preserved for audit purposes.')) {
      try {

        const { error } = await supabase
          .from('visits')
          .update({ status: 'inactive', updated_at: new Date().toISOString() })
          .eq('visit_id', visitId);

        if (error) {
          console.error('Error deactivating visit:', error);
          alert('Failed to deactivate visit. Please try again.');
          return;
        }

        refetch();
        alert('Visit marked as inactive successfully.');
      } catch (error) {
        console.error('Error deactivating visit:', error);
        alert('Failed to deactivate visit. Please try again.');
      }
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center">Loading today's visits...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between no-print">
          <div className="flex items-center gap-3">
            <Calendar className="h-8 w-8 text-primary" />
            <div>
              <h1 className="text-3xl font-bold text-primary">IPD PATIENT DASHBOARD</h1>
              <p className="text-muted-foreground">
                {format(new Date(), 'EEEE, MMMM do, yyyy')} - {filteredVisits?.length || 0} visits scheduled
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <DateRangePicker
              date={dateRange}
              onDateChange={handleDateRangeChange}
            />
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
              <Input
                placeholder="Search visits..."
                value={localSearchTerm}
                onChange={(e) => setLocalSearchTerm(e.target.value)}
                className="pl-10 w-48"
              />
            </div>
            <Select value={schemeFilter || 'all'} onValueChange={(value) => setSchemeFilter(value === 'all' ? '' : value)}>
              <SelectTrigger className="w-36 h-8 text-xs">
                <SelectValue placeholder="Scheme" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Schemes</SelectItem>
                <SelectItem value="PMJAY">PMJAY</SelectItem>
                <SelectItem value="MJPJAY">MJPJAY</SelectItem>
              </SelectContent>
            </Select>
            <Button
              onClick={handlePrint}
              variant="outline"
              className="flex items-center gap-1 text-xs h-8"
            >
              <Printer className="h-3 w-3" />
              Print List
            </Button>
            <Button
              onClick={handleExportToExcel}
              variant="outline"
              className="flex items-center gap-1 text-xs h-8"
            >
              <Download className="h-3 w-3" />
              Export XLS
            </Button>
            {/* Only show referral-related buttons for marketing managers */}
            {isMarketingManager && (
              <>
                <Button
                  onClick={handleOpenReferralReport}
                  variant="outline"
                  className="flex items-center gap-1 text-xs h-8"
                >
                  <Download className="h-3 w-3" />
                  Referral Report
                </Button>
                <Button
                  onClick={handleOpenUnpaidReport}
                  variant="outline"
                  className="flex items-center gap-1 text-xs h-8 text-red-600 border-red-300 hover:bg-red-50"
                >
                  <Download className="h-3 w-3" />
                  Unpaid Referral
                </Button>
              </>
            )}
            <Button
              onClick={() => setHideColumns(!hideColumns)}
              variant="outline"
              className="flex items-center gap-1 text-xs h-8"
            >
              {hideColumns ? 'Show Columns' : 'Hide Columns'}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="flex items-center gap-1 text-xs h-8">
                  <Filter className="h-3 w-3" />
                  Filters
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {/* Sort By Submenu */}
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <ArrowUpDown className="h-3 w-3 mr-2" />
                    Sort By
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem onSelect={() => setSortBy('sr_no')} className={sortBy === 'sr_no' ? 'bg-accent' : ''}>
                      Sr No (Ascending) {sortBy === 'sr_no' && '✓'}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setSortBy('sr_no_desc')} className={sortBy === 'sr_no_desc' ? 'bg-accent' : ''}>
                      Sr No (Descending) {sortBy === 'sr_no_desc' && '✓'}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => setSortBy('latest')} className={sortBy === 'latest' ? 'bg-accent' : ''}>
                      Latest First {sortBy === 'latest' && '✓'}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setSortBy('oldest')} className={sortBy === 'oldest' ? 'bg-accent' : ''}>
                      Oldest First {sortBy === 'oldest' && '✓'}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => setSortBy('name_asc')} className={sortBy === 'name_asc' ? 'bg-accent' : ''}>
                      Patient Name (A-Z) {sortBy === 'name_asc' && '✓'}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setSortBy('name_desc')} className={sortBy === 'name_desc' ? 'bg-accent' : ''}>
                      Patient Name (Z-A) {sortBy === 'name_desc' && '✓'}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => setSortBy('visit_id_asc')} className={sortBy === 'visit_id_asc' ? 'bg-accent' : ''}>
                      Visit ID (Ascending) {sortBy === 'visit_id_asc' && '✓'}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setSortBy('visit_id_desc')} className={sortBy === 'visit_id_desc' ? 'bg-accent' : ''}>
                      Visit ID (Descending) {sortBy === 'visit_id_desc' && '✓'}
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>

                <DropdownMenuSeparator />

                {/* Billing Executive Submenu */}
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>Billing Executive</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="max-h-64 overflow-y-auto">
                    <DropdownMenuItem onSelect={() => setBillingExecutiveFilter('')} className={billingExecutiveFilter === '' ? 'bg-accent' : ''}>
                      All {billingExecutiveFilter === '' && '✓'}
                    </DropdownMenuItem>
                    {['Dr.B.K.Murali', 'Ruby', 'Shrikant', 'Gaurav', 'Dr. Swapnil', 'Dr.Sachin', 'Dr.Shiraj', 'Dr. Sharad', 'Shashank', 'Shweta', 'Suraj', 'Nitin', 'Sonali', 'Ruchika', 'Pragati', 'Rachana', 'Kashish', 'Aman', 'Dolly', 'Ruchi', 'Gayatri', 'Noor', 'Nisha', 'Diksha', 'Ayush', 'Kiran', 'Pratik', 'Azhar', 'Tejas', 'Abhishek', 'Chandrprakash'].map((exec) => (
                      <DropdownMenuItem key={exec} onSelect={() => setBillingExecutiveFilter(exec)} className={billingExecutiveFilter === exec ? 'bg-accent' : ''}>
                        {exec} {billingExecutiveFilter === exec && '✓'}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>

                {/* Billing Status Submenu */}
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>Billing Status</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem onSelect={() => setBillingStatusFilter('')} className={billingStatusFilter === '' ? 'bg-accent' : ''}>
                      All {billingStatusFilter === '' && '✓'}
                    </DropdownMenuItem>
                    {['Approval Pending', 'ID Pending', 'Doctor Planning Done', 'Bill Completed', 'Bill Submitted', 'Bill uploaded, not couriered', 'Bill uploaded, couriered', 'Payment received'].map((status) => (
                      <DropdownMenuItem key={status} onSelect={() => setBillingStatusFilter(status)} className={billingStatusFilter === status ? 'bg-accent' : ''}>
                        {status === 'Bill Completed' ? 'Bill PDF Completed' : (status === 'Bill Submitted' ? 'Bill submitted - DSC done' : status)} {billingStatusFilter === status && '✓'}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>

                {/* Corporate Submenu */}
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>Corporate</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="max-h-64 overflow-y-auto">
                    <DropdownMenuItem onSelect={() => setCorporateFilter('')} className={corporateFilter === '' ? 'bg-accent' : ''}>
                      All {corporateFilter === '' && '✓'}
                    </DropdownMenuItem>
                    {corporates.map((corporate) => (
                      <DropdownMenuItem key={corporate.id} onSelect={() => setCorporateFilter(corporate.name)} className={corporateFilter === corporate.name ? 'bg-accent' : ''}>
                        {corporate.name} {corporateFilter === corporate.name && '✓'}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>

                {/* Treatment Type Submenu */}
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>Treatment Type</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem onSelect={() => setTreatmentTypeFilter('')} className={treatmentTypeFilter === '' ? 'bg-accent' : ''}>
                      All {treatmentTypeFilter === '' && '✓'}
                    </DropdownMenuItem>
                    {['Conservative', 'Surgical'].map((type) => (
                      <DropdownMenuItem key={type} onSelect={() => setTreatmentTypeFilter(type)} className={treatmentTypeFilter === type ? 'bg-accent' : ''}>
                        {type} {treatmentTypeFilter === type && '✓'}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>

                {/* Surgery Filters */}
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>Surgery</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-72">
                    <div className="px-2 py-1.5">
                      <Input
                        value={surgerySearchFilter}
                        onChange={(e) => setSurgerySearchFilter(e.target.value)}
                        onKeyDown={(e) => e.stopPropagation()}
                        placeholder="Search surgery or package..."
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="max-h-64 overflow-y-auto">
                      <DropdownMenuItem onSelect={() => setSurgerySearchFilter('')} className={surgerySearchFilter === '' ? 'bg-accent' : ''}>
                        All surgery names {surgerySearchFilter === '' && '✓'}
                      </DropdownMenuItem>
                      {surgeryNameOptions
                        .filter((name) => !surgerySearchFilter || name.toLowerCase().includes(surgerySearchFilter.toLowerCase().trim()))
                        .map((name) => (
                          <DropdownMenuItem key={name} onSelect={() => setSurgerySearchFilter(name)} className={surgerySearchFilter === name ? 'bg-accent' : ''}>
                            {name} {surgerySearchFilter === name && '✓'}
                          </DropdownMenuItem>
                        ))}
                    </div>
                    <DropdownMenuSeparator />
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>Category</DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="max-h-64 overflow-y-auto">
                        <DropdownMenuItem onSelect={() => setSurgeryCategoryFilter('')} className={surgeryCategoryFilter === '' ? 'bg-accent' : ''}>
                          All {surgeryCategoryFilter === '' && '✓'}
                        </DropdownMenuItem>
                        {surgeryCategoryOptions.map((category) => (
                          <DropdownMenuItem key={category} onSelect={() => setSurgeryCategoryFilter(category)} className={surgeryCategoryFilter === category ? 'bg-accent' : ''}>
                            {category} {surgeryCategoryFilter === category && '✓'}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>Code / Package Code</DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="max-h-64 overflow-y-auto">
                        <DropdownMenuItem onSelect={() => setSurgeryCodeFilter('')} className={surgeryCodeFilter === '' ? 'bg-accent' : ''}>
                          All {surgeryCodeFilter === '' && '✓'}
                        </DropdownMenuItem>
                        {surgeryCodeOptions.map((code) => (
                          <DropdownMenuItem key={code} onSelect={() => setSurgeryCodeFilter(code)} className={surgeryCodeFilter === code ? 'bg-accent' : ''}>
                            {code} {surgeryCodeFilter === code && '✓'}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>Surgery Status</DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="max-h-64 overflow-y-auto">
                        <DropdownMenuItem onSelect={() => setSurgeryStatusFilter('')} className={surgeryStatusFilter === '' ? 'bg-accent' : ''}>
                          All {surgeryStatusFilter === '' && '✓'}
                        </DropdownMenuItem>
                        {surgeryStatusOptions.map((status) => (
                          <DropdownMenuItem key={status} onSelect={() => setSurgeryStatusFilter(status)} className={surgeryStatusFilter === status ? 'bg-accent' : ''}>
                            {status} {surgeryStatusFilter === status && '✓'}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>Sanction / Approval</DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="max-h-64 overflow-y-auto">
                        <DropdownMenuItem onSelect={() => setSurgeryApprovalFilter('')} className={surgeryApprovalFilter === '' ? 'bg-accent' : ''}>
                          All {surgeryApprovalFilter === '' && '✓'}
                        </DropdownMenuItem>
                        {surgeryApprovalOptions.map((approval) => (
                          <DropdownMenuItem key={approval} onSelect={() => setSurgeryApprovalFilter(String(approval))} className={surgeryApprovalFilter === approval ? 'bg-accent' : ''}>
                            {approval} {surgeryApprovalFilter === approval && '✓'}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>Surgery Date</DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        <DropdownMenuItem onSelect={() => setSurgeryDateStatusFilter('')} className={surgeryDateStatusFilter === '' ? 'bg-accent' : ''}>
                          All {surgeryDateStatusFilter === '' && '✓'}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setSurgeryDateStatusFilter('completed')} className={surgeryDateStatusFilter === 'completed' ? 'bg-accent' : ''}>
                          Date entered / completed {surgeryDateStatusFilter === 'completed' && '✓'}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setSurgeryDateStatusFilter('pending')} className={surgeryDateStatusFilter === 'pending' ? 'bg-accent' : ''}>
                          Date pending {surgeryDateStatusFilter === 'pending' && '✓'}
                        </DropdownMenuItem>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    {surgerySearchFilter && (
                      <DropdownMenuItem onSelect={() => setSurgerySearchFilter('')}>Clear surgery search</DropdownMenuItem>
                    )}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>

                {/* Bunch Submenu */}
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>Bunch</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem onSelect={() => setBunchFilter('')} className={bunchFilter === '' ? 'bg-accent' : ''}>
                      All {bunchFilter === '' && '✓'}
                    </DropdownMenuItem>
                    {Array.from(new Set((todaysVisits || []).map(visit => visit.bunch_no).filter(Boolean))).sort().map((bunchNo) => (
                      <DropdownMenuItem key={bunchNo} onSelect={() => setBunchFilter(bunchNo as string)} className={bunchFilter === bunchNo ? 'bg-accent' : ''}>
                        Bunch {bunchNo} {bunchFilter === bunchNo && '✓'}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 no-print">
          <div className="bg-card p-4 rounded-lg border">
            <div className="text-2xl font-bold text-blue-600">
              {(todaysVisits || []).filter(v => v.status === 'scheduled' || !v.status).length}
            </div>
            <div className="text-sm text-muted-foreground">Scheduled</div>
          </div>
          <div className="bg-card p-4 rounded-lg border">
            <div className="text-2xl font-bold text-yellow-600">
              {(todaysVisits || []).filter(v => v.status === 'in-progress').length}
            </div>
            <div className="text-sm text-muted-foreground">In Progress</div>
          </div>
          <div className="bg-card p-4 rounded-lg border">
            <div className="text-2xl font-bold text-green-600">
              {(todaysVisits || []).filter(v => v.status === 'completed').length}
            </div>
            <div className="text-sm text-muted-foreground">Completed</div>
          </div>
          <div className="bg-card p-4 rounded-lg border">
            <div className="text-2xl font-bold text-primary">
              {(todaysVisits || []).length}
            </div>
            <div className="text-sm text-muted-foreground">Total Visits</div>
          </div>
        </div>

        {/* Print Info - Disabled to remove blank space in print output */}
        {false && (
          <div className="print-info">
            <h3 className="font-semibold">Applied Filters:</h3>
            {billingExecutiveFilter && <p>Billing Executive: {billingExecutiveFilter}</p>}
            {billingStatusFilter && <p>Billing Status: {billingStatusFilter}</p>}
            {bunchFilter && <p>Bunch: {bunchFilter}</p>}
            {searchTerm && <p>Search: {searchTerm}</p>}
            {!billingExecutiveFilter && !billingStatusFilter && !bunchFilter && !searchTerm && <p>No filters applied - Showing all visits</p>}
          </div>
        )}

        {/* Visits Table */}
        <div className="bg-card rounded-lg border no-print">
          <div className="p-4 border-b">
            <h2 className="text-lg font-semibold">IPD PATIENT</h2>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                {!hideColumns && <TableHead className="font-semibold">Sr No</TableHead>}
                {!hideColumns && <TableHead className="font-semibold">Bunch No.</TableHead>}
                <TableHead className="font-semibold">Visit ID</TableHead>
                <TableHead className="font-semibold">Patient Name</TableHead>
                <TableHead className="font-semibold">Doctor</TableHead>
                <TableHead className="font-semibold">Diagnosis</TableHead>
                <TableHead className="font-semibold">Gender/Age</TableHead>
                <TableHead className="font-semibold">Claim ID</TableHead>
                <TableHead className="font-semibold">Registration ID</TableHead>
                <TableHead className="text-center font-semibold">Intimation</TableHead>
                <TableHead className="text-center font-semibold">Payment Received</TableHead>
                <TableHead className="font-semibold">Bill</TableHead>
                <TableHead className="font-semibold">Admission Notes</TableHead>
                <TableHead className="font-semibold">Corporate</TableHead>
                {!hideColumns && <TableHead className="font-semibold">Billing Executive</TableHead>}
                {!hideColumns && <TableHead className="font-semibold">Billing Status</TableHead>}
                {!hideColumns && <TableHead className="font-semibold">File Status</TableHead>}
                {!hideColumns && <TableHead className="font-semibold">Photos</TableHead>}
                {!hideColumns && <TableHead className="font-semibold">Sign</TableHead>}
                {!hideColumns && <TableHead className="font-semibold">HospitalStamp</TableHead>}
                {!hideColumns && <TableHead className="font-semibold">DrSurgeonStamp</TableHead>}
                {!hideColumns && <TableHead className="font-semibold">Condonation Delay -submission</TableHead>}
                {!hideColumns && <TableHead className="font-semibold">Condonation Delay -intimation</TableHead>}
                {!hideColumns && <TableHead className="font-semibold">Extension of Stay</TableHead>}
                {!hideColumns && <TableHead className="font-semibold">Extension Days</TableHead>}
                {!hideColumns && <TableHead className="font-semibold">Additional Approvals</TableHead>}
                {!hideColumns && <TableHead className="font-semibold">Visit Type</TableHead>}
                <TableHead className="font-semibold">Admission Date</TableHead>
                <TableHead className="font-semibold">Days Admitted</TableHead>
                {canSeeReferralColumn && <TableHead className="font-semibold">Referral Doctor/Relationship Manager</TableHead>}
                {/* Only show referral-related columns for marketing managers */}
                {isMarketingManager && <TableHead className="font-semibold">Referee DOA_Amt Paid</TableHead>}
                {isMarketingManager && <TableHead className="font-semibold">Referral Payment</TableHead>}
                <TableHead className="font-semibold">Discharge Date</TableHead>
                <TableHead className="font-semibold">Stickers</TableHead>
                <TableHead className="font-semibold">ESIC UHID</TableHead>
                <TableHead className="font-semibold">Discharge Intimation</TableHead>
                <TableHead className="font-semibold">Summaries and Certificates</TableHead>
                <TableHead className="font-semibold">Getpass Notification</TableHead>
                <TableHead className="font-semibold">Radiology</TableHead>
                {canSeeActionsColumn && <TableHead className="font-semibold">Actions</TableHead>}
              </TableRow>
              <TableRow className="bg-muted/30">
                {!hideColumns && <TableHead></TableHead>}
                {!hideColumns && <TableHead></TableHead>}
                <TableHead></TableHead>
                <TableHead></TableHead>
                <TableHead></TableHead>
                <TableHead></TableHead>
                <TableHead></TableHead>
                <TableHead></TableHead>
                <TableHead></TableHead>
                <TableHead></TableHead>
                <TableHead className="text-center">
                  <ColumnFilter options={paymentStatusOptions} selected={paymentStatusFilter} onChange={setPaymentStatusFilter} />
                </TableHead>
                <TableHead></TableHead>
                {!hideColumns && <TableHead></TableHead>}
                {!hideColumns && <TableHead></TableHead>}
                {!hideColumns && (
                  <TableHead>
                    <ColumnFilter options={fileStatusOptions} selected={fileStatusFilter} onChange={setFileStatusFilter} />
                  </TableHead>
                )}
                {!hideColumns && <TableHead></TableHead>}
                {!hideColumns && <TableHead></TableHead>}
                {!hideColumns && <TableHead></TableHead>}
                {!hideColumns && <TableHead></TableHead>}
                {!hideColumns && (
                  <TableHead>
                    <ColumnFilter options={condonationSubmissionOptions} selected={condonationSubmissionFilter} onChange={setCondonationSubmissionFilter} />
                  </TableHead>
                )}
                {!hideColumns && (
                  <TableHead>
                    <ColumnFilter options={condonationIntimationOptions} selected={condonationIntimationFilter} onChange={setCondonationIntimationFilter} />
                  </TableHead>
                )}
                {!hideColumns && (
                  <TableHead>
                    <ColumnFilter options={extensionOfStayOptions} selected={extensionOfStayFilter} onChange={setExtensionOfStayFilter} />
                  </TableHead>
                )}
                {!hideColumns && (
                  <TableHead>
                    <ColumnFilter options={additionalApprovalsOptions} selected={additionalApprovalsFilter} onChange={setAdditionalApprovalsFilter} />
                  </TableHead>
                )}
                {!hideColumns && <TableHead></TableHead>}
                <TableHead></TableHead>
                <TableHead></TableHead>
                <TableHead></TableHead>
                <TableHead></TableHead>
                <TableHead></TableHead>
                {canSeeReferralColumn && <TableHead></TableHead>}
                <TableHead></TableHead>
                <TableHead></TableHead>
                <TableHead></TableHead>
                <TableHead></TableHead>
                <TableHead></TableHead>
                <TableHead></TableHead>
                <TableHead></TableHead>
                {canSeeActionsColumn && <TableHead></TableHead>}
              </TableRow>
            </TableHeader>

            <TableBody>
              {paginatedVisits.map((visit) => (
                <TableRow key={visit.id} className="hover:bg-muted/50">
                  {!hideColumns && (
                    <TableCell>
                      {isAdmin ? (
                        <Input
                          value={visit.sr_no || ''}
                          onChange={(e) => handleSrNoSubmit(visit.visit_id, e.target.value)}
                          onBlur={(e) => handleSrNoSubmit(visit.visit_id, e.target.value)}
                          placeholder="Enter Sr No"
                          className="w-20 h-8 text-sm"
                        />
                      ) : (
                        <span className="text-sm">{visit.sr_no || '-'}</span>
                      )}
                    </TableCell>
                  )}
                  {!hideColumns && (
                    <TableCell>
                      <BunchNumberInput visit={visit} isAdmin={isAdmin} />
                    </TableCell>
                  )}
                  <TableCell className="font-mono text-sm">
                    <button
                      onClick={() => handleVisitIdClick(visit.patients?.id, visit.visit_id)}
                      className="text-blue-600 hover:text-blue-800 hover:underline font-medium transition-colors"
                    >
                      {visit.visit_id}
                    </button>
                  </TableCell>
                  <TableCell className="font-medium">
                    {formatDialysisPatientName(visit.patients?.name, visit)}
                    {visit.discharge_date && <span className="text-red-500 text-xs ml-1">(discharged)</span>}
                  </TableCell>
                  <TableCell>
                    {visit.appointment_with}
                  </TableCell>
                  <TableCell>
                    {visit.diagnoses?.name || 'General'}
                  </TableCell>
                  <TableCell>
                    {(() => {
                      const gender = visit.patients?.gender || 'Unknown';
                      const age = visit.patients?.age;
                      return age ? `${gender}/${age} Years` : `${gender}/N/A`;
                    })()}
                  </TableCell>
                  <TableCell>
                    <ClaimIdInput visit={visit} />
                  </TableCell>
                  <TableCell>
                    <RegistrationIdInput visit={visit} />
                  </TableCell>
                  <TableCell className="text-center">
                    {renderIntimationStatus(visit)}
                  </TableCell>
                  <TableCell className="text-center">
                    {renderAdvancePaymentStatus(visit)}
                  </TableCell>
                  <TableCell>
                    {(() => {
                      // Check if this is an ESIC patient
                      const isESICPatient = Boolean(visit.esic_uh_id) ||
                                            visit.patients?.corporate?.toLowerCase().includes('esic') ||
                                            visit.patients?.corporate?.toLowerCase() === 'esic';

                      // For private patients, always show normal green bill icon (no referral document requirements)
                      if (!isESICPatient) {
                        return (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={() => handleBillClick(visit)}
                            title="View Bill - Private Patient"
                          >
                            <DollarSign className="h-4 w-4 text-green-600" />
                          </Button>
                        );
                      }

                      // For ESIC patients only - apply referral document logic
                      const hasReferralLetter = referralLetterStatus[visit.visit_id];
                      const withinGracePeriod = isWithin24Hours(visit.visit_date || visit.created_at);
                      const remainingTime = getRemainingTime(visit.visit_date || visit.created_at);

                      // Case 1: Has referral letter - always enabled (green)
                      if (hasReferralLetter) {
                        return (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={() => handleBillClick(visit)}
                            title="View Bill - Referral letter uploaded"
                          >
                            <DollarSign className="h-4 w-4 text-green-600" />
                          </Button>
                        );
                      }

                      // Case 2: Within 24 hours without referral letter - enabled but orange (grace period)
                      if (withinGracePeriod) {
                        return (
                          <div className="relative group">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0"
                              onClick={() => handleBillClick(visit)}
                            >
                              <DollarSign className="h-4 w-4 text-orange-500" />
                            </Button>

                            {/* Grace period tooltip */}
                            <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-orange-500 text-white text-xs rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none z-50 whitespace-nowrap">
                              <div className="font-medium">⏰ Grace Period Active</div>
                              <div className="text-xs">Billing accessible without referral letter</div>
                              <div className="text-xs font-semibold">Patient: {visit.patients?.name}</div>
                              <div className="text-xs">{remainingTime}</div>
                              <div className="text-xs mt-1 text-orange-100">Please upload referral letter soon</div>

                              {/* Arrow pointing down */}
                              <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-orange-500"></div>
                            </div>
                          </div>
                        );
                      }

                      // Case 3: After 24 hours without referral letter - disabled (red)
                      return (
                        <div className="relative group">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 opacity-50 cursor-not-allowed"
                            disabled
                            onClick={() => handleBillClick(visit)}
                          >
                            <DollarSign className="h-4 w-4 text-red-600" />
                          </Button>

                          {/* 24-hour expired tooltip */}
                          <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-red-600 text-white text-xs rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none z-50 whitespace-nowrap">
                            <div className="font-medium">🚫 Grace Period Expired</div>
                            <div className="text-xs">24-hour grace period has ended</div>
                            <div className="text-xs">Please upload the referral letter for</div>
                            <div className="text-xs font-semibold">{visit.patients?.name}</div>
                            <div className="text-xs">before accessing billing section</div>
                            
                            {/* Arrow pointing down */}
                            <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-red-600"></div>
                          </div>
                        </div>
                      );
                    })()}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 hover:bg-green-50"
                      onClick={() => navigate(`/admission-notes/${visit.visit_id}`)}
                      title="Admission Notes"
                    >
                      <FileText className="h-4 w-4 text-green-600" />
                    </Button>
                  </TableCell>
                  <TableCell>
                    {visit.patients?.corporate || '—'}
                  </TableCell>
                  {!hideColumns && (
                    <TableCell>
                      <BillingExecutiveInput visit={visit} isAdmin={isAdmin} />
                    </TableCell>
                  )}
                  {!hideColumns && (
                    <TableCell>
                      <BillingStatusDropdown visit={visit} />
                    </TableCell>
                  )}
                  {!hideColumns && (
                    <TableCell>
                      {isAdmin ? <FileStatusToggle visit={visit} /> : (
                        <Badge variant="outline" className="capitalize">{visit.file_status || '—'}</Badge>
                      )}
                    </TableCell>
                  )}
                  {!hideColumns && (
                    <TableCell className="text-center">
                      <PhotosCountButton visit={visit} />
                    </TableCell>
                  )}
                  {!hideColumns && (
                    <TableCell className="text-center">
                      <SignCountButton visit={visit} />
                    </TableCell>
                  )}
                  {!hideColumns && (
                    <TableCell className="text-center">
                      <HospitalStampCountButton visit={visit} />
                    </TableCell>
                  )}
                  {!hideColumns && (
                    <TableCell className="text-center">
                      <DrSurgeonStampCountButton visit={visit} />
                    </TableCell>
                  )}
                  {!hideColumns && (
                    <TableCell>
                      {isAdmin ? <CondonationDelayToggle visit={visit} /> : (
                        <Badge variant="outline" className="capitalize">{visit.condonation_delay_claim || '—'}</Badge>
                      )}
                    </TableCell>
                  )}
                  {!hideColumns && (
                    <TableCell>
                      {isAdmin ? <CondonationDelayIntimationToggle visit={visit} /> : (
                        <Badge variant="outline" className="capitalize">{visit.condonation_delay_intimation || '—'}</Badge>
                      )}
                    </TableCell>
                  )}
                  {!hideColumns && (
                    <TableCell>
                      {isAdmin ? <ExtensionOfStayToggle visit={visit} /> : (
                        <Badge variant="outline" className="capitalize">{visit.extension_of_stay || '—'}</Badge>
                      )}
                    </TableCell>
                  )}
                  {!hideColumns && (
                    <TableCell>
                      <ExtensionDaysCell
                        visitUuid={visit.id}
                        currentCount={(visit as any).extension_days_count ?? 0}
                      />
                    </TableCell>
                  )}
                  {!hideColumns && (
                    <TableCell>
                      {isAdmin ? <AdditionalApprovalsToggle visit={visit} /> : (
                        <Badge variant="outline" className="capitalize">{visit.additional_approvals || '—'}</Badge>
                      )}
                    </TableCell>
                  )}
                  {!hideColumns && (
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {visit.visit_type}
                      </Badge>
                    </TableCell>
                  )}
                  <TableCell>
                    {visit.admission_date ? format(new Date(visit.admission_date), 'MMM dd, yyyy HH:mm') : '—'}
                  </TableCell>
                  <TableCell>
                    {visit.admission_date ? `${Math.ceil((((visit.discharge_date ? new Date(visit.discharge_date).getTime() : Date.now()) - new Date(visit.admission_date).getTime())) / (1000 * 60 * 60 * 24))} days` : '—'}
                  </TableCell>
                  {canSeeReferralColumn && (
                    <TableCell className="text-xs">
                      <div>{visit.referees?.name || '-'}</div>
                      {visit.relationship_managers?.code && (
                        <div>{visit.relationship_managers.code}</div>
                      )}
                    </TableCell>
                  )}
                  {/* Only show referral-related cells for marketing managers */}
                  {isMarketingManager && (
                    <TableCell>
                      <IpdRefereeAmountCell
                        visit={visit}
                        onUpdate={refetch}
                        billTotal={billTotals[visit.visit_id] || 0}
                        totalPaid={doaPaidTotals[visit.id] || 0}
                        advanceTotal={advancePaymentData.activeTotals[visit.visit_id] || 0}
                      />
                    </TableCell>
                  )}
                  {isMarketingManager && (
                    <TableCell className="text-sm">
                      {doaPayments[visit.id]?.length > 0
                        ? doaPayments[visit.id][0]?.referral_payment_status || '-'
                        : '-'}
                    </TableCell>
                  )}
                  <TableCell>
                    {visit.discharge_date ? (
                      (() => {
                        try {
                          console.log('🗓️ Discharge date for', visit.patients?.name, ':', visit.discharge_date, 'Type:', typeof visit.discharge_date);
                          return format(new Date(visit.discharge_date), 'MMM dd, yyyy');
                        } catch (error) {
                          console.error('❌ Date format error for', visit.patients?.name, ':', error, 'Value:', visit.discharge_date);
                          return String(visit.discharge_date); // Show raw value if format fails
                        }
                      })()
                    ) : '—'}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => printSticker({
                        patientName: visit.patients?.name || 'N/A',
                        uhid: visit.esic_uh_id || visit.patients?.patients_id || 'N/A',
                        visitId: visit.visit_id || 'N/A',
                        age: visit.patients?.age || 'N/A',
                        gender: visit.patients?.gender || 'N/A',
                        consultant: visit.appointment_with || 'N/A',
                        department: visit.visit_type || 'General',
                        tariff: visit.patients?.corporate || 'Private'
                      })}
                    >
                      Print Sticker
                    </Button>
                  </TableCell>
                  <TableCell>
                    <EsicUhidInput visit={visit} />
                  </TableCell>
                  <TableCell className="text-center">
                    {visit.discharge_intimation_at ? (
                      <div className="flex flex-col items-center gap-1">
                        <Checkbox checked={true} disabled className="data-[state=checked]:bg-green-600" />
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(visit.discharge_intimation_at), 'MMM dd, HH:mm')}
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
                              .eq('visit_id', visit.visit_id);
                            if (error) {
                              console.error('Error updating discharge intimation:', error);
                              return;
                            }
                            refetch();
                          } catch (error) {
                            console.error('Error:', error);
                          }
                        }}
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    <Select onValueChange={(value) => {
                      if (value === 'discharge-summary') {
                        navigate(`/ipd-discharge-summary/${visit.visit_id}`);
                      } else if (value === 'death-certificate') {
                        navigate(`/death-certificate/${visit.visit_id}`);
                      }
                    }}>
                      <SelectTrigger className="w-[140px] h-8">
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="discharge-summary">Discharge Summary</SelectItem>
                        <SelectItem value="death-summary" disabled>Death Summary</SelectItem>
                        <SelectItem value="death-certificate">Death Certificate</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSelectedVisitForNotification(visit);
                        setIsNotificationModalOpen(true);
                      }}
                      className="text-purple-600 hover:text-purple-700 hover:bg-purple-50"
                    >
                      <Bell className="h-4 w-4 mr-1" />
                      Add Notification
                    </Button>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 hover:bg-violet-50"
                      onClick={() => {
                        setSelectedVisitForMri(visit);
                        setMriModalOpen(true);
                      }}
                      title="Add Scan / Radiology Order"
                    >
                      <Brain className="h-4 w-4 text-violet-600" />
                    </Button>
                  </TableCell>
                  {canSeeActionsColumn && (
                   <TableCell>
                     <div className="flex items-center gap-2">
                       <Button
                         variant="ghost"
                         size="sm"
                         className="h-8 w-8 p-0 hover:bg-blue-50"
                         onClick={() => {
                           setSelectedPatientForView(visit);
                           setViewDialogOpen(true);
                         }}
                         title="View Patient Details"
                       >
                         <Eye className="h-4 w-4 text-blue-600" />
                       </Button>
                       <Button
                         variant="ghost"
                         size="sm"
                         className="h-10 w-10 p-0 relative bg-blue-50 hover:bg-blue-100 border-2 border-blue-500 rounded-full animate-pulse hover:scale-110 transition-all duration-200 shadow-lg shadow-blue-500/50"
                         onClick={() => handleEditPatientClick(visit)}
                         title="Edit Patient Details"
                       >
                         <div className="absolute inset-0 rounded-full bg-blue-500/20 animate-ping"></div>
                         <div className="absolute inset-0 rounded-full bg-blue-500/10 animate-ping animation-delay-75"></div>
                         <FileText className="h-5 w-5 text-blue-600 relative z-10 animate-bounce" />
                       </Button>
                       <Button
                         variant="ghost"
                         size="sm"
                         className="h-8 w-8 p-0 hover:bg-green-50"
                         onClick={() => handleCommentClick(visit)}
                         title="View/Add Comments"
                       >
                         <MessageSquare className="h-4 w-4 text-green-600" />
                       </Button>
                       <Button
                         variant="ghost"
                         size="sm"
                         className="h-8 w-8 p-0 hover:bg-purple-50"
                         onClick={() => {
                           setSelectedVisitForDocument(visit);
                           setShowDocumentUploadDialog(true);
                         }}
                         title="Upload Documents"
                       >
                         <Upload className="h-4 w-4 text-purple-600" />
                       </Button>
                       <Button
                         variant="ghost"
                         size="sm"
                         className="h-8 w-8 p-0 hover:bg-orange-50"
                         onClick={() => setLabReportVisit({ visitId: visit.id, patientName: visit.patients?.name || '' })}
                         title="View Lab Reports"
                       >
                         <FlaskConical className="h-4 w-4 text-orange-600" />
                       </Button>
                       {/* Show Revoke Discharge button only for discharged patients */}
                       {visit.discharge_date && (
                         <AlertDialog>
                           <AlertDialogTrigger asChild>
                             <Button
                               variant="ghost"
                               size="sm"
                               className="h-8 w-8 p-0 hover:bg-orange-50"
                               title="Revoke Discharge - Move back to Currently Admitted"
                             >
                               <RotateCcw className="h-4 w-4 text-orange-600" />
                             </Button>
                           </AlertDialogTrigger>
                           <AlertDialogContent>
                             <AlertDialogHeader>
                               <AlertDialogTitle>Revoke Discharge</AlertDialogTitle>
                               <AlertDialogDescription>
                                 Are you sure you want to revoke the discharge for <strong>{visit.patients?.name}</strong>?
                                 This will remove the discharge date/time and move the patient back to "Currently Admitted Patients" list.
                                 This action is typically used for correcting accidental or wrong discharge entries.
                               </AlertDialogDescription>
                             </AlertDialogHeader>
                             <AlertDialogFooter>
                               <AlertDialogCancel>Cancel</AlertDialogCancel>
                               <AlertDialogAction
                                 onClick={() => handleRevokeDischarge(visit.visit_id, visit.patients?.name)}
                                 className="bg-orange-600 hover:bg-orange-700"
                               >
                                 Revoke Discharge
                               </AlertDialogAction>
                             </AlertDialogFooter>
                           </AlertDialogContent>
                         </AlertDialog>
                       )}
                       {(isAdmin || isMarketingManager) && (
                         <Button
                           variant="ghost"
                           size="sm"
                           className="h-8 w-8 p-0 hover:bg-orange-50"
                           onClick={() => handleDeleteVisit(visit.visit_id)}
                           title="Mark Visit Inactive"
                         >
                           <Trash2 className="h-4 w-4 text-orange-600" />
                         </Button>
                       )}
                     </div>
                   </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Pagination Controls */}
        {filteredVisits.length > 0 && (
          <div className="flex items-center justify-between px-4 py-3 bg-white border-t">
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-700">
                Showing {startItem} to {endItem} of {filteredVisits.length} results
              </span>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-700">Items per page:</span>
                <select
                  value={itemsPerPage}
                  onChange={(e) => {
                    setItemsPerPage(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="h-8 w-20 text-sm border border-gray-300 rounded-md px-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(currentPage - 1)}
                disabled={currentPage === 1}
                className="flex items-center gap-1"
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </Button>
              <div className="flex items-center gap-1">
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNumber;
                  if (totalPages <= 5) {
                    pageNumber = i + 1;
                  } else if (currentPage <= 3) {
                    pageNumber = i + 1;
                  } else if (currentPage >= totalPages - 2) {
                    pageNumber = totalPages - 4 + i;
                  } else {
                    pageNumber = currentPage - 2 + i;
                  }
                  return (
                    <Button
                      key={pageNumber}
                      variant={pageNumber === currentPage ? "default" : "outline"}
                      size="sm"
                      onClick={() => setCurrentPage(pageNumber)}
                      className="w-8 h-8 p-0"
                    >
                      {pageNumber}
                    </Button>
                  );
                })}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="flex items-center gap-1"
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {filteredVisits.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No visits scheduled for today.</p>
            <p className="text-sm">Registered visits will appear here.</p>
          </div>
        )}

        {/* Edit Patient Dialog */}
        {selectedPatientForEdit && (
          <EditPatientDialog
            isOpen={showEditPatientDialog}
            onClose={() => {
              setShowEditPatientDialog(false);
              setSelectedPatientForEdit(null);
            }}
            patient={selectedPatientForEdit}
            onSave={handleSavePatient}
          />
        )}

        {/* Visit Edit Dialog */}
        {selectedVisitForEdit && (
          <VisitRegistrationForm
            isOpen={showVisitEditDialog}
            onClose={() => {
              setShowVisitEditDialog(false);
              setSelectedVisitForEdit(null);
            }}
            patient={selectedVisitForEdit.patient}
            existingVisit={selectedVisitForEdit.visit}
            editMode={true}
          />
        )}

        {/* Document Upload Dialog */}
        {selectedVisitForDocument && (
          <DocumentUploadDialog
            isOpen={showDocumentUploadDialog}
            onClose={() => {
              const visitId = selectedVisitForDocument?.visit_id;
              const patientName = selectedVisitForDocument?.patients?.name;
              setShowDocumentUploadDialog(false);
              setSelectedVisitForDocument(null);
              // Refresh referral status after closing
              if (visitId) {
                checkReferralLetterUploaded(visitId, patientName).then(isUploaded => {
                  setReferralLetterStatus(prev => ({
                    ...prev,
                    [visitId]: isUploaded
                  }));
                });
              }
            }}
            patientName={selectedVisitForDocument.patients?.name || 'Unknown'}
            visitId={selectedVisitForDocument.visit_id}
          />
        )}

        {/* Radiology Order Modal */}
        {selectedVisitForMri && (
          <MriOrderModal
            isOpen={mriModalOpen}
            onClose={() => {
              setMriModalOpen(false);
              setSelectedVisitForMri(null);
            }}
            visit={selectedVisitForMri}
          />
        )}

        {/* Comment Dialogs */}
        {paginatedVisits.map((visit) => (
          <Dialog
            key={`comment-dialog-${visit.id}`}
            open={commentDialogs[visit.id] || false}
            onOpenChange={(open) => {
              setCommentDialogs(prev => ({
                ...prev,
                [visit.id]: open
              }));
            }}
          >
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Comments for {visit.patients?.name || 'Patient'}</DialogTitle>
                <DialogDescription className="text-xs">
                  Visit ID: {visit.visit_id} | Auto-saves as you type
                </DialogDescription>
              </DialogHeader>

              <div className="relative">
                <textarea
                  className="w-full min-h-[150px] p-3 border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 resize-vertical"
                  placeholder="Add your comments here..."
                  value={commentTexts[visit.id] || ''}
                  onChange={(e) => handleCommentChange(visit.id, e.target.value)}
                />

                {/* Save indicators */}
                {savingComments[visit.id] && (
                  <div className="absolute bottom-2 right-2 text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded border border-blue-200">
                    Saving...
                  </div>
                )}
                {savedComments[visit.id] && !savingComments[visit.id] && (
                  <div className="absolute bottom-2 right-2 text-xs text-green-600 bg-green-50 px-2 py-1 rounded border border-green-200">
                    ✓ Saved
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>
        ))}

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
                      <span className="font-medium text-gray-600">Patient Type:</span> <span className="px-2 py-1 bg-purple-100 text-purple-700 rounded-full text-xs">{selectedPatientForView.patient_type || 'IPD'}</span>
                    </div>
                    <div className="col-span-2">
                      <span className="font-medium text-gray-600">Doctor/Appointment With:</span> {selectedPatientForView.appointment_with || 'Not specified'}
                    </div>
                    <div className="col-span-2">
                      <span className="font-medium text-gray-600">Reason for Visit:</span> {selectedPatientForView.reason_for_visit || 'N/A'}
                    </div>
                  </div>
                </div>

                {/* Contact Information */}
                <div className="bg-yellow-50 p-4 rounded-lg">
                  <h3 className="font-semibold text-yellow-700 mb-2">Contact Information</h3>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="font-medium text-gray-600">Phone:</span> {selectedPatientForView.patients?.phone || 'N/A'}
                    </div>
                    <div>
                      <span className="font-medium text-gray-600">Emergency Contact:</span> {selectedPatientForView.patients?.emergency_contact_name || 'N/A'}
                    </div>
                    <div className="col-span-2">
                      <span className="font-medium text-gray-600">Emergency Mobile:</span> {selectedPatientForView.patients?.emergency_contact_mobile || 'N/A'}
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
                      <span className="font-medium text-gray-600">Diagnosis:</span> {selectedPatientForView.diagnoses?.name || 'General'}
                    </div>
                    <div>
                      <span className="font-medium text-gray-600">Relation with Employee:</span> {selectedPatientForView.relation_with_employee || 'N/A'}
                    </div>
                    <div>
                      <span className="font-medium text-gray-600">Claim ID:</span> {selectedPatientForView.claim_id || 'N/A'}
                    </div>
                    <div>
                      <span className="font-medium text-gray-600">Treatment Type:</span> {selectedPatientForView.treatment_type || 'N/A'}
                    </div>
                    <div>
                      <span className="font-medium text-gray-600">Registration ID:</span> {selectedPatientForView.yojana_registration_id || 'N/A'}
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

        {/* Getpass Notification Modal */}
        <Dialog open={isNotificationModalOpen} onOpenChange={(open) => {
          setIsNotificationModalOpen(open);
          if (!open) {
            // Reset form when closing
            setNotificationReason('');
            setNotificationCustomReason('');
            setNotificationPendingAmount('');
          }
        }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Getpass Notification</DialogTitle>
            </DialogHeader>
            <div className="py-4 space-y-4">
              <p className="text-gray-500">Patient: {selectedVisitForNotification?.patients?.name}</p>
              <p className="text-gray-500">Visit ID: {selectedVisitForNotification?.visit_id}</p>

              {/* Reason Dropdown */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Reason</label>
                <Select value={notificationReason} onValueChange={setNotificationReason}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select reason" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="overstay">Overstay</SelectItem>
                    <SelectItem value="higher_room">Higher room than entitlement</SelectItem>
                    <SelectItem value="disposable_cost">Cost of disposable</SelectItem>
                    <SelectItem value="implant_cost">Cost of implant other than empanel</SelectItem>
                    <SelectItem value="food_relative">Food for relative</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Custom Reason Input (shows when "Other" selected) */}
              {notificationReason === 'other' && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Specify Reason</label>
                  <Input
                    placeholder="Enter your reason"
                    value={notificationCustomReason}
                    onChange={(e) => setNotificationCustomReason(e.target.value)}
                  />
                </div>
              )}

              {/* Pending Amount */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Pending Amount</label>
                <Input
                  type="number"
                  placeholder="Enter pending amount"
                  value={notificationPendingAmount}
                  onChange={(e) => setNotificationPendingAmount(e.target.value)}
                />
              </div>

              {/* Action Buttons */}
              <div className="flex justify-end gap-2 pt-4 border-t">
                <Button variant="outline" onClick={() => setIsNotificationModalOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleSaveNotification}
                  disabled={saveNotificationMutation.isPending}
                >
                  {saveNotificationMutation.isPending ? 'Saving...' : 'Save Notification'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Print Column Picker Modal */}
        <ColumnPickerModal
          isOpen={isPrintPickerOpen}
          columns={IPD_PRINT_COLUMNS}
          selectedIds={printSelectedIds}
          presets={IPD_PRINT_PRESETS}
          settings={printSettings}
          onSelectedIdsChange={setPrintSelectedIds}
          onSettingsChange={setPrintSettings}
          onClose={() => setIsPrintPickerOpen(false)}
          onConfirm={handlePrintConfirm}
          onPreview={handlePrintPreview}
        />

        {/* Print Preview */}
        {showPrintPreview && (() => {
          const finalSettings = { ...printSettings, selectedColumnIds: printSelectedIds };

          return (
            <PrintPreview
              reportTitle="IPD Dashboard"
              columns={IPD_PRINT_COLUMNS}
              data={filteredVisits}
              settings={finalSettings}
              appliedFilters={getCurrentFilters()}
              onClose={() => setShowPrintPreview(false)}
            />
          );
        })()}
      </div>

      {/* Print Styles */}
      <style>{`
        @media print {
          /* Page settings */
          @page {
            margin: 0.5in;
            size: A4 landscape;
          }

          /* Reset body and html */
          body, html {
            margin: 0 !important;
            padding: 0 !important;
            background: white !important;
          }

          /* Hide UI elements and dashboard content */
          [data-sidebar],
          aside,
          nav,
          button:not(.print-preview-overlay button),
          select,
          input,
          .no-print,
          header,
          footer,
          [role="dialog"]:not(.print-preview-overlay [role="dialog"]),
          [data-radix-portal],
          [data-radix-dialog-overlay],
          [data-radix-dialog-content],
          .flex.flex-col.md\\:flex-row.justify-between.items-start.md\\:items-center.mb-6,
          .grid.grid-cols-1.md\\:grid-cols-4.gap-4,
          .bg-card.rounded-lg.border.no-print {
            display: none !important;
            visibility: hidden !important;
          }

          /* Hide the page title/header inside the table card */
          .bg-card.rounded-lg.border .p-4.border-b {
            display: none !important;
          }

          /* Hide the filter row (second header row) */
          thead tr:nth-child(2) {
            display: none !important;
          }

          /* Hide actions column */
          th:last-child,
          td:last-child {
            display: none !important;
          }

          /* Main container adjustments */
          .min-h-screen.flex.w-full {
            display: block !important;
          }

          main {
            width: 100% !important;
            padding: 0 !important;
            margin: 0 !important;
          }

          .max-w-7xl.mx-auto.space-y-6 {
            max-width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
          }

          /* CRITICAL: Ensure PrintPreview and its content are visible */
          .print-preview-overlay {
            display: block !important;
            visibility: visible !important;
            position: static !important;
            z-index: 99999 !important;
          }

          .print-preview-overlay,
          .print-preview-overlay *,
          [data-print-content="true"],
          [data-print-content="true"] * {
            visibility: visible !important;
          }

          /* Remove any interactive elements styling */
          a {
            color: black !important;
            text-decoration: none !important;
          }

          /* Ensure proper text sizing */
          .text-sm, .text-xs {
            font-size: 14px !important;
          }

          .font-mono {
            font-family: monospace !important;
          }
        }

        /* Hide print info by default */
        .print-info {
          display: none;
        }
      `}</style>

      {/* Referral Report Preview Modal */}
      <Dialog open={isReferralReportOpen} onOpenChange={setIsReferralReportOpen}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>IPD Referral Report Preview</DialogTitle>
          </DialogHeader>

          <div id="ipd-referral-report-content">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date of Admission</TableHead>
                  <TableHead>Visit ID</TableHead>
                  <TableHead>Patient Name</TableHead>
                  <TableHead>Referral Doctor/Relationship Manager</TableHead>
                  <TableHead>Referee DOA Amt Paid</TableHead>
                  <TableHead>Total Amount Paid</TableHead>
                  <TableHead>Payment Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {referralReportVisits.map((visit) => (
                  <TableRow key={visit.id}>
                    <TableCell>{visit.visit_date || '-'}</TableCell>
                    <TableCell>{visit.visit_id || '-'}</TableCell>
                    <TableCell>{formatDialysisPatientName(visit.patients?.name, visit) || '-'}</TableCell>
                    <TableCell>
                      <div>{visit.referees?.name || '-'}</div>
                      {visit.relationship_managers?.code && (
                        <div>{visit.relationship_managers.code}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      {doaPayments[visit.id]?.length > 0 ? (
                        <div className="space-y-1">
                          {doaPayments[visit.id].map((payment, idx) => (
                            <div key={idx} className="text-sm">
                              ₹{payment.amount.toLocaleString()} ({format(new Date(payment.payment_date), 'dd MMM')})
                            </div>
                          ))}
                        </div>
                      ) : '-'}
                    </TableCell>
                    <TableCell>
                      {doaPayments[visit.id]?.length > 0
                        ? `₹${doaPayments[visit.id].reduce((sum, p) => sum + p.amount, 0).toLocaleString()}`
                        : '-'}
                    </TableCell>
                    <TableCell>{doaPayments[visit.id]?.[0]?.referral_payment_status || '-'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex justify-between items-center pt-4 border-t">
            <span className="text-sm text-muted-foreground">
              Total: {referralReportVisits.length} records
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

      {/* Unpaid Referral Report Preview Modal */}
      <Dialog open={isUnpaidReportOpen} onOpenChange={setIsUnpaidReportOpen}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-red-600">IPD Unpaid Referral Report</DialogTitle>
          </DialogHeader>

          <div id="ipd-unpaid-referral-report-content">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date of Admission</TableHead>
                  <TableHead>Visit ID</TableHead>
                  <TableHead>Patient Name</TableHead>
                  <TableHead>Referral Doctor/Relationship Manager</TableHead>
                  <TableHead>Referee DOA Amt Paid</TableHead>
                  <TableHead>Total Amount Paid</TableHead>
                  <TableHead>Payment Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {unpaidReferralVisits.map((visit) => (
                  <TableRow key={visit.id}>
                    <TableCell>{visit.visit_date || '-'}</TableCell>
                    <TableCell>{visit.visit_id || '-'}</TableCell>
                    <TableCell>{formatDialysisPatientName(visit.patients?.name, visit) || '-'}</TableCell>
                    <TableCell>
                      <div>{visit.referees?.name || '-'}</div>
                      {visit.relationship_managers?.code && (
                        <div>{visit.relationship_managers.code}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      {doaPayments[visit.id]?.length > 0 ? (
                        <div className="space-y-1">
                          {doaPayments[visit.id].map((payment, idx) => (
                            <div key={idx} className="text-sm">
                              ₹{payment.amount.toLocaleString()} ({format(new Date(payment.payment_date), 'dd MMM')})
                            </div>
                          ))}
                          {doaPayments[visit.id].length > 1 && (
                            <div className="font-semibold border-t pt-1 mt-1">
                              Total: ₹{doaPayments[visit.id].reduce((sum, p) => sum + p.amount, 0).toLocaleString()}
                            </div>
                          )}
                        </div>
                      ) : '-'}
                    </TableCell>
                    <TableCell>
                      {doaPayments[visit.id]?.length > 0
                        ? `₹${doaPayments[visit.id].reduce((sum, p) => sum + p.amount, 0).toLocaleString()}`
                        : '-'}
                    </TableCell>
                    <TableCell className="text-red-600 font-medium">{doaPayments[visit.id]?.[0]?.referral_payment_status || '-'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex justify-between items-center pt-4 border-t">
            <span className="text-sm text-muted-foreground">
              Total Unpaid: {unpaidReferralVisits.length} records
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

      {/* Lab Reports Dialog */}
      <Dialog open={!!labReportVisit} onOpenChange={() => setLabReportVisit(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FlaskConical className="h-5 w-5 text-orange-600" />
              Lab Reports — {labReportVisit?.patientName}
            </DialogTitle>
            <DialogDescription>
              All lab tests ordered for visit {labReportVisit?.visitId}
            </DialogDescription>
          </DialogHeader>
          {labReportVisit && <LabReportsPanel visitId={labReportVisit.visitId} />}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TodaysIpdDashboard;
