import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

const COUNT_STALE_TIME = 30 * 60 * 1000;

interface CountQueryResult {
  count: number | null;
  error: unknown;
}

interface CountQueryBuilder extends PromiseLike<CountQueryResult> {
  eq(column: string, value: string): CountQueryBuilder;
}

async function fetchExactCount(
  table: string,
  filter?: (query: CountQueryBuilder) => CountQueryBuilder
): Promise<number> {
  try {
    const builder = supabase.from(table).select('id', { count: 'exact', head: true }) as CountQueryBuilder;
    const { count, error } = await (filter ? filter(builder) : builder);

    if (error) {
      console.error(`Error fetching ${table} count:`, error);
      return 0;
    }

    return count || 0;
  } catch (error) {
    console.error(`Error in ${table} count query:`, error);
    return 0;
  }
}

/**
 * Hospital-scoped total patients count. Standalone so screens that only need
 * this number (e.g. the dashboard's Total Patients stat) share the app-level
 * cached query instead of mounting all sidebar counts.
 */
export const usePatientsCount = (enabled: boolean = true) => {
  const { hospitalConfig } = useAuth();
  return useQuery({
    queryKey: ['patients-count', hospitalConfig.name],
    queryFn: () =>
      fetchExactCount('patients', (query) => query.eq('hospital_name', hospitalConfig.name)),
    retry: 0,
    refetchOnWindowFocus: false,
    staleTime: COUNT_STALE_TIME,
    enabled,
  });
};

/**
 * Sidebar count badges. Pass `enabled: false` to suppress all the count queries
 * until they're actually needed, especially while unauthenticated.
 */
export const useCounts = (enabled: boolean = true) => {
  const { hospitalConfig, user } = useAuth();
  const role = user?.role?.toLowerCase().trim() || '';
  const isAdmin = ['superadmin', 'super_admin', 'admin'].includes(role);
  const canSeePatients = isAdmin || ['doctor', 'consultant', 'nurse', 'receptionist', 'reception', 'front_office'].includes(role);
  const canSeePharmacy = isAdmin || ['pharmacy', 'pharmacist'].includes(role);
  const canSeeLab = isAdmin || ['lab', 'lab_technician'].includes(role);
  const canSeeRadiology = isAdmin || ['radiology', 'radiology_tech'].includes(role);

  const { data: diagnosesCount = 0 } = useQuery({
    queryKey: ['diagnoses-count'],
    queryFn: () => fetchExactCount('diagnoses'),
    retry: 0,
    refetchOnWindowFocus: false,
    staleTime: COUNT_STALE_TIME,
    enabled: enabled && isAdmin,
  });

  const { data: patientsCount = 0 } = usePatientsCount(enabled && canSeePatients);

  const { data: usersCount = 0 } = useQuery({
    queryKey: ['users-count'],
    queryFn: () => fetchExactCount('User'),
    retry: 0,
    refetchOnWindowFocus: false,
    staleTime: COUNT_STALE_TIME,
    enabled: enabled && isAdmin,
  });

  const { data: complicationsCount = 0 } = useQuery({
    queryKey: ['complications-count'],
    queryFn: () => fetchExactCount('complications'),
    retry: 0,
    refetchOnWindowFocus: false,
    staleTime: COUNT_STALE_TIME,
    enabled: enabled && isAdmin,
  });

  const { data: cghsSurgeryCount = 0 } = useQuery({
    queryKey: ['cghs-surgery-count'],
    queryFn: () => fetchExactCount('cghs_surgery'),
    retry: 0,
    refetchOnWindowFocus: false,
    staleTime: COUNT_STALE_TIME,
    enabled: enabled && isAdmin,
  });

  const { data: labCount = 0 } = useQuery({
    queryKey: ['lab-count'],
    queryFn: () => fetchExactCount('lab'),
    retry: 0,
    refetchOnWindowFocus: false,
    staleTime: COUNT_STALE_TIME,
    enabled: enabled && canSeeLab,
  });

  const { data: radiologyCount = 0 } = useQuery({
    queryKey: ['radiology-count'],
    queryFn: () => fetchExactCount('radiology'),
    retry: 0,
    refetchOnWindowFocus: false,
    staleTime: COUNT_STALE_TIME,
    enabled: enabled && canSeeRadiology,
  });

  const { data: medicationsCount = 0 } = useQuery({
    queryKey: ['medications-count'],
    queryFn: () => fetchExactCount('medication'),
    retry: 0,
    refetchOnWindowFocus: false,
    staleTime: COUNT_STALE_TIME,
    enabled: enabled && isAdmin,
  });

  const { data: esicSurgeonsCount = 0 } = useQuery({
    queryKey: ['esic-surgeons-count'],
    queryFn: () => fetchExactCount('esic_surgeons'),
    retry: 0,
    refetchOnWindowFocus: false,
    staleTime: COUNT_STALE_TIME,
    enabled: enabled && isAdmin,
  });

  const { data: refereesCount = 0 } = useQuery({
    queryKey: ['referees-count'],
    queryFn: () => fetchExactCount('referees'),
    retry: 0,
    refetchOnWindowFocus: false,
    staleTime: COUNT_STALE_TIME,
    enabled: enabled && isAdmin,
  });

  const { data: hopeSurgeonsCount = 0 } = useQuery({
    queryKey: ['hope-surgeons-count'],
    queryFn: () => fetchExactCount('hope_surgeons'),
    retry: 0,
    refetchOnWindowFocus: false,
    staleTime: COUNT_STALE_TIME,
    enabled: enabled && isAdmin,
  });

  const { data: hopeConsultantsCount = 0 } = useQuery({
    queryKey: ['hope-consultants-count'],
    queryFn: () => fetchExactCount('hope_consultants'),
    retry: 0,
    refetchOnWindowFocus: false,
    staleTime: COUNT_STALE_TIME,
    enabled: enabled && isAdmin,
  });

  const { data: hopeAnaesthetistsCount = 0 } = useQuery({
    queryKey: ['hope-anaesthetists-count'],
    queryFn: () => fetchExactCount('hope_anaesthetists'),
    retry: 0,
    refetchOnWindowFocus: false,
    staleTime: COUNT_STALE_TIME,
    enabled: enabled && isAdmin,
  });

  const { data: ayushmanSurgeonsCount = 0 } = useQuery({
    queryKey: ['ayushman-surgeons-count'],
    queryFn: () => fetchExactCount('ayushman_surgeons'),
    retry: 0,
    refetchOnWindowFocus: false,
    staleTime: COUNT_STALE_TIME,
    enabled: enabled && isAdmin,
  });

  const { data: ayushmanConsultantsCount = 0 } = useQuery({
    queryKey: ['ayushman-consultants-count'],
    queryFn: () => fetchExactCount('ayushman_consultants'),
    retry: 0,
    refetchOnWindowFocus: false,
    staleTime: COUNT_STALE_TIME,
    enabled: enabled && isAdmin,
  });

  const { data: ayushmanAnaesthetistsCount = 0 } = useQuery({
    queryKey: ['ayushman-anaesthetists-count'],
    queryFn: () => fetchExactCount('ayushman_anaesthetists'),
    retry: 0,
    refetchOnWindowFocus: false,
    staleTime: COUNT_STALE_TIME,
    enabled: enabled && isAdmin,
  });

  const { data: pendingPrescriptionsCount = 0 } = useQuery({
    queryKey: ['pending-prescriptions', 'count', hospitalConfig.name],
    queryFn: async () => {
      try {
        const { count, error } = await supabase
          .from('prescriptions')
          .select('id', { count: 'exact', head: true })
          .or(`status.eq.PENDING,and(status.eq.APPROVED,source.eq.ward,hospital_name.eq.${hospitalConfig.name})`);
        if (error) return 0;
        return count ?? 0;
      } catch {
        return 0;
      }
    },
    retry: 0,
    // Pharmacy screens own their live notification polling. Keeping this
    // global sidebar query on a timer multiplies requests for every open tab.
    refetchInterval: false,
    staleTime: 5 * 60_000,
    enabled: enabled && canSeePharmacy,
  });

  return {
    diagnosesCount,
    patientsCount,
    usersCount,
    complicationsCount,
    cghsSurgeryCount,
    labCount,
    radiologyCount,
    medicationsCount,
    esicSurgeonsCount,
    refereesCount,
    hopeSurgeonsCount,
    hopeConsultantsCount,
    hopeAnaesthetistsCount,
    ayushmanSurgeonsCount,
    ayushmanConsultantsCount,
    ayushmanAnaesthetistsCount,
    pendingPrescriptionsCount,
  };
};
