import { useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Loader2, Plus, Workflow, Trash2, Power, PowerOff, Users, Mail, Clock, Tag, FileText, CheckCircle2, CalendarClock, ExternalLink } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import {
  fetchTaskFlows,
  saveTaskFlow,
  deleteTaskFlow,
  makeStarterFlow,
  type TaskFlow,
  type StoredNode,
  type StoredEdge,
} from '@/lib/taskOptimizerFlows';
import { COMMON_TASKS } from './commonTasks';
import FlowCanvas from './flow/FlowCanvas';
import BillingWorkflowDiagram from './BillingWorkflowDiagram';
import DailyBillingWorkflow from './DailyBillingWorkflow';
import CorporateMailer from './CorporateMailer';
import BillingDashboardModal from './BillingDashboardModal';

// ── Static Email Automation Card ─────────────────────────────────────────────

function EmailAutomationCard() {
  const [showDetails, setShowDetails] = useState(false);
  return (
    <>
      <Card className="border-green-200 bg-green-50/30">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-100 shrink-0">
                <Mail className="h-5 w-5 text-green-700" />
              </div>
              <div>
                <CardTitle className="text-sm font-semibold">Email Checker &amp; Reply Drafter</CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  Reads info@hopehospital.com, classifies emails, applies Gmail labels, saves draft replies for review.
                </CardDescription>
              </div>
            </div>
            <Badge className="bg-green-100 text-green-700 border-green-200 shrink-0 text-xs">
              <CheckCircle2 className="h-3 w-3 mr-1" /> Active
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" />9:00 AM &amp; 5:00 PM IST daily</span>
            <span className="flex items-center gap-1.5"><CalendarClock className="h-3.5 w-3.5" />Google Apps Script</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground flex items-center gap-1"><Tag className="h-3 w-3" />Labels:</span>
            {['patient-inquiry', 'appointment', 'billing', 'lab-report', 'general'].map(cat => (
              <Badge key={cat} variant="outline" className="text-xs py-0 h-5">HH/{cat}</Badge>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {['Read Gmail inbox', 'Classify by keyword', 'Apply HH/ label', 'Save draft reply'].map(a => (
              <div key={a} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <div className="h-1.5 w-1.5 rounded-full bg-green-500 shrink-0" />{a}
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between pt-1 border-t border-green-100">
            <span className="text-xs text-muted-foreground">No auto-send — staff reviews drafts first</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowDetails(true)}>
                <FileText className="h-3 w-3 mr-1" />Details
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" asChild>
                <a href="https://script.google.com" target="_blank" rel="noreferrer">
                  <ExternalLink className="h-3 w-3 mr-1" />Manage
                </a>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={showDetails} onOpenChange={setShowDetails}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-green-600" />Email Checker &amp; Reply Drafter
            </DialogTitle>
            <DialogDescription>Automation details</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <ol className="space-y-2">
              {[
                <>Runs at <strong>9 AM</strong> and <strong>5 PM</strong> IST automatically</>,
                <>Reads unread emails in <strong>info@hopehospital.com</strong></>,
                <>Classifies each email: appointment / billing / lab / patient / general</>,
                <><code className="bg-muted px-1 rounded text-xs">HH/category</code> label applied in Gmail</>,
                <>Professional draft reply saved — staff reviews &amp; clicks Send</>,
              ].map((step, i) => (
                <li key={i} className="flex gap-2">
                  <span className="font-semibold text-green-600 shrink-0">{i + 1}.</span>{step}
                </li>
              ))}
            </ol>
            <div className="grid grid-cols-2 gap-3 bg-muted/40 rounded-lg p-3">
              <div><p className="text-xs text-muted-foreground">Schedule</p><p className="font-medium">9 AM &amp; 5 PM IST</p></div>
              <div><p className="text-xs text-muted-foreground">Email</p><p className="font-medium">info@hopehospital.com</p></div>
              <div><p className="text-xs text-muted-foreground">Platform</p><p className="font-medium">Google Apps Script</p></div>
              <div><p className="text-xs text-muted-foreground">Auto-send?</p><p className="font-medium text-amber-600">No — review first</p></div>
            </div>
            <div className="flex justify-end">
              <Button size="sm" asChild>
                <a href="https://script.google.com" target="_blank" rel="noreferrer">
                  <ExternalLink className="h-3.5 w-3.5 mr-1.5" />Open Google Apps Script
                </a>
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Email Notification starter template ──────────────────────────────────────

function makeEmailNotificationTemplate() {
  return {
    name: 'Email Notification',
    enabled: false,
    nodes: [
      {
        id: 'trigger-1',
        type: 'trigger',
        position: { x: 80, y: 120 },
        data: {
          kind: 'status_changed',
          label: 'Status Changed',
          config: { to: 'done' },
        },
      },
      {
        id: 'action-1',
        type: 'action',
        position: { x: 380, y: 120 },
        data: {
          kind: 'email',
          label: 'Send Email',
          config: {
            to: '',
            subject: 'Task Completed: {task}',
            message:
              'Hi, task "{task}" has been marked as {status} by {staff} ({designation}).',
          },
        },
      },
    ],
    edges: [
      {
        id: 'e-trigger-1-action-1',
        source: 'trigger-1',
        target: 'action-1',
      },
    ],
  };
}

const ROLE_OPTIONS = Object.keys(COMMON_TASKS);
const ALL_STAFF_LABEL = 'All staff';

// ── Pre-built automation templates ──────────────────────────────────
interface FlowTemplate {
  id: string;
  name: string;
  role: string;
  description: string;
  nodes: StoredNode[];
  edges: StoredEdge[];
}

const AUTOMATION_TEMPLATES: FlowTemplate[] = [
  {
    id: 'tpl-nurse-daily',
    name: 'Nurse Daily Workflow',
    role: 'Nursing',
    description: '9-step OPD nurse checklist — notifies supervisor when each task is marked done',
    nodes: [
      { id: 'trigger-1',  type: 'trigger',   position: { x: 290, y: 0 },
        data: { kind: 'trigger',   label: 'Shift Starts',                   config: { event: 'status_changed', toStatus: 'any' } } },
      { id: 'condition-1',type: 'condition',  position: { x: 290, y: 130 },
        data: { kind: 'condition', label: 'Role is Nursing',                 config: { field: 'designation', op: 'eq', value: 'Nursing' } } },
      { id: 'action-1',   type: 'action',     position: { x: 270, y: 270 },
        data: { kind: 'action', label: 'Check OPD Patient Files',            config: { type: 'notify', message: 'Check and verify all OPD patient files before shift starts. Ensure no file is missing or incomplete.' } } },
      { id: 'action-2',   type: 'action',     position: { x: 270, y: 420 },
        data: { kind: 'action', label: 'Prepare Dressing Room',              config: { type: 'notify', message: 'Clean dressing room. Change bedsheet and restock procedure tray.' } } },
      { id: 'action-3',   type: 'action',     position: { x: 270, y: 570 },
        data: { kind: 'action', label: 'Organize OPD Table for Doctor',      config: { type: 'notify', message: 'Clear and organize OPD table for the doctor.' } } },
      { id: 'action-4',   type: 'action',     position: { x: 270, y: 720 },
        data: { kind: 'action', label: 'Register Patient Details',           config: { type: 'notify', message: 'Register patient: Name, Address, Mobile Number and Panel Type (Private / Ayushman / ESIC) in OPD register.' } } },
      { id: 'action-5',   type: 'action',     position: { x: 270, y: 870 },
        data: { kind: 'action', label: 'Record BP & Pulse',                  config: { type: 'notify', message: 'Measure and record Blood Pressure and Pulse for every OPD patient.' } } },
      { id: 'action-6',   type: 'action',     position: { x: 270, y: 1020 },
        data: { kind: 'action', label: 'Inform Patient About Tests',         config: { type: 'notify', message: 'Inform patient about investigations and tests as per doctor\'s advice.' } } },
      { id: 'action-7',   type: 'action',     position: { x: 270, y: 1170 },
        data: { kind: 'action', label: 'Show Lab Reports to Doctor',         config: { type: 'notify', message: 'Once test reports arrive from lab, show them to the doctor immediately for review.' } } },
      { id: 'action-8',   type: 'action',     position: { x: 270, y: 1320 },
        data: { kind: 'action', label: 'Transfer Patient to Ward / ICU',     config: { type: 'notify', message: 'Note patient Registration Number and transfer patient to General Ward / ICU / Private Room as per doctor order.' } } },
      { id: 'action-9',   type: 'action',     position: { x: 270, y: 1470 },
        data: { kind: 'action', label: 'Update Casualty Register',           config: { type: 'notify', message: 'Update and maintain Casualty Register for all emergency patients throughout the shift.' } } },
    ],
    edges: [
      { id: 'e1', source: 'trigger-1', target: 'condition-1' },
      { id: 'e2', source: 'condition-1', target: 'action-1' },
      { id: 'e3', source: 'action-1', target: 'action-2' },
      { id: 'e4', source: 'action-2', target: 'action-3' },
      { id: 'e5', source: 'action-3', target: 'action-4' },
      { id: 'e6', source: 'action-4', target: 'action-5' },
      { id: 'e7', source: 'action-5', target: 'action-6' },
      { id: 'e8', source: 'action-6', target: 'action-7' },
      { id: 'e9', source: 'action-7', target: 'action-8' },
      { id: 'e10', source: 'action-8', target: 'action-9' },
    ],
  },
  {
    id: 'tpl-vitals-alert',
    name: 'Vitals Recorded Alert',
    role: 'Nursing',
    description: 'When nurse records BP/Pulse — auto-notify doctor to review patient vitals',
    nodes: [
      { id: 'trigger-1', type: 'trigger', position: { x: 80, y: 160 },
        data: { kind: 'trigger', label: 'When status changes', config: { event: 'status_changed', toStatus: 'any' } } },
      { id: 'condition-1', type: 'condition', position: { x: 340, y: 160 },
        data: { kind: 'condition', label: 'Role is Nursing', config: { field: 'designation', op: 'eq', value: 'Nursing' } } },
      { id: 'action-1', type: 'action', position: { x: 600, y: 160 },
        data: { kind: 'action', label: 'Notify Doctor', config: { type: 'notify', message: 'Patient vitals recorded. Please review BP and pulse in OPD.' } } },
    ],
    edges: [
      { id: 'e1', source: 'trigger-1', target: 'condition-1' },
      { id: 'e2', source: 'condition-1', target: 'action-1' },
    ],
  },
  {
    id: 'tpl-billing-discharge',
    name: 'Billing on Discharge',
    role: 'Billing',
    description: 'Notify billing staff automatically when patient is ready for discharge',
    nodes: [
      { id: 'trigger-1', type: 'trigger', position: { x: 80, y: 160 },
        data: { kind: 'trigger', label: 'When task marked Done', config: { event: 'status_changed', toStatus: 'done' } } },
      { id: 'condition-1', type: 'condition', position: { x: 340, y: 160 },
        data: { kind: 'condition', label: 'Role is Billing', config: { field: 'designation', op: 'eq', value: 'Billing' } } },
      { id: 'action-1', type: 'action', position: { x: 600, y: 160 },
        data: { kind: 'action', label: 'Notify Billing Team', config: { type: 'notify', message: 'Patient ready for final bill. Please process discharge billing.' } } },
    ],
    edges: [
      { id: 'e1', source: 'trigger-1', target: 'condition-1' },
      { id: 'e2', source: 'condition-1', target: 'action-1' },
    ],
  },
];

// Group flows by their role, "All staff" (null role) last, each group's flows
// kept in their existing date-desc order.
function groupByRole(flows: TaskFlow[]): Array<{ role: string; flows: TaskFlow[] }> {
  const map = new Map<string, TaskFlow[]>();
  for (const flow of flows) {
    const key = flow.role?.trim() || ALL_STAFF_LABEL;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(flow);
  }
  return Array.from(map.entries())
    .map(([role, list]) => ({ role, flows: list }))
    .sort((a, b) => {
      if (a.role === ALL_STAFF_LABEL) return 1;
      if (b.role === ALL_STAFF_LABEL) return -1;
      return a.role.localeCompare(b.role);
    });
}

// Lists saved automations and hosts the React Flow editor. Editing a flow
// swaps the list out for the canvas; saving returns to the list.
const AutomationsPanel = () => {
  const { hospitalType } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<TaskFlow | 'new' | 'email-template' | FlowTemplate | null>(null);
  const [activeTab, setActiveTab] = useState<'daily' | 'diagram' | 'flows' | 'mailer'>('daily');
  const loadTemplate = (tpl: FlowTemplate) => setEditing(tpl);

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

  // ── Editor ──
  if (editing) {
    const starter = makeStarterFlow();
    const emailTemplate = makeEmailNotificationTemplate();
    const isNew = editing === 'new';
    const isEmailTemplate = editing === 'email-template';
    const isTpl = !isNew && !isEmailTemplate && typeof editing === 'object' && editing !== null && !('created_at' in editing);
    const isExisting = !isNew && !isEmailTemplate && !isTpl;
    const flow = isExisting ? editing as TaskFlow : null;
    return (
      <FlowCanvas
        initialName={isExisting ? flow!.name : isEmailTemplate ? emailTemplate.name : isTpl ? (editing as FlowTemplate).name : 'New automation'}
        initialEnabled={isExisting ? flow!.enabled : isEmailTemplate ? emailTemplate.enabled : true}
        initialRole={isExisting ? flow!.role : isTpl ? (editing as FlowTemplate).role : null}
        initialNodes={isExisting ? flow!.nodes : isEmailTemplate ? emailTemplate.nodes : isTpl ? (editing as FlowTemplate).nodes : starter.nodes}
        initialEdges={isExisting ? flow!.edges : isEmailTemplate ? emailTemplate.edges : isTpl ? (editing as FlowTemplate).edges : starter.edges}
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

  // ── List ──
  return (
    <div className="space-y-4">

      {/* Templates (from main) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4" /> Templates
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-3">
            {AUTOMATION_TEMPLATES.map(tpl => (
              <button
                key={tpl.id}
                type="button"
                onClick={() => loadTemplate(tpl)}
                className="flex flex-col items-start gap-2 rounded-lg border border-dashed p-3 text-left transition-colors hover:border-primary hover:bg-primary/5"
              >
                <div className="flex items-center justify-between w-full">
                  <span className="text-sm font-semibold">{tpl.name}</span>
                  <Badge variant="outline" className="text-xs">{tpl.role}</Badge>
                </div>
                <span className="text-xs text-muted-foreground leading-relaxed">{tpl.description}</span>
                <span className="text-xs text-primary font-medium">Use template →</span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Tab bar */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1 border-b border-slate-200">
          <button
            type="button"
            className={`px-4 py-2 rounded-t-lg font-medium text-sm transition-colors ${activeTab === 'daily' ? 'bg-white border border-b-white text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}
            onClick={() => setActiveTab('daily')}
          >
            Daily Tasks
          </button>
          <button
            type="button"
            className={`px-4 py-2 rounded-t-lg font-medium text-sm transition-colors ${activeTab === 'diagram' ? 'bg-white border border-b-white text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}
            onClick={() => setActiveTab('diagram')}
          >
            Billing Workflow
          </button>
          <button
            type="button"
            className={`px-4 py-2 rounded-t-lg font-medium text-sm transition-colors ${activeTab === 'flows' ? 'bg-white border border-b-white text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}
            onClick={() => setActiveTab('flows')}
          >
            Automations
          </button>
          <button
            type="button"
            className={`px-4 py-2 rounded-t-lg font-medium text-sm transition-colors ${activeTab === 'mailer' ? 'bg-white border border-b-white text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}
            onClick={() => setActiveTab('mailer')}
          >
            Corporate Mailer
          </button>
        </div>
        <div className="flex gap-2">
          {activeTab === 'daily' && <BillingDashboardModal />}
          {activeTab === 'flows' && (
            <>
              <Button size="sm" variant="outline" onClick={() => setEditing('email-template')}>
                <Mail className="mr-1.5 h-4 w-4" /> Email Template
              </Button>
              <Button size="sm" onClick={() => setEditing('new')}>
                <Plus className="mr-1.5 h-4 w-4" /> New automation
              </Button>
            </>
          )}
        </div>
      </div>

      {activeTab === 'daily' ? (
        <DailyBillingWorkflow />
      ) : activeTab === 'diagram' ? (
        <BillingWorkflowDiagram />
      ) : activeTab === 'mailer' ? (
        <CorporateMailer />
      ) : (
        <>
          <div className="mb-2">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Workflow className="h-5 w-5 text-primary" /> Automations
            </h2>
            <p className="text-sm text-muted-foreground">
              Build trigger → condition → action flows per staff role, run when a task's status changes.
            </p>
          </div>

          <EmailAutomationCard />

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
                              <span
                                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                  flow.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
                                }`}
                              >
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
        </>
      )}
    </div>
  );
};

export default AutomationsPanel;
