import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FileText } from 'lucide-react';
import { WORKFLOW_REPORTS, WORKFLOW_STATUS_LABELS } from '@/lib/workflowStatus';

// Six workflow report cards (Approval / Extension / Discharge / Bill / Submission / Payment).
// Counts come from visits.workflow_status, which is set manually per patient
// via the Status dropdown on the Advance Statement Report.
export const OverviewReportsSection = () => {
  const navigate = useNavigate();
  const { hospitalConfig } = useAuth();

  const { data: statusCounts = {}, isLoading } = useQuery({
    queryKey: ['overview-workflow-report-counts', hospitalConfig?.name],
    refetchInterval: 60_000,
    queryFn: async () => {
      const data = await fetchAllRows((from, to) => {
        let query = supabase
          .from('visits')
          .select('workflow_status, patients!inner(hospital_name)')
          .not('workflow_status', 'is', null);

        if (hospitalConfig?.name) {
          query = query.eq('patients.hospital_name', hospitalConfig.name);
        }

        return query.order('id').range(from, to);
      });

      const counts: Record<string, number> = {};
      (data || []).forEach((row: any) => {
        if (row.workflow_status) {
          counts[row.workflow_status] = (counts[row.workflow_status] || 0) + 1;
        }
      });
      return counts;
    },
  });

  return (
    <div className="mt-4">
      <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
        <FileText className="h-5 w-5 text-primary" />
        Reports
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {WORKFLOW_REPORTS.map((report) => {
          const total = report.statuses.reduce((sum, s) => sum + (statusCounts[s] || 0), 0);
          return (
            <Card
              key={report.key}
              className="cursor-pointer transition-shadow hover:shadow-md"
              onClick={() => navigate(`/workflow-status-report/${report.key}`)}
            >
              <CardHeader className="pb-2 pt-3 px-3">
                <CardTitle className="text-sm">{report.title}</CardTitle>
              </CardHeader>
              <CardContent className="px-3 pb-3">
                <div className="text-2xl font-bold text-primary">
                  {isLoading ? '…' : total}
                </div>
                <div className="mt-1 space-y-0.5">
                  {report.statuses.map((status) => (
                    <div key={status} className="flex justify-between text-xs text-muted-foreground">
                      <span>{WORKFLOW_STATUS_LABELS[status]?.replace(/^\w+\s/, '') || status}</span>
                      <span className="font-medium text-foreground">
                        {isLoading ? '' : statusCounts[status] || 0}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
};
