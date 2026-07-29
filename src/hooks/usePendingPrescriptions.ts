import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
// Use the anon data client: the shared OAuth-aware client returns 0 rows under
// an authenticated Google session, so the bell would silently show "0".
import { supabaseData as supabaseAnon } from '@/integrations/supabase/data-client';
import { buildPendingFilter } from '@/lib/ward-bridge-logic';

export interface PendingPrescription {
  id: string;
  prescription_number: string | null;
  doctor_name: string | null;
  prescription_date: string | null;
  created_at: string | null;
  patient_name: string;
  patient_location: string | null;
}

interface UsePendingPrescriptionsResult {
  count: number;
  recent: PendingPrescription[];
  isLoading: boolean;
}

export const pendingPrescriptionCountQueryKey = (hospitalType: string | null | undefined) =>
  ['pending-prescriptions', 'count', hospitalType] as const;

const fetchPendingPrescriptionCount = async (hospitalType: string | null | undefined): Promise<number> => {
  const { count, error } = await (supabaseAnon as any)
    .from('prescriptions')
    .select('id', { count: 'exact', head: true })
    .or(buildPendingFilter(hospitalType));
  if (error) return 0;
  return count ?? 0;
};

/**
 * Shared sidebar count query. It intentionally does not create a realtime
 * subscription; the Pharmacy Dashboard owns the single live subscription and
 * invalidates this same cached query when prescription data changes.
 */
export const usePendingPrescriptionCount = (enabled = true): number => {
  const { hospitalType } = useAuth();
  const { data = 0 } = useQuery({
    queryKey: pendingPrescriptionCountQueryKey(hospitalType),
    queryFn: () => fetchPendingPrescriptionCount(hospitalType),
    refetchInterval: 60_000,
    staleTime: 30_000,
    enabled: enabled && !!hospitalType,
  });

  return data;
};

export const usePendingPrescriptions = (): UsePendingPrescriptionsResult => {
  const queryClient = useQueryClient();
  const { hospitalType } = useAuth();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pending camera/manual prescriptions (any hospital) PLUS ward orders bridged
  // from the tablet — scoped to THIS hospital, with NULL-hospital ward orders
  // shown to everyone. See buildPendingFilter for the full rationale.
  const pendingFilter = buildPendingFilter(hospitalType);
  const COUNT_KEY = pendingPrescriptionCountQueryKey(hospitalType);
  const RECENT_KEY = ['pending-prescriptions', 'recent', hospitalType] as const;

  const countQuery = useQuery({
    queryKey: COUNT_KEY,
    queryFn: () => fetchPendingPrescriptionCount(hospitalType),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const recentQuery = useQuery({
    queryKey: RECENT_KEY,
    queryFn: async () => {
      const { data, error } = await (supabaseAnon as any)
        .from('prescriptions')
        .select('id, prescription_number, doctor_name, prescription_date, created_at, patient_location, patients(name)')
        .or(pendingFilter)
        .order('created_at', { ascending: false })
        .limit(5);

      if (error) throw error;

      return (data || []).map((r: any) => ({
        id: r.id,
        prescription_number: r.prescription_number,
        doctor_name: r.doctor_name,
        prescription_date: r.prescription_date,
        created_at: r.created_at,
        patient_name: r.patients?.name || 'Unknown',
        patient_location: r.patient_location || null,
      })) as PendingPrescription[];
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  useEffect(() => {
    const isRelevantPendingRow = (row: any): boolean => {
      if (!row) return false;
      if (row.status === 'PENDING') return true;
      return row.status === 'APPROVED' && row.source === 'ward' &&
        (row.hospital_name === hospitalType || row.hospital_name == null);
    };

    const channel = (supabaseAnon as any)
      .channel('prescription-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'prescriptions' },
        (payload: any) => {
          const evt = payload?.eventType;
          const row = payload?.new || {};
          const oldRow = payload?.old || {};
          const affectsPendingData = evt === 'DELETE'
            ? isRelevantPendingRow(oldRow)
            : isRelevantPendingRow(row) || (evt === 'UPDATE' && isRelevantPendingRow(oldRow));
          if (!affectsPendingData) return;
          if (debounceRef.current) clearTimeout(debounceRef.current);
          // Announce when new medicine reaches the pharmacy: either a brand-new
          // prescription card (INSERT), or a same-day ward re-send that bumps an
          // existing open card (UPDATE while still APPROVED). Dispense updates flip
          // the status away from APPROVED, so they don't fire a toast.
          const isNewCard = evt === 'INSERT';
          const isWardResend =
            evt === 'UPDATE' && row.source === 'ward' && row.status === 'APPROVED';
          const num = row.prescription_number;
          debounceRef.current = setTimeout(() => {
            queryClient.invalidateQueries({ queryKey: ['pending-prescriptions'] });
            if (isNewCard || isWardResend) {
              toast.success(num ? `New medicine order #${num}` : 'New medicine sent to pharmacy');
            }
          }, 500);
        }
      )
      .subscribe();

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      supabaseAnon.removeChannel(channel);
    };
  }, [queryClient]);

  return {
    count: countQuery.data ?? 0,
    recent: recentQuery.data ?? [],
    isLoading: countQuery.isLoading || recentQuery.isLoading,
  };
};
