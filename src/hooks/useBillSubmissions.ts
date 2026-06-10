import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface BillSubmissionInput {
  visit_id: string;
  corporate?: string;
  bill_amount?: number;
  executive_who_submitted?: string;
  date_of_submission?: string;
  intimation_date?: string;
  expected_payment_date?: string;
  received_amount?: number;
  deduction_amount?: number;
  tds_amount?: number;
  received_date?: string;
}

// Corporate short name mapping for bill number prefix
const getCorporateBillPrefix = (corporateName: string | null | undefined): string => {
  if (!corporateName || corporateName.trim() === '' || corporateName.toLowerCase() === 'private') {
    return 'PVT';
  }
  const shortNameMap: Record<string, string> = {
    'Mahatma Jyotirao Phule jan Arogya Yojana (MJPJAY)': 'MJPJAY',
    'Ayushman Bharat - Pradhan Mantri Jan Arogya Yojna (PM-JAY)': 'PM-JAY',
    'Rashtriya Bal Swasthya Karyakram (RBSK)': 'RBSK',
    'Central Government Health Scheme (CGHS)': 'CGHS',
    'Ex Serviceman Contributory Health Scheme (ECHS)': 'ECHS',
    'Maharashtra Police Kutumb Arogya Yojana (MPKAY)': 'MPKAY',
    'MIKSSKAY - Maharashtra Karagruh Va Sudhar Sevabal Kutumb Arogya Yojana': 'MIKSSKAY',
    'Maharashtra Dharmadaya Karmachari Kutumbe Seashya Yojana (MDKKSY)': 'MDKKSY',
    'Coal India Limited (CIL)': 'CIL',
    'Central Railways (C.Rly)': 'CR',
    'South Eastern Central Railway (SECR)': 'SECR',
    'Western Coalfield Limited (WCL)': 'WCL',
  };
  return shortNameMap[corporateName] || corporateName.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
};

// Detect government scheme (yojna) corporates so the right bill page/total is shown
const isYojnaCorporate = (corp?: string | null) =>
  /yojna|yojana|pm-?jay|mjpjay|ayushman|rbsk/i.test(corp || '');

// Generate bill numbers for submissions grouped by corporate-month
const assignBillNumbers = (
  submissions: any[],
  billNoMap: Record<string, string>
): any[] => {
  const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

  // Sort by admission_date ascending so serial numbers are chronological
  const sorted = [...submissions].sort((a, b) => {
    const dateA = a.visits?.admission_date || a.created_at || '';
    const dateB = b.visits?.admission_date || b.created_at || '';
    return dateA.localeCompare(dateB);
  });

  // Track serial counters per corporate-month group
  const counters: Record<string, number> = {};

  for (const item of sorted) {
    // If already has a bill_no from bills table, keep it
    if (billNoMap[item.visit_id]) {
      item._bill_no = billNoMap[item.visit_id];
      continue;
    }

    const corporate = item.visits?.patients?.corporate || '';
    const prefix = getCorporateBillPrefix(corporate);
    const admissionDate = item.visits?.admission_date || item.created_at || '';
    const date = admissionDate ? new Date(admissionDate) : new Date();
    const month = monthNames[date.getMonth()];
    const groupKey = `${prefix}-${month}`;

    if (!counters[groupKey]) {
      counters[groupKey] = 0;
    }
    counters[groupKey]++;
    item._bill_no = `${groupKey}-${String(counters[groupKey]).padStart(3, '0')}`;
  }

  return sorted;
};

// Fetch all bill submissions with patient info via join, filtered by hospital
export const useBillSubmissions = (hospitalName?: string) => {
  return useQuery({
    queryKey: ['bill-submissions', hospitalName],
    queryFn: async () => {
      let query = supabase
        .from('bill_preparation' as any)
        .select(`
          id,
          visit_id,
          corporate,
          bill_amount,
          executive_who_submitted,
          date_of_submission,
          intimation_date,
          expected_payment_date,
          received_amount,
          deduction_amount,
          tds_amount,
          received_date,
          created_at,
          visits!inner!visit_id(
            admission_date,
            discharge_date,
            patients!inner(name, corporate, hospital_name)
          )
        `)
        .order('created_at', { ascending: false });

      // Filter by hospital if provided
      if (hospitalName) {
        query = query.eq('visits.patients.hospital_name', hospitalName);
      }

      const { data, error } = await query;

      if (error) throw error;

      // Fetch bill numbers for all visit_ids from bills table
      const visitIds = (data || []).map((item: any) => item.visit_id).filter(Boolean);
      let billNoMap: Record<string, string> = {};
      const finalTotalMap: Record<string, number> = {};
      const yojnaTotalMap: Record<string, number> = {};
      if (visitIds.length > 0) {
        const { data: billsData } = await (supabase as any)
          .from('bills')
          .select('visit_id, bill_no, formatted_bill_no')
          .in('visit_id', visitIds);
        if (billsData) {
          for (const b of billsData) {
            if (b.visit_id) billNoMap[b.visit_id] = b.formatted_bill_no || b.bill_no || '';
          }
        }

        // Final (corporate) bill totals. The bills table has many duplicate/0-amount draft
        // rows per visit, so take the latest NON-ZERO total: filter > 0, newest first, keep
        // the first one seen per visit.
        const { data: finalTotals } = await (supabase as any)
          .from('bills')
          .select('visit_id, total_amount, created_at')
          .in('visit_id', visitIds)
          .gt('total_amount', 0)
          .order('created_at', { ascending: false });
        if (finalTotals) {
          for (const b of finalTotals) {
            if (b.visit_id && finalTotalMap[b.visit_id] == null) {
              finalTotalMap[b.visit_id] = b.total_amount;
            }
          }
        }

        // Yojna bill totals (separate yojna_bills table written by the Yojna Bill page):
        // latest non-zero per visit, same approach.
        const { data: yojnaData } = await (supabase as any)
          .from('yojna_bills')
          .select('visit_id, total_amount, updated_at')
          .in('visit_id', visitIds)
          .gt('total_amount', 0)
          .order('updated_at', { ascending: false });
        if (yojnaData) {
          for (const y of yojnaData) {
            if (y.visit_id && yojnaTotalMap[y.visit_id] == null) {
              yojnaTotalMap[y.visit_id] = y.total_amount;
            }
          }
        }
      }

      // Assign bill numbers (from bills table or auto-generated)
      const withBillNos = assignBillNumbers(data || [], billNoMap);

      // Map data to include patient_name, dates, and bill_no
      return withBillNos.map((item: any) => {
        const corp = item.visits?.patients?.corporate || '';
        const yt = yojnaTotalMap[item.visit_id];
        const ft = finalTotalMap[item.visit_id];
        const preferYojna = isYojnaCorporate(corp);
        // Pick by corporate type, but fall back to whichever bill actually exists
        const useYojna = preferYojna ? (yt != null || ft == null) : (ft == null && yt != null);
        const bill_total = useYojna ? (yt ?? null) : (ft ?? null);
        const bill_link = useYojna ? `/yojna-bill/${item.visit_id}` : `/final-bill/${item.visit_id}`;

        return {
          ...item,
          bill_no: item._bill_no || billNoMap[item.visit_id] || '',
          patient_name: item.visits?.patients?.name || '',
          patient_corporate: item.visits?.patients?.corporate || '',
          admission_date: item.visits?.admission_date || '',
          discharge_date: item.visits?.discharge_date || '',
          intimation_date: item.intimation_date || '',
          bill_total,
          bill_link,
        };
      });
    },
  });
};

// Create bill submission (merge-upsert: preserves existing values, never overwrites with null)
export const useCreateBillSubmission = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: BillSubmissionInput) => {
      // Fetch existing record to merge (prevent overwriting saved dates with null)
      const { data: existing } = await supabase
        .from('bill_preparation' as any)
        .select('*')
        .eq('visit_id', data.visit_id)
        .maybeSingle();

      const merged = {
        visit_id: data.visit_id,
        corporate: data.corporate || existing?.corporate || null,
        bill_amount: data.bill_amount || existing?.bill_amount || 0,
        executive_who_submitted: data.executive_who_submitted || existing?.executive_who_submitted || null,
        date_of_submission: data.date_of_submission || existing?.date_of_submission || null,
        intimation_date: data.intimation_date || existing?.intimation_date || null,
        expected_payment_date: data.expected_payment_date || existing?.expected_payment_date || null,
        received_amount: data.received_amount ?? existing?.received_amount ?? null,
        deduction_amount: data.deduction_amount ?? existing?.deduction_amount ?? null,
        tds_amount: data.tds_amount ?? existing?.tds_amount ?? null,
        received_date: data.received_date || existing?.received_date || null,
      };

      const { data: result, error } = await supabase
        .from('bill_preparation' as any)
        .upsert(merged, { onConflict: 'visit_id' })
        .select()
        .single();

      if (error) throw error;
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bill-submissions'] });
      toast.success('Bill submission saved successfully');
    },
    onError: (error) => {
      toast.error('Failed to save bill submission: ' + error.message);
    },
  });
};

// Update bill submission
export const useUpdateBillSubmission = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...data }: BillSubmissionInput & { id: string }) => {
      // Only send fields that were explicitly provided — never overwrite existing
      // values with null/0 for fields the caller didn't touch (e.g. kanban partial updates)
      const patch: Record<string, any> = {};
      if (data.visit_id !== undefined) patch.visit_id = data.visit_id;
      if (data.corporate !== undefined) patch.corporate = data.corporate || null;
      if (data.bill_amount !== undefined) patch.bill_amount = data.bill_amount;
      if (data.executive_who_submitted !== undefined) patch.executive_who_submitted = data.executive_who_submitted || null;
      if (data.date_of_submission !== undefined) patch.date_of_submission = data.date_of_submission || null;
      if (data.intimation_date !== undefined) patch.intimation_date = data.intimation_date || null;
      if (data.expected_payment_date !== undefined) patch.expected_payment_date = data.expected_payment_date || null;
      if (data.received_amount !== undefined) patch.received_amount = data.received_amount;
      if (data.deduction_amount !== undefined) patch.deduction_amount = data.deduction_amount;
      if (data.tds_amount !== undefined) patch.tds_amount = data.tds_amount;
      if (data.received_date !== undefined) patch.received_date = data.received_date || null;

      const { data: result, error } = await supabase
        .from('bill_preparation' as any)
        .update(patch)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bill-submissions'] });
      toast.success('Bill submission updated successfully');
    },
    onError: (error) => {
      toast.error('Failed to update bill submission: ' + error.message);
    },
  });
};

// Delete bill submission
export const useDeleteBillSubmission = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('bill_preparation' as any)
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bill-submissions'] });
      toast.success('Bill submission deleted successfully');
    },
    onError: (error) => {
      toast.error('Failed to delete bill submission: ' + error.message);
    },
  });
};
