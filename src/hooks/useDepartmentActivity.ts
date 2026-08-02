import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { getDateRange } from '@/hooks/useDirectorKpis';

/**
 * CMD/Director "is each department entering data today?" monitor.
 *
 * Counts today's operational rows per department so the Director Dashboard can
 * raise an alarm when a department is silent. Presence/absence is what matters
 * here, so each query is an exact head-count (no rows transferred) and any error
 * falls back to 0 (shown as "no data" — same defensive pattern as useCounts).
 *
 * Hospital scoping: clinical tables link to a hospital only via visit_id, so v1
 * counts today's rows globally. Hospital separation can be layered later using
 * the hospitalVisitIds approach in useDirectorKpis.
 */
export interface DepartmentActivity {
  key: string;
  label: string;
  count: number;
  entered: boolean;
  route: string;
}

// Untyped client — several of these tables are absent from the stale generated
// Supabase types, matching how useDirectorKpis already queries them.
const sb = supabase as unknown as { from: (table: string) => any };

// Count rows in `table` whose timestamp column is within [start, end).
async function countSince(table: string, column: string, startISO: string, endISO: string): Promise<number> {
  try {
    const { count, error } = await sb
      .from(table)
      .select('*', { count: 'exact', head: true })
      .gte(column, startISO)
      .lt(column, endISO);
    if (error) {
      console.error(`Error counting ${table} activity:`, error);
      return 0;
    }
    return count || 0;
  } catch (error) {
    console.error(`Error in ${table} activity query:`, error);
    return 0;
  }
}

// Departments whose daily work is photo uploads (file_uploads categories) —
// radiology investigations, and the nurses' treatment sheets / vital charts.
async function countUploadsSince(categories: string[], startISO: string, endISO: string): Promise<number> {
  try {
    const { count, error } = await sb
      .from('file_uploads')
      .select('*', { count: 'exact', head: true })
      .in('category', categories)
      .gte('created_at', startISO)
      .lt('created_at', endISO);
    if (error) {
      console.error(`Error counting ${categories.join(',')} uploads:`, error);
      return 0;
    }
    return count || 0;
  } catch (error) {
    console.error(`Error in ${categories.join(',')} uploads query:`, error);
    return 0;
  }
}

// Count rows whose date-only column equals today's date string.
async function countOnDate(table: string, column: string, dateStr: string): Promise<number> {
  try {
    const { count, error } = await sb
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq(column, dateStr);
    if (error) {
      console.error(`Error counting ${table} activity:`, error);
      return 0;
    }
    return count || 0;
  } catch (error) {
    console.error(`Error in ${table} activity query:`, error);
    return 0;
  }
}

export const useDepartmentActivity = (enabled: boolean = true) => {
  const { data = [], isLoading, refetch } = useQuery<DepartmentActivity[]>({
    queryKey: ['department-activity-today'],
    queryFn: async () => {
      const { startISO, endISO, startDate } = getDateRange('today', '');

      const [lab, radiology, radiologyPhotos, pharmacy, ot, otUploads, nursing, nursingUploads, accounts, advance, finalPay] = await Promise.all([
        countSince('visit_labs', 'created_at', startISO, endISO),
        countSince('radiology_orders', 'created_at', startISO, endISO),
        countUploadsSince(['radiology_investigation'], startISO, endISO),
        countSince('visit_medications', 'created_at', startISO, endISO),
        countOnDate('ot_schedule', 'scheduled_date', startDate),
        // OT staff's uploads: surgery snaps, OT notes, implant photos/bills.
        countUploadsSince(['ot_photos', 'ot_notes', 'implant_sticker', 'implant_invoice'], startISO, endISO),
        countSince('vital_signs', 'recorded_at', startISO, endISO),
        // Nurses' documentation: treatment sheets, monitor/vital charts,
        // dialysis charts, clinical notes — each upload is an entry.
        countUploadsSince(['treatment_sheet', 'monitor_chart', 'dialysis', 'dialysis_scan', 'clinical_notes'], startISO, endISO),
        countOnDate('vouchers', 'voucher_date', startDate),
        countSince('advance_payment', 'created_at', startISO, endISO),
        countSince('final_payments', 'created_at', startISO, endISO),
      ]);

      const departments: DepartmentActivity[] = [
        { key: 'lab', label: 'Lab', count: lab, route: '/lab' },
        { key: 'radiology', label: 'Radiology', count: radiology + radiologyPhotos, route: '/radiology' },
        { key: 'pharmacy', label: 'Pharmacy', count: pharmacy, route: '/pharmacy' },
        { key: 'ot', label: 'Operation Theatre', count: ot + otUploads, route: '/ot' },
        { key: 'nursing', label: 'Nursing', count: nursing + nursingUploads, route: '/nursing' },
        { key: 'accounts', label: 'Accounts', count: accounts, route: '/accounting' },
        { key: 'collections', label: 'Collections', count: advance + finalPay, route: '/daily-payment-allocation' },
      ].map(d => ({ ...d, entered: d.count > 0 }));

      return departments;
    },
    retry: 0,
    refetchOnWindowFocus: false,
    refetchInterval: 60_000,
    staleTime: 60_000,
    enabled,
  });

  return { departments: data, isLoading, refetch };
};
