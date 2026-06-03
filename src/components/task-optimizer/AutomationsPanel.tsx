import { useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Loader2, Plus, Workflow, Trash2, Power, PowerOff, Users } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import {
  fetchTaskFlows,
  saveTaskFlow,
  deleteTaskFlow,
  makeStarterFlow,
  type TaskFlow,
} from '@/lib/taskOptimizerFlows';
import { COMMON_TASKS } from './commonTasks';
import FlowCanvas from './flow/FlowCanvas';

const ROLE_OPTIONS = Object.keys(COMMON_TASKS);


function groupByRole(flows: TaskFlow[]): Array<{ role: string; flows: TaskFlow[] }> {
  const ALL_STAFF = 'All staff';
  const map = new Map<string, TaskFlow[]>();
  for (const flow of flows) {
    const key = flow.role?.trim() || ALL_STAFF;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(flow);
  }
  return Array.from(map.entries())
    .map(([role, list]) => ({ role, flows: list }))
    .sort((a, b) => {
      if (a.role === ALL_STAFF) return 1;
      if (b.role === ALL_STAFF) return -1;
      return a.role.localeCompare(b.role);
    });
}

const AutomationsPanel = () => {
  const { hospitalType } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<TaskFlow | 'new' | null>(null);

  const { data: flows, isLoading, error } = useQuery({
    queryKey: ['task-optimizer-flows', hospitalType],
    queryFn: () => fetchTaskFlows(hospitalType ?? null),
  });

  const saveMutation = useMutation({
    mutationFn: saveTaskFlow,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task-optimizer-flows'] });
      toast({ title: 'Automation saved' });
      setEditing(null);
    },
    onError: (e: unknown) =>
      toast({ title: 'Save failed', description: e instanceof Error ? e.message : 'Try again.', variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteTaskFlow,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task-optimizer-flows'] });
      toast({ title: 'Automation deleted' });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: (flow: TaskFlow) =>
      saveTaskFlow({
        id: flow.id,
        hospitalType: flow.hospital_type,
        role: flow.role,
        name: flow.name,
        enabled: !flow.enabled,
        nodes: flow.nodes,
        edges: flow.edges,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['task-optimizer-flows'] }),
  });

  if (editing) {
    const starter = makeStarterFlow();
    const isExisting = typeof editing === 'object' && editing !== null;
    const flow = isExisting ? editing as TaskFlow : null;
    return (
      <FlowCanvas
        initialName={isExisting ? flow!.name : 'New automation'}
        initialEnabled={isExisting ? flow!.enabled : true}
        initialRole={isExisting ? flow!.role : null}
        initialNodes={isExisting ? flow!.nodes : starter.nodes}
        initialEdges={isExisting ? flow!.edges : starter.edges}
        roleOptions={ROLE_OPTIONS}
        saving={saveMutation.isPending}
        onBack={() => setEditing(null)}
        onSave={data =>
          saveMutation.mutate({
            ...(isExisting && flow ? { id: flow.id } : {}),
            hospitalType: hospitalType ?? null,
            ...data,
          })
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Workflow className="h-5 w-5 text-primary" /> Automations
          </h2>
          <p className="text-sm text-muted-foreground">
            Build trigger → condition → action flows per staff role, run when a task's status changes.
          </p>
        </div>
        <Button size="sm" onClick={() => setEditing('new')}>
          <Plus className="mr-1.5 h-4 w-4" /> New automation
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading automations…
        </div>
      ) : error ? (
        <p className="py-8 text-sm text-destructive">
          Could not load automations. The table may not exist yet — run the migration.
        </p>
      ) : (flows ?? []).length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <Workflow className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No automations yet.</p>
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus className="mr-1.5 h-4 w-4" /> Create your first automation
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {groupByRole(flows ?? []).map(group => (
            <section key={group.role} className="space-y-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                <Users className="h-4 w-4" />
                {group.role}
                <span className="font-normal">· {group.flows.length}</span>
              </h3>
              <div className="grid gap-3">
                {group.flows.map(flow => (
                  <Card key={flow.id}>
                    <CardContent className="flex items-center justify-between gap-3 p-4">
                      <button type="button" className="flex-1 text-left" onClick={() => setEditing(flow)}>
                        <p className="flex items-center gap-2 font-medium">
                          {flow.name}
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${flow.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                            {flow.enabled ? 'Enabled' : 'Disabled'}
                          </span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {(flow.nodes ?? []).length} node{(flow.nodes ?? []).length === 1 ? '' : 's'} ·{' '}
                          {(flow.edges ?? []).length} connection{(flow.edges ?? []).length === 1 ? '' : 's'}
                        </p>
                      </button>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" title={flow.enabled ? 'Disable' : 'Enable'} onClick={() => toggleMutation.mutate(flow)}>
                          {flow.enabled ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}
                        </Button>
                        <Button variant="ghost" size="icon" title="Delete" onClick={() => deleteMutation.mutate(flow.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
};

export default AutomationsPanel;
