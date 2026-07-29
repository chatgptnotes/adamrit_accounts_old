
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { RequestTimeoutError, withTimeout } from '@/utils/withTimeout';
import { useInvoiceAccess } from '@/hooks/useInvoiceAccess';

const FINAL_BILL_REQUEST_TIMEOUT_MS = 15_000;
const FINAL_BILL_TRANSIENT_RETRY_DELAY_MS = 800;

type InvoiceContentResponse = {
  ok?: boolean;
  error?: string;
  reason?: string;
  stage?: string;
  retryable?: boolean;
  requestId?: string;
  sections?: BillSection[];
  line_items?: BillLineItem[];
  bill_items_json?: unknown;
  bill_patient_data?: unknown;
};

class InvoiceContentRequestError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  readonly requestId: string | null;
  readonly stage: string | null;

  constructor(
    message: string,
    options: { status?: number; retryable?: boolean; requestId?: string | null; stage?: string | null } = {},
  ) {
    super(message);
    this.name = 'InvoiceContentRequestError';
    this.status = options.status ?? 0;
    this.retryable = options.retryable ?? false;
    this.requestId = options.requestId ?? null;
    this.stage = options.stage ?? null;
  }
}

const waitForRetry = (signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, FINAL_BILL_TRANSIENT_RETRY_DELAY_MS);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });

const fetchInvoiceContent = async (
  billId: string,
  grantToken: string | null | undefined,
  querySignal: AbortSignal,
): Promise<InvoiceContentResponse> => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (querySignal.aborted) throw querySignal.reason;

    const controller = new AbortController();
    const forwardAbort = () => controller.abort(querySignal.reason);
    querySignal.addEventListener('abort', forwardAbort, { once: true });
    const timeout = window.setTimeout(
      () => controller.abort(new RequestTimeoutError('Loading bill content', FINAL_BILL_REQUEST_TIMEOUT_MS)),
      FINAL_BILL_REQUEST_TIMEOUT_MS,
    );

    try {
      const response = await fetch('/api/invoice-content', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ billId, grantToken }),
        signal: controller.signal,
      });
      const responseRequestId = response.headers.get('x-request-id');
      const contentType = response.headers.get('content-type') || '';
      const rawBody = await response.text();
      let content: InvoiceContentResponse | null = null;
      try {
        content = rawBody ? JSON.parse(rawBody) as InvoiceContentResponse : null;
      } catch {
        content = null;
      }

      if (response.ok && content?.ok) return content;

      const isMalformedGatewayResponse = !content && response.status >= 500;
      const retryable = content?.retryable ??
        (isMalformedGatewayResponse || [502, 503, 504].includes(response.status));
      const requestId = content?.requestId || responseRequestId;
      const message = content?.reason || content?.error || 'Unable to load bill content';
      const requestError = new InvoiceContentRequestError(message, {
        status: response.status,
        retryable,
        requestId,
        stage: content?.stage || (!content ? 'gateway' : null),
      });

      console.error('❌ Invoice content request failed:', {
        status: response.status,
        contentType,
        retryable,
        requestId,
        stage: requestError.stage,
      });

      if (!retryable || attempt === 1) throw requestError;
    } catch (error) {
      if (querySignal.aborted) throw querySignal.reason;

      const timeoutReason = controller.signal.aborted && controller.signal.reason instanceof RequestTimeoutError
        ? controller.signal.reason
        : null;
      const requestError = error instanceof InvoiceContentRequestError
        ? error
        : new InvoiceContentRequestError(
          timeoutReason?.message || (error instanceof Error ? error.message : 'Unable to load bill content'),
          { retryable: true, stage: timeoutReason ? 'timeout' : 'network' },
        );
      if (!requestError.retryable || attempt === 1) throw requestError;
    } finally {
      window.clearTimeout(timeout);
      querySignal.removeEventListener('abort', forwardAbort);
    }

    await waitForRetry(querySignal);
  }

  throw new InvoiceContentRequestError('Unable to load bill content');
};

export interface BillSection {
  id: string;
  section_title: string;
  date_from: string | null;
  date_to: string | null;
  section_order: number;
  conservative_additional_start?: string | null;
  conservative_additional_end?: string | null;
  additionalDateRanges?: any[];
}

export interface BillLineItem {
  id: string;
  bill_section_id: string | null;
  sr_no: string;
  item_description: string;
  cghs_nabh_code: string | null;
  cghs_nabh_rate: number | null;
  qty: number;
  amount: number;
  item_type: 'standard' | 'surgical';
  base_amount: number | null;
  primary_adjustment: string | null;
  secondary_adjustment: string | null;
  dates_info: string | null;
  item_order: number;
}

export interface BillData {
  id: string;
  bill_no: string;
  claim_id: string;
  date: string;
  category: string;
  total_amount: number;
  status: string;
  visit_id?: string;
  admission_date?: string;
  discharge_date?: string;
  visit_date?: string;
  visit_created_at?: string;
  sections: BillSection[];
  line_items: BillLineItem[];
}

export const useFinalBillData = (visitId: string) => {
  const queryClient = useQueryClient();
  const access = useInvoiceAccess({ visitId });

  const { data: billData, isLoading, error: queryError, refetch } = useQuery({
    queryKey: ['final-bill', visitId, access.grantToken],
    queryFn: async ({ signal }) => {
      try {
        console.log('🔍 Fetching bill data for visit ID:', visitId);

        // Get visit dates
        const { data: visitData, error: visitError } = await withTimeout(
          supabase
            .from('visits')
            .select('patient_id, admission_date, discharge_date, created_at, visit_date')
            .eq('visit_id', visitId)
            .single() as { data: any; error: any },
          FINAL_BILL_REQUEST_TIMEOUT_MS,
          'Loading visit data',
        );

        if (visitError) {
          console.error('❌ Error fetching visit:', visitError);
          if (visitError.code === 'PGRST116') {
            console.warn(`⚠️ No visit found with visit_id: ${visitId}`);
            return null;
          }
          throw visitError;
        }

        if (!visitData?.patient_id) {
          console.warn('⚠️ Visit found but patient_id is missing:', visitData);
          return null;
        }

        console.log('✅ Visit data found:', {
          patient_id: visitData.patient_id,
          admission_date: visitData.admission_date,
          visit_date: visitData.visit_date
        });

        // First try to find bill by visit_id (exact match)
        const { data: billByVisit } = await withTimeout(
          supabase
            .from('bills')
            .select('*')
            .eq('visit_id', visitId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle() as { data: any },
          FINAL_BILL_REQUEST_TIMEOUT_MS,
          'Loading bill data',
        );

        // Use bill found by visit_id only — no patient_id fallback (would load previous visit's bill)
        const billsData = billByVisit;

        if (!billsData) {
          return null;
        }


        const content = await fetchInvoiceContent(billsData.id, access.grantToken, signal);

        const sectionsData = (content as any)?.sections || [];
        const lineItemsData = (content as any)?.line_items || [];

        const result = {
          ...billsData,
          admission_date: visitData.admission_date,
          discharge_date: visitData.discharge_date,
          visit_date: visitData.visit_date,
          visit_created_at: visitData.created_at,
          sections: sectionsData || [],
          line_items: lineItemsData || [],
          bill_items_json: (content as any)?.bill_items_json ?? null,
          bill_patient_data: (content as any)?.bill_patient_data ?? null,
        } as BillData;

        return result;
      } catch (err) {
        console.error('❌ Unexpected error in useFinalBillData:', err);
        throw err;
      }
    },
    enabled: !!visitId && !access.needsGate && !access.isLockLoading,
    retry: false,
  });

  const saveBillMutation = useMutation({
    mutationFn: async (billData: {
      id?: string;
      patient_id: string;
      visit_id?: string;
      bill_no: string;
      claim_id: string;
      date: string;
      category: string;
      total_amount: number;
      sections: any[];
      line_items: any[];
      bill_patient_data?: any;
      bill_items_json?: any;
    }) => {
      console.log('💾 Starting bill save with total_amount:', billData.total_amount);

      // Find existing bill: first by id, then by visit_id, then by patient_id
      let existingBillId = billData.id;

      if (!existingBillId && (billData.visit_id || visitId)) {
        const { data: existingBill } = await supabase
          .from('bills')
          .select('id')
          .eq('visit_id', billData.visit_id || visitId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle() as { data: any };
        if (existingBill) {
          existingBillId = existingBill.id;
          console.log('📌 Found existing bill by visit_id:', existingBillId);
        }
      }

      let bill: any = null;
      let billError: any = null;

      if (existingBillId) {
        // UPDATE existing bill - only edit, no new row
        console.log('📝 Updating existing bill:', existingBillId);

        // Preserve approval status — don't reset to DRAFT if already submitted for approval
        const { data: currentBill } = await supabase
          .from('bills')
          .select('status')
          .eq('id', existingBillId)
          .single();
        const preserveStatus = currentBill?.status === 'PENDING_APPROVAL' || currentBill?.status === 'APPROVED';

        const result = await supabase
          .from('bills')
          .update({
            bill_no: billData.bill_no,
            claim_id: billData.claim_id,
            date: billData.date,
            category: billData.category,
            total_amount: billData.total_amount,
            visit_id: billData.visit_id || visitId,
            bill_patient_data: billData.bill_patient_data || {},
            bill_items_json: billData.bill_items_json || null,
            ...(preserveStatus ? {} : { status: 'DRAFT' })
          } as any)
          .eq('id', existingBillId)
          .select()
          .single();
        bill = result.data;
        billError = result.error;
      } else {
        // INSERT new bill only if no existing bill found
        console.log('🆕 Creating new bill (first time for this visit)');
        const result = await supabase
          .from('bills')
          .insert({
            patient_id: billData.patient_id,
            visit_id: billData.visit_id || visitId,
            bill_no: billData.bill_no,
            claim_id: billData.claim_id,
            date: billData.date,
            category: billData.category,
            total_amount: billData.total_amount,
            bill_patient_data: billData.bill_patient_data || {},
            bill_items_json: billData.bill_items_json || null,
            status: 'DRAFT'
          } as any)
          .select()
          .single();
        bill = result.data;
        billError = result.error;
      }

      if (billError) {
        console.error('Error saving bill:', billError);
        throw billError;
      }

      // Delete existing sections and line items (then re-insert fresh)
      await supabase.from('bill_sections').delete().eq('bill_id', bill.id);
      await supabase.from('bill_line_items').delete().eq('bill_id', bill.id);

      // Save sections
      if (billData.sections.length > 0) {
        const sectionsToInsert = billData.sections.map((section: any, index: number) => ({
          bill_id: bill.id,
          section_title: section.title,
          date_from: section.dates?.from ? new Date(section.dates.from).toISOString().split('T')[0] : null,
          date_to: section.dates?.to ? new Date(section.dates.to).toISOString().split('T')[0] : null,
          section_order: index,
          conservative_additional_start: section.conservative_additional_start ?
            new Date(section.conservative_additional_start).toISOString().split('T')[0] : null,
          conservative_additional_end: section.conservative_additional_end ?
            new Date(section.conservative_additional_end).toISOString().split('T')[0] : null
        }));

        const { error: sectionsError } = await supabase
          .from('bill_sections')
          .insert(sectionsToInsert as any);

        if (sectionsError) {
          console.error('Error saving sections:', sectionsError);
          throw sectionsError;
        }
      }

      // Save line items
      if (billData.line_items.length > 0) {
        const lineItemsToInsert = billData.line_items.map((item: any, index: number) => ({
          bill_id: bill.id,
          bill_section_id: null,
          sr_no: item.srNo || `${index + 1}`,
          item_description: item.description || '',
          cghs_nabh_code: item.code || null,
          cghs_nabh_rate: item.rate ? parseFloat(item.rate.toString()) : null,
          qty: item.qty || 1,
          amount: item.amount ? parseFloat(item.amount.toString()) : 0,
          item_type: item.type || 'standard',
          base_amount: item.type === 'surgical' && item.baseAmount ? parseFloat(item.baseAmount.toString()) : null,
          primary_adjustment: item.type === 'surgical' ? item.primaryAdjustment : null,
          secondary_adjustment: item.type === 'surgical' ? item.secondaryAdjustment : null,
          dates_info: item.dates ? JSON.stringify(item.dates) : null,
          item_order: index
        }));

        const { error: lineItemsError } = await supabase
          .from('bill_line_items')
          .insert(lineItemsToInsert as any);

        if (lineItemsError) {
          console.error('Error saving line items:', lineItemsError);
          throw lineItemsError;
        }
      }


      // WhatsApp alert for invoices > Rs. 1,00,000
      if (bill.total_amount >= 100000) {
        import('@/lib/payment-alert-service').then(({ sendPaymentAlert }) => {
          sendPaymentAlert({
            alert_type: 'invoice',
            amount: bill.total_amount,
            patient_name: bill.bill_patient_data?.name || 'Patient',
            patient_id: bill.patient_id,
            visit_id: bill.visit_id || visitId,
            additional_info: `Bill No: ${bill.bill_no || 'N/A'}, Category: ${bill.category || 'N/A'}`,
          });
        });
      }

      return bill;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['final-bill', visitId] });
    },
  });

  return {
    billData,
    isLoading,
    // A transient background refresh must not replace a valid, already-rendered
    // bill with the full-screen error state in FinalBill.
    error: billData ? null : queryError,
    refetch,
    saveBill: saveBillMutation.mutate,
    saveBillAsync: saveBillMutation.mutateAsync,
    isSaving: saveBillMutation.isPending,
    access,
  };
};
