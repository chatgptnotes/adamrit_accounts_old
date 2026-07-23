import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { ALL_STATUS_OPTIONS } from '@/lib/workflowStatus';

export interface WorkflowStatusMasterRow {
  id: string;
  value: string;
  label: string;
  workflow: string | null;
  stage: string | null;
  sort_order: number;
  is_active: boolean;
}

// Dropdown options for the patient workflow status, from the editable
// workflow_status_master table; falls back to the static list if the
// master is empty or the migration has not been applied yet.
export function useWorkflowStatusOptions() {
  return useQuery({
    queryKey: ['workflow-status-master-options'],
    staleTime: 1000 * 60 * 5,
    queryFn: async (): Promise<Array<{ value: string; label: string }>> => {
      const { data, error } = await (supabase as any)
        .from('workflow_status_master')
        .select('value, label, sort_order')
        .eq('is_active', true)
        .order('sort_order');
      if (error || !data || data.length === 0) {
        if (error) console.warn('workflow_status_master unavailable, using static statuses:', error.message);
        return ALL_STATUS_OPTIONS;
      }
      return data.map((row: any) => ({ value: row.value, label: row.label }));
    },
  });
}
