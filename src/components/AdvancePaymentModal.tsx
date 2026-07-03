import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { pushPaymentToTally } from '@/lib/tally-auto-push';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EnhancedDatePicker } from '@/components/ui/enhanced-date-picker';
import { supabase } from '@/integrations/supabase/client';
import { supabaseData } from '@/integrations/supabase/data-client';
import { isUuid } from '@/utils/visitId';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Printer } from 'lucide-react';

interface AdvancePaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  visitId?: string;
  patientId?: string;
  patientData?: {
    name?: string;
    billNo?: string;
    registrationNo?: string;
    dateOfAdmission?: string;
  };
  onPaymentAdded?: () => void;
}

interface PaymentTransaction {
  id: string;
  payment_date: string;
  advance_amount: number;
  payment_mode: string;
  remarks: string;
  reference_number: string;
  status: string;
  is_refund: boolean;
  refund_reason: string;
  billing_executive?: string;
}

interface PatientInfo {
  name: string;
  billNo: string;
  registrationNo: string;
  dateOfAdmission: string;
  patientType: string;
}

const paymentModes = [
  { value: 'CASH', label: 'Cash' },
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'CARD', label: 'Card' },
  { value: 'UPI', label: 'UPI' },
  { value: 'NEFT', label: 'NEFT' },
  { value: 'RTGS', label: 'RTGS' },
  { value: 'DD', label: 'Demand Draft' },
  { value: 'ONLINE', label: 'Online Transfer' },
  { value: 'CREDIT', label: 'Credit' },
];

// Curated billing-executive names that should always be available in the
// dropdown, regardless of what the User table currently holds. These are also
// seeded into the Supabase User table by migration
// 20260613000000_seed_billing_executives.sql. New billing executives added to
// the User table show up automatically (merged below).
const BASE_BILLING_EXECUTIVES = [
  'Chetna',
  'Arpit',
  'Akshay',
  'Shohib',
  'Nisha',
  'Diksha',
  'Pragati',
  'Abhishekh',
  'Sailesh',
  'Abuzar'
];

// Former executives removed from the dropdown. Their (possibly seeded) User
// rows would otherwise re-add them via the DB merge below.
const REMOVED_BILLING_EXECUTIVES = new Set(['jagruti', 'priyanka tandekar']);

// Filter out non-staff / system accounts and raw login usernames so they never
// appear in the Billing Executive dropdown (e.g. admin, test, superadmin,
// nurse, dotted usernames like "shashank.bill", or numeric ones like
// "abuzarqureshi1983").
const SYSTEM_ACCOUNT_NAMES = new Set([
  'superadmin', 'admin', 'test', 'user', 'nurse', 'lab', 'doctor', 'doctor1',
  'cmd', 'marketingmanager', 'emergencysevafirebase', 'ottech', 'reception',
  'reception1', 'staff', 'demo'
]);
const isJunkExecutiveName = (name: string): boolean => {
  const n = name.trim();
  if (!n) return true;
  if (/[0-9._]/.test(n)) return true; // raw username (digits, dots, underscores)
  return SYSTEM_ACCOUNT_NAMES.has(n.toLowerCase());
};

// UUID validation helper function
const isValidUUID = isUuid;

// Date parsing helper function
const parseDisplayDate = (displayDate: string): string | null => {
  if (!displayDate || displayDate === 'N/A') return null;
  
  try {
    // Handle DD/MM/YYYY format
    const parts = displayDate.split('/');
    if (parts.length === 3) {
      const [day, month, year] = parts;
      const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      if (!isNaN(date.getTime())) {
        return date.toISOString().split('T')[0]; // Return YYYY-MM-DD format
      }
    }
    return null;
  } catch (error) {
    console.error('Error parsing date:', error);
    return null;
  }
};

export const AdvancePaymentModal: React.FC<AdvancePaymentModalProps> = ({
  isOpen,
  onClose,
  visitId,
  patientId,
  patientData,
  onPaymentAdded
}) => {
  const { hospitalType } = useAuth();

  const [formData, setFormData] = useState({
    advanceAmount: '',
    isRefund: false,
    refundReason: '',
    paymentDate: new Date(),
    paymentMode: 'CASH',
    billingExecutive: '',
    remarks: '',
    referenceNumber: '',
    selectedBank: '',
    packageName: '',
    packageDays: ''
  });

  const [paymentHistory, setPaymentHistory] = useState<PaymentTransaction[]>([]);
  const [returnedAmount, setReturnedAmount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [patientInfo, setPatientInfo] = useState<PatientInfo>({
    name: '',
    billNo: '',
    registrationNo: '',
    dateOfAdmission: '',
    patientType: 'IPD'
  });
  const [bankAccounts, setBankAccounts] = useState<Array<{ id: string; account_name: string }>>([]);
  const [packages, setPackages] = useState<Array<{ id: string; name: string }>>([]);
  const [billingExecutives, setBillingExecutives] = useState<string[]>([]);

  // Load billing executives when the modal opens: the curated base list is
  // always present, merged with real staff from the Supabase User table (junk /
  // system accounts filtered out). New billing executives added to the DB show
  // up here automatically.
  useEffect(() => {
    if (!isOpen) return;
    (async () => {
      const { data, error } = await supabaseData
        .from('User')
        .select('full_name, email, is_active, hospital_type')
        .eq('hospital_type', hospitalType || 'hope')
        .neq('is_active', false)
        .order('full_name');
      if (error) {
        console.error('Failed to load billing executives', error);
      }
      const dbNames = (data || [])
        .map((u: any) => (u.full_name?.trim() || u.email?.split('@')[0] || '').trim())
        .filter((n: string) => n && !isJunkExecutiveName(n) && !REMOVED_BILLING_EXECUTIVES.has(n.toLowerCase()));

      // Merge base + DB names, de-duplicated case-insensitively (first spelling wins).
      const seen = new Set<string>();
      const merged: string[] = [];
      for (const name of [...BASE_BILLING_EXECUTIVES, ...dbNames]) {
        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(name);
      }
      setBillingExecutives(merged.sort((a, b) => a.localeCompare(b)));
    })();
  }, [isOpen, hospitalType]);

  // Generate default narration when modal opens or payment mode changes
  useEffect(() => {
    if (!isOpen) return;

    // Generate default narration
    const paymentModeLabel = paymentModes.find(pm => pm.value === formData.paymentMode)?.label || formData.paymentMode;
    const patientName = patientInfo.name || patientData?.name || 'Patient';
    const registrationNo = patientInfo.registrationNo || patientData?.registrationNo || '';

    const defaultNarration = `Being cash received towards ${paymentModeLabel} from ${patientName} against R. No.: ${registrationNo}`;

    // Only set default narration if remarks field is empty
    if (!formData.remarks) {
      setFormData(prev => ({
        ...prev,
        remarks: defaultNarration
      }));
    }
  }, [isOpen, formData.paymentMode, patientInfo.name, patientInfo.registrationNo, patientData]);

  // Fetch bank accounts when modal opens
  useEffect(() => {
    if (!isOpen) return;

    const fetchBankAccounts = async () => {
      try {
        const { data, error } = await supabase
          .from('chart_of_accounts')
          .select('id, account_name, account_code')
          .in('account_code', ['1121', '1122', '1123'])
          .eq('is_active', true)
          .order('account_name');

        if (error) {
          console.error('❌ Error fetching bank accounts:', error);
          // Fallback to hardcoded banks if database query fails
          const fallbackBanks = [
            { id: '1', account_name: 'Canara Bank [A/C120023677813)JARIPATHKA ]', account_code: '1123' },
            { id: '2', account_name: 'SARASWAT BANK', account_code: '1122' },
            { id: '3', account_name: 'STATE BANK OF INDIA (DRM)', account_code: '1121' }
          ];
          setBankAccounts(fallbackBanks);
          return;
        }


        // If no banks found in database, use fallback
        if (!data || data.length === 0) {
          const fallbackBanks = [
            { id: '1', account_name: 'Canara Bank [A/C120023677813)JARIPATHKA ]', account_code: '1123' },
            { id: '2', account_name: 'SARASWAT BANK', account_code: '1122' },
            { id: '3', account_name: 'STATE BANK OF INDIA (DRM)', account_code: '1121' }
          ];
          setBankAccounts(fallbackBanks);
        } else {
          setBankAccounts(data);
        }
      } catch (error) {
        console.error('❌ Exception fetching bank accounts:', error);
        // Fallback to hardcoded banks on exception
        const fallbackBanks = [
          { id: '1', account_name: 'Canara Bank [A/C120023677813)JARIPATHKA ]', account_code: '1123' },
          { id: '2', account_name: 'SARASWAT BANK', account_code: '1122' },
          { id: '3', account_name: 'STATE BANK OF INDIA (DRM)', account_code: '1121' }
        ];
        setBankAccounts(fallbackBanks);
      }
    };

    fetchBankAccounts();
  }, [isOpen]);

  // Fetch packages from cghs_surgery when modal opens
  useEffect(() => {
    if (!isOpen) return;

    const fetchPackages = async () => {
      try {
        const { data, error } = await supabase
          .from('cghs_surgery')
          .select('id, name')
          .eq('is_active', true)
          .order('name');

        if (error) {
          console.error('❌ Error fetching packages:', error);
          return;
        }

        setPackages(data || []);
      } catch (error) {
        console.error('❌ Exception fetching packages:', error);
      }
    };

    fetchPackages();
  }, [isOpen]);

  // Set patient info and fetch payment history when modal opens
  useEffect(() => {
    if (!isOpen) return;

    try {
      if (patientData) {
        // Use provided patient data
        console.log('🔍 PatientData details:', {
          name: patientData.name,
          billNo: patientData.billNo,
          registrationNo: patientData.registrationNo,
          dateOfAdmission: patientData.dateOfAdmission
        });
        
        // Safely set patient info
        const safePatientInfo = {
          name: patientData.name || 'N/A',
          billNo: patientData.billNo || 'N/A',
          registrationNo: patientData.registrationNo || 'N/A',
          dateOfAdmission: patientData.dateOfAdmission || 'N/A',
          patientType: patientInfo.patientType || 'IPD'
        };
        
        console.log('🔧 Setting safe patient info:', safePatientInfo);
        setPatientInfo(safePatientInfo);
        
        // If registration number is missing, try to fetch it directly from patients table
        if ((!patientData.registrationNo || patientData.registrationNo === 'N/A') && patientId && isValidUUID(patientId)) {
          console.log('🔍 Registration number missing, fetching directly...');
          fetchRegistrationNumber(patientId);
        }
        
        // Fetch payment history for the current visit
        if (visitId) {
          fetchPaymentHistory(visitId);
        } else {
          setPaymentHistory([]);
          setReturnedAmount(0);
        }
      } else if (visitId) {
        // Fallback to fetching patient data
        console.log('🔍 No patient data provided, fetching from database');
        fetchPatientInfo();
      } else {
      }
    } catch (error) {
      console.error('❌ Error in useEffect:', error);
      // Set default values on error
      setPatientInfo({
        name: 'N/A',
        billNo: 'N/A',
        registrationNo: 'N/A',
        dateOfAdmission: 'N/A',
        patientType: 'IPD'
      });
    }
  }, [isOpen, visitId, patientData, patientId]);

  const fetchRegistrationNumber = async (patientId: string) => {
    try {
      if (!patientId || !isValidUUID(patientId)) {
        return;
      }

      console.log('🔍 Fetching registration number for patient:', patientId);
      
      const { data: patientData, error } = await supabase
        .from('patients')
        .select('patients_id')
        .eq('id', patientId)
        .single();

      console.log('📋 Registration number query result:', { patientData, error });

      if (error) {
        console.error('❌ Database error fetching registration number:', error);
        return;
      }

      if (patientData?.patients_id) {
        setPatientInfo(prev => ({
          ...prev,
          registrationNo: patientData.patients_id
        }));
      } else {
        console.log('📝 No registration number found in database');
      }
    } catch (error) {
      console.error('❌ Exception in fetchRegistrationNumber:', error);
    }
  };

  const fetchPaymentHistory = async (fetchedVisitId?: string) => {
    try {
      // Use passed visitId or the one from props
      const currentVisitId = fetchedVisitId || visitId;
      if (!currentVisitId) {
        setPaymentHistory([]);
        setReturnedAmount(0);
        return;
      }

      console.log('💳 Fetching payment history for visit:', currentVisitId);
      setIsLoading(true);

      const { data, error } = await supabase
        .from('advance_payment')
        .select('*')
        .eq('visit_id', currentVisitId)
        .order('payment_date', { ascending: false });

      console.log('💳 Payment history query result:', { 
        data: data ? data.slice(0, 3) : null, // Only show first 3 for logging
        error, 
        totalCount: data?.length || 0 
      });

      if (error) {
        console.error('❌ Database error fetching payment history:', error);
        
        // Handle specific database errors gracefully
        if (error.message?.includes('relation') && error.message?.includes('does not exist')) {
          console.log('📝 advance_payment table not found, this is expected if migration not applied yet');
          setPaymentHistory([]);
          setReturnedAmount(0);
          return; // Don't show error toast for this case
        }
        
        toast.error('Failed to fetch payment history');
        setPaymentHistory([]);
        setReturnedAmount(0);
        return;
      }

      const safeData = data || [];
      setPaymentHistory(safeData);
      
      // Calculate returned amount (sum of refunds) with error handling
      try {
        const totalRefunds = safeData
          .filter(payment => {
            try {
              return payment.is_refund === true;
            } catch (e) {
              return false;
            }
          })
          .reduce((sum, payment) => {
            try {
              const amount = parseFloat(payment.advance_amount?.toString() || '0');
              return sum + (isNaN(amount) ? 0 : amount);
            } catch (e) {
              return sum;
            }
          }, 0);
        
        console.log('💳 Total refunds calculated:', totalRefunds);
        setReturnedAmount(totalRefunds);
      } catch (refundError) {
        console.error('❌ Error calculating refunds:', refundError);
        setReturnedAmount(0);
      }
    } catch (error) {
      console.error('❌ Exception in fetchPaymentHistory:', error);
      toast.error('Failed to fetch payment history');
      setPaymentHistory([]);
      setReturnedAmount(0);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchPatientInfo = async () => {
    if (!visitId) {
      return;
    }

    console.log('🔍 Fetching patient info for visit:', visitId);

    try {
      // First, get visit data
      const { data: visitData, error: visitError } = await supabase
        .from('visits')
        .select(`
          id,
          visit_id,
          admission_date,
          visit_date,
          patient_id,
          patient_type
        `)
        .eq('visit_id', visitId)
        .single();

      console.log('📋 Visit data query result:', { visitData, visitError });

      if (visitError) {
        console.error('❌ Error fetching visit info:', visitError);
        toast.error('Failed to fetch visit information');
        return;
      }

      if (!visitData) {
        console.error('❌ No visit data found');
        return;
      }

      // Now fetch patient data using patient_id from visit
      const { data: patientData, error: patientError } = await supabase
        .from('patients')
        .select('id, name, patients_id')
        .eq('id', visitData.patient_id)
        .single();

      console.log('👤 Patient data query result:', { patientData, patientError });

      // Fetch bill information separately
      let billNo = 'N/A';
      const { data: billData, error: billError } = await supabase
        .from('bills')
        .select('bill_no')
        .eq('visit_id', visitData.id)
        .single();

      console.log('💰 Bill data query result:', { billData, billError });
      
      if (billData && !billError) {
        billNo = billData.bill_no || 'N/A';
      }

      // Set patient info with fetched data
      const patientInfo = {
        name: patientData?.name || 'N/A',
        billNo: billNo,
        registrationNo: patientData?.patients_id || 'N/A',
        dateOfAdmission: visitData.admission_date
          ? format(new Date(visitData.admission_date), 'dd/MM/yyyy')
          : visitData.visit_date
          ? format(new Date(visitData.visit_date), 'dd/MM/yyyy')
          : 'N/A',
        patientType: (visitData as any).patient_type || 'IPD'
      };

      setPatientInfo(patientInfo);

      // Also fetch payment history for this visit
      if (visitId) {
        await fetchPaymentHistory(visitId);
      }

    } catch (error) {
      console.error('❌ Error in fetchPatientInfo:', error);
      toast.error('Failed to fetch patient information');
    }
  };

  const handleSave = async () => {
    // Validate payment mode first
    if (!formData.paymentMode || formData.paymentMode.trim() === '') {
      toast.error('Please select a payment mode');
      return;
    }

    // Validation - allow empty amount for refund-only transactions
    if (!formData.isRefund) {
      // Advance payment - amount is required
      if (!formData.advanceAmount || parseFloat(formData.advanceAmount) <= 0) {
        toast.error('Please enter a valid advance amount');
        return;
      }
    } else {
      // Refund - amount is optional (can be refund-only or combined with advance)
      if (formData.advanceAmount && parseFloat(formData.advanceAmount) <= 0) {
        toast.error('Please enter a valid refund amount or leave empty');
        return;
      }

    }

    // Validate bank selection for all payment modes that require bank account (except CASH and CREDIT)
    const modesRequiringBank = ['ONLINE', 'UPI', 'NEFT', 'RTGS', 'CHEQUE', 'CARD', 'DD'];
    if (modesRequiringBank.includes(formData.paymentMode) && !formData.selectedBank) {
      toast.error(`Please select a bank account for ${formData.paymentMode} payment`);
      return;
    }

    if (!patientId || !isValidUUID(patientId)) {
      toast.error('Invalid patient ID');
      console.error('❌ Invalid patient ID:', patientId);
      return;
    }

    if (!visitId) {
      toast.error('Visit ID is required');
      return;
    }

    // Validate required patient info
    if (!patientInfo.name || patientInfo.name === 'N/A') {
      toast.error('Patient information not loaded. Please refresh and try again.');
      return;
    }

    setIsSaving(true);
    try {
      // Prepare advance payment data with proper validation
      const advancePaymentData = {
        patient_id: patientId, // Already validated as UUID
        visit_id: visitId || null,
        patient_name: patientInfo.name || 'Unknown',
        bill_no: patientInfo.billNo && patientInfo.billNo !== 'N/A' ? patientInfo.billNo : null,
        patients_id: patientInfo.registrationNo && patientInfo.registrationNo !== 'N/A' ? patientInfo.registrationNo : null,
        date_of_admission: parseDisplayDate(patientInfo.dateOfAdmission),
        advance_amount: formData.advanceAmount ? parseFloat(formData.advanceAmount) : 0,
        returned_amount: returnedAmount || 0.00,
        is_refund: formData.isRefund || false,
        refund_reason: formData.isRefund && formData.refundReason ? formData.refundReason.trim() : null,
        payment_date: formData.paymentDate.toISOString(),
        payment_mode: formData.paymentMode?.trim() || 'CASH',
        billing_executive: formData.billingExecutive && formData.billingExecutive.trim() ? formData.billingExecutive.trim() : null,
        reference_number: formData.referenceNumber && formData.referenceNumber.trim() ? formData.referenceNumber.trim() : null,
        remarks: formData.remarks && formData.remarks.trim() ? formData.remarks.trim() : null,
        bank_account_id: (formData.selectedBank && isValidUUID(formData.selectedBank)) ? formData.selectedBank : null,
        bank_account_name: bankAccounts.find(b => b.id === formData.selectedBank)?.account_name || null,
        created_by: null,
        package_name: formData.packageName?.trim() || null,
        package_days: formData.packageDays ? parseInt(formData.packageDays) : null,
      };

      console.log('💾 Saving advance payment:', advancePaymentData);

      const { data, error } = await supabase
        .from('advance_payment')
        .insert(advancePaymentData)
        .select()
        .single();

      if (error) {
        console.error('❌ Error saving advance payment:', error);
        
        // Check if it's a table doesn't exist error
        if (error.message?.includes('relation') && error.message?.includes('does not exist')) {
          toast.error('Database table not found. Please contact administrator to apply database migrations.');
        } else if (error.message?.includes('invalid input syntax for type uuid')) {
          toast.error('Invalid data format. Please try refreshing the page.');
        } else {
          toast.error(`Failed to save advance payment: ${error.message}`);
        }
        return;
      }


      // Fire-and-forget: push payment to Tally
      pushPaymentToTally({
        receiptNumber: data.id ? data.id.slice(-8).toUpperCase() : '',
        patientName: patientInfo.name || patientData?.name || 'Patient',
        date: format(formData.paymentDate, 'yyyy-MM-dd'),
        amount: parseFloat(formData.advanceAmount) || 0,
        paymentMode: formData.paymentMode || 'CASH',
      }).catch(console.error);

      toast.success('Advance payment saved successfully');

      // WhatsApp alert for receipts > Rs. 10,000
      const paymentAmount = parseFloat(formData.advanceAmount) || 0;
      if (paymentAmount >= 10000 && !formData.isRefund) {
        const { sendPaymentAlert } = await import('@/lib/payment-alert-service');
        sendPaymentAlert({
          alert_type: 'receipt',
          amount: paymentAmount,
          patient_name: patientInfo.name || patientData?.name || 'Patient',
          patient_id: patientInfo.patient_id || '',
          hospital_name: 'Hope',
          additional_info: `Advance Payment, Mode: ${formData.paymentMode}`,
        });
      }

      // Reset form
      setFormData({
        advanceAmount: '',
        isRefund: false,
        refundReason: '',
        paymentDate: new Date(),
        paymentMode: 'CASH',
        billingExecutive: '',
        remarks: '',
        referenceNumber: '',
        selectedBank: '',
        packageName: '',
        packageDays: ''
      });

      // Refresh payment history
      await fetchPaymentHistory();
      
      // Notify parent component
      onPaymentAdded?.();
      
    } catch (error) {
      console.error('❌ Exception saving advance payment:', error);
      toast.error('Failed to save advance payment');
    } finally {
      setIsSaving(false);
    }
  };

  const handlePrintReceipt = (payment: PaymentTransaction) => {
    // Generate receipt number (you can customize this logic)
    const receiptNumber = payment.id ? payment.id.slice(-6).toUpperCase() : Math.random().toString().slice(-6);

    // Determine hospital name based on login
    const hospitalName = hospitalType === 'ayushman'
      ? 'Ayushman Hospital Nagpur'
      : 'Hope Hospital Nagpur';

    // Convert amount to words
    const amountInWords = (amount: number): string => {
      const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
      const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
      const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
      
      const convertToWords = (num: number): string => {
        if (num === 0) return '';
        if (num < 10) return ones[num];
        if (num < 20) return teens[num - 10];
        if (num < 100) return tens[Math.floor(num / 10)] + (num % 10 !== 0 ? ' ' + ones[num % 10] : '');
        if (num < 1000) return ones[Math.floor(num / 100)] + ' Hundred' + (num % 100 !== 0 ? ' ' + convertToWords(num % 100) : '');
        if (num < 100000) return convertToWords(Math.floor(num / 1000)) + ' Thousand' + (num % 1000 !== 0 ? ' ' + convertToWords(num % 1000) : '');
        if (num < 10000000) return convertToWords(Math.floor(num / 100000)) + ' Lakh' + (num % 100000 !== 0 ? ' ' + convertToWords(num % 100000) : '');
        return convertToWords(Math.floor(num / 10000000)) + ' Crore' + (num % 10000000 !== 0 ? ' ' + convertToWords(num % 10000000) : '');
      };
      
      if (amount === 0) return 'Zero Rupees Only';
      return 'Rupee ' + convertToWords(amount) + ' Only';
    };

    const printContent = `
      <html>
        <head>
          <title>${patientInfo.patientType === 'OPD' ? 'OPD' : 'IPD'} Advance Payment Receipt</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              margin: 0;
              padding: 20px;
              font-size: 12px;
              line-height: 1.4;
            }
            .receipt-container {
              max-width: 700px;
              margin: 0 auto;
              border: 1px solid #000;
              padding: 0;
            }
            .header {
              text-align: right;
              padding: 10px 20px;
              border-bottom: 1px solid #000;
            }
            .print-btn {
              background: #007bff;
              color: white;
              border: none;
              padding: 5px 15px;
              cursor: pointer;
              font-size: 12px;
            }
            .receipt-content {
              padding: 20px;
            }
            .receipt-title {
              font-size: 16px;
              font-weight: bold;
              margin-bottom: 20px;
            }
            .receipt-info {
              margin-bottom: 30px;
            }
            .info-row {
              display: flex;
              margin-bottom: 8px;
            }
            .info-label {
              width: 150px;
              font-weight: normal;
            }
            .info-colon {
              width: 20px;
            }
            .info-value {
              flex: 1;
              font-weight: bold;
            }
            .amount-section {
              margin: 40px 0;
              border-top: 1px solid #000;
              border-bottom: 1px solid #000;
              padding: 15px 0;
            }
            .username-section {
              margin: 30px 0;
            }
            .signature-section {
              display: flex;
              justify-content: space-between;
              margin-top: 80px;
              padding-top: 20px;
              border-top: 1px solid #000;
            }
            .signature-box {
              text-align: center;
              width: 200px;
            }
            .hospital-header {
              text-align: center;
              padding: 15px 20px;
              border-bottom: 1px solid #000;
            }
            .hospital-name {
              font-size: 20px;
              font-weight: bold;
              margin: 0;
            }
            @page {
              size: A4 portrait;
              margin: 15mm;
            }
            @media print {
              .print-btn { display: none; }
              html, body {
                margin: 0 !important;
                padding: 0 !important;
                width: 100%;
                height: auto;
              }
              .receipt-container {
                max-width: 100%;
                width: 100%;
                border: 1px solid #000;
                box-sizing: border-box;
                margin: 0 auto;
                padding: 20px;
              }
              .header {
                padding: 10px 20px;
              }
              .receipt-content {
                padding: 20px;
              }
              .receipt-info {
                margin-bottom: 20px;
              }
              .info-row {
                margin-bottom: 8px;
              }
              .signature-section {
                margin-top: 60px;
                padding-top: 20px;
              }
              .amount-section {
                margin: 30px 0;
                padding: 15px 0;
              }
              .username-section {
                margin: 20px 0;
              }
            }
          </style>
        </head>
        <body>
          <div class="receipt-container">
            <div class="hospital-header">
              <h1 class="hospital-name">${hospitalName}</h1>
            </div>
            <div class="header">
              <button class="print-btn" onclick="window.print()">Print</button>
            </div>
            
            <div class="receipt-content">
              <div class="receipt-info">
                <div class="info-row">
                  <span class="info-label">Receipt No</span>
                  <span class="info-colon">:</span>
                  <span class="info-value">${receiptNumber}</span>
                </div>
              </div>

              <div class="receipt-info">
                <div class="info-row">
                  <span class="info-label">Received with thanks from</span>
                  <span class="info-colon">:</span>
                  <span class="info-value">${patientInfo.name || 'N/A'}(${patientInfo.registrationNo || 'N/A'})</span>
                </div>
                <div class="info-row">
                  <span class="info-label">The sum of</span>
                  <span class="info-colon">:</span>
                  <span class="info-value">${amountInWords(parseFloat(payment.advance_amount))}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">By</span>
                  <span class="info-colon">:</span>
                  <span class="info-value">${payment.payment_mode === 'CASH' ? 'Cash' : payment.payment_mode}${payment.reference_number ? ' - ' + payment.reference_number : ''}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Remarks</span>
                  <span class="info-colon">:</span>
                  <span class="info-value">${payment.remarks || `Being ${payment.is_refund ? 'refund' : 'advance payment'} received towards ${payment.is_refund ? 'refund' : (patientInfo.patientType === 'OPD' ? 'OPD ADV' : 'IPD ADV')} from ${patientInfo.name || 'patient'} against R. No.: ${receiptNumber}`}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Date</span>
                  <span class="info-colon">:</span>
                  <span class="info-value">${format(new Date(payment.payment_date), 'dd/MM/yyyy HH:mm:ss')}</span>
                </div>
              </div>

              <div class="amount-section">
                <div class="info-row">
                  <span class="info-label">₹${payment.advance_amount}/-</span>
                </div>
                <div class="username-section">
                  <div class="info-row">
                    <span class="info-label">Username</span>
                    <span class="info-colon">:</span>
                    <span class="info-value">${payment.billing_executive || formData.billingExecutive || 'System User'}</span>
                  </div>
                </div>
              </div>

              <div class="signature-section">
                <div class="signature-box">
                  <div style="border-bottom: 1px solid #000; margin-bottom: 5px; height: 40px;"></div>
                  <div>Name & Sign of Patient</div>
                </div>
                <div class="signature-box">
                  <div style="border-bottom: 1px solid #000; margin-bottom: 5px; height: 40px;"></div>
                  <div>Authorised Signatory</div>
                </div>
              </div>
            </div>
          </div>
        </body>
      </html>
    `;

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(printContent);
      printWindow.document.close();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-blue-600">
            Advance Payment
          </DialogTitle>
        </DialogHeader>

        {/* Patient Information Section */}
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="font-medium text-gray-700">Name:</span>
              <div className="text-gray-900">{patientInfo.name}</div>
            </div>
            <div>
              <span className="font-medium text-gray-700">Bill No.:</span>
              <div className="text-gray-900">{patientInfo.billNo}</div>
            </div>
            <div>
              <span className="font-medium text-gray-700">Registration No.:</span>
              <div className="text-gray-900">{patientInfo.registrationNo}</div>
            </div>
            <div>
              <span className="font-medium text-gray-700">Date of Admission:</span>
              <div className="text-gray-900">{patientInfo.dateOfAdmission}</div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column - Form */}
          <div className="space-y-4">
            {/* Returned Amount */}
            <div className="grid grid-cols-2 items-center gap-4">
              <Label htmlFor="returnedAmount" className="text-sm font-medium">
                Returned Amount:
              </Label>
              <div className="text-sm font-bold">
                {returnedAmount.toFixed(2)}
              </div>
            </div>

            {/* Advance Amount */}
            <div className="grid grid-cols-2 items-center gap-4">
              <Label htmlFor="advanceAmount" className="text-sm font-medium">
                {formData.isRefund ? 'Refund Amount' : 'Advance Amount'}
                {!formData.isRefund && <span className="text-red-500"> *</span>}
                {formData.isRefund && <span className="text-gray-500 text-xs"> (Optional)</span>}
              </Label>
              <Input
                id="advanceAmount"
                type="number"
                step="0.01"
                min="0"
                value={formData.advanceAmount}
                onChange={(e) => setFormData({ ...formData, advanceAmount: e.target.value })}
                placeholder={formData.isRefund ? "Enter refund amount (optional)" : "Enter amount"}
                className="w-full"
                autoComplete="off"
              />
            </div>

            {/* Is Refund */}
            <div className="grid grid-cols-2 items-start gap-4">
              <Label className="text-sm font-medium">Is Refund:</Label>
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="isRefund"
                    checked={formData.isRefund}
                    onCheckedChange={(checked) => 
                      setFormData({ ...formData, isRefund: checked as boolean })
                    }
                  />
                  <Label htmlFor="isRefund" className="text-sm">This is a refund</Label>
                </div>
                {formData.isRefund && (
                  <Input
                    placeholder="Refund reason"
                    value={formData.refundReason}
                    onChange={(e) => setFormData({ ...formData, refundReason: e.target.value })}
                    className="w-full"
                  />
                )}
              </div>
            </div>

            {/* Payment Date */}
            <div className="grid grid-cols-2 items-center gap-4">
              <Label htmlFor="paymentDate" className="text-sm font-medium">
                Payment Date <span className="text-red-500">*</span>
              </Label>
              <EnhancedDatePicker
                value={formData.paymentDate}
                onChange={(date) => setFormData({ ...formData, paymentDate: date || new Date() })}
                className="w-full"
                placeholder="Select date"
              />
            </div>

            {/* Mode of Payment */}
            <div className="grid grid-cols-2 items-center gap-4">
              <Label htmlFor="paymentMode" className="text-sm font-medium">
                Mode Of Payment <span className="text-red-500">*</span>
              </Label>
              <Select
                value={formData.paymentMode}
                onValueChange={(value) => setFormData({ ...formData, paymentMode: value, selectedBank: '' })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select payment mode" />
                </SelectTrigger>
                <SelectContent>
                  {paymentModes.map((mode) => (
                    <SelectItem key={mode.value} value={mode.value}>
                      {mode.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Bank Selection - Show for all payment modes except CASH and CREDIT */}
            {['ONLINE', 'UPI', 'NEFT', 'RTGS', 'CHEQUE', 'CARD', 'DD'].includes(formData.paymentMode) && (
              <div className="grid grid-cols-2 items-center gap-4">
                <Label htmlFor="bankAccount" className="text-sm font-medium">
                  Select Bank Account <span className="text-red-500">*</span>
                </Label>
                <Select
                  value={formData.selectedBank}
                  onValueChange={(value) => {
                    const bank = bankAccounts.find(b => b.id === value);
                    setFormData({
                      ...formData,
                      selectedBank: value,
                      remarks: formData.remarks.includes('Being cash received')
                        ? formData.remarks.replace(/Being cash received towards .+ from/, `Being cash received towards ${bank?.account_name || 'Online Transfer'} from`)
                        : formData.remarks
                          ? `${formData.remarks} - Bank: ${bank?.account_name}`
                          : `Being cash received towards ${bank?.account_name} from ${patientInfo.name || 'patient'} against R. No.: ${patientInfo.registrationNo}`
                    });
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select Bank Account" />
                  </SelectTrigger>
                  <SelectContent>
                    {bankAccounts.map((bank) => (
                      <SelectItem key={bank.id} value={bank.id}>
                        {bank.account_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Billing Executive */}
            <div className="grid grid-cols-2 items-center gap-4">
              <Label htmlFor="billingExecutive" className="text-sm font-medium">
                Billing Executive
              </Label>
              <Select 
                value={formData.billingExecutive} 
                onValueChange={(value) => setFormData({ ...formData, billingExecutive: value })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select Executive" />
                </SelectTrigger>
                <SelectContent>
                  {billingExecutives.map((executive) => (
                    <SelectItem key={executive} value={executive}>
                      {executive}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Reference Number */}
            {formData.paymentMode !== 'CASH' && (
              <div className="grid grid-cols-2 items-center gap-4">
                <Label htmlFor="referenceNumber" className="text-sm font-medium">
                  Reference Number
                </Label>
                <Input
                  id="referenceNumber"
                  value={formData.referenceNumber}
                  onChange={(e) => setFormData({ ...formData, referenceNumber: e.target.value })}
                  placeholder="Enter reference number"
                  className="w-full"
                />
              </div>
            )}

            {/* Package Detail + Package Days */}
            <div className="grid grid-cols-2 gap-4">
              <div className="grid grid-cols-2 items-center gap-4">
                <Label className="text-sm font-medium">Package Detail</Label>
                <Select
                  value={formData.packageName}
                  onValueChange={(value) => setFormData({ ...formData, packageName: value })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select package" />
                  </SelectTrigger>
                  <SelectContent>
                    {packages.map((pkg) => (
                      <SelectItem key={pkg.id} value={pkg.name}>
                        {pkg.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 items-center gap-4">
                <Label className="text-sm font-medium">Package Days</Label>
                <Input
                  type="number"
                  min="0"
                  value={formData.packageDays}
                  onChange={(e) => setFormData({ ...formData, packageDays: e.target.value })}
                  placeholder="Enter days"
                  className="w-full"
                />
              </div>
            </div>

            {/* Remarks */}
            <div className="grid grid-cols-2 items-start gap-4">
              <Label htmlFor="remarks" className="text-sm font-medium">
                Remark
              </Label>
              <div className="space-y-2">
                <Textarea
                  id="remarks"
                  value={formData.remarks}
                  onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
                  placeholder="Enter additional remarks..."
                  className="w-full min-h-[100px]"
                />
                {formData.paymentMode === 'ONLINE' && formData.selectedBank && (
                  <div className="text-xs text-green-600 bg-green-50 p-2 rounded border border-green-200">
                    ✓ Selected bank will be included in the payment receipt
                  </div>
                )}
              </div>
            </div>

            {/* Save Button */}
            <div className="flex justify-start">
              <Button 
                onClick={handleSave}
                disabled={isSaving}
                className="bg-blue-500 hover:bg-blue-600 text-white"
              >
                {isSaving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>

          {/* Right Column - Payment History */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Payment History</h3>
            
            {isLoading ? (
              <div className="text-center py-4">Loading payment history...</div>
            ) : paymentHistory.length === 0 ? (
              <div className="text-center py-4 text-gray-500">No payment history found</div>
            ) : (
              <div className="border rounded-lg overflow-hidden">
                <div className="bg-blue-100 grid grid-cols-3 gap-4 p-3 font-semibold text-sm">
                  <div>Date</div>
                  <div>Amount</div>
                  <div>Print</div>
                </div>
                
                <div className="max-h-[300px] overflow-y-auto">
                  {paymentHistory.map((payment, index) => (
                    <div 
                      key={payment.id}
                      className={`grid grid-cols-3 gap-4 p-3 text-sm border-b ${
                        index % 2 === 0 ? 'bg-white' : 'bg-gray-50'
                      }`}
                    >
                      <div>
                        {format(new Date(payment.payment_date), 'dd/MM/yyyy')}
                        <div className="text-xs text-gray-500">{payment.payment_mode}</div>
                      </div>
                      <div className="font-medium">
                        ₹{payment.advance_amount}
                        {payment.is_refund && (
                          <div className="text-xs text-red-600">Refund</div>
                        )}
                      </div>
                      <div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handlePrintReceipt(payment)}
                          className="h-8 w-8 p-0"
                        >
                          <Printer className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};