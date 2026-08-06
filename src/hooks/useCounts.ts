import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useMasterCounts } from '@/hooks/useMasterCounts';

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
  const isAdmin = ['superadmin', 'super_admin', 'ca', 'admin'].includes(role);
  const canSeePatients = isAdmin || ['doctor', 'consultant', 'nurse', 'receptionist', 'reception', 'front_office'].includes(role);
  const canSeeLab = isAdmin || ['lab', 'lab_technician'].includes(role);
  const canSeeRadiology = isAdmin || ['radiology', 'radiology_tech'].includes(role);
  const masterCounts = useMasterCounts(enabled && isAdmin);

  const diagnosesCount = masterCounts.Diagnoses ?? 0;

  const { data: patientsCount = 0 } = usePatientsCount(enabled && canSeePatients);

  const usersCount = masterCounts.Users ?? 0;
  const complicationsCount = masterCounts.Complications ?? 0;
  const cghsSurgeryCount = masterCounts.Surgery ?? 0;

  const { data: labCountFromQuery = 0 } = useQuery({
    queryKey: ['lab-count'],
    queryFn: () => fetchExactCount('lab'),
    retry: 0,
    refetchOnWindowFocus: false,
    staleTime: COUNT_STALE_TIME,
    enabled: enabled && canSeeLab && !isAdmin,
  });
  const labCount = isAdmin ? (masterCounts['Lab Master'] ?? 0) : labCountFromQuery;

  const { data: radiologyCountFromQuery = 0 } = useQuery({
    queryKey: ['radiology-count'],
    queryFn: () => fetchExactCount('radiology'),
    retry: 0,
    refetchOnWindowFocus: false,
    staleTime: COUNT_STALE_TIME,
    enabled: enabled && canSeeRadiology && !isAdmin,
  });
  const radiologyCount = isAdmin ? (masterCounts['Radiology Master'] ?? 0) : radiologyCountFromQuery;

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

  const refereesCount = masterCounts.Referees ?? 0;
  const hopeSurgeonsCount = masterCounts['Hope Surgeons'] ?? 0;
  const hopeConsultantsCount = masterCounts['Hope Consultants'] ?? 0;
  const hopeAnaesthetistsCount = masterCounts['Hope Anaesthetists'] ?? 0;
  const ayushmanSurgeonsCount = masterCounts['Ayushman Surgeons'] ?? 0;
  const ayushmanConsultantsCount = masterCounts['Ayushman Consultants'] ?? 0;
  const ayushmanAnaesthetistsCount = masterCounts['Ayushman Anaesthetists'] ?? 0;

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
  };
};
