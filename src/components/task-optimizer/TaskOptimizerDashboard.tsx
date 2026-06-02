import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Sparkles, Loader2, ListChecks, BarChart3, Plus, CheckCircle2, Workflow, FileText } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
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
import { optimizeTasks, type TaskSuggestion } from '@/lib/optimizeTasks';
import { SuggestionBadge } from './suggestionMeta';
import { COMMON_TASKS, WORKFLOW_TEMPLATES } from './commonTasks';
import SubmissionsList from './SubmissionsList';
import InsightsPanel from './InsightsPanel';
import AutomationsPanel from './AutomationsPanel';

// Selectable department / function categories — broad terms rather than
// specific job titles. Kept as display strings so the value stored in the DB
// is human-readable. "Other" lets staff whose function isn't listed type theirs.
const DESIGNATION_OPTIONS = [
  'Administration',
  'Accounts',
  'Finance',
  'Billing',
  'Clinical / Medical',
  'Nursing',
  'Pharmacy',
  'Laboratory',
  'Radiology',
  'Front Office / Reception',
  'Marketing',
  'Human Resources',
  'Quality',
  'Operations',
  'IT',
  'Housekeeping',
  'Security',
  'Maintenance',
  'Other',
] as const;

// Map a logged-in user's role to a default department category, when one fits.
const ROLE_TO_DESIGNATION: Record<string, string> = {
  admin: 'Administration',
  super_admin: 'Administration',
  superadmin: 'Administration',
  billing: 'Billing',
  doctor: 'Clinical / Medical',
  consultant: 'Clinical / Medical',
  physiotherapist: 'Clinical / Medical',
  nurse: 'Nursing',
  pharmacist: 'Pharmacy',
  pharmacy: 'Pharmacy',
  lab_technician: 'Laboratory',
  lab: 'Laboratory',
  radiology_tech: 'Radiology',
  radiology: 'Radiology',
  ot_tech: 'Operations',
  cath_lab_tech: 'Operations',
  receptionist: 'Front Office / Reception',
  reception: 'Front Office / Reception',
  front_office: 'Front Office / Reception',
  marketing_manager: 'Marketing',
  hr: 'Human Resources',
  quality: 'Quality',
  housekeeping: 'Housekeeping',
  security: 'Security',
  maintenance: 'Maintenance',
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

const TaskOptimizerDashboard = () => {
  const { user, hospitalType } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [view, setView] = useState<'entry' | 'submissions' | 'insights' | 'automations'>('entry');
  const [name, setName] = useState('');
  const [designation, setDesignation] = useState(
    () => ROLE_TO_DESIGNATION[user?.role ?? ''] ?? '',
  );
  const [customDesignation, setCustomDesignation] = useState('');
  const [tasksText, setTasksText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<TaskSuggestion[] | null>(null);

  // When "Other" is chosen, the typed value is what we use everywhere.
  const resolvedDesignation = designation === 'Other' ? customDesignation : designation;

  // Starter tasks for the chosen department, minus any already in the box.
  const currentTasks = tasksText
    .split('\n')
    .map(t => t.trim())
    .filter(Boolean);
  const suggestedCommonTasks = (COMMON_TASKS[designation] ?? []).filter(
    t => !currentTasks.includes(t),
  );

  const addCommonTask = (task: string) => {
    setTasksText(prev => (prev.trim() ? `${prev.replace(/\n+$/, '')}\n${task}` : task));
  };

  const handleAnalyze = async () => {
    const tasks = tasksText
      .split('\n')
      .map(t => t.trim())
      .filter(Boolean);

    if (!name.trim()) {
      toast({ title: 'Name required', description: 'Please enter your name.', variant: 'destructive' });
      return;
    }
    if (!resolvedDesignation.trim()) {
      toast({ title: 'Designation required', description: 'Please select your designation.', variant: 'destructive' });
      return;
    }
    if (tasks.length === 0) {
      toast({ title: 'No tasks', description: 'Add at least one task (one per line).', variant: 'destructive' });
      return;
    }

    setIsLoading(true);
    setSuggestions(null);

    // Try the AI first, but never let its failure block saving the entry.
    let result: TaskSuggestion[] | null = null;
    let aiError: string | null = null;
    try {
      result = await optimizeTasks({ name: name.trim(), designation: resolvedDesignation.trim(), tasks });
      setSuggestions(result);
    } catch (error: unknown) {
      aiError = getErrorMessage(error);
    }

    // Always save the person's data — with suggestions if the AI worked,
    // otherwise with none (they can be generated later from View Submissions).
    const { error } = await supabase.from('task_optimizer_logs').insert({
      user_email: user?.email ?? '',
      hospital_type: hospitalType ?? null,
      staff_name: name.trim(),
      designation: resolvedDesignation.trim(),
      tasks,
      ai_suggestions: result,
    });

    setIsLoading(false);

    if (error) {
      toast({
        title: 'Save failed',
        description: error.message || 'Your entry could not be saved. Please try again.',
        variant: 'destructive',
      });
      return;
    }

    // Refresh the submissions log so the new entry shows up.
    queryClient.invalidateQueries({ queryKey: ['task-optimizer-logs'] });

    if (aiError) {
      toast({
        title: 'Saved without AI suggestions',
        description: `${aiError} You can generate suggestions later from View Submissions.`,
      });
    } else {
      toast({ title: 'Analysis ready', description: `${result?.length ?? 0} suggestion(s) generated and saved.` });
    }
  };

  return (
    // The Automations builder needs room for the canvas, so it breaks out of the
    // narrow reading width used by the other views.
    <div className={`mx-auto space-y-6 ${view === 'automations' ? 'max-w-[1600px]' : 'max-w-4xl'}`}>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Sparkles className="h-6 w-6 text-primary" />
            Task Optimizer
          </h1>
          <p className="text-sm text-muted-foreground">
            List your daily tasks and let AI suggest how to reduce, automate, or delegate them.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant={view === 'entry' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setView('entry')}
          >
            <Sparkles className="mr-2 h-4 w-4" />
            New Entry
          </Button>
          <Button
            variant={view === 'submissions' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setView('submissions')}
          >
            <ListChecks className="mr-2 h-4 w-4" />
            View Submissions
          </Button>
          <Button
            variant={view === 'automations' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setView('automations')}
          >
            <Workflow className="mr-2 h-4 w-4" />
            Automations
          </Button>
          <Button
            variant={view === 'insights' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setView('insights')}
          >
            <BarChart3 className="mr-2 h-4 w-4" />
            Insights
          </Button>
        </div>
      </header>

      {view === 'submissions' ? (
        <SubmissionsList />
      ) : view === 'insights' ? (
        <InsightsPanel />
      ) : view === 'automations' ? (
        <AutomationsPanel />
      ) : (
        <>
      {/* Templates */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Quick Templates
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {WORKFLOW_TEMPLATES.map(tpl => (
              <button
                key={tpl.id}
                type="button"
                onClick={() => {
                  setDesignation(tpl.designation);
                  setTasksText(tpl.tasks.join('\n'));
                }}
                className="flex flex-col items-start gap-0.5 rounded-lg border border-dashed px-3 py-2 text-left transition-colors hover:border-primary hover:bg-primary/5"
              >
                <span className="text-sm font-medium">{tpl.label}</span>
                <span className="text-xs text-muted-foreground">{tpl.description}</span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Your details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="staff-name">Name</Label>
              <Input
                id="staff-name"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Priya Sharma"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="staff-designation">Designation</Label>
              <Select value={designation} onValueChange={setDesignation}>
                <SelectTrigger id="staff-designation">
                  <SelectValue placeholder="Select your designation" />
                </SelectTrigger>
                <SelectContent>
                  {DESIGNATION_OPTIONS.map(option => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {designation === 'Other' && (
                <Input
                  value={customDesignation}
                  onChange={e => setCustomDesignation(e.target.value)}
                  placeholder="Type your designation"
                  className="mt-2"
                />
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="staff-tasks">Daily tasks (one per line)</Label>
            <Textarea
              id="staff-tasks"
              value={tasksText}
              onChange={e => setTasksText(e.target.value)}
              placeholder={'Enter patient vitals into the system\nCall patients to confirm appointments\nPrepare daily census report'}
              rows={8}
            />
            {suggestedCommonTasks.length > 0 && (
              <div className="space-y-1.5 pt-1">
                <p className="text-xs text-muted-foreground">
                  Common tasks for {designation} — click to add:
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {suggestedCommonTasks.map(task => (
                    <button
                      key={task}
                      type="button"
                      onClick={() => addCommonTask(task)}
                      className="inline-flex items-center gap-1 rounded-full border border-dashed px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                    >
                      <Plus className="h-3 w-3" />
                      {task}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <Button onClick={handleAnalyze} disabled={isLoading} className="w-full sm:w-auto">
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Analyzing…
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                Analyze with AI
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {suggestions && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Suggestions</h2>
          <div className="grid gap-3">
            {suggestions.map((s, i) => (
              <Card key={i}>
                <CardContent className="space-y-2 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-medium">{s.task}</p>
                    <SuggestionBadge type={s.type} />
                  </div>
                  {s.suggestion && <p className="text-sm">{s.suggestion}</p>}
                  {s.rationale && (
                    <p className="text-sm text-muted-foreground">{s.rationale}</p>
                  )}
                  {s.tool && (
                    <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>
                        <span className="font-medium text-foreground">Tool:</span> {s.tool}
                      </span>
                      {s.existsInAdamrit && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-700">
                          <CheckCircle2 className="h-3 w-3" />
                          Available now
                        </span>
                      )}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}
        </>
      )}
    </div>
  );
};

export default TaskOptimizerDashboard;
