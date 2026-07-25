import React, { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { format } from 'date-fns';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface InvoiceAmountPaidOverrideEvent {
  id: string;
  action: 'set' | 'restore';
  display_amount: number | string | null;
  created_by_email: string;
  created_at: string;
}

const CMD_EMAIL = 'cmd@hopehospital.com';

const formatMoney = (amount: number): string =>
  amount.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

// Convert amount to words (Indian format)
const convertAmountToWords = (amount: number): string => {
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
  return 'Rupee ' + convertToWords(Math.floor(amount)) + ' Only';
};

const Invoice = () => {
  const [showPharmacyCharges, setShowPharmacyCharges] = useState(false);
  const [discountRemoved, setDiscountRemoved] = useState(false);
  const [chargeFilter, setChargeFilter] = useState('all'); // 'all', 'lab', 'radiology', 'surgery'
  const [hideLabRadiology, setHideLabRadiology] = useState(false);
  const [isEditingPaidOverride, setIsEditingPaidOverride] = useState(false);
  const [paidOverrideInput, setPaidOverrideInput] = useState('');
  const [isSavingPaidOverride, setIsSavingPaidOverride] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { visitId } = useParams<{ visitId: string }>();
  const { hospitalConfig, user } = useAuth();
  const isCmdUser = user?.email?.trim().toLowerCase() === CMD_EMAIL;
  const hospitalName = hospitalConfig?.name === 'ayushman' ? 'Ayushman Hospital Nagpur' : 'Hope Hospital Nagpur';

  // Fetch patient and visit data
  const { data: visitData, isLoading } = useQuery({
    queryKey: ['invoice-visit', visitId],
    queryFn: async () => {
      if (!visitId) return null;

      const { data, error } = await supabase
        .from('visits')
        .select(`
          *,
          patients (*)
        `)
        .eq('visit_id', visitId)
        .single();

      if (error) {
        console.error('Error fetching visit data:', error);
        return null;
      }

      return data;
    },
    enabled: !!visitId
  });

  // Fetch bill data for financial information
  const { data: billData } = useQuery({
    queryKey: ['invoice-bill', visitId],
    queryFn: async () => {
      if (!visitId) return null;

      const { data, error } = await supabase
        .from('bills')
        .select(`
          *,
          bill_sections (
            *,
            bill_line_items (*)
          )
        `)
        .eq('visit_id', visitId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('Error fetching bill data:', error);
        return null;
      }

      return data;
    },
    enabled: !!visitId
  });

  // Fetch payment data
  const { data: paymentData } = useQuery({
    queryKey: ['invoice-payments', visitId],
    queryFn: async () => {

      // accounting_transactions table does not exist in this project's schema;
      // payment totals come from advance_payment below.
      return [];
    },
    enabled: !!visitId
  });

  // Fetch advance payments
  const { data: advanceData } = useQuery({
    queryKey: ['invoice-advances', visitId],
    queryFn: async () => {

      // accounting_transactions table does not exist in this project's schema;
      // advance totals come from advance_payment below.
      return [];
    },
    enabled: !!visitId
  });

  // Fetch advance payment data from advance_payment table (same as Financial Summary)
  const { data: advancePaymentData } = useQuery({
    queryKey: ['invoice-advance-payment', visitId],
    queryFn: async () => {

      if (!visitId) {
        return [];
      }

      try {
        // Fetch advance payments with exact visitId match and ACTIVE status
        const { data: exactMatch, error: exactError } = await supabase
          .from('advance_payment')
          .select('*')
          .eq('visit_id', visitId)
          .eq('status', 'ACTIVE');


        if (exactError) {
          console.error('Error fetching advance payment data:', exactError);
          return [];
        }

        // Calculate totals
        let totalPaid = 0;
        let totalRefunded = 0;

        if (exactMatch && exactMatch.length > 0) {
          exactMatch.forEach(record => {
            const amount = parseFloat(record.advance_amount) || 0;

            if (record.is_refund) {
              // Refund amount is stored in `advance_amount` for refund rows
              totalRefunded += amount;
            } else {
              totalPaid += amount;
            }
          });

          console.log('✅ Advance payment totals:', {
            total_paid: totalPaid,
            total_refunded: totalRefunded,
            net_advance: totalPaid - totalRefunded
          });
        }

        return exactMatch || [];
      } catch (error) {
        console.error('Exception fetching advance payment:', error);
        return [];
      }
    },
    enabled: !!visitId
  });

  // Fetch final payment from final_payments table
  const { data: finalPaymentData } = useQuery({
    queryKey: ['invoice-final-payment', visitId],
    queryFn: async () => {
      if (!visitId) return null;

      const { data, error } = await supabase
        .from('final_payments')
        .select('*')
        .eq('visit_id', visitId)
        .maybeSingle();

      if (error) {
        console.error('Error fetching final payment:', error);
        return null;
      }

      return data;
    },
    enabled: !!visitId
  });

  // Fetch discount from visit_discounts table (same as Final Bill)
  const { data: discountData } = useQuery({
    queryKey: ['invoice-discount', visitId],
    queryFn: async () => {

      if (!visitId) {
        return 0;
      }

      // First get the UUID from visits table using visit_id string
      const { data: visitData, error: visitError } = await supabase
        .from('visits')
        .select('id')
        .eq('visit_id', visitId)
        .single();


      if (visitError || !visitData?.id) {
        console.error('Could not find visit UUID for discount:', visitError);
        return 0;
      }

      const visitUUID = visitData.id;

      // Fetch discount from visit_discounts table
      const { data, error } = await supabase
        .from('visit_discounts')
        .select('discount_amount')
        .eq('visit_id', visitUUID)
        .maybeSingle();


      if (error) {
        console.error('Error fetching discount:', error);
        return 0;
      }

      const discountAmount = data?.discount_amount || 0;

      return discountAmount;
    },
    enabled: !!visitId
  });

  // Fetch lab tests from visit_labs table (Service Selection data)
  const { data: labOrdersData } = useQuery({
    queryKey: ['invoice-visit-labs', visitId],
    queryFn: async () => {

      if (!visitId) {
        return [];
      }

      // First get the UUID from visits table using visit_id string
      const { data: visitData, error: visitError } = await supabase
        .from('visits')
        .select('id')
        .eq('visit_id', visitId)
        .single();


      if (visitError || !visitData?.id) {
        console.error('Could not find visit UUID:', visitError);
        return [];
      }

      const visitUUID = visitData.id;

      // Now fetch visit_labs using the UUID

      const { data, error } = await supabase
        .from('visit_labs')
        .select(`
          *,
          lab:lab_id (
            id,
            name,
            private,
            "NABH_rates_in_rupee",
            "Non-NABH_rates_in_rupee",
            bhopal_nabh_rate,
            bhopal_non_nabh_rate,
            category,
            description
          )
        `)
        .eq('visit_id', visitUUID)
        .order('ordered_date', { ascending: false });


      if (error) {
        console.error('Error fetching visit labs:', error);
        return [];
      }

      return data || [];
    },
    enabled: !!visitId
  });

  // Fetch radiology tests from visit_radiology (service selection data)
  const { data: radiologyOrdersData } = useQuery({
    queryKey: ['invoice-visit-radiology', visitId],
    queryFn: async () => {
      if (!visitId) {
        return [];
      }

      // First get the UUID from visits table using visit_id string
      const { data: visitData, error: visitError } = await supabase
        .from('visits')
        .select('id')
        .eq('visit_id', visitId)
        .single();


      if (visitError || !visitData?.id) {
        console.error('Could not find visit UUID for radiology:', visitError);
        return [];
      }

      const visitUUID = visitData.id;

      // Now fetch visit_radiology using the UUID

      const { data, error } = await supabase
        .from('visit_radiology')
        .select(`
          *,
          radiology:radiology_id (
            id,
            name,
            category,
            description
          )
        `)
        .eq('visit_id', visitUUID)
        .order('ordered_date', { ascending: false });

      if (error) {
        console.error('Error fetching visit radiology tests:', error);
        return [];
      }


      // Also try to fetch all visit_radiology records for debugging
      if (!data || data.length === 0) {
        const { data: allRadiologyData, error: allRadiologyError } = await supabase
          .from('visit_radiology')
          .select('*')
          .limit(10);
      }

      return data || [];
    },
    enabled: !!visitId
  });

  // Fetch surgeries from visit_surgeries table
  const { data: surgeryOrdersData } = useQuery({
    queryKey: ['invoice-visit-surgeries', visitId],
    queryFn: async () => {

      if (!visitId) return [];

      // Get visit UUID first
      const { data: visitData, error: visitError } = await supabase
        .from('visits')
        .select('id')
        .eq('visit_id', visitId)
        .single();

      if (visitError || !visitData?.id) {
        console.error('Visit not found for surgeries:', visitError);
        return [];
      }

      const { data, error } = await supabase
        .from('visit_surgeries')
        .select(`
          *,
          cghs_surgery:surgery_id (
            id,
            name,
            code,
            NABH_NABL_Rate
          )
        `)
        .eq('visit_id', visitData.id);


      if (error) {
        console.error('Error fetching surgery orders:', error);
        return [];
      }
      return data || [];
    },
    enabled: !!visitId
  });

  // Fetch anesthetists from visit_anesthetists table
  const { data: anesthetistData } = useQuery({
    queryKey: ['invoice-visit-anesthetists', visitId],
    queryFn: async () => {
      if (!visitId) return [];

      // Get visit UUID first
      const { data: visitData, error: visitError } = await supabase
        .from('visits')
        .select('id')
        .eq('visit_id', visitId)
        .single();

      if (visitError || !visitData?.id) {
        console.error('Visit not found for anesthetists:', visitError);
        return [];
      }

      const { data, error } = await supabase
        .from('visit_anesthetists')
        .select('*')
        .eq('visit_id', visitData.id);


      if (error) {
        console.error('Error fetching anesthetists:', error);
        return [];
      }
      return data || [];
    },
    enabled: !!visitId
  });

  // Fetch implants from visit_implants table
  const { data: implantOrdersData } = useQuery({
    queryKey: ['invoice-visit-implants', visitId],
    queryFn: async () => {

      if (!visitId) return [];

      // Get visit UUID first
      const { data: visitData, error: visitError } = await supabase
        .from('visits')
        .select('id')
        .eq('visit_id', visitId)
        .single();

      if (visitError || !visitData?.id) {
        console.error('Visit not found for implants:', visitError);
        return [];
      }

      const { data, error } = await supabase
        .from('visit_implants' as any)
        .select('*')
        .eq('visit_id', visitData.id)
        .eq('status', 'Active');


      if (error) {
        console.error('Error fetching implant orders:', error);
        return [];
      }
      return data || [];
    },
    enabled: !!visitId
  });

  // Fetch mandatory services from junction table (actual saved services for this visit)
  const { data: mandatoryServicesData } = useQuery({
    queryKey: ['invoice-mandatory-services-junction', visitId],
    queryFn: async () => {

      if (!visitId) {
        return [];
      }

      // Get visit UUID first
      const { data: visitData, error: visitError } = await supabase
        .from('visits')
        .select('id, visit_id')
        .eq('visit_id', visitId)
        .single();

      if (visitError || !visitData) {
        console.error('Visit not found for mandatory services:', visitError);
        return [];
      }


      // Fetch from junction table
      const { data, error } = await supabase
        .from('visit_mandatory_services')
        .select(`
          id,
          quantity,
          rate_used,
          rate_type,
          amount,
          selected_at,
          start_date,
          end_date,
          mandatory_services!mandatory_service_id (
            id,
            service_name,
            tpa_rate,
            private_rate,
            nabh_rate,
            non_nabh_rate
          )
        `)
        .eq('visit_id', visitData.id)
        .order('selected_at', { ascending: false });


      if (error) {
        console.error('Error fetching mandatory services from junction table:', error);
        return [];
      }

      // Map junction data to expected format
      const mappedData = (data || []).map(item => ({
        id: item.mandatory_services?.id,
        service_name: item.mandatory_services?.service_name,
        tpa_rate: item.mandatory_services?.tpa_rate,
        private_rate: item.mandatory_services?.private_rate,
        nabh_rate: item.mandatory_services?.nabh_rate,
        non_nabh_rate: item.mandatory_services?.non_nabh_rate,
        // Junction table specific data
        quantity: item.quantity,
        rate_used: item.rate_used,
        rate_type: item.rate_type,
        amount: item.amount,
        selected_at: item.selected_at,
        start_date: item.start_date,
        end_date: item.end_date
      }));

      return mappedData;
    },
    enabled: !!visitId
  });

  // Fetch clinical services from junction table (actual saved services for this visit)
  const { data: clinicalServicesData } = useQuery({
    queryKey: ['invoice-clinical-services-junction', visitId],
    queryFn: async () => {

      if (!visitId) {
        return [];
      }

      // Get visit UUID first
      const { data: visitData, error: visitError } = await supabase
        .from('visits')
        .select('id, visit_id')
        .eq('visit_id', visitId)
        .single();

      if (visitError || !visitData) {
        console.error('Visit not found for clinical services:', visitError);
        return [];
      }


      // Fetch from junction table
      const { data, error } = await supabase
        .from('visit_clinical_services')
        .select(`
          id,
          quantity,
          rate_used,
          rate_type,
          amount,
          selected_at,
          start_date,
          end_date,
          clinical_services!clinical_service_id (
            id,
            service_name,
            tpa_rate,
            private_rate,
            nabh_rate,
            non_nabh_rate
          )
        `)
        .eq('visit_id', visitData.id)
        .order('selected_at', { ascending: false });


      if (error) {
        console.error('Error fetching clinical services from junction table:', error);
        return [];
      }

      // Map junction data to expected format
      const mappedData = (data || []).map(item => ({
        id: item.clinical_services?.id,
        service_name: item.clinical_services?.service_name,
        tpa_rate: item.clinical_services?.tpa_rate,
        private_rate: item.clinical_services?.private_rate,
        nabh_rate: item.clinical_services?.nabh_rate,
        non_nabh_rate: item.clinical_services?.non_nabh_rate,
        // Junction table specific data
        quantity: item.quantity,
        rate_used: item.rate_used,
        rate_type: item.rate_type,
        amount: item.amount,
        selected_at: item.selected_at,
        start_date: item.start_date,
        end_date: item.end_date
      }));

      return mappedData;
    },
    enabled: !!visitId
  });

  // Fetch accommodation charges from visit_accommodations table
  const { data: accommodationData } = useQuery({
    queryKey: ['invoice-visit-accommodations', visitId],
    queryFn: async () => {

      if (!visitId) return [];

      // Get visit UUID first
      const { data: visitData, error: visitError } = await supabase
        .from('visits')
        .select('id')
        .eq('visit_id', visitId)
        .single();

      if (visitError || !visitData?.id) {
        console.error('Visit not found for accommodations:', visitError);
        return [];
      }

      const { data, error } = await supabase
        .from('visit_accommodations')
        .select(`
          *,
          accommodation:accommodation_id (
            id,
            room_type,
            private_rate,
            nabh_rate,
            non_nabh_rate,
            tpa_rate
          )
        `)
        .eq('visit_id', visitData.id)
        .order('start_date', { ascending: false });


      if (error) {
        console.error('Error fetching accommodations:', error);
        return [];
      }
      return data || [];
    },
    enabled: !!visitId
  });

  // Fetch pharmacy charges (CREDIT sales for this visit)
  const { data: pharmacyData } = useQuery({
    queryKey: ['invoice-pharmacy', visitId, hospitalConfig?.name],
    queryFn: async () => {
      if (!visitId) return { totalAmount: 0 };

      const patientId = visitData?.patients?.patients_id;
      const hName = hospitalConfig?.name;

      if (!patientId || !hName) return { totalAmount: 0 };

      // 1. Get CREDIT sales for this patient for THIS VISIT
      const { data: salesData, error: salesError } = await supabase
        .from('pharmacy_sales')
        .select('sale_id, total_amount')
        .eq('patient_id', patientId)
        .eq('visit_id', visitId)
        .eq('hospital_name', hName)
        .eq('payment_method', 'CREDIT');

      if (salesError) {
        console.error('Error fetching pharmacy sales:', salesError);
        return { totalAmount: 0 };
      }

      const totalCreditSales = (salesData || []).reduce((sum, sale) => sum + (sale.total_amount || 0), 0);
      const visitSaleIds = (salesData || []).map(sale => sale.sale_id);

      // 2. Get returns for sales from THIS VISIT
      let totalReturns = 0;
      if (visitSaleIds.length > 0) {
        const { data: returnsData } = await supabase
          .from('medicine_returns')
          .select('net_refund')
          .in('original_sale_id', visitSaleIds)
          .eq('hospital_name', hName);

        totalReturns = (returnsData || []).reduce((sum, ret) => sum + (ret.net_refund || 0), 0);
      }

      // 3. Get credit payments for sales from THIS VISIT
      let totalPaymentsReceived = 0;
      if (visitSaleIds.length > 0) {
        const { data: paymentsData } = await supabase
          .from('pharmacy_credit_payments')
          .select('amount')
          .in('sale_id', visitSaleIds)
          .eq('hospital_name', hName);

        totalPaymentsReceived = (paymentsData || []).reduce((sum, payment) => sum + (payment.amount || 0), 0);
      }

      const pendingAmount = Math.max(0, totalCreditSales - totalReturns - totalPaymentsReceived);

      return { totalAmount: pendingAmount };
    },
    enabled: !!visitId && !!visitData?.patients?.patients_id && !!hospitalConfig?.name
  });

  // The newest append-only event determines whether a display override is active.
  // Until the supplied migration is applied, this query safely falls back to the
  // actual paid amount so the existing invoice remains usable.
  const { data: amountPaidOverrideEvent } = useQuery<InvoiceAmountPaidOverrideEvent | null>({
    queryKey: ['invoice-amount-paid-override', visitId],
    queryFn: async () => {
      if (!visitId) return null;

      const { data, error } = await (supabase as any)
        .from('invoice_amount_paid_override_events')
        .select('id, action, display_amount, created_by_email, created_at')
        .eq('visit_id', visitId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.warn('Amount Paid override is unavailable. Apply the supplied migration to enable it:', error);
        return null;
      }

      return data as InvoiceAmountPaidOverrideEvent | null;
    },
    enabled: !!visitId,
    retry: false,
  });

  // Show loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-white p-4 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading invoice data...</p>
        </div>
      </div>
    );
  }

  // Show error if no data found
  if (!visitData) {
    return (
      <div className="min-h-screen bg-white p-4 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-bold text-red-600 mb-4">Invoice Not Found</h2>
          <p className="text-gray-600 mb-4">Unable to load invoice data for visit ID: {visitId}</p>
          <button
            onClick={() => navigate(-1)}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  const patient = visitData.patients;

  // Calculate age string
  const calculateAge = (birthDate: string) => {
    if (!birthDate) return 'N/A';
    const birth = new Date(birthDate);
    const today = new Date();
    const years = today.getFullYear() - birth.getFullYear();
    const months = today.getMonth() - birth.getMonth();
    const days = today.getDate() - birth.getDate();

    let ageYears = years;
    let ageMonths = months;

    if (days < 0) {
      ageMonths--;
    }
    if (ageMonths < 0) {
      ageYears--;
      ageMonths += 12;
    }

    return `${ageYears}Y ${ageMonths}M 0D`;
  };

  // Create services array from actual bill data and lab/radiology orders
  // Helper function to get rate based on patient type
  const getMandatoryServiceRate = (service, patientCategory) => {
    if (!service) {
      return 0;
    }

    console.log('getMandatoryServiceRate: service rates:', {
      service_name: service.service_name,
      private_rate: service.private_rate,
      tpa_rate: service.tpa_rate,
      cghs_rate: service.cghs_rate,
      non_cghs_rate: service.non_cghs_rate,
      patientCategory: patientCategory
    });

    let rate = 0;
    switch (patientCategory?.toLowerCase()) {
      case 'private':
        rate = parseFloat(service.private_rate) || 0;
        break;
      case 'tpa':
      case 'corporate':
        rate = parseFloat(service.tpa_rate) || 0;
        break;
      case 'cghs':
        rate = parseFloat(service.cghs_rate) || 0;
        break;
      case 'non_cghs':
        rate = parseFloat(service.non_cghs_rate) || 0;
        break;
      default:
        rate = parseFloat(service.private_rate) || 0; // Default to private rate
        break;
    }

    return rate;
  };

  const createServicesFromBillData = () => {
    const services = [];
    let srNo = 1;

    // If filter is set to lab or radiology, show only that data
    if (chargeFilter === 'lab') {

      if (labOrdersData && labOrdersData.length > 0) {
        // Get patient info to determine correct rate type
        const patientType = (visitData?.patient_type || visitData?.patients?.patient_type || '').toLowerCase().trim();
        const corporate = (visitData?.patients?.corporate || '').toLowerCase().trim();

        const hasCorporate = corporate.length > 0 && corporate !== 'private';
        const isPrivatePatient = !hasCorporate && (patientType === 'private' || corporate === 'private');
        const usesNonNABHRate = hasCorporate && (corporate.includes('cghs') || corporate.includes('echs') || corporate.includes('esic'));
        const usesBhopaliNABHRate = hasCorporate && (corporate.includes('mp police') || corporate.includes('ordnance factory'));
        const usesNABHRate = hasCorporate && !usesNonNABHRate && !usesBhopaliNABHRate;

        labOrdersData.filter(l => !l.is_hidden).forEach((visitLab) => {
          const labDetail = visitLab.lab;
          const quantity = visitLab.quantity || 1;

          // Use saved rate from visit_labs instead of recalculating
          const correctUnitRate = visitLab.cost || visitLab.unit_rate || 0;

          const finalCost = correctUnitRate * quantity;

          services.push({
            srNo: srNo++,
            item: labDetail?.name || 'Lab Test',
            rate: correctUnitRate,
            qty: quantity,
            amount: finalCost,
            type: 'lab'
          });
        });
      } else {
      }
      return services;
    }

    if (chargeFilter === 'radiology') {

      // Show visit radiology tests data
      if (radiologyOrdersData && radiologyOrdersData.length > 0) {
        radiologyOrdersData.forEach((visitRadiology) => {
          // Use actual cost from visit_radiology table (stored cost for this visit)
          const rate = visitRadiology.cost ? parseFloat(visitRadiology.cost.toString()) : (visitRadiology.unit_rate ? parseFloat(visitRadiology.unit_rate.toString()) : 1000);

          console.log('Radiology test details:', {
            name: visitRadiology.radiology?.name,
            storedCost: visitRadiology.cost,
            unitRate: visitRadiology.unit_rate,
            rate: rate,
            id: visitRadiology.radiology?.id
          });
          services.push({
            srNo: srNo++,
            item: visitRadiology.radiology?.name || 'Radiology Procedure',
            rate: rate,
            qty: 1,
            amount: rate,
            type: 'radiology'
          });
        });
      } else {
      }
      return services;
    }

    if (chargeFilter === 'surgery') {

      if (surgeryOrdersData && surgeryOrdersData.length > 0) {
        surgeryOrdersData.forEach((visitSurgery: any) => {
          const rateStr = visitSurgery.cghs_surgery?.NABH_NABL_Rate || '0';
          const surgeryRate = parseFloat(String(rateStr).replace(/[^\d.]/g, '')) || 0;

          console.log('Surgery details:', {
            name: visitSurgery.cghs_surgery?.name,
            code: visitSurgery.cghs_surgery?.code,
            rateStr: rateStr,
            rate: surgeryRate
          });

          services.push({
            srNo: srNo++,
            item: visitSurgery.cghs_surgery?.name || 'Surgery',
            rate: surgeryRate,
            qty: 1,
            amount: surgeryRate,
            type: 'surgery'
          });
        });
      } else {
      }
      return services;
    }

    if (chargeFilter === 'implants') {

      if (implantOrdersData && implantOrdersData.length > 0) {
        implantOrdersData.forEach((visitImplant: any) => {
          const rate = parseFloat(visitImplant.rate) || 0;
          const qty = visitImplant.quantity || 1;
          const amount = parseFloat(visitImplant.amount) || (rate * qty);

          services.push({
            srNo: srNo++,
            item: visitImplant.implant_name || 'Implant',
            rate: rate,
            qty: qty,
            amount: amount,
            type: 'implant'
          });
        });
      } else {
      }
      return services;
    }

    if (chargeFilter === 'accommodation') {

      if (accommodationData && accommodationData.length > 0) {
        accommodationData.forEach((visitAccom: any) => {
          const rate = parseFloat(visitAccom.amount) || parseFloat(visitAccom.rate_used) || 0;
          const days = visitAccom.days || 1;

          services.push({
            srNo: srNo++,
            item: visitAccom.accommodation?.room_type || 'Accommodation',
            rate: rate,
            qty: days,
            amount: rate,
            type: 'accommodation'
          });
        });
      }
      return services;
    }

    // Default: show all charges (bill data + lab + radiology + mandatory services + clinical services)
    // Helper functions to categorize services
    const isRegistrationCharges = (name: string) => name?.toLowerCase().includes('registration');
    const isDoctorCharges = (name: string) => name?.toLowerCase().includes('doctor charges');
    const isSurgeonEntry = (name: string) => /^(dr\.|dr\s)/i.test(name?.trim() || '');

    // Don't add static General Ward - let mandatory services be the primary charges
    if (!billData?.bill_sections) {
      // Start with empty services array - mandatory services will be added later
    } else {
      // Add bill sections if they exist
      billData.bill_sections.forEach((section) => {
      if (section.bill_line_items && section.bill_line_items.length > 0) {
        section.bill_line_items.forEach((item) => {
          services.push({
            srNo: srNo++,
            item: item.description || section.section_name,
            rate: item.rate || 0,
            qty: item.quantity || 1,
            amount: item.amount || 0,
            type: 'other'
          });
        });
      } else {
        // If no line items, use section data
        services.push({
          srNo: srNo++,
          item: section.section_name,
          rate: section.total_amount || 0,
          qty: 1,
          amount: section.total_amount || 0,
          type: 'other'
        });
      }
      });
    }

    // NOW INCLUDING lab and radiology charges in "All Charges" view as SUMMARY LINES
    // Calculate lab charges by recalculating rates dynamically (same logic as Final Bill)

    let totalLabCharges = 0;

    if (labOrdersData && labOrdersData.length > 0) {
      // Get patient info to determine correct rate type
      const patientType = (visitData?.patient_type || visitData?.patients?.patient_type || '').toLowerCase().trim();
      const corporate = (visitData?.patients?.corporate || '').toLowerCase().trim();

      // Corporate field takes priority - check if patient has a corporate panel first
      const hasCorporate = corporate.length > 0 && corporate !== 'private';

      // Patient is private ONLY if they don't have a corporate panel
      const isPrivatePatient = !hasCorporate && (patientType === 'private' || corporate === 'private');

      // Check if corporate qualifies for Non-NABH rates (CGHS/ECHS/ESIC)
      const usesNonNABHRate = hasCorporate &&
        (corporate.includes('cghs') ||
        corporate.includes('echs') ||
        corporate.includes('esic'));

      // Check if corporate qualifies for Bhopal NABH rates
      const usesBhopaliNABHRate = hasCorporate &&
        (corporate.includes('mp police') ||
        corporate.includes('ordnance factory') ||
        corporate.includes('ordnance factory itarsi'));

      // Check if patient has other corporate
      const usesNABHRate = hasCorporate && !usesNonNABHRate && !usesBhopaliNABHRate;

      console.log('🔍 Patient Type Determination:', {
        patientType,
        corporate,
        isPrivatePatient,
        hasCorporate,
        usesNonNABHRate,
        usesBhopaliNABHRate,
        usesNABHRate
      });

      // USE STORED COST from visit_labs table (same as Final Bill)
      // Skip hidden lab tests - they should not appear in the bill
      labOrdersData.filter(l => !l.is_hidden).forEach((visitLab, index) => {
        const labDetail = visitLab.lab;

        // Use the stored cost from visit_labs table instead of recalculating
        const storedCost = visitLab.cost || 0;

        console.log(`Lab ${index + 1}: ${labDetail?.name}`, {
          storedCost: storedCost,
          usingSavedCost: true
        });

        totalLabCharges += storedCost;
      });

    }

    // Add single summary line for all lab charges if total > 0
    if (totalLabCharges > 0) {
      console.log(`📊 Adding Laboratory Charges summary line: ₹${totalLabCharges}`);
      services.push({
        srNo: srNo++,
        item: 'Laboratory Charges',
        rate: totalLabCharges,
        qty: 1,
        amount: totalLabCharges,
        type: 'lab'
      });
    } else {
      console.warn('⚠️ Total lab charges is 0! No lab tests found or all rates are 0.');
    }

    // Calculate total radiology charges and add as single line
    let totalRadiologyCharges = 0;
    if (radiologyOrdersData && radiologyOrdersData.length > 0) {
      radiologyOrdersData.forEach((visitRadiology) => {
        // Use stored cost from visit_radiology table
        const rate = visitRadiology.cost ? parseFloat(visitRadiology.cost.toString()) : (visitRadiology.unit_rate ? parseFloat(visitRadiology.unit_rate.toString()) : 1000);
        totalRadiologyCharges += rate;
        console.log('Adding radiology to total:', {
          name: visitRadiology.radiology?.name,
          storedCost: visitRadiology.cost,
          unitRate: visitRadiology.unit_rate,
          rate: rate
        });
      });

      // Add single summary line for all radiology charges
      if (totalRadiologyCharges > 0) {
        services.push({
          srNo: srNo++,
          item: 'Radiology Charges',
          rate: totalRadiologyCharges,
          qty: 1,
          amount: totalRadiologyCharges,
          type: 'radiology'
        });
      }
    }

    // Add mandatory services from junction table (actual saved services with correct rates)

    // ===== 1. REGISTRATION CHARGES (from mandatory services - if exists) =====
    if (mandatoryServicesData && mandatoryServicesData.length > 0) {
      const registrationServices = mandatoryServicesData.filter((s) => isRegistrationCharges(s.service_name));

      registrationServices.forEach((mandatoryService) => {
        const startDate = mandatoryService.start_date ? format(new Date(mandatoryService.start_date), 'dd-MM-yyyy') : '';
        const endDate = mandatoryService.end_date ? format(new Date(mandatoryService.end_date), 'dd-MM-yyyy') : '';

        let days = mandatoryService.quantity || 1;
        if (mandatoryService.start_date && mandatoryService.end_date) {
          const start = new Date(mandatoryService.start_date);
          const end = new Date(mandatoryService.end_date);
          days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
        }

        const rate = mandatoryService.rate_used || mandatoryService.amount || 0;
        const amount = (mandatoryService.start_date && mandatoryService.end_date)
          ? (rate * days)
          : (mandatoryService.amount || (rate * days));

        const dateRange = startDate && endDate ? ` (${startDate} to ${endDate})` : '';
        const itemDescription = `${mandatoryService.service_name}${dateRange}`;

        if (rate > 0) {
          services.push({
            srNo: srNo++,
            item: itemDescription,
            rate: rate,
            qty: days,
            amount: amount,
            type: 'registration'
          });
        }
      });
    }

    // ===== 2. CONSULTANT DOCTOR CHARGES (from mandatory services) =====
    if (mandatoryServicesData && mandatoryServicesData.length > 0) {
      const doctorChargesServices = mandatoryServicesData.filter((s) => isDoctorCharges(s.service_name));

      doctorChargesServices.forEach((mandatoryService) => {
        const startDate = mandatoryService.start_date ? format(new Date(mandatoryService.start_date), 'dd-MM-yyyy') : '';
        const endDate = mandatoryService.end_date ? format(new Date(mandatoryService.end_date), 'dd-MM-yyyy') : '';

        let days = mandatoryService.quantity || 1;
        if (mandatoryService.start_date && mandatoryService.end_date) {
          const start = new Date(mandatoryService.start_date);
          const end = new Date(mandatoryService.end_date);
          days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
        }

        const rate = mandatoryService.rate_used || mandatoryService.amount || 0;
        const amount = (mandatoryService.start_date && mandatoryService.end_date)
          ? (rate * days)
          : (mandatoryService.amount || (rate * days));

        const dateRange = startDate && endDate ? ` (${startDate} to ${endDate})` : '';
        const itemDescription = `${mandatoryService.service_name}${dateRange}`;

        if (rate > 0) {
          services.push({
            srNo: srNo++,
            item: itemDescription,
            rate: rate,
            qty: days,
            amount: amount,
            type: 'doctor'
          });
        }
      });
    }

    // ===== 3. ACCOMMODATION CHARGES =====

    if (accommodationData && accommodationData.length > 0) {
      accommodationData.forEach((visitAccom: any) => {
        const roomType = visitAccom.accommodation?.room_type || 'Accommodation';
        const startDate = visitAccom.start_date ? format(new Date(visitAccom.start_date), 'dd-MM-yyyy') : '';
        const endDate = visitAccom.end_date ? format(new Date(visitAccom.end_date), 'dd-MM-yyyy') : '';

        let days = 1;
        if (visitAccom.start_date && visitAccom.end_date) {
          const start = new Date(visitAccom.start_date);
          const end = new Date(visitAccom.end_date);
          days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
        }

        const ratePerDay = parseFloat(visitAccom.rate_used) || 0;
        const totalAmount = parseFloat(visitAccom.amount) || (ratePerDay * days);

        const dateRange = startDate && endDate ? ` (${startDate} to ${endDate})` : '';
        const itemDescription = `${roomType}${dateRange}`;

        console.log('Adding accommodation line:', {
          room_type: roomType,
          startDate,
          endDate,
          days,
          ratePerDay,
          totalAmount
        });

        services.push({
          srNo: srNo++,
          item: itemDescription,
          rate: ratePerDay,
          qty: days,
          amount: totalAmount,
          type: 'accommodation'
        });
      });
    } else {
    }

    // ===== 4. SURGERY CHARGES =====

    let totalSurgeryCharges = 0;
    const surgeryNames: string[] = [];
    if (surgeryOrdersData && surgeryOrdersData.length > 0) {
      surgeryOrdersData.forEach((visitSurgery: any) => {
        const surgeryRate = visitSurgery.rate && visitSurgery.rate > 0
          ? Number(visitSurgery.rate)
          : parseFloat(String(visitSurgery.cghs_surgery?.NABH_NABL_Rate || '0').replace(/[^\d.]/g, '')) || 0;
        totalSurgeryCharges += surgeryRate;
        const surgeryName = visitSurgery.cghs_surgery?.name || visitSurgery.surgery_name || '';
        if (surgeryName) surgeryNames.push(surgeryName);
        console.log('Adding surgery to total:', {
          name: surgeryName,
          storedRate: visitSurgery.rate,
          surgeryRate: surgeryRate
        });
      });

      if (totalSurgeryCharges > 0) {
        const surgeryLabel = surgeryNames.length > 0
          ? `Surgery Charges - ${surgeryNames.join(', ')}`
          : 'Surgery Charges';
        services.push({
          srNo: srNo++,
          item: surgeryLabel,
          rate: totalSurgeryCharges,
          qty: 1,
          amount: totalSurgeryCharges,
          type: 'surgery'
        });
      }
    } else {
    }

    // ===== 5. IMPLANT CHARGES (from surgery data) =====
    let totalImplantCharges = 0;
    if (surgeryOrdersData && surgeryOrdersData.length > 0) {
      surgeryOrdersData.forEach((visitSurgery: any) => {
        const implantCost = parseFloat(visitSurgery.implant_cost) || 0;
        if (implantCost > 0) {
          totalImplantCharges += implantCost;
          console.log('Adding implant cost:', {
            surgery: visitSurgery.cghs_surgery?.name,
            implantCost: implantCost
          });
        }
      });

      if (totalImplantCharges > 0) {
        services.push({
          srNo: srNo++,
          item: 'Implant Charges',
          rate: totalImplantCharges,
          qty: 1,
          amount: totalImplantCharges,
          type: 'implant'
        });
      }
    }

    // ===== 6. ANESTHETIST CHARGES =====

    let totalAnesthetistCharges = 0;
    if (anesthetistData && anesthetistData.length > 0) {
      anesthetistData.forEach((anesthetist: any) => {
        const anesthetistRate = parseFloat(anesthetist.rate) || 0;
        totalAnesthetistCharges += anesthetistRate;
        console.log('Adding anesthetist to total:', {
          name: anesthetist.anesthetist_name,
          type: anesthetist.anesthetist_type,
          rate: anesthetistRate
        });
      });

      if (totalAnesthetistCharges > 0) {
        const anesthetistNames = anesthetistData.map((a: any) => a.anesthetist_name).filter(Boolean).join(', ');
        services.push({
          srNo: srNo++,
          item: anesthetistNames ? `Anesthetist Charges - ${anesthetistNames}` : 'Anesthetist Charges',
          rate: totalAnesthetistCharges,
          qty: 1,
          amount: totalAnesthetistCharges,
          type: 'anesthetist'
        });
      }
    } else {
    }

    // ===== 7. SURGEON DOCTOR RATE (individual doctor name entries) =====
    // From mandatory services - entries starting with Dr. or DR.
    if (mandatoryServicesData && mandatoryServicesData.length > 0) {
      const surgeonServices = mandatoryServicesData.filter((s) =>
        isSurgeonEntry(s.service_name) && !isDoctorCharges(s.service_name)
      );

      surgeonServices.forEach((mandatoryService) => {
        const startDate = mandatoryService.start_date ? format(new Date(mandatoryService.start_date), 'dd-MM-yyyy') : '';
        const endDate = mandatoryService.end_date ? format(new Date(mandatoryService.end_date), 'dd-MM-yyyy') : '';

        let days = mandatoryService.quantity || 1;
        if (mandatoryService.start_date && mandatoryService.end_date) {
          const start = new Date(mandatoryService.start_date);
          const end = new Date(mandatoryService.end_date);
          days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
        }

        const rate = mandatoryService.rate_used || mandatoryService.amount || 0;
        const amount = (mandatoryService.start_date && mandatoryService.end_date)
          ? (rate * days)
          : (mandatoryService.amount || (rate * days));

        const dateRange = startDate && endDate ? ` (${startDate} to ${endDate})` : '';
        const itemDescription = `${mandatoryService.service_name}${dateRange}`;

        if (rate > 0) {
          services.push({
            srNo: srNo++,
            item: itemDescription,
            rate: rate,
            qty: days,
            amount: amount,
            type: 'surgeon'
          });
        }
      });
    }

    // From clinical services - entries starting with Dr. or DR.
    if (clinicalServicesData && clinicalServicesData.length > 0) {
      const surgeonClinicalServices = clinicalServicesData.filter((s) => isSurgeonEntry(s.service_name));

      surgeonClinicalServices.forEach((clinicalService) => {
        const startDate = clinicalService.start_date ? format(new Date(clinicalService.start_date), 'dd-MM-yyyy') : '';
        const endDate = clinicalService.end_date ? format(new Date(clinicalService.end_date), 'dd-MM-yyyy') : '';

        let days = clinicalService.quantity || 1;
        if (clinicalService.start_date && clinicalService.end_date) {
          const start = new Date(clinicalService.start_date);
          const end = new Date(clinicalService.end_date);
          days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
        }

        const rate = clinicalService.rate_used || clinicalService.amount || 0;
        const amount = (clinicalService.start_date && clinicalService.end_date)
          ? (rate * days)
          : (clinicalService.amount || (rate * days));

        const dateRange = startDate && endDate ? ` (${startDate} to ${endDate})` : '';
        const itemDescription = `${clinicalService.service_name}${dateRange}`;

        if (rate > 0) {
          services.push({
            srNo: srNo++,
            item: itemDescription,
            rate: rate,
            qty: days,
            amount: amount,
            type: 'surgeon'
          });
        }
      });
    }

    // ===== 8. CLINICAL SERVICES (excluding surgeon entries) =====

    if (clinicalServicesData && clinicalServicesData.length > 0) {
      const regularClinicalServices = clinicalServicesData.filter((s) => !isSurgeonEntry(s.service_name));

      regularClinicalServices.forEach((clinicalService) => {
        const startDate = clinicalService.start_date ? format(new Date(clinicalService.start_date), 'dd-MM-yyyy') : '';
        const endDate = clinicalService.end_date ? format(new Date(clinicalService.end_date), 'dd-MM-yyyy') : '';

        let days = clinicalService.quantity || 1;
        if (clinicalService.start_date && clinicalService.end_date) {
          const start = new Date(clinicalService.start_date);
          const end = new Date(clinicalService.end_date);
          days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
        }

        const rate = clinicalService.rate_used || clinicalService.amount || 0;
        const amount = (clinicalService.start_date && clinicalService.end_date)
          ? (rate * days)
          : (clinicalService.amount || (rate * days));

        const dateRange = startDate && endDate ? ` (${startDate} to ${endDate})` : '';
        const itemDescription = `${clinicalService.service_name}${dateRange}`;

        if (rate > 0) {
          services.push({
            srNo: srNo++,
            item: itemDescription,
            rate: rate,
            qty: days,
            amount: amount,
            type: 'clinical'
          });
        }
      });
    } else {
    }

    // ===== 9. MANDATORY SERVICES (excluding registration, doctor charges and surgeon entries) =====

    if (mandatoryServicesData && mandatoryServicesData.length > 0) {
      const regularMandatoryServices = mandatoryServicesData.filter((s) =>
        !isRegistrationCharges(s.service_name) && !isDoctorCharges(s.service_name) && !isSurgeonEntry(s.service_name)
      );

      regularMandatoryServices.forEach((mandatoryService) => {
        const startDate = mandatoryService.start_date ? format(new Date(mandatoryService.start_date), 'dd-MM-yyyy') : '';
        const endDate = mandatoryService.end_date ? format(new Date(mandatoryService.end_date), 'dd-MM-yyyy') : '';

        let days = mandatoryService.quantity || 1;
        if (mandatoryService.start_date && mandatoryService.end_date) {
          const start = new Date(mandatoryService.start_date);
          const end = new Date(mandatoryService.end_date);
          days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
        }

        const rate = mandatoryService.rate_used || mandatoryService.amount || 0;
        const amount = (mandatoryService.start_date && mandatoryService.end_date)
          ? (rate * days)
          : (mandatoryService.amount || (rate * days));

        const dateRange = startDate && endDate ? ` (${startDate} to ${endDate})` : '';
        const itemDescription = `${mandatoryService.service_name}${dateRange}`;

        if (rate > 0) {
          services.push({
            srNo: srNo++,
            item: itemDescription,
            rate: rate,
            qty: days,
            amount: amount,
            type: 'mandatory'
          });
        }
      });
    } else {
    }

    // Add pharmacy charges if toggled on
    if (showPharmacyCharges && pharmacyData?.totalAmount > 0) {
      services.push({
        srNo: srNo++,
        item: 'Pharmacy Charges',
        rate: pharmacyData.totalAmount,
        qty: 1,
        amount: pharmacyData.totalAmount,
        type: 'pharmacy'
      });
    }

    // For package patients with medicine: compulsorily add medicine line
    const isPackagePatient = visitData?.package_amount && Number(visitData.package_amount) > 0
      && visitData?.package_status === 'approved';
    const packageIncludesMedicine = visitData?.package_includes_medicine === true;

    if (isPackagePatient && packageIncludesMedicine && pharmacyData?.totalAmount > 0) {
      // If pharmacy charges weren't already added via toggle, add them compulsorily for package patients
      if (!showPharmacyCharges) {
        services.push({
          srNo: srNo++,
          item: 'Medicine Charges (Included in Package - Amount paid by hospital to third party pharmacy)',
          rate: pharmacyData.totalAmount,
          qty: 1,
          amount: pharmacyData.totalAmount,
          type: 'pharmacy'
        });
      } else {
        // Update the already-added pharmacy line with the note
        const pharmacyLine = services.find(s => s.type === 'pharmacy');
        if (pharmacyLine) {
          pharmacyLine.item = 'Medicine Charges (Included in Package - Amount paid by hospital to third party pharmacy)';
        }
      }
    }

    return services;
  };

  // Calculate actual financial amounts from database
  const calculateActualAmounts = () => {

    const totalBillAmount = billData?.total_amount || 0;

    // Calculate total payments from advance_payment table (primary source)
    let advancePaymentTotal = 0;
    let advancePaymentRefunded = 0;

    if (advancePaymentData && advancePaymentData.length > 0) {
      advancePaymentData.forEach(payment => {
        const amount = parseFloat(payment.advance_amount) || 0;

        if (payment.is_refund) {
          // For refund rows, the actual refund amount is stored in `advance_amount`
          // (`returned_amount` is a cumulative snapshot at save time, not the per-row refund)
          advancePaymentRefunded += amount;
        } else {
          advancePaymentTotal += amount;
        }
      });
    }

    const netAdvancePayment = advancePaymentTotal - advancePaymentRefunded;

    console.log('💵 Advance Payment Data:', advancePaymentData);
    console.log('💵 Advance Payment Total (gross):', advancePaymentTotal);
    console.log('💵 Advance Payment Refunded:', advancePaymentRefunded);
    console.log('💵 Net Advance Payment:', netAdvancePayment);

    // Fallback: Calculate total payments from accounting_transactions (if no advance_payment data)
    const totalPayments = (paymentData || []).reduce((sum, payment) => sum + (payment.amount || 0), 0);
    const totalAdvances = (advanceData || []).reduce((sum, advance) => sum + (advance.amount || 0), 0);
    const accountingTransactionsTotal = totalPayments + totalAdvances;

    console.log('💵 Total Payments (accounting_transactions):', totalPayments);
    console.log('💵 Total Advances (accounting_transactions):', totalAdvances);
    console.log('💵 Total from accounting_transactions:', accountingTransactionsTotal);

    // Use advance_payment data when present. Show GROSS Amount Paid + separate Refund line
    // so the invoice is transparent about money in vs money out.
    const grossAdvancePaid = advancePaymentTotal > 0 ? advancePaymentTotal : accountingTransactionsTotal;
    const refundedAmount = advancePaymentTotal > 0 ? advancePaymentRefunded : 0;

    // Add final payment amount
    const finalPaymentAmount = finalPaymentData?.amount || 0;
    console.log('💵 Final Payment Amount:', finalPaymentAmount);

    // Gross Amount Paid (before refunds)
    const totalAmountPaid = grossAdvancePaid + finalPaymentAmount;
    console.log('💵 FINAL Total Amount Paid (gross, Advance + Final):', totalAmountPaid);

    // Get discount from visit_discounts table (same as Final Bill)
    const discountAmount = discountData || 0;
    console.log('💰 Using discount from visit_discounts table:', discountAmount);

    // Balance = Bill − (gross paid − refunded) − discount = Bill − net paid − discount
    const balance = totalBillAmount - (totalAmountPaid - refundedAmount) - discountAmount;
    console.log('💳 Balance:', balance);

    return {
      total: totalBillAmount,
      amountPaid: totalAmountPaid,
      refunded: refundedAmount,
      discount: discountAmount,
      balance: balance
    };
  };

  const actualAmounts = calculateActualAmounts();

  // Create invoice data from fetched data
  const invoiceData = {
    patientName: patient?.name || 'N/A',
    age: patient?.date_of_birth ? calculateAge(patient.date_of_birth) : (patient?.age ? `${patient.age}Y 0M 0D` : 'N/A'),
    sex: patient?.gender || 'N/A',
    address: patient?.address || 'N/A',
    registrationDate: visitData.admission_date
      ? format(new Date(visitData.admission_date), 'dd/MM/yyyy HH:mm:ss')
      : visitData.visit_date
        ? format(new Date(visitData.visit_date), 'dd/MM/yyyy HH:mm:ss')
        : visitData.created_at
          ? format(new Date(visitData.created_at), 'dd/MM/yyyy HH:mm:ss')
          : 'N/A',
    dischargeDate: visitData.discharge_date ? format(new Date(visitData.discharge_date), 'dd/MM/yyyy HH:mm:ss') : '',
    invoiceNo: billData?.formatted_bill_no || billData?.bill_no || visitData.visit_id || 'N/A',
    registrationNo: patient?.patients_id || visitData.visit_id || 'N/A',
    category: visitData?.patients?.corporate || billData?.category || 'Private',
    primaryConsultant: visitData.referring_doctor
      || visitData.appointment_with
      || visitData.consultant
      || 'N/A',
    hospitalServiceTaxNo: 'ABUPK3997PSD001',
    hospitalPan: 'AAECD9144P',
    services: createServicesFromBillData(),
    total: actualAmounts.total,
    amountPaid: actualAmounts.amountPaid,
    refunded: actualAmounts.refunded,
    discount: actualAmounts.discount,
    balance: actualAmounts.balance,
    amountInWords: convertAmountToWords(actualAmounts.total)
  };

  // Filter services based on hideLabRadiology state
  const getVisibleServices = () => {
    if (hideLabRadiology && chargeFilter === 'all') {
      // Filter out lab and radiology services
      return invoiceData.services.filter(service =>
        service.type !== 'lab' && service.type !== 'radiology'
      );
    }
    return invoiceData.services;
  };

  const visibleServices = getVisibleServices();

  // Calculate dynamic total based on filter selection and visible services
  const calculateVisibleTotal = () => {
    return visibleServices.reduce((total, service) => {
      // Ensure amount is converted to number to avoid string concatenation
      const amount = typeof service.amount === 'string' ? parseFloat(service.amount) || 0 : service.amount || 0;
      return total + amount;
    }, 0);
  };

  const visibleTotal = calculateVisibleTotal();

  const overriddenAmountPaid =
    amountPaidOverrideEvent?.action === 'set' && amountPaidOverrideEvent.display_amount !== null
      ? Number(amountPaidOverrideEvent.display_amount)
      : null;
  const hasAmountPaidOverride =
    overriddenAmountPaid !== null && Number.isFinite(overriddenAmountPaid);
  const displayedAmountPaid = hasAmountPaidOverride
    ? overriddenAmountPaid
    : actualAmounts.amountPaid;

  // Calculate the visible balance from the amount shown on the invoice.
  const currentDiscount = discountRemoved ? 0 : actualAmounts.discount;
  // Balance = visibleTotal − (gross paid − refund) − discount
  const currentBalance = visibleTotal - (displayedAmountPaid - (actualAmounts.refunded || 0)) - currentDiscount;

  const openPaidOverrideEditor = () => {
    setPaidOverrideInput(displayedAmountPaid.toFixed(2));
    setIsEditingPaidOverride(true);
  };

  const savePaidOverride = async () => {
    if (!isCmdUser || !visitId) return;

    const normalizedInput = paidOverrideInput.trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(normalizedInput)) {
      toast.error('Enter a non-negative amount with no more than 2 decimal places.');
      return;
    }

    const displayAmount = Number(normalizedInput);
    if (!Number.isFinite(displayAmount) || displayAmount < 0) {
      toast.error('Enter a valid non-negative amount.');
      return;
    }

    setIsSavingPaidOverride(true);
    try {
      const { error } = await (supabase as any)
        .from('invoice_amount_paid_override_events')
        .insert({
          visit_id: visitId,
          action: 'set',
          display_amount: displayAmount,
          created_by_email: CMD_EMAIL,
        });

      if (error) throw error;

      await queryClient.invalidateQueries({
        queryKey: ['invoice-amount-paid-override', visitId],
      });
      setIsEditingPaidOverride(false);
      toast.success('Displayed Amount Paid updated.');
    } catch (error) {
      console.error('Failed to save Amount Paid override:', error);
      toast.error('Could not save the displayed amount. Confirm the migration has been applied.');
    } finally {
      setIsSavingPaidOverride(false);
    }
  };

  const restoreActualAmountPaid = async () => {
    if (!isCmdUser || !visitId || !hasAmountPaidOverride) return;
    if (!window.confirm('Restore the actual Amount Paid for everyone?')) return;

    setIsSavingPaidOverride(true);
    try {
      const { error } = await (supabase as any)
        .from('invoice_amount_paid_override_events')
        .insert({
          visit_id: visitId,
          action: 'restore',
          display_amount: null,
          created_by_email: CMD_EMAIL,
        });

      if (error) throw error;

      await queryClient.invalidateQueries({
        queryKey: ['invoice-amount-paid-override', visitId],
      });
      setIsEditingPaidOverride(false);
      toast.success('Actual Amount Paid restored.');
    } catch (error) {
      console.error('Failed to restore actual Amount Paid:', error);
      toast.error('Could not restore the actual amount. Confirm the migration has been applied.');
    } finally {
      setIsSavingPaidOverride(false);
    }
  };

  // Print functionality - matches exact screenshot format
  const handlePrint = () => {
    // Create print window
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Failed to open print window. Please check popup blockers.');
      return;
    }

    // Create the exact print document matching the screenshot
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Invoice - ${new Date().toLocaleDateString('en-IN')}</title>
          <meta charset="UTF-8">
          <style>
            body {
              margin: 0;
              padding: 20px;
              font-family: Arial, sans-serif;
              background: white;
              font-size: 12px;
            }

            .print-header {
              text-align: center;
              font-size: 16px;
              font-weight: bold;
              margin-bottom: 30px;
            }

            .invoice-container {
              border: 2px solid #000;
              padding: 15px;
            }

            .patient-info {
              margin-bottom: 20px;
              border: 1px solid #000;
              padding: 10px;
            }

            .patient-info table {
              width: 100%;
              border-collapse: collapse;
            }

            .patient-info td {
              border: none;
              padding: 3px 0;
              font-size: 12px;
              vertical-align: top;
            }

            .patient-info .label {
              width: 20%;
              font-weight: bold;
            }

            .patient-info .colon {
              width: 2%;
            }

            .patient-info .value {
              width: 78%;
            }

            .services-table {
              width: 100%;
              border-collapse: collapse;
              margin: 20px 0;
            }

            .services-table th, .services-table td {
              border: 1px solid #000;
              padding: 6px;
              text-align: center;
              font-size: 11px;
            }

            .services-table th {
              background-color: #f0f0f0;
              font-weight: bold;
            }

            .services-table .item-column {
              text-align: left;
            }

            .amount-section {
              display: flex;
              margin-top: 20px;
            }

            .amount-words {
              flex: 1;
              padding-right: 20px;
              font-size: 11px;
            }

            .amount-table {
              width: 300px;
            }

            .amount-table table {
              width: 100%;
              border-collapse: collapse;
            }

            .amount-table td {
              border: 1px solid #000;
              padding: 6px;
              font-size: 11px;
            }

            .amount-table .label-cell {
              background-color: #f0f0f0;
              font-weight: bold;
              width: 50%;
            }

            .footer-info {
              margin-top: 20px;
              font-size: 11px;
            }

            .hospital-footer {
              text-align: center;
              margin-top: 30px;
            }

            .hospital-name {
              font-size: 16px;
              font-weight: bold;
              margin-bottom: 20px;
            }

            .signatures {
              display: flex;
              justify-content: space-around;
              margin-top: 20px;
            }

            .signature-item {
              text-align: center;
              font-size: 10px;
            }

            .note {
              margin-top: 20px;
              font-size: 10px;
            }

            @page {
              size: A4;
              margin: 0.5in;
            }
          </style>
        </head>
        <body>
          <div class="print-header">${hospitalName}</div>

          <div class="invoice-container">
            <!-- Patient Information -->
            <div class="patient-info">
              <table>
                <tr>
                  <td class="label">Name Of Patient</td>
                  <td class="colon">:</td>
                  <td class="value">${invoiceData.patientName}</td>
                </tr>
                <tr>
                  <td class="label">Age/Sex</td>
                  <td class="colon">:</td>
                  <td class="value">${invoiceData.age}/${invoiceData.sex}</td>
                </tr>
                <tr>
                  <td class="label">Address</td>
                  <td class="colon">:</td>
                  <td class="value">${invoiceData.address}</td>
                </tr>
                <tr>
                  <td class="label">Date Of Registration</td>
                  <td class="colon">:</td>
                  <td class="value">${invoiceData.registrationDate}</td>
                </tr>
                <tr>
                  <td class="label">Date Of Discharge</td>
                  <td class="colon">:</td>
                  <td class="value">${invoiceData.dischargeDate}</td>
                </tr>
                <tr>
                  <td class="label">Invoice No.</td>
                  <td class="colon">:</td>
                  <td class="value">${invoiceData.invoiceNo}</td>
                </tr>
                <tr>
                  <td class="label">Registration No.</td>
                  <td class="colon">:</td>
                  <td class="value">${invoiceData.registrationNo}</td>
                </tr>
                <tr>
                  <td class="label">Category</td>
                  <td class="colon">:</td>
                  <td class="value">${invoiceData.category}</td>
                </tr>
                <tr>
                  <td class="label">Primary Consultant</td>
                  <td class="colon">:</td>
                  <td class="value">${invoiceData.primaryConsultant}</td>
                </tr>
              </table>
            </div>

            <!-- Services Table -->
            <table class="services-table">
              <thead>
                <tr>
                  <th>Sr. No.</th>
                  <th>Item</th>
                  <th>Rate</th>
                  <th>Qty.</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                ${visibleServices.map((service, index) => {
                  return `
                    <tr>
                      <td>${index + 1}</td>
                      <td class="item-column">${service.item}</td>
                      <td>${service.rate}</td>
                      <td>${service.qty}</td>
                      <td>${service.amount}</td>
                    </tr>
                  `;
                }).join('')}
                <tr>
                  <td colspan="4" style="font-weight: bold;">Total</td>
                  <td style="font-weight: bold;">Rs ${visibleTotal.toLocaleString()}.00</td>
                </tr>
              </tbody>
            </table>

            <!-- Amount Section -->
            <div class="amount-section">
              <div class="amount-words">
                <strong>Amount Chargeable (in words)</strong><br>
                ${convertAmountToWords(visibleTotal)}
              </div>

              <div class="amount-table">
                <table>
                  <tr>
                    <td class="label-cell">Amount Paid</td>
                    <td style="text-align: right;">Rs ${formatMoney(displayedAmountPaid)}</td>
                  </tr>
                  ${(invoiceData.refunded || 0) > 0 ? `
                  <tr>
                    <td class="label-cell">Refund Given</td>
                    <td style="text-align: right;">Rs ${invoiceData.refunded.toLocaleString()}.00</td>
                  </tr>` : ''}
                  <tr>
                    <td class="label-cell">Discount Given</td>
                    <td style="text-align: right;">Rs ${currentDiscount.toLocaleString()}.00</td>
                  </tr>
                  <tr>
                    <td class="label-cell">Balance</td>
                    <td style="text-align: right;">Rs ${currentBalance >= 0 ? currentBalance.toLocaleString() : `(${Math.abs(currentBalance).toLocaleString()})`}.00</td>
                  </tr>
                </table>
              </div>
            </div>

            <!-- Footer Information -->
            <div class="footer-info">
              <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
                <span>Hospital Service Tax No. : ${invoiceData.hospitalServiceTaxNo}</span>
                <span>Hospitals PAN : ${invoiceData.hospitalPan}</span>
              </div>
              <div style="margin-bottom: 20px;">
                <strong>Signature of Patient :</strong>
              </div>
            </div>

            <!-- Hospital Footer -->
            <div class="hospital-footer">
              <div class="hospital-name">${hospitalName}</div>
              <div class="signatures">
                <div class="signature-item">Bill Manager</div>
                <div class="signature-item">Cashier</div>
                <div class="signature-item">Med.Supdt.</div>
                <div class="signature-item">Authorised<br>Signatory</div>
              </div>
            </div>

            <!-- Note -->
            <div class="note">
              <strong>NOTE:</strong> ** Indicates that calculated price may vary .Please ask for "Detailled Bill" to see the details.)
            </div>
          </div>
        </body>
      </html>
    `);

    printWindow.document.close();

    // Wait for content to load then print
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 500);
  };

  // Request approval — flips bills.status to PENDING_APPROVAL so admin/superadmin
  // can review it from the /bill-approvals tab. Print stays locked until APPROVED.
  const handleRequestApproval = async () => {
    if (!billData?.id) {
      toast.error('Please save the bill first before requesting approval.');
      return;
    }

    try {
      const raw = localStorage.getItem('hmis_user');
      const currentUser = raw ? JSON.parse(raw) : {};
      const requestedBy = currentUser.email || currentUser.username || 'Unknown';

      const { error } = await supabase
        .from('bills')
        .update({ status: 'PENDING_APPROVAL', created_by: requestedBy } as any)
        .eq('id', billData.id);

      if (error) throw error;

      toast.success('Bill submitted for approval successfully!');
      queryClient.invalidateQueries({ queryKey: ['invoice-bill', visitId] });
      queryClient.invalidateQueries({ queryKey: ['pending-bill-count'] });
    } catch (error) {
      console.error('Error requesting approval:', error);
      toast.error('Failed to submit bill for approval.');
    }
  };

  const billStatus = (billData as any)?.status as string | undefined;
  const isApproved = billStatus === 'APPROVED';
  const isPendingApproval = billStatus === 'PENDING_APPROVAL';

  // Approval is required only for IPD + Private bills.
  // OPD (any payer) and IPD Corporate/Panel bills bypass approval.
  const visitPatientType = (visitData?.patient_type || '').toLowerCase().trim();
  const visitCorporate = (visitData?.patients?.corporate || '').toLowerCase().trim();
  const visitHasCorporate = visitCorporate.length > 0 && visitCorporate !== 'private';
  const isIPDVisit = visitPatientType === 'ipd';
  const needsApproval = isIPDVisit && !visitHasCorporate;

  const printDisabled = !!billData?.id && needsApproval && !isApproved;

  return (
    <div className="min-h-screen bg-white p-4">
      <div className="max-w-4xl mx-auto">
        {/* Print and Close Buttons */}
        <div className="flex justify-between items-center mb-4 no-print">
            <button
              onClick={() => navigate(-1)}
              className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 transition-colors"
            >
              Close
            </button>
            <div className="flex items-center gap-3">
              {billData?.id && !isPendingApproval && !isApproved && needsApproval && (
                <button
                  onClick={handleRequestApproval}
                  className="px-4 py-2 bg-orange-500 text-white rounded hover:bg-orange-600 transition-colors"
                >
                  Request Approval
                </button>
              )}
              {isPendingApproval && needsApproval && (
                <span className="text-orange-600 font-medium px-2">
                  Pending Approval
                </span>
              )}
              {isApproved && (
                <span className="text-green-600 font-medium px-2">
                  Approved
                </span>
              )}
              <button
                onClick={handlePrint}
                disabled={printDisabled}
                title={printDisabled ? 'Print disabled - Awaiting approval' : 'Print'}
                className={`px-4 py-2 text-white rounded transition-colors ${
                  printDisabled
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-blue-500 hover:bg-blue-600'
                }`}
              >
                {printDisabled ? '🔒 Awaiting Approval' : 'Print'}
              </button>
            </div>
          </div>

          {/* Invoice Form */}
          <div className="border border-gray-300 p-4 invoice-content">
          {/* Patient Information Table */}
          <table className="w-full mb-4 text-sm">
            <tbody>
              <tr>
                <td className="py-1 pr-4 font-medium">Name Of Patient</td>
                <td className="py-1">: {invoiceData.patientName}</td>
              </tr>
              <tr>
                <td className="py-1 pr-4 font-medium">Age/Sex</td>
                <td className="py-1">: {invoiceData.age}/{invoiceData.sex}</td>
              </tr>
              <tr>
                <td className="py-1 pr-4 font-medium">Address</td>
                <td className="py-1">: {invoiceData.address}</td>
              </tr>
              <tr>
                <td className="py-1 pr-4 font-medium">Date Of Registration</td>
                <td className="py-1">: {invoiceData.registrationDate}</td>
              </tr>
              <tr>
                <td className="py-1 pr-4 font-medium">Date Of Discharge</td>
                <td className="py-1">: {invoiceData.dischargeDate}</td>
              </tr>
              <tr>
                <td className="py-1 pr-4 font-medium">Invoice No.</td>
                <td className="py-1">: {invoiceData.invoiceNo}</td>
              </tr>
              <tr>
                <td className="py-1 pr-4 font-medium">Registration No.</td>
                <td className="py-1">: {invoiceData.registrationNo}</td>
              </tr>
              <tr>
                <td className="py-1 pr-4 font-medium">Category</td>
                <td className="py-1">: {invoiceData.category}</td>
              </tr>
              <tr>
                <td className="py-1 pr-4 font-medium">Primary Consultant</td>
                <td className="py-1">: {invoiceData.primaryConsultant}</td>
              </tr>
            </tbody>
          </table>

          {/* Control Buttons and Dropdown */}
          <div className="flex justify-center gap-2 mb-4 flex-wrap items-center">
            <button
              onClick={() => setShowPharmacyCharges(!showPharmacyCharges)}
              className={`px-4 py-2 text-white rounded transition-colors text-sm ${
                showPharmacyCharges
                  ? 'bg-green-500 hover:bg-green-600'
                  : 'bg-blue-500 hover:bg-blue-600'
              }`}
            >
              {showPharmacyCharges ? 'Hide Pharmacy Charge' : 'Show Pharmacy Charge'}
            </button>
            <button
              onClick={() => setHideLabRadiology(!hideLabRadiology)}
              className={`px-4 py-2 text-white rounded transition-colors text-sm ${
                hideLabRadiology
                  ? 'bg-green-500 hover:bg-green-600'
                  : 'bg-orange-500 hover:bg-orange-600'
              }`}
            >
              {hideLabRadiology ? 'Show Lab/Radiology' : 'Hide Lab/Radiology'}
            </button>
            <select
              value={chargeFilter}
              onChange={(e) => setChargeFilter(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Charges</option>
              <option value="lab">Lab Charges Only</option>
              <option value="radiology">Radiology Charges Only</option>
            </select>
          </div>

          {/* Services Table */}
          <table className="w-full border border-gray-400 text-sm mb-4">
            <thead>
              <tr>
                <th className="border border-gray-400 p-2 text-center">Sr. No.</th>
                <th className="border border-gray-400 p-2 text-center">Item</th>
                <th className="border border-gray-400 p-2 text-center">Rate</th>
                <th className="border border-gray-400 p-2 text-center">Qty.</th>
                <th className="border border-gray-400 p-2 text-center">Amount</th>
              </tr>
            </thead>
            <tbody>
              {visibleServices.map((service, index) => {
                return (
                  <tr key={service.srNo}>
                    <td className="border border-gray-400 p-2 text-center">{index + 1}</td>
                    <td className="border border-gray-400 p-2">{service.item}</td>
                    <td className="border border-gray-400 p-2 text-center">{service.rate}</td>
                    <td className="border border-gray-400 p-2 text-center">{service.qty}</td>
                    <td className="border border-gray-400 p-2 text-center">{service.amount}</td>
                  </tr>
                );
              })}
              <tr>
                <td className="border border-gray-400 p-2 text-center font-bold" colSpan={4}>Total</td>
                <td className="border border-gray-400 p-2 text-center font-bold">Rs {visibleTotal.toLocaleString()}.00</td>
              </tr>
            </tbody>
          </table>

          {/* Amount Details */}
          <div className="flex">
            <div className="w-1/2 pr-4">
              <div className="text-sm">
                <strong>Amount Chargeable (in words)</strong><br />
                {convertAmountToWords(visibleTotal)}
              </div>
            </div>
            {chargeFilter === 'all' && (
              <div className="w-1/2">
                <table className="w-full text-sm">
                  <tbody>
                    <tr>
                      <td className="border border-gray-400 p-2 bg-gray-100 font-medium">Amount Paid</td>
                      <td className="border border-gray-400 p-2 text-right">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div>Rs {formatMoney(displayedAmountPaid)}</div>
                            {isCmdUser && hasAmountPaidOverride && (
                              <div className="mt-1 text-xs text-gray-500">
                                Actual paid: Rs {formatMoney(actualAmounts.amountPaid)}
                              </div>
                            )}
                          </div>
                          {isCmdUser && (
                            <div className="flex shrink-0 justify-end gap-1 no-print">
                              <button
                                type="button"
                                onClick={openPaidOverrideEditor}
                                disabled={isSavingPaidOverride}
                                className="rounded bg-amber-500 px-2 py-1 text-xs text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {hasAmountPaidOverride ? 'Edit' : 'Hide / Replace'}
                              </button>
                              {hasAmountPaidOverride && (
                                <button
                                  type="button"
                                  onClick={restoreActualAmountPaid}
                                  disabled={isSavingPaidOverride}
                                  className="rounded bg-gray-600 px-2 py-1 text-xs text-white transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  Restore
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                    {isCmdUser && isEditingPaidOverride && (
                      <tr className="no-print">
                        <td className="border border-gray-400 p-2 bg-amber-50 font-medium">
                          Replacement Amount
                        </td>
                        <td className="border border-gray-400 p-2">
                          <div className="flex items-center gap-2">
                            <span className="text-gray-600">Rs</span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              inputMode="decimal"
                              value={paidOverrideInput}
                              onChange={(event) => setPaidOverrideInput(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault();
                                  void savePaidOverride();
                                }
                              }}
                              className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-right focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                              autoFocus
                            />
                            <button
                              type="button"
                              onClick={() => void savePaidOverride()}
                              disabled={isSavingPaidOverride}
                              className="rounded bg-green-600 px-2 py-1 text-xs text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {isSavingPaidOverride ? 'Saving…' : 'Save'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setIsEditingPaidOverride(false)}
                              disabled={isSavingPaidOverride}
                              className="rounded bg-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-300 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              Cancel
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                    {(invoiceData.refunded || 0) > 0 && (
                      <tr>
                        <td className="border border-gray-400 p-2 bg-gray-100 font-medium">Refund Given</td>
                        <td className="border border-gray-400 p-2 text-right">Rs {invoiceData.refunded.toLocaleString()}.00</td>
                      </tr>
                    )}
                    <tr>
                      <td className="border border-gray-400 p-2 bg-gray-100 font-medium">Discount Given</td>
                      <td className="border border-gray-400 p-2 text-right">Rs {currentDiscount.toLocaleString()}.00</td>
                    </tr>
                    <tr>
                      <td className="border border-gray-400 p-2 bg-gray-100 font-medium">Balance</td>
                      <td className="border border-gray-400 p-2 text-right">Rs {currentBalance >= 0 ? currentBalance.toLocaleString() : `(${Math.abs(currentBalance).toLocaleString()})`}.00</td>
                    </tr>
                  </tbody>
                </table>

                {/* Remove Discount Button */}
                <div className="mt-2">
                  <button
                    onClick={() => setDiscountRemoved(!discountRemoved)}
                    className={`px-3 py-1 text-white rounded text-xs transition-colors ${
                      discountRemoved
                        ? 'bg-green-500 hover:bg-green-600'
                        : 'bg-red-500 hover:bg-red-600'
                    }`}
                  >
                    {discountRemoved ? 'Add Discount' : 'Remove Discount'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Footer Information */}
          <div className="mt-6 text-sm">
            <div className="flex justify-between mb-2">
              <span>Hospital Service Tax No. : {invoiceData.hospitalServiceTaxNo}</span>
              <span>Hospitals PAN : {invoiceData.hospitalPan}</span>
            </div>
            <div className="mb-4">
              <strong>Signature of Patient :</strong>
            </div>

            {/* Hospital Name and Signatures */}
            <div className="text-center border-t border-gray-300 pt-4">
              <h2 className="text-lg font-bold mb-4">{hospitalName}</h2>
              <div className="flex justify-between text-center">
                <div>
                  <div className="mb-2">Bill Manager</div>
                </div>
                <div>
                  <div className="mb-2">Cashier</div>
                </div>
                <div>
                  <div className="mb-2">Med.Supdt.</div>
                </div>
                <div>
                  <div className="mb-2">Authorised<br />Signatory</div>
                </div>
              </div>
            </div>

            {/* Note */}
            <div className="mt-4 text-xs">
              <strong>NOTE:</strong> ** Indicates that calculated price may vary .Please ask for "Detailled Bill" to see the details.)
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Invoice;
