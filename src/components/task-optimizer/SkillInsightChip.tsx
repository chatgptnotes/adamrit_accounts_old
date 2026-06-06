import { useQuery } from '@tanstack/react-query';
import { Loader2, Wand2, Clock, ListTodo } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { fetchTaskActions } from '@/lib/taskOptimizerActions';
import type { TaskSuggestion } from '@/lib/optimizeTasks';

export interface SkillInsightChipProps {
  task: string;
}

interface LogRow {
  id: string;
  tasks: string[] | null;
  ai_suggestions: TaskSuggestion[] | null;
}

interface ChipData {
  related: number;
  automatablePct: number;
  hoursSaved: number;
}

// Compute the three numbers shown in the chip strip from logs + actions
// filtered to the current task text (case-insensitive substring match).
function computeChip(task: string, logs: LogRow[], actions: { task_text: string; time_saved_mins: number | null }[]): ChipData {
  const term = task.trim().toLowerCase();
  if (!term) return { related: 0, automatablePct: 0, hoursSaved: 0 };

  const matchedLogs = logs.filter(l => (l.tasks ?? []).some(t => t.toLowerCase().includes(term)));
  let automatable = 0;
  let total = 0;
  for (const log of matchedLogs) {
    for (const s of log.ai_suggestions ?? []) {
      // Only count the matching task line, not every suggestion in the log.
      if (!s.task?.toLowerCase().includes(term)) continue;
      total += 1;
      if (s.isSkill || s.type === 'automate') automatable += 1;
    }
  }
  const automatablePct = total === 0 ? 0 : Math.round((automatable / total) * 100);

  const minsSaved = actions
    .filter(a => a.task_text?.toLowerCase().includes(term))
    .reduce((sum, a) => sum + (a.time_saved_mins ?? 0), 0);

  return {
    related: matchedLogs.length,
    automatablePct,
    hoursSaved: Math.round((minsSaved / 60) * 10) / 10,
  };
}

export default function SkillInsightChip({ task }: SkillInsightChipProps) {
  const { hospitalType } = useAuth();
  const term = task.trim();

  const { data, isLoading } = useQuery({
    queryKey: ['skill-factory-insight', hospitalType, term.toLowerCase()],
    enabled: term.length > 1,
    queryFn: async (): Promise<ChipData> => {
      const { data: logs, error } = await supabase
        .from('task_optimizer_logs')
        .select('id, tasks, ai_suggestions')
        .eq('hospital_type', hospitalType)
        .limit(500);
      if (error) throw error;
      const actions = await fetchTaskActions(hospitalType);
      return computeChip(term, (logs ?? []) as LogRow[], actions);
    },
  });

  if (!term) {
    return <p className="text-[11px] text-muted-foreground">Type a task to see insights.</p>;
  }

  if (isLoading || !data) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading insights…
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      <Chip icon={Wand2} label="Automatable" value={`${data.automatablePct}%`} tone="blue" />
      <Chip icon={Clock} label="Hours saved" value={`${data.hoursSaved}h`} tone="emerald" />
      <Chip icon={ListTodo} label="Submissions" value={String(data.related)} tone="slate" />
    </div>
  );
}

const TONES: Record<string, string> = {
  blue: 'border-blue-200 bg-blue-50 text-blue-700',
  emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  slate: 'border-slate-200 bg-slate-50 text-slate-700',
};

function Chip({ icon: Icon, label, value, tone }: { icon: typeof Wand2; label: string; value: string; tone: string }) {
  return (
    <div className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium ${TONES[tone]}`}>
      <Icon className="h-3 w-3" />
      <span className="text-muted-foreground/80">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}
