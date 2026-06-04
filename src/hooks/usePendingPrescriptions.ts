import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';

export interface PendingPrescription {
  id: string;
  prescription_number: string | null;
  doctor_name: string | null;
  prescription_date: string | null;
  created_at: string | null;
  patient_name: string;
}

interface UsePendingPrescriptionsResult {
  count: number;
  recent: PendingPrescription[];
  isLoading: boolean;
}

export const usePendingPrescriptions = (): UsePendingPrescriptionsResult => {
  const queryClient = useQueryClient();
  const { hospitalType } = useAuth();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pending camera/manual prescriptions (any hospital, unchanged) PLUS ward
  // orders bridged from the tablet — scoped to THIS hospital so Hope and
  // Ayushman pharmacists only see their own ward orders.
  const pendingFilter = `status.eq.PENDING,and(status.eq.APPROVED,source.eq.ward,hospital_name.eq.${hospitalType})`;
  const COUNT_KEY = ['pending-prescriptions', 'count', hospitalType] as const;
  const RECENT_KEY = ['pending-prescriptions', 'recent', hospitalType] as const;

  const countQuery = useQuery({
    queryKey: COUNT_KEY,
    queryFn: async () => {
      const { count, error } = await (supabase as any)
        .from('prescriptions')
        .select('id', { count: 'exact', head: true })
        .or(pendingFilter);
      if (error) return 0;
      return count ?? 0;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const recentQuery = useQuery({
    queryKey: RECENT_KEY,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('prescriptions')
        .select('id, prescription_number, doctor_name, prescription_date, created_at, patients(name)')
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
      })) as PendingPrescription[];
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  useEffect(() => {
    const channel = (supabase as any)
      .channel('prescription-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'prescriptions' },
        (payload: any) => {
          if (debounceRef.current) clearTimeout(debounceRef.current);
          debounceRef.current = setTimeout(() => {
            queryClient.invalidateQueries({ queryKey: ['pending-prescriptions'] });
            // Only fire a toast for brand-new prescriptions, not for
            // updates (e.g. dispense) or deletes.
            if (payload?.eventType === 'INSERT') {
              const num = payload?.new?.prescription_number;
              toast.success(num ? `New prescription #${num}` : 'New prescription received');
            }
          }, 500);
        }
      )
      .subscribe();

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  return {
    count: countQuery.data ?? 0,
    recent: recentQuery.data ?? [],
    isLoading: countQuery.isLoading || recentQuery.isLoading,
  };
};
