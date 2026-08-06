import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export const usePendingBillCount = () => {
  const { user } = useAuth();
  const isAdminUser = user?.role === 'admin' || user?.role === 'superadmin' || user?.role === 'super_admin' || user?.role === 'ca';

  const { data: count = 0 } = useQuery({
    queryKey: ['pending-bill-count'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('bills')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'PENDING_APPROVAL');
      if (error) return 0;
      return count || 0;
    },
    enabled: isAdminUser,
    refetchInterval: 60000,
    staleTime: 30000,
  });

  return count;
};
