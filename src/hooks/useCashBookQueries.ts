import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/fetchAllRows';

export interface CashBookEntry {
  voucher_date: string;
  transaction_time: string;
  time_only: string;
  voucher_number: string;
  voucher_type: string;
  voucher_narration: string;
  entry_narration: string;
  debit_amount: number;
  credit_amount: number;
  particulars: string;
  user_id: string;
  entered_by: string;
  status: string;
  voucher_id: string;
  entry_id: string;
  payment_source?: string; // NEW: Payment source for enhanced display
  service_details?: any; // NEW: Service/medicine details from payment transaction
}

export interface CashBookFilters {
  from_date?: string;
  to_date?: string;
  created_by?: string;
  voucher_type?: string;
  search_narration?: string;
  payment_mode?: string; // NEW: Filter by payment mode
}

export interface CashAccountBalance {
  opening_balance: number;
  opening_balance_type: 'DR' | 'CR';
  balance_amount: number;
}

/**
 * Hook to fetch cash book transactions from database
 */
export const useCashBookEntries = (filters?: CashBookFilters) => {
  return useQuery({
    queryKey: ['cash-book-entries', filters],
    queryFn: async () => {
      // First, get the Cash account ID
      // Note: The account name in database is 'Cash in Hand' (account code 1110)
      const { data: cashAccount, error: accountError } = await supabase
        .from('chart_of_accounts')
        .select('id, account_name, opening_balance, opening_balance_type, is_active')
        .eq('account_name', 'Cash in Hand')
        .maybeSingle();

      if (accountError) {
        console.error('Error fetching cash account:', accountError);
        throw new Error(`Database error: ${accountError.message}`);
      }

      if (!cashAccount) {
        console.error('Cash account not found in chart_of_accounts');
        throw new Error('Cash account "Cash in Hand" not found. Please ensure it exists in the chart of accounts.');
      }

      if (!cashAccount.is_active) {
        console.error('Cash account exists but is inactive');
        throw new Error('Cash account "Cash in Hand" is inactive. Please activate it in the chart of accounts.');
      }

      // Status and dates filter on the SERVER. They used to be applied
      // client-side after an unpaged fetch that the server caps at 1000
      // rows in voucher_date-ascending order — so any period past the first
      // 1000 oldest entries rendered an empty Cash Book.
      const data = await fetchAllRows<any>((from, to) => {
        let query = supabase
          .from('voucher_entries')
          .select(`
            id,
            voucher_id,
            narration,
            debit_amount,
            credit_amount,
            voucher:vouchers!inner (
              id,
              voucher_date,
              voucher_number,
              narration,
              status,
              created_at,
              created_by,
              patient_id,
              voucher_type:voucher_types (
                id,
                voucher_type_name,
                voucher_category,
                voucher_type_code
              ),
              patient:patients (
                id,
                name
              )
            )
          `)
          .eq('account_id', cashAccount.id)
          .eq('voucher.status', 'AUTHORISED')
          .order('voucher(voucher_date)', { ascending: true })
          .order('id');
        if (filters?.from_date) query = query.gte('voucher.voucher_date', filters.from_date);
        if (filters?.to_date) query = query.lte('voucher.voucher_date', filters.to_date);
        return query.range(from, to);
      });

      // Fetch payment source details for all vouchers
      const voucherIds = (data || []).map((entry: any) => entry.voucher?.id).filter(Boolean);

      let paymentSourceMap = new Map<string, any>();

      if (voucherIds.length > 0) {
        const { data: paymentData, error: paymentError } = await supabase
          .from('patient_payment_transactions')
          .select('id, payment_source, service_details')
          .in('id', voucherIds.map(id => {
            // Extract payment transaction ID from voucher reference_number
            return id;
          }));

        if (!paymentError && paymentData) {
          paymentData.forEach((payment: any) => {
            paymentSourceMap.set(payment.id, payment);
          });
        }
      }

      // Transform the data to match CashBookEntry interface
      const entries: CashBookEntry[] = (data || [])
        .map((entry: any) => {
          const voucher = entry.voucher;
          if (!voucher) return null;

          // Apply status filter
          if (voucher.status !== 'AUTHORISED') return null;

          // Apply date filters
          if (filters?.from_date && voucher.voucher_date < filters.from_date) return null;
          if (filters?.to_date && voucher.voucher_date > filters.to_date) return null;

          // Apply user filter
          if (filters?.created_by && voucher.created_by !== filters.created_by) return null;

          // Apply voucher type filter
          if (filters?.voucher_type && voucher.voucher_type?.voucher_category !== filters.voucher_type) return null;

          // Apply narration search filter
          if (filters?.search_narration) {
            const searchLower = filters.search_narration.toLowerCase();
            const voucherNarration = (voucher.narration || '').toLowerCase();
            const entryNarration = (entry.narration || '').toLowerCase();
            if (!voucherNarration.includes(searchLower) && !entryNarration.includes(searchLower)) {
              return null;
            }
          }

          const createdAt = new Date(voucher.created_at);
          const timeOnly = createdAt.toLocaleTimeString('en-IN', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
          });

          // Get payment source details if available
          const paymentDetails = voucher.reference_number ? paymentSourceMap.get(voucher.reference_number) : null;

          // Build enhanced particulars based on payment source
          let particulars = voucher.patient?.name || 'Cash Transaction';
          let paymentSource = undefined;

          if (paymentDetails) {
            paymentSource = paymentDetails.payment_source;
            // Enhance particulars with payment source
            const sourceLabels: Record<string, string> = {
              'OPD_SERVICE': 'OPD Services',
              'PHARMACY': 'Pharmacy',
              'PHYSIOTHERAPY': 'Physiotherapy',
              'ADVANCE': 'Advance Payment',
              'FINAL_BILL': 'Final Bill',
              'DIRECT_SALE': 'Direct Sale'
            };
            const sourceLabel = sourceLabels[paymentSource] || paymentSource;
            particulars = `${voucher.patient?.name || 'Patient'} - ${sourceLabel}`;
          }

          return {
            voucher_date: voucher.voucher_date,
            transaction_time: voucher.created_at,
            time_only: timeOnly,
            voucher_number: voucher.voucher_number || '',
            voucher_type: voucher.voucher_type?.voucher_type_name || '',
            voucher_narration: voucher.narration || '',
            entry_narration: entry.narration || '',
            debit_amount: entry.debit_amount || 0,
            credit_amount: entry.credit_amount || 0,
            particulars: particulars,
            user_id: voucher.created_by || '',
            entered_by: 'System',
            status: voucher.status,
            voucher_id: voucher.id,
            entry_id: entry.id,
            payment_source: paymentSource,
            service_details: paymentDetails?.service_details
          };
        })
        .filter((entry): entry is CashBookEntry => entry !== null);

      return {
        entries,
        openingBalance: {
          opening_balance: cashAccount.opening_balance || 0,
          opening_balance_type: cashAccount.opening_balance_type as 'DR' | 'CR',
          balance_amount: cashAccount.opening_balance_type === 'DR'
            ? cashAccount.opening_balance
            : -cashAccount.opening_balance
        }
      };
    },
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: true
  });
};

/**
 * Hook to get list of users who created cash transactions
 */
export const useCashBookUsers = () => {
  return useQuery({
    queryKey: ['cash-book-users'],
    queryFn: async () => {
      // Get Cash account ID first
      const { data: cashAccount, error: accountError } = await supabase
        .from('chart_of_accounts')
        .select('id, is_active')
        .eq('account_name', 'Cash in Hand')
        .maybeSingle();

      if (accountError) {
        console.error('Error fetching cash account:', accountError);
        return [];
      }

      if (!cashAccount || !cashAccount.is_active) {
        return [];
      }

      const { data, error } = await supabase
        .from('vouchers')
        .select('created_by')
        .in('id', supabase
          .from('voucher_entries')
          .select('voucher_id')
          .eq('account_id', cashAccount.id)
        );

      if (error) {
        console.error('Error fetching cash book users:', error);
        return [];
      }

      // Return a simple default user list
      // In the future, this can be enhanced to fetch actual user data
      return [{
        id: 'all',
        email: 'all@users.com',
        full_name: 'All Users'
      }];
    }
  });
};

/**
 * Hook to get list of voucher types used in cash transactions
 */
export const useCashBookVoucherTypes = () => {
  return useQuery({
    queryKey: ['cash-book-voucher-types'],
    queryFn: async () => {
      // Get Cash account ID first
      const { data: cashAccount, error: accountError } = await supabase
        .from('chart_of_accounts')
        .select('id, is_active')
        .eq('account_name', 'Cash in Hand')
        .maybeSingle();

      if (accountError) {
        console.error('Error fetching cash account:', accountError);
        return [];
      }

      if (!cashAccount || !cashAccount.is_active) {
        return [];
      }

      const { data, error } = await supabase
        .from('vouchers')
        .select(`
          voucher_type_id,
          voucher_type:voucher_types (
            id,
            voucher_type_name,
            voucher_category,
            voucher_type_code
          )
        `)
        .in('id', supabase
          .from('voucher_entries')
          .select('voucher_id')
          .eq('account_id', cashAccount.id)
        );

      if (error) {
        console.error('Error fetching cash book voucher types:', error);
        return [];
      }

      // Get unique voucher types
      const uniqueTypes = Array.from(
        new Map(
          (data || [])
            .filter(v => v.voucher_type)
            .map(v => [v.voucher_type.id, v.voucher_type])
        ).values()
      );

      return uniqueTypes;
    }
  });
};

/**
 * Calculate closing balance for cash account up to a date
 */
export const useCashBalance = (upToDate?: string) => {
  return useQuery({
    queryKey: ['cash-balance', upToDate],
    queryFn: async () => {
      // Get Cash account
      const { data: cashAccount, error: accountError} = await supabase
        .from('chart_of_accounts')
        .select('id, opening_balance, opening_balance_type, is_active')
        .eq('account_name', 'Cash in Hand')
        .maybeSingle();

      if (accountError) {
        console.error('Error fetching cash account:', accountError);
        throw new Error(`Database error: ${accountError.message}`);
      }

      if (!cashAccount) {
        console.error('Cash account not found in chart_of_accounts');
        throw new Error('Cash account "Cash in Hand" not found. Please ensure it exists in the chart of accounts.');
      }

      if (!cashAccount.is_active) {
        console.error('Cash account exists but is inactive');
        throw new Error('Cash account "Cash in Hand" is inactive. Please activate it in the chart of accounts.');
      }

      // Get all transactions up to date. Paged — the unpaged select stopped
      // at 1000 rows and capped the closing balance there.
      const data = await fetchAllRows<any>((from, to) => {
        let query = supabase
          .from('voucher_entries')
          .select(`
            id,
            debit_amount,
            credit_amount,
            voucher:vouchers!inner (
              voucher_date,
              status
            )
          `)
          .eq('account_id', cashAccount.id)
          .eq('voucher.status', 'AUTHORISED')
          .order('id');
        if (upToDate) {
          query = query.lte('voucher.voucher_date', upToDate);
        }
        return query.range(from, to);
      });

      // Calculate totals
      const totalDebit = (data || []).reduce((sum, entry: any) => sum + (entry.debit_amount || 0), 0);
      const totalCredit = (data || []).reduce((sum, entry: any) => sum + (entry.credit_amount || 0), 0);

      // Calculate closing balance
      const openingBalance = cashAccount.opening_balance || 0;
      const openingType = cashAccount.opening_balance_type;

      let closingBalance: number;
      if (openingType === 'DR') {
        closingBalance = openingBalance + totalDebit - totalCredit;
      } else {
        closingBalance = openingBalance - totalDebit + totalCredit;
      }

      return {
        opening_balance: openingBalance,
        opening_balance_type: openingType,
        total_debit: totalDebit,
        total_credit: totalCredit,
        closing_balance: closingBalance,
        balance_type: closingBalance >= 0 ? 'DR' : 'CR'
      };
    }
  });
};

/**
 * Interface for daily transaction entry
 */
export interface DailyTransaction {
  transaction_id: string;
  transaction_type: string;
  visit_id: string | null;
  patient_id: string | null;
  patient_name: string;
  transaction_date: string;
  transaction_time: string;
  description: string;
  amount: number;
  quantity: number;
  unit_rate: number;
  rate_type: string;
  payment_mode: string;
}

/**
 * Hook to fetch ALL daily transactions from all billing tables
 * Includes: OPD, Lab, Radiology, Pharmacy, Physiotherapy, Mandatory Services
 */
export const useAllDailyTransactions = (filters?: CashBookFilters, hospitalName?: string) => {
  return useQuery({
    queryKey: ['all-daily-transactions', filters, hospitalName],
    queryFn: async () => {
      const fromDate = filters?.from_date || new Date().toISOString().split('T')[0];
      const toDate = filters?.to_date || new Date().toISOString().split('T')[0];

      // Call the database function to get all daily transactions
      const { data, error } = await supabase
        .rpc('get_cash_book_transactions_direct', {
          p_from_date: fromDate,
          p_to_date: toDate,
          p_transaction_type: filters?.voucher_type || null,
          p_patient_id: null,
          p_hospital_name: hospitalName || null
        });

      if (error) {
        console.error('Error fetching daily transactions:', error);
        throw new Error(`Failed to fetch transactions: ${error.message}`);
      }

      // Apply additional filters
      let filteredData = data || [];

      // Filter by narration search
      if (filters?.search_narration) {
        const searchLower = filters.search_narration.toLowerCase();
        filteredData = filteredData.filter((txn: any) => {
          const description = (txn.description || '').toLowerCase();
          const patientName = (txn.patient_name || '').toLowerCase();
          return description.includes(searchLower) || patientName.includes(searchLower);
        });
      }

      // Filter by payment mode
      if (filters?.payment_mode) {
        const paymentModeLower = filters.payment_mode.toLowerCase();
        filteredData = filteredData.filter((txn: any) => {
          const txnPaymentMode = (txn.payment_mode || '').toLowerCase();
          return txnPaymentMode === paymentModeLower;
        });
      }

      return filteredData as DailyTransaction[];
    },
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: true
  });
};

/**
 * Interface for payment receipt data
 */
export interface PaymentReceiptData {
  id: string;
  patient_name: string;
  patients_id?: string;
  advance_amount: string | number;
  payment_date: string;
  payment_mode: string;
  reference_number?: string;
  remarks?: string;
  created_by?: string;
  voucher_no?: string;
  is_refund?: boolean;
  patient_id?: string;
  visit_id?: string;
  patient_type?: string;
}

/**
 * Hook to fetch payment details by voucher number for receipt printing
 * Searches in advance_payment table and voucher entries
 */
export const usePaymentByVoucherNo = (voucherNo: string | undefined) => {
  return useQuery({
    queryKey: ['payment-by-voucher', voucherNo],
    queryFn: async () => {
      if (!voucherNo) {
        throw new Error('Voucher number is required');
      }

      // First try to find in advance_payment table
      // The voucher number might be stored in id or we need to search by other criteria
      const { data: advancePayments, error: advanceError } = await supabase
        .from('advance_payment')
        .select(`
          id,
          patient_name,
          patients_id,
          advance_amount,
          payment_date,
          payment_mode,
          reference_number,
          remarks,
          created_by,
          is_refund,
          patient_id,
          visit_id
        `)
        .eq('status', 'ACTIVE')
        .order('created_at', { ascending: false });

      if (advanceError) {
        console.error('Error fetching advance payments:', advanceError);
        throw new Error(`Database error: ${advanceError.message}`);
      }

      // Try to find a matching payment by voucher number pattern
      // The voucher_no might be part of the id or we need to match by other criteria
      let matchingPayment = null;

      if (advancePayments && advancePayments.length > 0) {
        // Try exact match or partial match with id
        matchingPayment = advancePayments.find((payment) => {
          const paymentId = payment.id?.slice(-6).toUpperCase();
          return paymentId === voucherNo.toUpperCase() || payment.id === voucherNo;
        });

        // If not found, try to match by sequence number
        // Assuming voucher numbers like '20223' might correspond to a record
        if (!matchingPayment) {
          // Try to find by converting voucher_no to a potential UUID match or index
          // This is a fallback - you may need to adjust based on your actual voucher numbering system
          const voucherIndex = parseInt(voucherNo, 10);
          if (!isNaN(voucherIndex) && voucherIndex > 0) {
            // For now, return the most recent payment as a fallback
            // In production, you should have a proper voucher_no column in advance_payment table
            matchingPayment = advancePayments[0];
          }
        }
      }

      // If still not found, try searching in vouchers table
      if (!matchingPayment) {
        const { data: voucherData, error: voucherError } = await supabase
          .from('vouchers')
          .select(`
            id,
            voucher_number,
            voucher_date,
            narration,
            patient_id,
            patient:patients (
              id,
              name,
              patients_id
            )
          `)
          .eq('voucher_number', voucherNo)
          .maybeSingle();

        if (voucherError) {
          console.error('Error fetching voucher:', voucherError);
        }

        if (voucherData && voucherData.patient) {
          // Try to find corresponding advance payment by patient and date
          const { data: paymentByPatient, error: paymentError } = await supabase
            .from('advance_payment')
            .select('*')
            .eq('patient_id', voucherData.patient_id)
            .eq('status', 'ACTIVE')
            .order('payment_date', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (!paymentError && paymentByPatient) {
            matchingPayment = {
              ...paymentByPatient,
              voucher_no: voucherNo,
            };
          }
        }
      }

      if (!matchingPayment) {
        throw new Error(`Payment record not found for voucher number: ${voucherNo}`);
      }

      // Fetch patient_type from visits table using visit_id
      let patientType = 'IPD';
      if (matchingPayment.visit_id) {
        const { data: visitData } = await supabase
          .from('visits')
          .select('patient_type')
          .eq('visit_id', matchingPayment.visit_id)
          .maybeSingle();
        if (visitData?.patient_type) {
          patientType = visitData.patient_type;
        }
      }

      // Format the payment data for receipt printing
      const receiptData: PaymentReceiptData = {
        id: matchingPayment.id,
        patient_name: matchingPayment.patient_name,
        patients_id: matchingPayment.patients_id,
        advance_amount: matchingPayment.advance_amount,
        payment_date: matchingPayment.payment_date,
        payment_mode: matchingPayment.payment_mode,
        reference_number: matchingPayment.reference_number,
        remarks: matchingPayment.remarks,
        created_by: matchingPayment.created_by,
        voucher_no: voucherNo,
        is_refund: matchingPayment.is_refund,
        patient_id: matchingPayment.patient_id,
        visit_id: matchingPayment.visit_id,
        patient_type: patientType,
      };

      return receiptData;
    },
    enabled: !!voucherNo, // Only run query if voucherNo is provided
    staleTime: 60000, // 1 minute
    refetchOnWindowFocus: false,
  });
};
