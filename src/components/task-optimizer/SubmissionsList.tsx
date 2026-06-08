import { useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Loader2, ChevronDown, ChevronRight, Calendar, User, Sparkles } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { optimizeTasks, ACTION_STATUSES, type TaskSuggestion, type ActionStatus } from '@/lib/optimizeTasks';
import { fetchTaskActions, upsertTaskAction, type TaskAction } from '@/lib/taskOptimizerActions';
import { dispatchFlowEvent } from '@/lib/flowDispatcher';
import { SuggestionBadge, STATUS_META } from './suggestionMeta';

interface TaskLogRow {
  id: string;
  user_email: string;
  staff_name: string;
  designation: string;
  log_date: string;
  tasks: string[];
  ai_suggestions: TaskSuggestion[] | null;
  created_at: string;
}

function formatDateHeading(isoDate: string): string {
  // log_date is a plain YYYY-MM-DD; render it as a readable date.
  const d = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

// Group rows by log_date, preserving the (already date-desc) order of first appearance.
function groupByDate(rows: TaskLogRow[]): Array<{ date: string; entries: TaskLogRow[] }> {
  const order: string[] = [];
  const map = new Map<string, TaskLogRow[]>();
  for (const row of rows) {
    if (!map.has(row.log_date)) {
      map.set(row.log_date, []);
      order.push(row.log_date);
    }
    map.get(row.log_date)!.push(row);
  }
  return order.map(date => ({ date, entries: map.get(date)! }));
}

// Key an action by the submission + task text, matching the DB unique index.
function actionKey(logId: string, taskText: string): string {
  return `${logId}|${taskText}`;
}

// Per-suggestion workflow control: a status dropdown plus, when a suggestion is
// marked "done", an estimate of minutes/day saved. Updates are persisted via the
// shared actions mutation and reflected optimistically by query invalidation.
function SuggestionActionControl({
  entry,
  suggestion,
  action,
  hospitalType,
  onSave,
  saving,
}: {
  entry: TaskLogRow;
  suggestion: TaskSuggestion;
  action: TaskAction | undefined;
  hospitalType: string | null;
  onSave: (input: {
    logId: string;
    hospitalType: string | null;
    taskText: string;
    suggestionType: TaskSuggestion['type'];
    status: ActionStatus;
    timeSavedMins?: number | null;
  }) => void;
  saving: boolean;
}) {
  const status: ActionStatus = action?.status ?? 'suggested';

  const handleStatusChange = (next: string) => {
    onSave({
      logId: entry.id,
      hospitalType,
      taskText: suggestion.task,
      suggestionType: suggestion.type,
      status: next as ActionStatus,
      timeSavedMins: action?.time_saved_mins ?? null,
    });
  };

  const handleTimeBlur = (value: string) => {
    const mins = value.trim() === '' ? null : Math.max(0, Math.round(Number(value)));
    if (mins !== null && Number.isNaN(mins)) return;
    onSave({
      logId: entry.id,
      hospitalType,
      taskText: suggestion.task,
      suggestionType: suggestion.type,
      status,
      timeSavedMins: mins,
    });
  };

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 border-t pt-2">
      <span className="text-xs font-medium text-muted-foreground">Status</span>
      <Select value={status} onValueChange={handleStatusChange} disabled={saving}>
        <SelectTrigger className="h-7 w-[140px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ACTION_STATUSES.map(s => (
            <SelectItem key={s} value={s} className="text-xs">
              {STATUS_META[s].label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {status === 'done' && (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Input
            type="number"
            min={0}
            defaultValue={action?.time_saved_mins ?? ''}
            onBlur={e => handleTimeBlur(e.target.value)}
            placeholder="0"
            className="h-7 w-16 text-xs"
            disabled={saving}
          />
          mins/day saved
        </span>
      )}
      {saving && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
    </div>
  );
}

function SubmissionCard({
  entry,
  actionMap,
  hospitalType,
}: {
  entry: TaskLogRow;
  actionMap: Map<string, TaskAction>;
  hospitalType: string | null;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const suggestions = entry.ai_suggestions ?? [];
  const hasSuggestions = suggestions.length > 0;

  const actionMutation = useMutation({
    mutationFn: upsertTaskAction,
    onSuccess: async (rowId, variables) => {
      queryClient.invalidateQueries({ queryKey: ['task-optimizer-actions'] });
      // Run any enabled automations for this status change. Best-effort: a
      // failure here never affects the saved status. Routed through the
      // dispatcher so audit-log + rate-limit + dedup are applied consistently
      // with the new event types.
      try {
        const results = await dispatchFlowEvent('status_changed', {
          hospitalType,
          entityId: rowId,
          // Each distinct status transition for the same row should fire once
          // (suggested → in_progress → done are three legitimate events).
          dedupSuffix: variables.status,
          statusContext: {
            staffName: entry.staff_name,
            designation: entry.designation,
            suggestionType: variables.suggestionType,
            status: variables.status,
            timeSavedMins: variables.timeSavedMins ?? null,
            taskText: variables.taskText,
          },
          actionRowId: rowId,
        });
        if (results.length > 0) {
          // tag/set_status actions may have mutated rows — refresh.
          queryClient.invalidateQueries({ queryKey: ['task-optimizer-actions'] });
          toast({
            title: `Automation${results.length > 1 ? 's' : ''} ran`,
            description: results.map(r => r.message).join(' · ').slice(0, 220),
          });
        }
      } catch {
        // Automations are best-effort; ignore evaluation/run failures.
      }
    },
    onError: (error: unknown) => {
      toast({
        title: 'Could not update status',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    },
  });

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const result = await optimizeTasks({
        name: entry.staff_name,
        designation: entry.designation,
        tasks: entry.tasks,
      });
      const { error } = await supabase
        .from('task_optimizer_logs')
        .update({ ai_suggestions: result })
        .eq('id', entry.id);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['task-optimizer-logs'] });
      toast({ title: 'Suggestions generated', description: `${result.length} suggestion(s) added.` });
    } catch (error: unknown) {
      toast({
        title: 'Could not generate',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-4">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="flex w-full items-start justify-between gap-3 text-left"
        >
          <div className="space-y-0.5">
            <p className="flex items-center gap-2 font-medium">
              <User className="h-4 w-4 text-muted-foreground" />
              {entry.staff_name}
              <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
                {entry.designation}
              </span>
              {!hasSuggestions && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                  AI pending
                </span>
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              {entry.tasks.length} task{entry.tasks.length === 1 ? '' : 's'} · {formatTime(entry.created_at)}
              {entry.user_email ? ` · ${entry.user_email}` : ''}
            </p>
          </div>
          {open ? (
            <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
          )}
        </button>

        {open && (
          <div className="mt-3 space-y-3 border-t pt-3">
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tasks</p>
              <ul className="list-disc space-y-0.5 pl-5 text-sm">
                {entry.tasks.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </div>
            {hasSuggestions ? (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">AI suggestions</p>
                {suggestions.map((s, i) => (
                  <div key={i} className="rounded-md border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-medium">{s.task}</p>
                      <SuggestionBadge type={s.type} />
                    </div>
                    {s.suggestion && <p className="mt-1 text-sm">{s.suggestion}</p>}
                    {s.rationale && <p className="mt-0.5 text-sm text-muted-foreground">{s.rationale}</p>}
                    {s.tool && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">Tool:</span> {s.tool}
                      </p>
                    )}
                    {/* "keep" tasks have nothing to action — skip the workflow control. */}
                    {s.type !== 'keep' && (
                      <SuggestionActionControl
                        entry={entry}
                        suggestion={s}
                        action={actionMap.get(actionKey(entry.id, s.task))}
                        hospitalType={hospitalType}
                        onSave={actionMutation.mutate}
                        saving={actionMutation.isPending}
                      />
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  No AI suggestions yet for this entry.
                </p>
                <Button size="sm" onClick={handleGenerate} disabled={generating}>
                  {generating ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Generating…
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" />
                      Generate AI suggestions
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const SubmissionsList = () => {
  const { hospitalType } = useAuth();

  const { data, isLoading, error } = useQuery({
    queryKey: ['task-optimizer-logs', hospitalType],
    queryFn: async (): Promise<TaskLogRow[]> => {
      let query = supabase
        .from('task_optimizer_logs')
        .select('id, user_email, staff_name, designation, log_date, tasks, ai_suggestions, created_at')
        .order('created_at', { ascending: false })
        .limit(200);
      if (hospitalType) query = query.eq('hospital_type', hospitalType);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as TaskLogRow[];
    },
  });

  // Workflow actions for these submissions. Missing table just yields no actions
  // (every suggestion shows as "Suggested"), so the list still renders.
  const { data: actions } = useQuery({
    queryKey: ['task-optimizer-actions', hospitalType],
    queryFn: () => fetchTaskActions(hospitalType ?? null),
  });

  const actionMap = new Map<string, TaskAction>();
  for (const a of actions ?? []) {
    actionMap.set(`${a.log_id}|${a.task_text}`, a);
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading submissions…
      </div>
    );
  }

  if (error) {
    return (
      <p className="py-8 text-sm text-destructive">
        Could not load submissions. The table may not exist yet — run the migration.
      </p>
    );
  }

  const rows = data ?? [];
  if (rows.length === 0) {
    return <p className="py-8 text-sm text-muted-foreground">No submissions yet.</p>;
  }

  const groups = groupByDate(rows);

  return (
    <div className="space-y-6">
      {groups.map(group => (
        <section key={group.date} className="space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <Calendar className="h-4 w-4" />
            {formatDateHeading(group.date)}
            <span className="font-normal">· {group.entries.length} submission{group.entries.length === 1 ? '' : 's'}</span>
          </h3>
          <div className="grid gap-3">
            {group.entries.map(entry => (
              <SubmissionCard
                key={entry.id}
                entry={entry}
                actionMap={actionMap}
                hospitalType={hospitalType ?? null}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
};

export default SubmissionsList;
