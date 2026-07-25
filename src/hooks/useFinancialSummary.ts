import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface FinancialSummaryData {
  // Total Amount Row
  totalAmount: {
    advancePayment: string;
    clinicalServices: string;
    laboratoryServices: string;
    radiology: string;
    pharmacy: string;
    implant: string;
    blood: string;
    surgery: string;
    mandatoryServices: string;
    physiotherapy: string;
    consultation: string;
    surgeryInternalReport: string;
    implantCost: string;
    private: string;
    accommodationCharges: string;
    total: string;
  };
  // Discount Row
  discount: {
    advancePayment: string;
    clinicalServices: string;
    laboratoryServices: string;
    radiology: string;
    pharmacy: string;
    implant: string;
    blood: string;
    surgery: string;
    mandatoryServices: string;
    physiotherapy: string;
    consultation: string;
    surgeryInternalReport: string;
    implantCost: string;
    private: string;
    accommodationCharges: string;
    total: string;
  };
  // Amount Paid Row
  amountPaid: {
    advancePayment: string;
    clinicalServices: string;
    laboratoryServices: string;
    radiology: string;
    pharmacy: string;
    implant: string;
    blood: string;
    surgery: string;
    mandatoryServices: string;
    physiotherapy: string;
    consultation: string;
    surgeryInternalReport: string;
    implantCost: string;
    private: string;
    accommodationCharges: string;
    total: string;
  };
  // Refunded Amount Row
  refundedAmount: {
    advancePayment: string;
    clinicalServices: string;
    laboratoryServices: string;
    radiology: string;
    pharmacy: string;
    implant: string;
    blood: string;
    surgery: string;
    mandatoryServices: string;
    physiotherapy: string;
    consultation: string;
    surgeryInternalReport: string;
    implantCost: string;
    private: string;
    accommodationCharges: string;
    total: string;
  };
  // Balance Row
  balance: {
    advancePayment: string;
    clinicalServices: string;
    laboratoryServices: string;
    radiology: string;
    pharmacy: string;
    implant: string;
    blood: string;
    surgery: string;
    mandatoryServices: string;
    physiotherapy: string;
    consultation: string;
    surgeryInternalReport: string;
    implantCost: string;
    private: string;
    accommodationCharges: string;
    total: string;
  };
  // Final Payment Row
  finalPayment: {
    advancePayment: string;
    clinicalServices: string;
    laboratoryServices: string;
    radiology: string;
    pharmacy: string;
    implant: string;
    blood: string;
    surgery: string;
    mandatoryServices: string;
    physiotherapy: string;
    consultation: string;
    surgeryInternalReport: string;
    implantCost: string;
    private: string;
    accommodationCharges: string;
    total: string;
  };
}

export interface PackageDates {
  start_date: string;
  end_date: string;
  total_package_days: number;
  total_admission_days: number;
}


// Emergency localStorage backup utilities
const getEmergencyBackupKey = (billId: string) => `emergency_discount_backup_${billId}`;

const saveEmergencyBackup = (billId: string, discountData: FinancialSummaryData['discount']) => {
  if (!billId) return;
  try {
    const backup = {
      discountData,
      timestamp: new Date().toISOString(),
      billId,
      version: 'emergency_v1'
    };
    localStorage.setItem(getEmergencyBackupKey(billId), JSON.stringify(backup));
    console.log('🚨 [EMERGENCY BACKUP] Discount data saved to localStorage:', { billId, timestamp: backup.timestamp });
  } catch (error) {
    console.error('❌ [EMERGENCY BACKUP] Failed to save:', error);
  }
};

const loadEmergencyBackup = (billId: string): FinancialSummaryData['discount'] | null => {
  if (!billId) return null;
  try {
    const backup = localStorage.getItem(getEmergencyBackupKey(billId));
    if (!backup) return null;

    const parsed = JSON.parse(backup);
    console.log('🚨 [EMERGENCY BACKUP] Loaded from localStorage:', { billId, timestamp: parsed.timestamp });
    return parsed.discountData;
  } catch (error) {
    console.error('❌ [EMERGENCY BACKUP] Failed to load:', error);
    return null;
  }
};

export const useFinancialSummary = (billId?: string, visitId?: string, savedMedicationData?: any[]) => {
  // 🔥 CRITICAL: Track hook initialization and potential re-initialization
  const initId = useRef(Math.random().toString(36).substr(2, 9));
  const initCount = useRef(0);
  initCount.current += 1;

  console.log('🚀 [HOOK INIT] useFinancialSummary:', {
    billId: billId,
    initCount: initCount.current,
    isReInitialization: initCount.current > 1,
    visitId: visitId
  });

  // Display-only Amount Paid override shared with /invoice/:visitId.
  // The underlying financial summary and payment records remain unchanged.
  const { data: amountPaidOverrideEvent } = useQuery<{
    action: 'set' | 'restore';
    display_amount: number | string | null;
  } | null>({
    queryKey: ['invoice-amount-paid-override', visitId],
    queryFn: async () => {
      if (!visitId) return null;

      const { data, error } = await (supabase as any)
        .from('invoice_amount_paid_override_events')
        .select('action, display_amount')
        .eq('visit_id', visitId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.warn('Amount Paid display override is unavailable:', error);
        return null;
      }

      return data;
    },
    enabled: !!visitId,
    retry: false,
  });


  // 🔥 CRITICAL: Track initial state creation
  const initialState = {
    totalAmount: {
      advancePayment: '0',
      clinicalServices: '0',
      laboratoryServices: '0',
      radiology: '0',
      pharmacy: '0',
      implant: '0',
      blood: '0',
      surgery: '0',
      mandatoryServices: '0',
      physiotherapy: '0',
      consultation: '0',
      surgeryInternalReport: '0',
      implantCost: '0',
      private: '0',
      accommodationCharges: '0',
      total: '0'
    },
    discount: {
      advancePayment: '',
      clinicalServices: '',
      laboratoryServices: '',
      radiology: '',
      pharmacy: '',
      implant: '',
      blood: '',
      surgery: '',
      mandatoryServices: '',
      physiotherapy: '',
      consultation: '',
      surgeryInternalReport: '',
      implantCost: '',
      private: '',
      accommodationCharges: '',
      total: ''
    },
    amountPaid: {
      advancePayment: '',
      clinicalServices: '',
      laboratoryServices: '',
      radiology: '',
      pharmacy: '',
      implant: '',
      blood: '',
      surgery: '',
      mandatoryServices: '',
      physiotherapy: '',
      consultation: '',
      surgeryInternalReport: '',
      implantCost: '',
      private: '',
      accommodationCharges: '',
      total: ''
    },
    refundedAmount: {
      advancePayment: '',
      clinicalServices: '',
      laboratoryServices: '',
      radiology: '',
      pharmacy: '',
      implant: '',
      blood: '',
      surgery: '',
      mandatoryServices: '',
      physiotherapy: '',
      consultation: '',
      surgeryInternalReport: '',
      implantCost: '',
      private: '',
      accommodationCharges: '',
      total: ''
    },
    balance: {
      advancePayment: '',
      clinicalServices: '',
      laboratoryServices: '',
      radiology: '',
      pharmacy: '',
      implant: '',
      blood: '',
      surgery: '',
      mandatoryServices: '',
      physiotherapy: '',
      consultation: '',
      surgeryInternalReport: '',
      implantCost: '',
      private: '',
      accommodationCharges: '',
      total: ''
    },
    finalPayment: {
      advancePayment: '0',
      clinicalServices: '0',
      laboratoryServices: '0',
      radiology: '0',
      pharmacy: '0',
      implant: '0',
      blood: '0',
      surgery: '0',
      mandatoryServices: '0',
      physiotherapy: '0',
      consultation: '0',
      surgeryInternalReport: '0',
      implantCost: '0',
      private: '0',
      accommodationCharges: '0',
      total: '0'
    }
  };

  console.log('🏁 [STATE INIT] Creating initial financial summary state:', {
    initId: initId.current,
    hasEmptyDiscounts: true,
    initialDiscountState: initialState.discount,
    timestamp: new Date().toISOString()
  });

  const [financialSummaryData, setFinancialSummaryData] = useState<FinancialSummaryData>(initialState);

  // 🔥 CRITICAL: Create wrapper to track ALL state changes
  const originalSetFinancialSummaryData = setFinancialSummaryData;
  const trackedSetFinancialSummaryData = useCallback((newState: any) => {
    const isFunction = typeof newState === 'function';

    console.log('🎯 [STATE CHANGE] setFinancialSummaryData called:', {
      initId: initId.current,
      callType: isFunction ? 'function' : 'direct',
      timestamp: new Date().toISOString(),
      stackTrace: new Error('State change').stack?.split('\n').slice(0, 5).join('\n'),
      currentDiscountValues: financialSummaryData.discount,
    });

    if (isFunction) {
      const result = originalSetFinancialSummaryData((prev: FinancialSummaryData) => {
        const newValue = newState(prev);
        console.log('🔄 [STATE FUNCTION] State update function executed:', {
          initId: initId.current,
          prevDiscountValues: prev.discount,
          newDiscountValues: newValue.discount,
          discountValuesChanged: JSON.stringify(prev.discount) !== JSON.stringify(newValue.discount),
          discountResetToEmpty: Object.values(newValue.discount).every(val => val === ''),
          timestamp: new Date().toISOString()
        });
        return newValue;
      });
      return result;
    } else {
      console.log('📝 [STATE DIRECT] Direct state update:', {
        initId: initId.current,
        newDiscountValues: newState.discount,
        discountResetToEmpty: Object.values(newState.discount).every(val => val === ''),
        timestamp: new Date().toISOString()
      });
      return originalSetFinancialSummaryData(newState);
    }
  }, [financialSummaryData.discount, initId]);

  // Replace the original setter with our tracked version
  const setFinancialSummaryDataTracked = trackedSetFinancialSummaryData;

  const [packageDates, setPackageDates] = useState<PackageDates>({
    start_date: '',
    end_date: '',
    total_package_days: 7,
    total_admission_days: 0
  });

  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [shouldAutoPopulateAfterLoad, setShouldAutoPopulateAfterLoad] = useState(false);
  const [hasLoadedFromDatabase, setHasLoadedFromDatabase] = useState(false);
  const [lastSaveTime, setLastSaveTime] = useState<Date | null>(null);
  const [isAutoSaving, setIsAutoSaving] = useState(false);
  const [userHasModifiedDiscounts, setUserHasModifiedDiscounts] = useState(false);
  const [isStateLocked, setIsStateLocked] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);

  // Refs for debouncing and cleanup
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastDiscountDataRef = useRef<string>('');
  const initialDiscountLoadRef = useRef<boolean>(false);
  const emergencyBackupRef = useRef<string>('');


  // Auto-calculation functions for fetching real data
  const fetchLabTestsTotal = async (): Promise<number> => {
    if (!visitId) {
      console.log('🚫 No visitId provided for lab tests total');
      return 0;
    }

    console.log('🔍 Fetching lab tests total for visit:', visitId);

    try {
      // Get visit UUID first
      const { data: visitData, error: visitError } = await supabase
        .from('visits')
        .select('id, visit_id')
        .eq('visit_id', visitId)
        .single();

      console.log('📋 Visit lookup result:', { visitData, visitError });

      if (visitError || !visitData) {
        console.error('❌ Failed to find visit for lab tests:', visitError);
        return 0;
      }


      // Get visit_labs data using the UUID
      const { data: visitLabsData, error: visitLabsError } = await supabase
        .from('visit_labs')
        .select('*')
        .eq('visit_id', visitData.id);

      console.log('📊 Visit labs query result:', { 
        visitLabsData, 
        visitLabsError, 
        count: visitLabsData?.length || 0 
      });

      if (visitLabsError) {
        console.error('❌ Visit labs query error:', visitLabsError);
        return 0;
      }

      if (!visitLabsData || visitLabsData.length === 0) {
        console.log('📝 No visit labs data found');
        return 0;
      }

      // Get lab details for cost information
      const labIds = visitLabsData.map((item: any) => item.lab_id);
      console.log('🔍 Fetching lab details for IDs:', labIds);

      const { data: labsData, error: labsError } = await supabase
        .from('lab')
        .select('id, name, private')
        .in('id', labIds);

      console.log('📊 Labs details query result:', { 
        labsData, 
        labsError, 
        count: labsData?.length || 0 
      });

      if (labsError) {
        console.error('❌ Labs details query error:', labsError);
        return 0;
      }

      if (!labsData || labsData.length === 0) {
        console.log('📝 No lab details found for cost calculation');
        return 0;
      }

      // Calculate total using quantity and cost columns (updated after migration)
      let total = 0;
      visitLabsData.forEach((visitLab: any, index) => {
        const labDetail = labsData.find((l: any) => l.id === visitLab.lab_id);

        // Use cost column if available, otherwise use quantity × private rate
        let itemTotal = 0;
        if (visitLab.cost && visitLab.cost > 0) {
          // Migration complete: use cost column directly
          itemTotal = parseFloat(visitLab.cost) || 0;
        } else {
          // Fallback: calculate from quantity × private rate
          const quantity = visitLab.quantity || 1;
          const unitRate = (labDetail?.private && labDetail.private > 0) ? labDetail.private : 0;
          itemTotal = quantity * unitRate;
        }

        total += itemTotal;

        console.log(`💰 Lab ${index + 1}:`, {
          labName: labDetail?.name || 'Unknown',
          labId: visitLab.lab_id,
          quantity: visitLab.quantity || 1,
          unitRate: labDetail?.private || 0,
          costColumn: visitLab.cost,
          itemTotal: itemTotal,
          usingCostColumn: !!(visitLab.cost && visitLab.cost > 0)
        });
      });

      return total;
    } catch (error) {
      console.error('❌ Error fetching lab tests total:', error);
      return 0;
    }
  };

  const fetchClinicalServicesTotal = async (): Promise<number> => {
    if (!visitId) return 0;

    try {
      // Get visit UUID first
      const { data: visitData, error: visitError } = await supabase
        .from('visits')
        .select('id')
        .eq('visit_id', visitId)
        .single();

      if (visitError || !visitData) return 0;

      // Fetch clinical services from junction table
      const { data: clinicalData, error: clinicalError } = await supabase
        .from('visit_clinical_services')
        .select('amount')
        .eq('visit_id', visitData.id);

      if (clinicalError || !clinicalData) return 0;

      // Calculate total
      const total = clinicalData.reduce((sum, service) => sum + (parseFloat(service.amount) || 0), 0);
      console.log('💰 Clinical services total calculated:', total);
      return total;
    } catch (error) {
      console.error('Error fetching clinical services total:', error);
      return 0;
    }
  };

  const fetchMandatoryServicesTotal = async (): Promise<number> => {
    if (!visitId) return 0;

    try {
      // Get visit UUID first
      const { data: visitData, error: visitError } = await supabase
        .from('visits')
        .select('id')
        .eq('visit_id', visitId)
        .single();

      if (visitError || !visitData) return 0;

      // Fetch mandatory services from junction table
      const { data: mandatoryData, error: mandatoryError } = await supabase
        .from('visit_mandatory_services')
        .select('amount')
        .eq('visit_id', visitData.id);

      if (mandatoryError || !mandatoryData) return 0;

      // Calculate total
      const total = mandatoryData.reduce((sum, service) => sum + (parseFloat(service.amount) || 0), 0);
      console.log('💰 Mandatory services total calculated:', total);
      return total;
    } catch (error) {
      console.error('Error fetching mandatory services total:', error);
      return 0;
    }
  };

  const fetchSurgeryTotal = async (): Promise<number> => {
    if (!visitId) return 0;

    try {
      // Get visit UUID first
      const { data: visitData, error: visitError } = await supabase
        .from('visits')
        .select('id')
        .eq('visit_id', visitId)
        .single();

      if (visitError || !visitData) return 0;

      // Fetch surgeries from visit_surgeries junction table with stored rate and fallback to cghs_surgery rate
      const { data: surgeryData, error: surgeryError } = await supabase
        .from('visit_surgeries')
        .select(`
          surgery_id,
          rate,
          cghs_surgery:surgery_id (
            NABH_NABL_Rate
          )
        `)
        .eq('visit_id', visitData.id);

      if (surgeryError || !surgeryData) return 0;

      // Calculate total - use stored rate first, fallback to NABH_NABL_Rate
      const total = surgeryData.reduce((sum, item: any) => {
        // Use stored rate from visit_surgeries if available
        if (item.rate && item.rate > 0) {
          return sum + Number(item.rate);
        }
        // Fallback to cghs_surgery.NABH_NABL_Rate
        const rateStr = item.cghs_surgery?.NABH_NABL_Rate || '0';
        const rate = parseFloat(rateStr.toString().replace(/[^\d.]/g, '')) || 0;
        return sum + rate;
      }, 0);

      console.log('💰 Surgery total calculated:', total);
      return total;
    } catch (error) {
      console.error('Error fetching surgery total:', error);
      return 0;
    }
  };

const fetchAnesthetistTotal = async (): Promise<number> => {
    if (!visitId) return 0;

    try {
      // Get visit UUID first
      const { data: visitData, error: visitError } = await supabase
        .from('visits')
        .select('id')
        .eq('visit_id', visitId)
        .single();

      if (visitError || !visitData) return 0;

      // Fetch anesthetists from visit_anesthetists table
      const { data: anesthetistData, error: anesthetistError } = await supabase
        .from('visit_anesthetists')
        .select('rate')
        .eq('visit_id', visitData.id);

      if (anesthetistError || !anesthetistData) return 0;

      // Calculate total
      const total = anesthetistData.reduce((sum, item: any) => {
        return sum + (parseFloat(item.rate) || 0);
      }, 0);

      console.log('💉 Anesthetist total calculated:', total);
      return total;
    } catch (error) {
      console.error('Error fetching anesthetist total:', error);
      return 0;
    }
  };

  // Fetch implant total from visit_implants table
  const fetchImplantTotal = async (): Promise<number> => {
    if (!visitId) return 0;

    try {
      console.log('🔧 Fetching implant total for visit:', visitId);

      // Get visit UUID first
      const { data: visitData, error: visitError } = await supabase
        .from('visits')
        .select('id')
        .eq('visit_id', visitId)
        .single();

      if (visitError || !visitData) {
        return 0;
      }

      // Fetch implants from visit_implants table
      const { data: implantData, error: implantError } = await supabase
        .from('visit_implants' as any)
        .select('amount, quantity, rate, status')
        .eq('visit_id', visitData.id)
        .eq('status', 'Active');

      if (implantError) {
        console.error('❌ Error fetching implants:', implantError);
        return 0;
      }

      if (!implantData || implantData.length === 0) {
        console.log('📝 No implants found for this visit');
        return 0;
      }

      // Calculate total from amount column
      const total = implantData.reduce((sum: number, item: any) => {
        return sum + (parseFloat(item.amount) || 0);
      }, 0);

      console.log('💰 Implant total calculated:', total, 'from', implantData.length, 'implants');
      return total;
    } catch (error) {
      console.error('Error fetching implant total:', error);
      return 0;
    }
  };

  const fetchRadiologyTotal = async (): Promise<number> => {
    if (!visitId) return 0;

    try {
      // Get visit UUID first
      const { data: visitData, error: visitError } = await supabase
        .from('visits')
        .select('id')
        .eq('visit_id', visitId)
        .single();

      if (visitError || !visitData) return 0;

      // Get visit_radiology data using the UUID
      const { data: visitRadiologyData, error: visitRadiologyError } = await supabase
        .from('visit_radiology')
        .select('*')
        .eq('visit_id', visitData.id);

      if (visitRadiologyError || !visitRadiologyData || visitRadiologyData.length === 0) {
        console.log('📝 No radiology data found for visit');
        return 0;
      }

      // Calculate total using quantity-based calculation from visit_radiology
      let total = 0;
      visitRadiologyData.forEach((visitRadiology: any) => {
        // Parse values to numbers first before comparison
        const quantity = parseInt(visitRadiology.quantity) || 1;
        const unitRate = parseFloat(visitRadiology.unit_rate) || 0;
        const totalCost = parseFloat(visitRadiology.cost) || 0;

        // If we have proper quantity data, use the stored total cost
        if (totalCost > 0) {
          total += totalCost;
        } else if (unitRate > 0) {
          // Fallback: calculate from unit_rate * quantity
          total += unitRate * quantity;
        }
        // If both cost and unit_rate are missing/0, the test contributes 0 to the total
      });
      
      console.log('💰 Radiology total calculated:', total);
      return total;
    } catch (error) {
      console.error('Error fetching radiology total:', error);
      return 0;
    }
  };

  const fetchPharmacyTotal = async (): Promise<number> => {
    if (!visitId) {
      console.log('🚫 No visitId provided for pharmacy total');
      return 0;
    }

    console.log('🔍 Fetching pharmacy total from pharmacy_sales for visit:', visitId);

    try {
      // Query pharmacy_sales for CREDIT sales linked to this visit
      const { data: salesData, error: salesError } = await (supabase as any)
        .from('pharmacy_sales')
        .select('sale_id, total_amount, payment_method')
        .eq('visit_id', visitId)
        .eq('payment_method', 'CREDIT');

      if (salesError) {
        console.error('Error fetching pharmacy sales:', salesError);
        return 0;
      }

      const totalCreditSales = (salesData || []).reduce((sum: number, sale: any) => sum + (sale.total_amount || 0), 0);
      const visitSaleIds = (salesData || []).map((sale: any) => sale.sale_id);

      // Subtract returns for these sales
      let totalReturns = 0;
      if (visitSaleIds.length > 0) {
        const { data: returnsData } = await (supabase as any)
          .from('medicine_returns')
          .select('net_refund')
          .in('original_sale_id', visitSaleIds);

        totalReturns = (returnsData || []).reduce((sum: number, ret: any) => sum + (ret.net_refund || 0), 0);
      }

      const netPharmacy = totalCreditSales - totalReturns;
      console.log('💰 Pharmacy total:', netPharmacy, '(sales:', totalCreditSales, '- returns:', totalReturns, ')');
      return netPharmacy > 0 ? netPharmacy : 0;
    } catch (error) {
      console.error('Error fetching pharmacy total:', error);
      return 0;
    }
  };

  const fetchAdvancePaymentTotal = async (): Promise<number> => {
    if (!visitId) {
      console.log('🚫 No visitId provided for advance payment total');
      return 0;
    }

    console.log('🔍 Fetching advance payment total for visit:', visitId);

    try {
      // Query advance_payment table directly using visit_id (no need for UUID conversion)
      const { data: advancePaymentData, error: advancePaymentError } = await supabase
        .from('advance_payment')
        .select('advance_amount, status')
        .eq('visit_id', visitId)
        .eq('status', 'ACTIVE') // Only include active payments
        .eq('is_refund', false); // Only advance payments, NOT refunds

      console.log('📊 Advance payment query result:', { 
        advancePaymentData, 
        advancePaymentError, 
        count: advancePaymentData?.length || 0 
      });

      if (advancePaymentError) {
        console.error('❌ Advance payment query error:', advancePaymentError);
        return 0;
      }

      if (!advancePaymentData || advancePaymentData.length === 0) {
        console.log('📝 No advance payment data found for visit');
        return 0;
      }

      // Calculate total advance payment
      const total = advancePaymentData.reduce((sum, payment) => {
        const amount = parseFloat(payment.advance_amount?.toString() || '0') || 0;
        return sum + amount;
      }, 0);

      return total;
    } catch (error) {
      console.error('❌ Error fetching advance payment total:', error);
      return 0;
    }
  };

  const fetchRefundedAmount = async (): Promise<number> => {
    if (!visitId) {
      console.log('🚫 No visitId provided for refunded amount');
      return 0;
    }

    console.log('🔍 Fetching refunded amount for visit:', visitId);

    try {
      const { data: refundData, error: refundError } = await supabase
        .from('advance_payment')
        .select('advance_amount, status')
        .eq('visit_id', visitId)
        .eq('status', 'ACTIVE')
        .eq('is_refund', true); // Only refunds, NOT advance payments

      console.log('📊 Refund query result:', {
        refundData,
        refundError,
        count: refundData?.length || 0
      });

      if (refundError) {
        console.error('❌ Refund query error:', refundError);
        return 0;
      }

      if (!refundData || refundData.length === 0) {
        console.log('📝 No refund data found for visit');
        return 0;
      }

      // Calculate total refunded amount
      const total = refundData.reduce((sum, payment) => {
        const amount = parseFloat(payment.advance_amount?.toString() || '0') || 0;
        return sum + amount;
      }, 0);

      return total;
    } catch (error) {
      console.error('❌ Error fetching refunded amount:', error);
      return 0;
    }
  };

  const fetchAccommodationTotal = async (): Promise<number> => {
    if (!visitId) return 0;

    try {
      // Get visit UUID first
      const { data: visitData, error: visitError } = await supabase
        .from('visits')
        .select('id')
        .eq('visit_id', visitId)
        .single();

      if (visitError || !visitData) return 0;

      // Fetch accommodation charges from junction table
      const { data: accommodationData, error: accommodationError } = await supabase
        .from('visit_accommodations')
        .select('amount')
        .eq('visit_id', visitData.id);

      if (accommodationError || !accommodationData) return 0;

      // Calculate total
      const total = accommodationData.reduce((sum, accommodation) => sum + (parseFloat(accommodation.amount) || 0), 0);
      console.log('💰 Accommodation charges total calculated:', total);
      return total;
    } catch (error) {
      console.error('Error fetching accommodation total:', error);
      return 0;
    }
  };

  // Load financial summary data from database
  const loadFinancialSummary = async () => {
    const loadSessionId = Math.random().toString(36).substr(2, 9);

    if (!billId) {
      setIsInitializing(false);
      return;
    }

    console.log('🔄 [FINANCIAL SUMMARY] Loading financial summary with:', {
      billId: billId,
      billIdType: typeof billId,
      billIdLength: billId?.length,
      billIdTrimmed: billId?.trim(),
      loadSessionId: loadSessionId,
      timestamp: new Date().toISOString(),
      isStateLocked: isStateLocked
    });

    // Lock state during critical load operation
    setIsStateLocked(true);
    console.log('🔒 [STATE LOCK] State locked during database load');

    setIsLoading(true);
    try {
      console.log('🔍 [DATABASE DEBUG] Querying financial_summary for billId:', billId);
      const { data, error } = await supabase
        .from('financial_summary')
        .select('*')
        .eq('bill_id', billId)
        .maybeSingle();

      console.log('📋 [DATABASE DEBUG] Raw query result:', {
        data: data,
        error: error,
        errorCode: error?.code,
        errorMessage: error?.message,
        foundRecord: !!data
      });

      if (error && error.code !== 'PGRST116') { // PGRST116 is "not found"
        console.error('❌ [FINANCIAL SUMMARY] Error loading financial summary:', error);
        toast.error('Failed to load financial summary data');
        return;
      }

      if (data) {
        console.log('✅ [FINANCIAL SUMMARY] Found saved data, loading discount values...', {
          recordId: data.id,
          lastUpdated: data.updated_at,
          rawDiscountData: {
            discount_laboratory_services: data.discount_laboratory_services,
            discount_radiology: data.discount_radiology,
            discount_pharmacy: data.discount_pharmacy,
            discount_clinical_services: data.discount_clinical_services,
            discount_total: data.discount_total
          },
          rawDiscountTypes: {
            discount_laboratory_services_type: typeof data.discount_laboratory_services,
            discount_radiology_type: typeof data.discount_radiology,
            discount_pharmacy_type: typeof data.discount_pharmacy,
            discount_clinical_services_type: typeof data.discount_clinical_services,
            discount_total_type: typeof data.discount_total
          },
          convertedDiscountStrings: {
            laboratory: (data.discount_laboratory_services && data.discount_laboratory_services !== 0) ? data.discount_laboratory_services.toString() : '',
            radiology: (data.discount_radiology && data.discount_radiology !== 0) ? data.discount_radiology.toString() : '',
            pharmacy: (data.discount_pharmacy && data.discount_pharmacy !== 0) ? data.discount_pharmacy.toString() : '',
            clinical: (data.discount_clinical_services && data.discount_clinical_services !== 0) ? data.discount_clinical_services.toString() : '',
            total: (data.discount_total && data.discount_total !== 0) ? data.discount_total.toString() : ''
          }
        });
        // Convert database format to component format
        const convertedData: FinancialSummaryData = {
          totalAmount: {
            advancePayment: data.total_amount_advance_payment?.toString() || '',
            clinicalServices: data.total_amount_clinical_services?.toString() || '',
            laboratoryServices: data.total_amount_laboratory_services?.toString() || '',
            radiology: data.total_amount_radiology?.toString() || '',
            pharmacy: data.total_amount_pharmacy?.toString() || '',
            implant: data.total_amount_implant?.toString() || '',
            blood: data.total_amount_blood?.toString() || '',
            surgery: data.total_amount_surgery?.toString() || '',
            mandatoryServices: data.total_amount_mandatory_services?.toString() || '',
            physiotherapy: data.total_amount_physiotherapy?.toString() || '',
            consultation: data.total_amount_consultation?.toString() || '',
            surgeryInternalReport: data.total_amount_surgery_internal_report?.toString() || '',
            implantCost: data.total_amount_implant_cost?.toString() || '',
            private: data.total_amount_private?.toString() || '',
            accommodationCharges: data.total_amount_accommodation_charges?.toString() || '',
            total: data.total_amount_total?.toString() || ''
          },
          discount: {
            advancePayment: (data.discount_advance_payment !== null && data.discount_advance_payment !== 0) ? data.discount_advance_payment.toString() : '',
            clinicalServices: (data.discount_clinical_services !== null && data.discount_clinical_services !== 0) ? data.discount_clinical_services.toString() : '',
            laboratoryServices: (data.discount_laboratory_services !== null && data.discount_laboratory_services !== 0) ? data.discount_laboratory_services.toString() : '',
            radiology: (data.discount_radiology !== null && data.discount_radiology !== 0) ? data.discount_radiology.toString() : '',
            pharmacy: (data.discount_pharmacy !== null && data.discount_pharmacy !== 0) ? data.discount_pharmacy.toString() : '',
            implant: (data.discount_implant !== null && data.discount_implant !== 0) ? data.discount_implant.toString() : '',
            blood: (data.discount_blood !== null && data.discount_blood !== 0) ? data.discount_blood.toString() : '',
            surgery: (data.discount_surgery !== null && data.discount_surgery !== 0) ? data.discount_surgery.toString() : '',
            mandatoryServices: (data.discount_mandatory_services !== null && data.discount_mandatory_services !== 0) ? data.discount_mandatory_services.toString() : '',
            physiotherapy: (data.discount_physiotherapy !== null && data.discount_physiotherapy !== 0) ? data.discount_physiotherapy.toString() : '',
            consultation: (data.discount_consultation !== null && data.discount_consultation !== 0) ? data.discount_consultation.toString() : '',
            surgeryInternalReport: (data.discount_surgery_internal_report !== null && data.discount_surgery_internal_report !== 0) ? data.discount_surgery_internal_report.toString() : '',
            implantCost: (data.discount_implant_cost !== null && data.discount_implant_cost !== 0) ? data.discount_implant_cost.toString() : '',
            private: (data.discount_private !== null && data.discount_private !== 0) ? data.discount_private.toString() : '',
            accommodationCharges: (data.discount_accommodation_charges !== null && data.discount_accommodation_charges !== 0) ? data.discount_accommodation_charges.toString() : '',
            total: (data.discount_total !== null && data.discount_total !== 0) ? data.discount_total.toString() : ''
          },
          amountPaid: {
            advancePayment: data.amount_paid_advance_payment?.toString() || '',
            clinicalServices: data.amount_paid_clinical_services?.toString() || '',
            laboratoryServices: data.amount_paid_laboratory_services?.toString() || '',
            radiology: data.amount_paid_radiology?.toString() || '',
            pharmacy: data.amount_paid_pharmacy?.toString() || '',
            implant: data.amount_paid_implant?.toString() || '',
            blood: data.amount_paid_blood?.toString() || '',
            surgery: data.amount_paid_surgery?.toString() || '',
            mandatoryServices: data.amount_paid_mandatory_services?.toString() || '',
            physiotherapy: data.amount_paid_physiotherapy?.toString() || '',
            consultation: data.amount_paid_consultation?.toString() || '',
            surgeryInternalReport: data.amount_paid_surgery_internal_report?.toString() || '',
            implantCost: data.amount_paid_implant_cost?.toString() || '',
            private: data.amount_paid_private?.toString() || '',
            accommodationCharges: data.amount_paid_accommodation_charges?.toString() || '',
            total: data.amount_paid_total?.toString() || ''
          },
          refundedAmount: {
            advancePayment: data.refunded_amount_advance_payment?.toString() || '',
            clinicalServices: data.refunded_amount_clinical_services?.toString() || '',
            laboratoryServices: data.refunded_amount_laboratory_services?.toString() || '',
            radiology: data.refunded_amount_radiology?.toString() || '',
            pharmacy: data.refunded_amount_pharmacy?.toString() || '',
            implant: data.refunded_amount_implant?.toString() || '',
            blood: data.refunded_amount_blood?.toString() || '',
            surgery: data.refunded_amount_surgery?.toString() || '',
            mandatoryServices: data.refunded_amount_mandatory_services?.toString() || '',
            physiotherapy: data.refunded_amount_physiotherapy?.toString() || '',
            consultation: data.refunded_amount_consultation?.toString() || '',
            surgeryInternalReport: data.refunded_amount_surgery_internal_report?.toString() || '',
            implantCost: data.refunded_amount_implant_cost?.toString() || '',
            private: data.refunded_amount_private?.toString() || '',
            accommodationCharges: data.refunded_amount_accommodation_charges?.toString() || '',
            total: data.refunded_amount_total?.toString() || ''
          },
          balance: {
            advancePayment: data.balance_advance_payment?.toString() || '',
            clinicalServices: data.balance_clinical_services?.toString() || '',
            laboratoryServices: data.balance_laboratory_services?.toString() || '',
            radiology: data.balance_radiology?.toString() || '',
            pharmacy: data.balance_pharmacy?.toString() || '',
            implant: data.balance_implant?.toString() || '',
            blood: data.balance_blood?.toString() || '',
            surgery: data.balance_surgery?.toString() || '',
            mandatoryServices: data.balance_mandatory_services?.toString() || '',
            physiotherapy: data.balance_physiotherapy?.toString() || '',
            consultation: data.balance_consultation?.toString() || '',
            surgeryInternalReport: data.balance_surgery_internal_report?.toString() || '',
            implantCost: data.balance_implant_cost?.toString() || '',
            private: data.balance_private?.toString() || '',
            accommodationCharges: data.balance_accommodation_charges?.toString() || '',
            total: data.balance_total?.toString() || ''
          }
        };

        // 🔥 LOAD DISCOUNT FROM NEW TABLE: Load discount from visit_discounts table
        try {
          console.log('🔍 [DISCOUNT INTEGRATION] Loading discount from visit_discounts table...');
          console.log('🔍 [DISCOUNT INTEGRATION] Available IDs - visitId:', visitId, 'billId:', billId);

          // Use visitId for discount lookup (preferred), fallback to billId if visitId not available
          const lookupId = visitId || billId;
          if (!lookupId) {
          } else {
            console.log('🔍 [DISCOUNT INTEGRATION] Using ID for discount lookup:', lookupId);

            // Get visit UUID from visitId or billId
            const { data: visitData, error: visitError } = await supabase
              .from('visits')
              .select('id, visit_id')
              .eq('visit_id', lookupId)
              .maybeSingle();

            console.log('🔍 [DISCOUNT INTEGRATION] Visit query result:', { visitData, visitError });

            if (visitError) {
              console.error('❌ [DISCOUNT INTEGRATION] Visit query error:', visitError);
              console.log('❌ [DISCOUNT INTEGRATION] Query details:', {
                table: 'visits',
                select: 'id, visit_id',
                where: `visit_id = ${lookupId}`
              });
            } else if (!visitData) {
            } else {
              // Load discount from visit_discounts table
              console.log('🔍 [DISCOUNT INTEGRATION] Querying visit_discounts with visit UUID:', visitData.id);
              const { data: discountData, error: discountError } = await supabase
                .from('visit_discounts')
                .select('*')
                .eq('visit_id', visitData.id)
                .maybeSingle();

              console.log('🔍 [DISCOUNT INTEGRATION] Discount query result:', { discountData, discountError });

              if (discountError) {
                if (discountError.code === 'PGRST116') {
                  console.log('📝 [DISCOUNT INTEGRATION] No discount record found (PGRST116 - expected for new visits)');
                } else {
                  console.error('❌ [DISCOUNT INTEGRATION] Unexpected error loading discount:', discountError);
                  console.log('❌ [DISCOUNT INTEGRATION] Discount query details:', {
                    table: 'visit_discounts',
                    select: '*',
                    where: `visit_id = ${visitData.id}`,
                    visitUUID: visitData.id
                  });
                }
              } else if (discountData) {
                // Only apply discount if approved (or if approval_status column doesn't exist yet)
                const approvalStatus = (discountData as any).approval_status;
                if (!approvalStatus || approvalStatus === 'approved') {
                  convertedData.discount.total = discountData.discount_amount?.toString() || '';
                } else {
                  convertedData.discount.total = '0';
                }
              } else {
                console.log('📝 [DISCOUNT INTEGRATION] Query succeeded but no data returned');
                console.log('📝 [DISCOUNT INTEGRATION] discountData:', discountData);
                console.log('📝 [DISCOUNT INTEGRATION] discountError:', discountError);
              }
            }
          }
        } catch (discountIntegrationError) {
          console.error('❌ [DISCOUNT INTEGRATION] Exception:', discountIntegrationError);
        }

        // 🔥 CRITICAL: Protect discount value if it was loaded from database
        if (convertedData.discount.total && convertedData.discount.total !== '0' && convertedData.discount.total !== '') {
          console.log('🛡️ [DISCOUNT PROTECTION] Discount value loaded from database, protecting it:', convertedData.discount.total);
        }

        setFinancialSummaryDataTracked(convertedData);

        // 🔥 CRITICAL LOGGING: Confirm what was set in React state
        console.log('📱 [REACT STATE SET] ✅ FINAL DISCOUNT TOTAL SET TO:', convertedData.discount.total);
        console.log('📱 [REACT STATE SET] Discount values set in React state:', {
          radiologyInState: convertedData.discount.radiology,
          laboratoryInState: convertedData.discount.laboratoryServices,
          clinicalInState: convertedData.discount.clinicalServices,
          pharmacyInState: convertedData.discount.pharmacy,
          totalInState: convertedData.discount.total,
          allDiscountInState: convertedData.discount
        });

        // Save emergency backup immediately after successful load
        saveEmergencyBackup(billId, convertedData.discount);
        emergencyBackupRef.current = JSON.stringify(convertedData.discount);

        // Mark that we've completed initial discount load from database
        initialDiscountLoadRef.current = true;
        setUserHasModifiedDiscounts(false); // Reset modification flag on database load
        setIsInitializing(false);

        console.log('✅ [FINANCIAL SUMMARY] Data converted and set in React state:', {
          discountValuesSetInState: {
            laboratory: convertedData.discount.laboratoryServices,
            radiology: convertedData.discount.radiology,
            pharmacy: convertedData.discount.pharmacy,
            clinical: convertedData.discount.clinicalServices,
            total: convertedData.discount.total
          },
          initialLoadCompleted: true,
          userModificationsFlagReset: true,
          emergencyBackupSaved: true
        });

        // Load package dates
        if (data.package_start_date || data.package_end_date) {
          setPackageDates({
            start_date: data.package_start_date || '',
            end_date: data.package_end_date || '',
            total_package_days: data.total_package_days || 7,
            total_admission_days: data.total_admission_days || 0
          });
        }

        setHasLoadedFromDatabase(true);
      } else {
        console.log('🔍 [FINANCIAL SUMMARY] This means either:');

        // 🔥 CRITICAL FIX: Load discount from visit_discounts table even if financial_summary doesn't exist
        console.log('🔍 [DISCOUNT INTEGRATION - NO RECORD] Attempting to load discount from visit_discounts table...');
        try {
          const lookupId = visitId || billId;
          if (lookupId) {
            console.log('🔍 [DISCOUNT INTEGRATION - NO RECORD] Using ID for discount lookup:', lookupId);

            // Get visit UUID from visitId or billId
            const { data: visitData, error: visitError } = await supabase
              .from('visits')
              .select('id, visit_id')
              .eq('visit_id', lookupId)
              .maybeSingle();

            console.log('🔍 [DISCOUNT INTEGRATION - NO RECORD] Visit query result:', { visitData, visitError });

            if (!visitError && visitData) {
              // Load discount from visit_discounts table
              console.log('🔍 [DISCOUNT INTEGRATION - NO RECORD] Querying visit_discounts with visit UUID:', visitData.id);
              const { data: discountData, error: discountError } = await supabase
                .from('visit_discounts')
                .select('*')
                .eq('visit_id', visitData.id)
                .maybeSingle();

              console.log('🔍 [DISCOUNT INTEGRATION - NO RECORD] Discount query result:', { discountData, discountError });

              if (!discountError && discountData) {
                // Only apply discount if approved
                const approvalStatus = (discountData as any).approval_status;
                const effectiveAmount = (!approvalStatus || approvalStatus === 'approved')
                  ? (discountData.discount_amount?.toString() || '')
                  : '0';
                setFinancialSummaryDataTracked(prev => ({
                  ...prev,
                  discount: {
                    ...prev.discount,
                    total: effectiveAmount
                  }
                }));
                setIsInitializing(false);
                setHasLoadedFromDatabase(true);
                return; // Exit early - discount loaded successfully
              }
            }
          }
        } catch (discountError) {
          console.error('❌ [DISCOUNT INTEGRATION - NO RECORD] Exception loading discount:', discountError);
        }

        // Try session backup first, then emergency backup as last resort
        console.log('🚨 [RECOVERY SEQUENCE] Starting recovery sequence for missing database data...');

        // Try session backup first
        try {
          const sessionBackup = sessionStorage.getItem(`financial_backup_${billId}`);
          if (sessionBackup) {
            const parsed = JSON.parse(sessionBackup);
            setFinancialSummaryDataTracked(prev => ({
              ...prev,
              discount: parsed.discount
            }));
            emergencyBackupRef.current = JSON.stringify(parsed.discount);
            toast.success('Recovered discount values from session backup');
            setIsInitializing(false);
            setHasLoadedFromDatabase(true);
            return; // Exit early - session backup found
          }
        } catch (sessionError) {
          console.error('❌ [SESSION RECOVERY] Session backup failed to load:', sessionError);
        }

        // Try emergency localStorage backup as last resort
        console.log('🚨 [EMERGENCY RECOVERY] Session backup not found, attempting emergency localStorage backup...');
        const emergencyData = loadEmergencyBackup(billId);
        if (emergencyData) {
          setFinancialSummaryDataTracked(prev => ({
            ...prev,
            discount: emergencyData
          }));
          emergencyBackupRef.current = JSON.stringify(emergencyData);
          toast.success('Recovered discount values from emergency backup');
        } else {
        }

        setIsInitializing(false);
        // Even if no data found, mark as loaded so auto-populate can proceed
        setHasLoadedFromDatabase(true);
      }
    } catch (error) {
      console.error('❌ [FINANCIAL SUMMARY] Error loading financial summary:', error);
      toast.error('Failed to load financial summary data');
      setIsInitializing(false);
    } finally {
      setIsLoading(false);
      setIsStateLocked(false);
      console.log('🔓 [STATE UNLOCK] State unlocked after database operation');

      // FIXED: Remove automatic auto-populate after load to prevent overwriting loaded discount values
      // Auto-populate should only be triggered manually via "Refresh Totals" button
      if (shouldAutoPopulateAfterLoad) {
        console.log('🛡️ [LOAD COMPLETE] Auto-populate was queued but SKIPPED to preserve loaded discount values');
        console.log('💡 [LOAD COMPLETE] Use "Refresh Totals Only" button to manually refresh if needed');
        setShouldAutoPopulateAfterLoad(false);
      }
    }
  };

  // Save financial summary data to database
  const saveFinancialSummary = async () => {
    const saveSessionId = Math.random().toString(36).substr(2, 9);
    console.log('💾 [FINANCIAL SUMMARY] Save attempt with:', {
      billId: billId,
      billIdType: typeof billId,
      billIdLength: billId?.length,
      billIdTrimmed: billId?.trim(),
      visitId: visitId,
      saveSessionId: saveSessionId,
      timestamp: new Date().toISOString()
    });

    if (!billId || !billId.trim()) {
      console.error('❌ [FINANCIAL SUMMARY] Cannot save: billId validation failed:', {
        billId: billId,
        billIdType: typeof billId,
        billIdLength: billId?.length,
        reason: !billId ? 'billId is falsy' : 'billId is empty after trim'
      });
      toast.error('Bill ID is required to save financial summary. Please wait for bill creation.');
      return;
    }

    setIsSaving(true);
    console.log('🔄 [SAVE TRANSACTION] Starting comprehensive database transaction with enhanced logging...');

    try {
      // Step 1: Convert visitId (TEXT) to visits.id (UUID) for proper foreign key reference
      let visitUUID = null;
      if (visitId) {
        console.log('🔍 [SAVE TRANSACTION] Step 1: Converting visitId from TEXT to UUID:', visitId);
        const { data: visitData, error: visitError } = await supabase
          .from('visits')
          .select('id')
          .eq('visit_id', visitId)
          .single();

        if (visitError) {
          console.error('❌ [SAVE TRANSACTION] Step 1 ERROR: Failed to find visit UUID for visitId:', {
            visitId: visitId,
            error: visitError,
            errorMessage: visitError.message,
            errorCode: visitError.code
          });
          // Don't fail completely - proceed with null visit_id
        } else if (visitData) {
          visitUUID = visitData.id;
          console.log('✅ [SAVE TRANSACTION] Step 1 SUCCESS: Converted visitId to UUID:', {
            fromVisitId: visitId,
            toVisitUUID: visitUUID
          });
        }
      } else {
      }

      // Step 2: Log and validate discount values being saved
      console.log('🔍 [SAVE TRANSACTION] Step 2: Validating discount values before save:', {
        discountValues: financialSummaryData.discount,
        hasNonEmptyDiscounts: Object.values(financialSummaryData.discount).some(val => val && val.trim() !== '' && val !== '0'),
        billId: billId,
        saveSessionId: saveSessionId
      });

      // Save to sessionStorage immediately before database save as backup
      try {
        const sessionBackup = {
          billId: billId,
          timestamp: new Date().toISOString(),
          discount: financialSummaryData.discount,
          version: 'session_backup_v1'
        };
        sessionStorage.setItem(`financial_backup_${billId}`, JSON.stringify(sessionBackup));
      } catch (sessionError) {
        console.error('❌ [SAVE TRANSACTION] Step 2a ERROR: Session backup failed:', sessionError);
      }

      // 🔥 CRITICAL DISCOVERY: Add detailed logging for discount value conversion
      console.log('💥 [SAVE DIAGNOSTIC] Raw discount values from React state:', {
        radiology: financialSummaryData.discount.radiology,
        radiologyType: typeof financialSummaryData.discount.radiology,
        radiologyLength: financialSummaryData.discount.radiology?.length,
        laboratoryServices: financialSummaryData.discount.laboratoryServices,
        clinicalServices: financialSummaryData.discount.clinicalServices,
        pharmacy: financialSummaryData.discount.pharmacy,
        total: financialSummaryData?.discount?.total,
        allDiscountValues: financialSummaryData.discount
      });

      // Convert component format to database format
      const dbData = {
        bill_id: billId,
        visit_id: visitUUID,
        
        // Total Amount Row
        total_amount_advance_payment: parseFloat(financialSummaryData.totalAmount.advancePayment) || 0,
        total_amount_clinical_services: parseFloat(financialSummaryData.totalAmount.clinicalServices) || 0,
        total_amount_laboratory_services: parseFloat(financialSummaryData.totalAmount.laboratoryServices) || 0,
        total_amount_radiology: parseFloat(financialSummaryData.totalAmount.radiology) || 0,
        total_amount_pharmacy: parseFloat(financialSummaryData.totalAmount.pharmacy) || 0,
        total_amount_implant: parseFloat(financialSummaryData.totalAmount.implant) || 0,
        total_amount_blood: parseFloat(financialSummaryData.totalAmount.blood) || 0,
        total_amount_surgery: parseFloat(financialSummaryData.totalAmount.surgery) || 0,
        total_amount_mandatory_services: parseFloat(financialSummaryData.totalAmount.mandatoryServices) || 0,
        total_amount_physiotherapy: parseFloat(financialSummaryData.totalAmount.physiotherapy) || 0,
        total_amount_consultation: parseFloat(financialSummaryData.totalAmount.consultation) || 0,
        total_amount_surgery_internal_report: parseFloat(financialSummaryData.totalAmount.surgeryInternalReport) || 0,
        total_amount_implant_cost: parseFloat(financialSummaryData.totalAmount.implantCost) || 0,
        total_amount_private: parseFloat(financialSummaryData.totalAmount.private) || 0,
        total_amount_accommodation_charges: parseFloat(financialSummaryData.totalAmount.accommodationCharges) || 0,
        total_amount_total: parseFloat(financialSummaryData?.totalAmount?.total) || 0,
        
        // 🔥 ENHANCED: Discount Row - handle DEFAULT 0 database constraint properly
        discount_advance_payment: financialSummaryData.discount.advancePayment && financialSummaryData.discount.advancePayment.trim() !== '' && financialSummaryData.discount.advancePayment.trim() !== '0' ? parseFloat(financialSummaryData.discount.advancePayment) : null,
        discount_clinical_services: financialSummaryData.discount.clinicalServices && financialSummaryData.discount.clinicalServices.trim() !== '' && financialSummaryData.discount.clinicalServices.trim() !== '0' ? parseFloat(financialSummaryData.discount.clinicalServices) : null,
        discount_laboratory_services: financialSummaryData.discount.laboratoryServices && financialSummaryData.discount.laboratoryServices.trim() !== '' && financialSummaryData.discount.laboratoryServices.trim() !== '0' ? parseFloat(financialSummaryData.discount.laboratoryServices) : null,
        discount_radiology: financialSummaryData.discount.radiology && financialSummaryData.discount.radiology.trim() !== '' && financialSummaryData.discount.radiology.trim() !== '0' ? parseFloat(financialSummaryData.discount.radiology) : null,
        discount_pharmacy: financialSummaryData.discount.pharmacy && financialSummaryData.discount.pharmacy.trim() !== '' && financialSummaryData.discount.pharmacy.trim() !== '0' ? parseFloat(financialSummaryData.discount.pharmacy) : null,
        discount_implant: financialSummaryData.discount.implant && financialSummaryData.discount.implant.trim() !== '' && financialSummaryData.discount.implant.trim() !== '0' ? parseFloat(financialSummaryData.discount.implant) : null,
        discount_blood: financialSummaryData.discount.blood && financialSummaryData.discount.blood.trim() !== '' && financialSummaryData.discount.blood.trim() !== '0' ? parseFloat(financialSummaryData.discount.blood) : null,
        discount_surgery: financialSummaryData.discount.surgery && financialSummaryData.discount.surgery.trim() !== '' && financialSummaryData.discount.surgery.trim() !== '0' ? parseFloat(financialSummaryData.discount.surgery) : null,
        discount_mandatory_services: financialSummaryData.discount.mandatoryServices && financialSummaryData.discount.mandatoryServices.trim() !== '' && financialSummaryData.discount.mandatoryServices.trim() !== '0' ? parseFloat(financialSummaryData.discount.mandatoryServices) : null,
        discount_physiotherapy: financialSummaryData.discount.physiotherapy && financialSummaryData.discount.physiotherapy.trim() !== '' && financialSummaryData.discount.physiotherapy.trim() !== '0' ? parseFloat(financialSummaryData.discount.physiotherapy) : null,
        discount_consultation: financialSummaryData.discount.consultation && financialSummaryData.discount.consultation.trim() !== '' && financialSummaryData.discount.consultation.trim() !== '0' ? parseFloat(financialSummaryData.discount.consultation) : null,
        discount_surgery_internal_report: financialSummaryData.discount.surgeryInternalReport && financialSummaryData.discount.surgeryInternalReport.trim() !== '' && financialSummaryData.discount.surgeryInternalReport.trim() !== '0' ? parseFloat(financialSummaryData.discount.surgeryInternalReport) : null,
        discount_implant_cost: financialSummaryData.discount.implantCost && financialSummaryData.discount.implantCost.trim() !== '' && financialSummaryData.discount.implantCost.trim() !== '0' ? parseFloat(financialSummaryData.discount.implantCost) : null,
        discount_private: financialSummaryData.discount.private && financialSummaryData.discount.private.trim() !== '' && financialSummaryData.discount.private.trim() !== '0' ? parseFloat(financialSummaryData.discount.private) : null,
        discount_accommodation_charges: financialSummaryData.discount.accommodationCharges && financialSummaryData.discount.accommodationCharges.trim() !== '' && financialSummaryData.discount.accommodationCharges.trim() !== '0' ? parseFloat(financialSummaryData.discount.accommodationCharges) : null,
        discount_total: financialSummaryData?.discount?.total && financialSummaryData?.discount?.total.trim() !== '' && financialSummaryData?.discount?.total.trim() !== '0' ? parseFloat(financialSummaryData?.discount?.total) : null,
        
        // Amount Paid Row
        amount_paid_advance_payment: parseFloat(financialSummaryData.amountPaid.advancePayment) || 0,
        amount_paid_clinical_services: parseFloat(financialSummaryData.amountPaid.clinicalServices) || 0,
        amount_paid_laboratory_services: parseFloat(financialSummaryData.amountPaid.laboratoryServices) || 0,
        amount_paid_radiology: parseFloat(financialSummaryData.amountPaid.radiology) || 0,
        amount_paid_pharmacy: parseFloat(financialSummaryData.amountPaid.pharmacy) || 0,
        amount_paid_implant: parseFloat(financialSummaryData.amountPaid.implant) || 0,
        amount_paid_blood: parseFloat(financialSummaryData.amountPaid.blood) || 0,
        amount_paid_surgery: parseFloat(financialSummaryData.amountPaid.surgery) || 0,
        amount_paid_mandatory_services: parseFloat(financialSummaryData.amountPaid.mandatoryServices) || 0,
        amount_paid_physiotherapy: parseFloat(financialSummaryData.amountPaid.physiotherapy) || 0,
        amount_paid_consultation: parseFloat(financialSummaryData.amountPaid.consultation) || 0,
        amount_paid_surgery_internal_report: parseFloat(financialSummaryData.amountPaid.surgeryInternalReport) || 0,
        amount_paid_implant_cost: parseFloat(financialSummaryData.amountPaid.implantCost) || 0,
        amount_paid_private: parseFloat(financialSummaryData.amountPaid.private) || 0,
        amount_paid_accommodation_charges: parseFloat(financialSummaryData.amountPaid.accommodationCharges) || 0,
        amount_paid_total: parseFloat(financialSummaryData?.amountPaid?.total) || 0,
        
        // Refunded Amount Row
        refunded_amount_advance_payment: parseFloat(financialSummaryData.refundedAmount.advancePayment) || 0,
        refunded_amount_clinical_services: parseFloat(financialSummaryData.refundedAmount.clinicalServices) || 0,
        refunded_amount_laboratory_services: parseFloat(financialSummaryData.refundedAmount.laboratoryServices) || 0,
        refunded_amount_radiology: parseFloat(financialSummaryData.refundedAmount.radiology) || 0,
        refunded_amount_pharmacy: parseFloat(financialSummaryData.refundedAmount.pharmacy) || 0,
        refunded_amount_implant: parseFloat(financialSummaryData.refundedAmount.implant) || 0,
        refunded_amount_blood: parseFloat(financialSummaryData.refundedAmount.blood) || 0,
        refunded_amount_surgery: parseFloat(financialSummaryData.refundedAmount.surgery) || 0,
        refunded_amount_mandatory_services: parseFloat(financialSummaryData.refundedAmount.mandatoryServices) || 0,
        refunded_amount_physiotherapy: parseFloat(financialSummaryData.refundedAmount.physiotherapy) || 0,
        refunded_amount_consultation: parseFloat(financialSummaryData.refundedAmount.consultation) || 0,
        refunded_amount_surgery_internal_report: parseFloat(financialSummaryData.refundedAmount.surgeryInternalReport) || 0,
        refunded_amount_implant_cost: parseFloat(financialSummaryData.refundedAmount.implantCost) || 0,
        refunded_amount_private: parseFloat(financialSummaryData.refundedAmount.private) || 0,
        refunded_amount_accommodation_charges: parseFloat(financialSummaryData.refundedAmount.accommodationCharges) || 0,
        refunded_amount_total: parseFloat(financialSummaryData?.refundedAmount?.total) || 0,
        
        // Balance Row
        balance_advance_payment: parseFloat(financialSummaryData.balance.advancePayment) || 0,
        balance_clinical_services: parseFloat(financialSummaryData.balance.clinicalServices) || 0,
        balance_laboratory_services: parseFloat(financialSummaryData.balance.laboratoryServices) || 0,
        balance_radiology: parseFloat(financialSummaryData.balance.radiology) || 0,
        balance_pharmacy: parseFloat(financialSummaryData.balance.pharmacy) || 0,
        balance_implant: parseFloat(financialSummaryData.balance.implant) || 0,
        balance_blood: parseFloat(financialSummaryData.balance.blood) || 0,
        balance_surgery: parseFloat(financialSummaryData.balance.surgery) || 0,
        balance_mandatory_services: parseFloat(financialSummaryData.balance.mandatoryServices) || 0,
        balance_physiotherapy: parseFloat(financialSummaryData.balance.physiotherapy) || 0,
        balance_consultation: parseFloat(financialSummaryData.balance.consultation) || 0,
        balance_surgery_internal_report: parseFloat(financialSummaryData.balance.surgeryInternalReport) || 0,
        balance_implant_cost: parseFloat(financialSummaryData.balance.implantCost) || 0,
        balance_private: parseFloat(financialSummaryData.balance.private) || 0,
        balance_accommodation_charges: parseFloat(financialSummaryData.balance.accommodationCharges) || 0,
        balance_total: parseFloat(financialSummaryData?.balance?.total) || 0,
        
        // Package dates
        package_start_date: packageDates.start_date || null,
        package_end_date: packageDates.end_date || null,
        total_package_days: packageDates.total_package_days || 7,
        total_admission_days: packageDates.total_admission_days || 0
      };

      // 🔥 CRITICAL LOGGING: Show exact values being sent to database
      console.log('💾 [DATABASE SAVE] Values being sent to database:', {
        discount_radiology: dbData.discount_radiology,
        discount_laboratory_services: dbData.discount_laboratory_services,
        discount_clinical_services: dbData.discount_clinical_services,
        discount_pharmacy: dbData.discount_pharmacy,
        discount_total: dbData.discount_total,
        bill_id: dbData.bill_id,
        visit_id: dbData.visit_id
      });

      // 🔥 ENHANCED: Use native Supabase UPSERT for atomic operation
      console.log('🔄 [FINANCIAL SUMMARY] Performing UPSERT operation for billId:', billId);
      console.log('💾 [UPSERT] Using atomic UPSERT with conflict resolution on bill_id');

      const result = await supabase
        .from('financial_summary')
        .upsert(dbData, {
          onConflict: 'bill_id',
          ignoreDuplicates: false
        })
        .select();

      const operationType = result.data && result.data.length > 0 ? 'UPSERT' : 'UNKNOWN';

      if (result.error) {
        console.error('❌ [FINANCIAL SUMMARY] UPSERT operation failed:', {
          operation: 'UPSERT',
          error: result.error,
          billId: billId,
          visitUUID: visitUUID,
          errorCode: result.error.code,
          errorMessage: result.error.message,
          errorDetails: result.error.details
        });
        toast.error(`Failed to save financial summary data: ${result.error.message}`);
        return;
      }

      console.log(`✅ [FINANCIAL SUMMARY] UPSERT operation successful:`, {
        operation: 'UPSERT',
        billId: billId,
        recordsAffected: result.data?.length || 0,
        isAtomicOperation: true,
        savedData: result.data?.[0] ? {
          id: result.data[0].id,
          bill_id: result.data[0].bill_id,
          visit_id: result.data[0].visit_id,
          savedDiscounts: {
            laboratory: result.data[0].discount_laboratory_services,
            radiology: result.data[0].discount_radiology,
            pharmacy: result.data[0].discount_pharmacy,
            clinical: result.data[0].discount_clinical_services,
            total: result.data[0].discount_total
          }
        } : null
      });

      // VERIFICATION: Immediately read back the data to confirm it was saved correctly
      console.log('🔍 [FINANCIAL SUMMARY] Verifying save operation with immediate read-back...');
      const { data: verificationData, error: verificationError } = await supabase
        .from('financial_summary')
        .select('*')
        .eq('bill_id', billId)
        .single();

      if (verificationError) {
        console.error('❌ [FINANCIAL SUMMARY] Verification read failed:', verificationError);
        toast.error('Save completed but verification failed. Please refresh to check data.');
      } else if (verificationData) {
        console.log('✅ [FINANCIAL SUMMARY] Verification successful - data confirmed in database:', {
          verifiedDiscounts: {
            laboratory: verificationData.discount_laboratory_services,
            radiology: verificationData.discount_radiology,
            pharmacy: verificationData.discount_pharmacy,
            clinical: verificationData.discount_clinical_services,
            total: verificationData.discount_total
          },
          lastUpdated: verificationData.updated_at,
          verificationMatch: {
            laboratory: verificationData.discount_laboratory_services === (parseFloat(financialSummaryData.discount.laboratoryServices) || 0),
            radiology: verificationData.discount_radiology === (parseFloat(financialSummaryData.discount.radiology) || 0),
            pharmacy: verificationData.discount_pharmacy === (parseFloat(financialSummaryData.discount.pharmacy) || 0),
            clinical: verificationData.discount_clinical_services === (parseFloat(financialSummaryData.discount.clinicalServices) || 0),
            total: verificationData.discount_total === (parseFloat(financialSummaryData?.discount?.total) || 0)
          }
        });

        setLastSaveTime(new Date());

        toast.success('Financial summary saved and verified successfully!');
      } else {
        console.error('❌ [FINANCIAL SUMMARY] Verification failed: No data found after save');
        toast.error('Save operation unclear. Please refresh to check data.');
      }

    } catch (error) {
      console.error('❌ [FINANCIAL SUMMARY] Unexpected error during save operation:', {
        error: error,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        errorStack: error instanceof Error ? error.stack : null,
        billId: billId,
        visitId: visitId,
        timestamp: new Date().toISOString()
      });
      toast.error(`Failed to save financial summary data: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Simplified auto-save that uses the main save function
  const triggerAutoSave = useCallback(async () => {
    if (!billId || isAutoSaving || isSaving) return;

    console.log('🔄 [AUTO-SAVE] Triggering auto-save using main save function...');
    setIsAutoSaving(true);

    try {
      // Use the main, tested save function instead of duplicate logic
      await saveFinancialSummary();
    } catch (error) {
      console.error('❌ [AUTO-SAVE] Auto-save failed:', error);
      toast.error('Auto-save failed - your changes may not be saved');
    } finally {
      setIsAutoSaving(false);
    }
  }, [billId, isAutoSaving, isSaving, saveFinancialSummary]);

  // Handle financial summary input change with auto-save
  const handleFinancialSummaryChange = (row: string, column: string, value: string) => {
    console.log('📝 [INPUT CHANGE] Financial summary changed:', { row, column, value });

    setFinancialSummaryDataTracked(prev => {
      const newData = {
        ...prev,
        [row]: {
          ...prev[row as keyof typeof prev],
          [column]: value
        }
      };

      // Detailed logging for discount changes
      if (row === 'discount') {
        console.log('💡 [DISCOUNT TRACKING] Discount value change detected:', {
          column: column,
          oldValue: prev.discount[column as keyof typeof prev.discount],
          newValue: value,
          beforeState: prev.discount,
          afterState: newData.discount,
          timestamp: new Date().toISOString(),
          billId: billId,
          userInitiated: true
        });


        // Legacy emergency backup
        if (billId) {
          saveEmergencyBackup(billId, newData.discount);
          emergencyBackupRef.current = JSON.stringify(newData.discount);
        }
      }

      return newData;
    });

    // Track user modifications to discount values (auto-save disabled)
    if (row === 'discount' && initialDiscountLoadRef.current) {
      console.log('🛡️ [USER MODIFICATION] User manually modified discount value:', { column, value });
      setUserHasModifiedDiscounts(true);

      // Note: Auto-save removed - user must manually click Calculate and then Save
      console.log('📝 [DISCOUNT CHANGE] Discount value changed (auto-save disabled - requires manual calculation)');
    }
  };

  // 🔄 TOTALS-ONLY AUTO-POPULATE (PROPER SEPARATION OF CONCERNS)
  const autoPopulateFinancialData = async () => {
    console.log('🔥 [AUTO-POPULATE] Starting totals-only auto-populate (discount preservation via state)');

    if (!visitId) {
      console.log('🚫 No visitId provided for auto-population');
      return;
    }

    // CRITICAL: Block all operations during state lock
    if (isStateLocked) {
      console.log('🔒 [AUTO-POPULATE] State is locked - operation blocked to prevent race conditions');
      setShouldAutoPopulateAfterLoad(true);
      return;
    }

    // CRITICAL: Block during initialization
    if (isInitializing) {
      setShouldAutoPopulateAfterLoad(true);
      return;
    }

    // CRITICAL: Check if we're still loading financial summary from database
    if (isLoading) {
      setShouldAutoPopulateAfterLoad(true);
      return;
    }

    // CRITICAL: Ensure database load has completed first
    if (!hasLoadedFromDatabase && billId) {
      console.log('🔄 [AUTO-POPULATE] Database load has not completed yet - queuing auto-populate to run after load');
      setShouldAutoPopulateAfterLoad(true);
      return;
    }

    console.log('🔄 Auto-populating financial totals for visit:', visitId);
    console.log('📊 [AUTO-POPULATE] Current state before auto-populate:', {
      isLoading: isLoading,
      hasLoadedFromDatabase: hasLoadedFromDatabase,
      billId: billId,
      currentDiscountValues: financialSummaryData.discount,
      allowedToProceed: true
    });

    // Reset the queue flag to prevent multiple queued operations
    setShouldAutoPopulateAfterLoad(false);
    setIsLoading(true);

    try {
      // 🔥 STEP 1: Fetch all totals from visit data (NO DISCOUNT LOADING)
      console.log('📊 [AUTO-POPULATE] Step 1: Fetching totals from visit data only...');
      const [
        labTotal,
        clinicalTotal,
        mandatoryTotal,
        radiologyTotal,
        pharmacyTotal,
        accommodationTotal,
        advancePaymentTotal,
        refundedTotal,
        surgeryTotal,
        anesthetistTotal,
        implantTotal
      ] = await Promise.all([
        fetchLabTestsTotal(),
        fetchClinicalServicesTotal(),
        fetchMandatoryServicesTotal(),
        fetchRadiologyTotal(),
        fetchPharmacyTotal(),
        fetchAccommodationTotal(),
        fetchAdvancePaymentTotal(),
        fetchRefundedAmount(),
        fetchSurgeryTotal(),
        fetchAnesthetistTotal(),
        fetchImplantTotal()
      ]);

      // Calculate grand total (including surgery, anesthetist, and implant)
      const grandTotal = labTotal + clinicalTotal + mandatoryTotal + radiologyTotal + pharmacyTotal + accommodationTotal + surgeryTotal + anesthetistTotal + implantTotal;

      // 🔥 STEP 2: Update ONLY totals, preserve existing discount values from state
      console.log('📝 [AUTO-POPULATE] Step 2: Updating totals only, preserving existing discount values...');
      setFinancialSummaryDataTracked(prev => {
        console.log('🔍 [AUTO-POPULATE] State preservation details:', {
          preservingDiscountValues: prev.discount,
          discountSource: 'existing state (loaded by loadFinancialSummary)',
          noDiscountDatabaseQuery: true
        });

        // 🔄 TOTALS-ONLY UPDATE: Update totals, preserve ALL existing values
        const updatedData = {
          ...prev,
          // ONLY update totalAmount - auto-calculated from visit data
          totalAmount: {
            ...prev.totalAmount,
            advancePayment: '0', // Advance payment is not a service cost, should be 0
            clinicalServices: clinicalTotal.toString(),
            laboratoryServices: labTotal.toString(),
            radiology: radiologyTotal.toString(),
            pharmacy: pharmacyTotal.toString(),
            surgery: surgeryTotal.toString(),
            implant: implantTotal.toString(),
            mandatoryServices: mandatoryTotal.toString(),
            physiotherapy: anesthetistTotal.toString(), // Anesthetist total (field named physiotherapy for compatibility)
            accommodationCharges: accommodationTotal.toString(),
            total: grandTotal.toString()
          },
          // 🛡️ PRESERVE EXISTING DISCOUNT VALUES: No database loading, use current state
          discount: { ...prev.discount },
          // ✅ Update advance payments in Amount Paid row
          amountPaid: {
            ...prev.amountPaid,
            advancePayment: advancePaymentTotal.toString(),
            total: advancePaymentTotal.toString()
          },
          // ✅ Update refunded amount in Refunded Amount row
          refundedAmount: {
            ...prev.refundedAmount,
            advancePayment: refundedTotal.toString(),
            total: refundedTotal.toString()
          },

          // ⚠️ SIMPLE BALANCE: Calculate without discount (discount applied separately via Calculate button)
          balance: {
            ...prev.balance,
            advancePayment: '0', // Always 0 - advance payment has no service balance
            clinicalServices: (clinicalTotal - (parseFloat(prev.amountPaid.clinicalServices) || 0) + (parseFloat(prev.refundedAmount.clinicalServices) || 0)).toString(),
            laboratoryServices: (labTotal - (parseFloat(prev.amountPaid.laboratoryServices) || 0) + (parseFloat(prev.refundedAmount.laboratoryServices) || 0)).toString(),
            radiology: (radiologyTotal - (parseFloat(prev.amountPaid.radiology) || 0) + (parseFloat(prev.refundedAmount.radiology) || 0)).toString(),
            pharmacy: (pharmacyTotal - (parseFloat(prev.amountPaid.pharmacy) || 0) + (parseFloat(prev.refundedAmount.pharmacy) || 0)).toString(),
            surgery: (surgeryTotal - (parseFloat(prev.amountPaid.surgery) || 0) + (parseFloat(prev.refundedAmount.surgery) || 0)).toString(),
            implant: (implantTotal - (parseFloat(prev.amountPaid.implant) || 0) + (parseFloat(prev.refundedAmount.implant) || 0)).toString(),
            mandatoryServices: (mandatoryTotal - (parseFloat(prev.amountPaid.mandatoryServices) || 0) + (parseFloat(prev.refundedAmount.mandatoryServices) || 0)).toString(),
            total: (grandTotal - advancePaymentTotal + refundedTotal).toString()
          }
        };

        console.log('✅ [AUTO-POPULATE] Step 2 Complete: Totals-only update with proper separation:', {
          totalAmountUpdated: true,
          advancePaymentMoved: true,
          discountValuesPreserved: true,
          discountSourceFunction: 'loadFinancialSummary (proper separation)',
          balanceCalculatedWithoutDiscount: true
        });

        return updatedData;
      });

      console.log('✅ [AUTO-POPULATE] Totals-only auto-populate completed successfully:', {
        advancePaymentTotal,
        refundedTotal,
        labTotal,
        clinicalTotal,
        mandatoryTotal,
        radiologyTotal,
        pharmacyTotal,
        surgeryTotal,
        accommodationTotal,
        grandTotal,
        discountHandling: 'preserved from state (loaded by loadFinancialSummary)'
      });

    } catch (error) {
      console.error('❌ Error auto-populating financial data:', error);
      toast.error('Failed to load financial data from database');
    } finally {
      setIsLoading(false);
    }
  };

  // Load data when billId becomes available or changes
  useEffect(() => {
    console.log('🔄 [FINANCIAL SUMMARY] useEffect triggered - billId changed:', {
      billId: billId,
      billIdType: typeof billId,
      billIdLength: billId?.length || 0,
      isValidBillId: !!(billId && billId.trim()),
      currentTimestamp: new Date().toISOString()
    });

    if (billId && billId.trim()) {
      loadFinancialSummary();
    } else {
      console.log('❌ [FINANCIAL SUMMARY] Invalid billId - cannot load financial summary:', {
        providedBillId: billId,
        reason: !billId ? 'billId is falsy' : 'billId is empty string'
      });
    }
  }, [billId]);

  // Cleanup function for timeouts
  useEffect(() => {
    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, []);

  // 🔄 RACE CONDITION FIXED: Removed separate discount loading useEffect
  // Discount loading is now integrated into autoPopulateFinancialData to prevent race conditions

  // Track all discount value changes for debugging
  useEffect(() => {
    const currentDiscountData = JSON.stringify(financialSummaryData.discount);
    const previousDiscountData = lastDiscountDataRef.current;

    // Log discount total specifically
    console.log('🔍 [DISCOUNT TRACKER] Current discount total in state:', financialSummaryData?.discount?.total);
    console.log('🔍 [DISCOUNT TRACKER] Full discount object:', financialSummaryData.discount);

    if (previousDiscountData && currentDiscountData !== previousDiscountData) {
      console.log('🔍 [DISCOUNT MONITORING] Discount values changed externally:', {
        from: JSON.parse(previousDiscountData),
        to: financialSummaryData.discount,
        billId: billId,
        timestamp: new Date().toISOString(),
        userHasModifiedDiscounts: userHasModifiedDiscounts,
        source: 'Unknown - external change detected'
      });
    }

    lastDiscountDataRef.current = currentDiscountData;
  }, [financialSummaryData.discount, billId, userHasModifiedDiscounts]);

  // Fetch final payment data from database
  useEffect(() => {
    const fetchFinalPayment = async () => {
      if (!visitId) return;

      try {
        // STEP 1: Check if patient is currently discharged
        const { data: visitData, error: visitError } = await supabase
          .from('visits')
          .select('discharge_date')
          .eq('visit_id', visitId)
          .single();

        if (visitError) {
          console.error('Error fetching visit data:', visitError);
          return;
        }

        // STEP 2: Only fetch final payment if patient IS CURRENTLY DISCHARGED
        if (!visitData?.discharge_date) {
          // Reset finalPayment to 0 for undischarged patients
          setFinancialSummaryDataTracked((prev) => ({
            ...prev,
            finalPayment: {
              ...prev.finalPayment,
              total: '0'
            }
          }));
          return;
        }

        // STEP 3: Patient is discharged, fetch final payment normally
        const { data, error } = await supabase
          .from('final_payments')
          .select('*')
          .eq('visit_id', visitId)
          .maybeSingle();

        if (error) {
          console.error('Error fetching final payment:', error);
          return;
        }

        if (data) {

          // Update finalPayment in state with the amount
          // For now, we'll put the full amount in the total
          // You can distribute it across categories if needed
          setFinancialSummaryDataTracked((prev) => ({
            ...prev,
            finalPayment: {
              ...prev.finalPayment,
              total: data.amount ? data.amount.toString() : '0'
            }
          }));
        }
      } catch (error) {
        console.error('Error in fetchFinalPayment:', error);
      }
    };

    fetchFinalPayment();
  }, [visitId]);

  // 🔄 DEDICATED DISCOUNT PERSISTENCE SYSTEM - Completely separate from auto-populate
  const loadSavedDiscountValues = useCallback(async () => {
    if (!billId) {
      console.log('🚫 [DISCOUNT LOAD] No billId provided');
      return null;
    }

    console.log('🔍 [DISCOUNT LOAD] Loading saved discount values from database...');
    try {
      const { data: savedData, error: savedError } = await supabase
        .from('financial_summary')
        .select('discount_total, discount_clinical_services, discount_laboratory_services, discount_radiology, discount_pharmacy, discount_implant, discount_blood, discount_surgery, discount_mandatory_services, discount_physiotherapy, discount_consultation, discount_surgery_internal_report, discount_implant_cost, discount_private, discount_accommodation_charges')
        .eq('bill_id', billId)
        .maybeSingle();

      if (savedError && savedError.code !== 'PGRST116') {
        console.error('❌ [DISCOUNT LOAD] Error loading saved discount values:', savedError);
        return null;
      }

      if (savedData) {
        const discountValues = {
          total: (savedData.discount_total !== null && savedData.discount_total !== 0) ? savedData.discount_total.toString() : '',
          clinicalServices: (savedData.discount_clinical_services !== null && savedData.discount_clinical_services !== 0) ? savedData.discount_clinical_services.toString() : '',
          laboratoryServices: (savedData.discount_laboratory_services !== null && savedData.discount_laboratory_services !== 0) ? savedData.discount_laboratory_services.toString() : '',
          radiology: (savedData.discount_radiology !== null && savedData.discount_radiology !== 0) ? savedData.discount_radiology.toString() : '',
          pharmacy: (savedData.discount_pharmacy !== null && savedData.discount_pharmacy !== 0) ? savedData.discount_pharmacy.toString() : '',
          implant: (savedData.discount_implant !== null && savedData.discount_implant !== 0) ? savedData.discount_implant.toString() : '',
          blood: (savedData.discount_blood !== null && savedData.discount_blood !== 0) ? savedData.discount_blood.toString() : '',
          surgery: (savedData.discount_surgery !== null && savedData.discount_surgery !== 0) ? savedData.discount_surgery.toString() : '',
          mandatoryServices: (savedData.discount_mandatory_services !== null && savedData.discount_mandatory_services !== 0) ? savedData.discount_mandatory_services.toString() : '',
          physiotherapy: (savedData.discount_physiotherapy !== null && savedData.discount_physiotherapy !== 0) ? savedData.discount_physiotherapy.toString() : '',
          consultation: (savedData.discount_consultation !== null && savedData.discount_consultation !== 0) ? savedData.discount_consultation.toString() : '',
          surgeryInternalReport: (savedData.discount_surgery_internal_report !== null && savedData.discount_surgery_internal_report !== 0) ? savedData.discount_surgery_internal_report.toString() : '',
          implantCost: (savedData.discount_implant_cost !== null && savedData.discount_implant_cost !== 0) ? savedData.discount_implant_cost.toString() : '',
          private: (savedData.discount_private !== null && savedData.discount_private !== 0) ? savedData.discount_private.toString() : '',
          accommodationCharges: (savedData.discount_accommodation_charges !== null && savedData.discount_accommodation_charges !== 0) ? savedData.discount_accommodation_charges.toString() : '',
          advancePayment: '' // Not applicable for discounts
        };

        return discountValues;
      } else {
        console.log('📝 [DISCOUNT LOAD] No saved discount values found in database');
        return null;
      }
    } catch (error) {
      console.error('❌ [DISCOUNT LOAD] Exception loading saved discount values:', error);
      return null;
    }
  }, [billId]);

  const saveDiscountValues = useCallback(async (discountData: any) => {
    if (!billId) {
      console.log('🚫 [DISCOUNT SAVE] No billId provided');
      return false;
    }

    console.log('💾 [DISCOUNT SAVE] Saving discount values to database...');
    try {
      const dbData = {
        bill_id: billId,
        discount_total: discountData.total && discountData.total.trim() !== '' && discountData.total.trim() !== '0' ? parseFloat(discountData.total) : null,
        discount_clinical_services: discountData.clinicalServices && discountData.clinicalServices.trim() !== '' && discountData.clinicalServices.trim() !== '0' ? parseFloat(discountData.clinicalServices) : null,
        discount_laboratory_services: discountData.laboratoryServices && discountData.laboratoryServices.trim() !== '' && discountData.laboratoryServices.trim() !== '0' ? parseFloat(discountData.laboratoryServices) : null,
        discount_radiology: discountData.radiology && discountData.radiology.trim() !== '' && discountData.radiology.trim() !== '0' ? parseFloat(discountData.radiology) : null,
        discount_pharmacy: discountData.pharmacy && discountData.pharmacy.trim() !== '' && discountData.pharmacy.trim() !== '0' ? parseFloat(discountData.pharmacy) : null,
        discount_implant: discountData.implant && discountData.implant.trim() !== '' && discountData.implant.trim() !== '0' ? parseFloat(discountData.implant) : null,
        discount_blood: discountData.blood && discountData.blood.trim() !== '' && discountData.blood.trim() !== '0' ? parseFloat(discountData.blood) : null,
        discount_surgery: discountData.surgery && discountData.surgery.trim() !== '' && discountData.surgery.trim() !== '0' ? parseFloat(discountData.surgery) : null,
        discount_mandatory_services: discountData.mandatoryServices && discountData.mandatoryServices.trim() !== '' && discountData.mandatoryServices.trim() !== '0' ? parseFloat(discountData.mandatoryServices) : null,
        discount_physiotherapy: discountData.physiotherapy && discountData.physiotherapy.trim() !== '' && discountData.physiotherapy.trim() !== '0' ? parseFloat(discountData.physiotherapy) : null,
        discount_consultation: discountData.consultation && discountData.consultation.trim() !== '' && discountData.consultation.trim() !== '0' ? parseFloat(discountData.consultation) : null,
        discount_surgery_internal_report: discountData.surgeryInternalReport && discountData.surgeryInternalReport.trim() !== '' && discountData.surgeryInternalReport.trim() !== '0' ? parseFloat(discountData.surgeryInternalReport) : null,
        discount_implant_cost: discountData.implantCost && discountData.implantCost.trim() !== '' && discountData.implantCost.trim() !== '0' ? parseFloat(discountData.implantCost) : null,
        discount_private: discountData.private && discountData.private.trim() !== '' && discountData.private.trim() !== '0' ? parseFloat(discountData.private) : null,
        discount_accommodation_charges: discountData.accommodationCharges && discountData.accommodationCharges.trim() !== '' && discountData.accommodationCharges.trim() !== '0' ? parseFloat(discountData.accommodationCharges) : null
      };

      const { error: upsertError } = await supabase
        .from('financial_summary')
        .upsert(dbData, { onConflict: 'bill_id', ignoreDuplicates: false });

      if (upsertError) {
        console.error('❌ [DISCOUNT SAVE] Error saving discount values:', upsertError);
        return false;
      }

      return true;
    } catch (error) {
      console.error('❌ [DISCOUNT SAVE] Exception saving discount values:', error);
      return false;
    }
  }, [billId]);

  // 🧮 ENHANCED MANUAL CALCULATION: Load discount values first, then calculate
  const calculateBalanceWithDiscount = useCallback(async () => {
    console.log('🧮 [MANUAL CALCULATE] Starting enhanced balance calculation...');

    // Step 1: Load current discount values from database
    const savedDiscountValues = await loadSavedDiscountValues();
    console.log('🔍 [MANUAL CALCULATE] Loaded discount values:', savedDiscountValues);

    setFinancialSummaryDataTracked(prev => {
      // Step 2: Use saved discount values if available, otherwise use memory values
      const currentDiscountValues = savedDiscountValues || prev.discount;
      const discountTotal = parseFloat(currentDiscountValues.total) || 0;
      const totalAmount = parseFloat(prev?.totalAmount?.total) || 0;
      const amountPaidTotal = parseFloat(prev?.amountPaid?.total) || 0;
      const refundedTotal = parseFloat(prev?.refundedAmount?.total) || 0;
      const finalPaymentTotal = parseFloat(prev.finalPayment?.total) || 0;

      // Calculate new balance: Total - Discount - Amount Paid - Final Payment + Refunded
      const newBalance = totalAmount - discountTotal - amountPaidTotal - finalPaymentTotal + refundedTotal;

      console.log('🧮 [MANUAL CALCULATE] Enhanced balance calculation:', {
        totalAmount,
        discountTotal,
        amountPaidTotal,
        finalPaymentTotal,
        refundedTotal,
        newBalance,
        discountSource: savedDiscountValues ? 'database' : 'memory'
      });

      return {
        ...prev,
        // Update discount values if loaded from database
        discount: currentDiscountValues,
        balance: {
          ...prev.balance,
          total: newBalance.toString()
        }
      };
    });

  }, [loadSavedDiscountValues]);

  // Note: Auto-populate is now manual only via "Refresh table" button
  // This prevents overwriting saved discount values on page load

  const displayedFinancialSummaryData = useMemo<FinancialSummaryData>(() => {
    if (
      amountPaidOverrideEvent?.action !== 'set' ||
      amountPaidOverrideEvent.display_amount === null
    ) {
      return financialSummaryData;
    }

    const displayAmount = Number(amountPaidOverrideEvent.display_amount);
    if (!Number.isFinite(displayAmount) || displayAmount < 0) {
      return financialSummaryData;
    }

    return {
      ...financialSummaryData,
      amountPaid: {
        ...financialSummaryData.amountPaid,
        advancePayment: displayAmount.toString(),
      },
    };
  }, [amountPaidOverrideEvent, financialSummaryData]);

  return {
    financialSummaryData: displayedFinancialSummaryData,
    setFinancialSummaryData: setFinancialSummaryDataTracked,
    packageDates,
    setPackageDates,
    isLoading,
    isSaving,
    isAutoSaving,
    lastSaveTime,
    userHasModifiedDiscounts,
    isStateLocked,
    isInitializing,
    saveFinancialSummary,
    handleFinancialSummaryChange,
    loadFinancialSummary,
    autoPopulateFinancialData,
    calculateBalanceWithDiscount,
    loadSavedDiscountValues,
    saveDiscountValues
  };
};
