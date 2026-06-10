// Skill Factory v2 — Skill Factory's UI shell powered by the Task Optimizer engine.
// Layout (no left rail): Staff → Tasks → Workflow + AI sidebar.
// Admins see every staff member found in task_optimizer_logs; everyone else sees
// only their own auto-resolved card (designation derived from user.role).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Sparkles,
  Search,
  Boxes,
  Plus,
  Trash2,
  GripVertical,
  Loader2,
  Wand2,
  Save,
  User as UserIcon,
  PanelLeftClose,
  PanelLeftOpen,
  CornerDownRight,
  ListTodo,
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  closestCenter,
  defaultDropAnimationSideEffects,
  pointerWithin,
  rectIntersection,
  KeyboardSensor,
  MouseSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDroppable,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type DropAnimation,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { toast } from 'sonner';

import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import {
  fetchTaskFlows,
  saveTaskFlow,
  deleteTaskFlow,
  makeStarterFlow,
  type StoredNode,
  type StoredEdge,
  type TaskFlow,
  type ActionConfig,
  type TriggerConfig,
} from '@/lib/taskOptimizerFlows';
import type { TaskSuggestion } from '@/lib/optimizeTasks';
import type { GeneratedFlow, TaskChange, StepChange } from '@/lib/generateFlowFromPrompt';
import { generateSubtasksForTask } from '@/lib/generateSubtasks';
import { COMMON_TASKS } from '@/components/task-optimizer/commonTasks';

import SkillFactoryFlow from '@/components/task-optimizer/SkillFactoryFlow';
import SkillFactoryChatbot from '@/components/task-optimizer/SkillFactoryChatbot';
import NotificationBell from '@/components/task-optimizer/NotificationBell';
import SkillInsightChip from '@/components/task-optimizer/SkillInsightChip';
import BillScanMenu from '@/components/task-optimizer/flow/BillScanMenu';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';
import type { ImperativePanelHandle } from 'react-resizable-panels';

// ── Local types ─────────────────────────────────────────────────────
interface TaskOptimizerLog {
  id: string;
  user_email: string;
  hospital_type: string | null;
  staff_name: string | null;
  designation: string | null;
  log_date: string;
  tasks: string[] | null;
  ai_suggestions: TaskSuggestion[] | null;
  created_at: string;
}

interface StaffMember {
  key: string;
  name: string;
  designation: string;
  email?: string | null;
  isCurrentUser?: boolean;
}

const LOGS_TABLE = 'task_optimizer_logs';

// Subtasks live per (log, task) in localStorage for v2 — easy to add, no
// migration needed. Phase 2 will move them into task_optimizer_logs.subtasks.
const subtasksKey = (logId: string) => `sf-v2:subtasks:${logId}`;
// Drop blanks AND case-insensitive duplicates. Earlier builds could push the
// same label in twice when the canvas mirrored structural template nodes back
// into subtasks; this lets that stale localStorage self-heal on the next read.
const cleanSubtaskList = (list: unknown): string[] => {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of list) {
    if (typeof s !== 'string') continue;
    const trimmed = s.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
};
const readSubtasks = (logId: string): Record<string, string[]> => {
  try {
    const raw = localStorage.getItem(subtasksKey(logId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const cleaned: Record<string, string[]> = {};
    for (const [task, list] of Object.entries(parsed as Record<string, unknown>)) {
      cleaned[task] = cleanSubtaskList(list);
    }
    return cleaned;
  } catch {
    return {};
  }
};
const writeSubtasks = (logId: string, map: Record<string, string[]>) => {
  try {
    const cleaned: Record<string, string[]> = {};
    for (const [task, list] of Object.entries(map)) {
      cleaned[task] = cleanSubtaskList(list);
    }
    localStorage.setItem(subtasksKey(logId), JSON.stringify(cleaned));
  } catch {
    /* noop */
  }
};

const COLLAPSE_KEY = 'sf-v2:staffCollapsed';
// Default = collapsed (true) on first visit; user's later choice is remembered.
const readCollapsed = (): boolean => {
  try {
    const v = localStorage.getItem(COLLAPSE_KEY);
    if (v === null) return true;
    return v === '1';
  } catch {
    return true;
  }
};
const writeCollapsed = (v: boolean) => {
  try {
    localStorage.setItem(COLLAPSE_KEY, v ? '1' : '0');
  } catch {
    /* noop */
  }
};

const orderKey = (email: string) => `sf-v2:${email}:staff`;
const readOrder = (email: string): string[] => {
  try {
    const raw = localStorage.getItem(orderKey(email));
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
};
const writeOrder = (email: string, order: string[]) => {
  try {
    localStorage.setItem(orderKey(email), JSON.stringify(order));
  } catch {
    /* noop */
  }
};

// Map the auth role code (e.g. "nurse") to a human designation that matches the
// COMMON_TASKS keys used elsewhere in Task Optimizer. Unknown roles fall back to
// title-cased role text so brand-new roles still show something sensible.
const ROLE_TO_DESIGNATION: Record<string, string> = {
  nurse: 'Nursing',
  doctor: 'Doctor',
  consultant: 'Consultant',
  physiotherapist: 'Physiotherapy',
  pharmacy: 'Pharmacy',
  pharmacist: 'Pharmacy',
  lab: 'Laboratory',
  lab_technician: 'Laboratory',
  radiology: 'Radiology',
  radiology_tech: 'Radiology',
  receptionist: 'Front Office / Reception',
  reception: 'Front Office / Reception',
  front_office: 'Front Office / Reception',
  billing: 'Accounts',
  marketing_manager: 'Marketing',
  admin: 'Administration',
  superadmin: 'Administration',
  super_admin: 'Administration',
  hr: 'Administration',
  housekeeping: 'Administration',
  security: 'Administration',
  driver: 'Administration',
  maintenance: 'Administration',
  quality: 'Administration',
  ot_tech: 'OT Technician',
  cath_lab_tech: 'Cath Lab Technician',
  user: 'Staff',
};

const titleCase = (s: string) =>
  s
    .split(/[_\s]+/)
    .map((p) => (p ? p[0].toUpperCase() + p.slice(1) : p))
    .join(' ');

const designationFromRole = (role: string | undefined) =>
  role ? ROLE_TO_DESIGNATION[role] ?? titleCase(role) : 'Staff';

const staffKey = (name: string) => name.trim().toLowerCase();

const ADMIN_ROLES = new Set(['admin', 'superadmin', 'super_admin']);
const isAdminRole = (role?: string) => !!role && ADMIN_ROLES.has(role);

// Demo persona that's always available so the page can open onto a sensible
// default even before any task_optimizer_logs rows exist.
const FRONT_DESK_STAFF: StaffMember = {
  key: staffKey('Front Desk'),
  name: 'Front Desk',
  designation: 'Front Office / Reception',
};

function deriveStaffList(
  logs: TaskOptimizerLog[],
  savedOrder: string[],
  currentUser: { username?: string; email?: string; role?: string } | null,
  showAll: boolean,
): StaffMember[] {
  const byKey = new Map<string, StaffMember>();

  if (currentUser?.email) {
    const name = (currentUser.username || currentUser.email.split('@')[0]).trim();
    if (name) {
      byKey.set(staffKey(name), {
        key: staffKey(name),
        name,
        designation: designationFromRole(currentUser.role),
        email: currentUser.email,
        isCurrentUser: true,
      });
    }
  }

  if (showAll) {
    for (const l of logs) {
      const rawName = (l.staff_name ?? '').trim();
      if (!rawName) continue;
      const key = staffKey(rawName);
      if (byKey.has(key)) continue;
      byKey.set(key, {
        key,
        name: rawName,
        designation: (l.designation ?? '').trim() || 'Staff',
        email: l.user_email,
      });
    }
  }

  // Ensure a Front Desk / Reception persona is always present so it can be the
  // page's default opener even on a fresh workspace.
  const hasFrontDesk = Array.from(byKey.values()).some((s) => {
    const d = s.designation.toLowerCase();
    return d.includes('front office') || d.includes('reception') || d === 'front desk';
  });
  if (!hasFrontDesk) byKey.set(FRONT_DESK_STAFF.key, FRONT_DESK_STAFF);

  const all = Array.from(byKey.values());
  const out: StaffMember[] = [];
  const taken = new Set<string>();
  for (const k of savedOrder) {
    const found = all.find((s) => s.key === k);
    if (found) {
      out.push(found);
      taken.add(k);
    }
  }
  for (const s of all) if (!taken.has(s.key)) out.push(s);
  return out;
}

function latestLogForStaff(logs: TaskOptimizerLog[], staffName: string): TaskOptimizerLog | null {
  const target = staffKey(staffName);
  let pick: TaskOptimizerLog | null = null;
  for (const l of logs) {
    if (staffKey(l.staff_name ?? '') !== target) continue;
    if (!pick || l.created_at > pick.created_at) pick = l;
  }
  return pick;
}

const TYPE_TONE: Record<string, string> = {
  automate: 'bg-blue-100 text-blue-700 border-blue-200',
  reduce: 'bg-amber-100 text-amber-700 border-amber-200',
  delegate: 'bg-purple-100 text-purple-700 border-purple-200',
  keep: 'bg-slate-100 text-slate-600 border-slate-200',
};

// Solid dot color for the all-tasks strip chips (matches TYPE_TONE).
const VERDICT_DOT: Record<string, string> = {
  automate: 'bg-blue-500',
  reduce: 'bg-amber-500',
  delegate: 'bg-purple-500',
  keep: 'bg-slate-400',
};

// Map an AI verdict to a sensible action type for the overview node.
const VERDICT_ACTION: Record<string, ActionConfig['type']> = {
  automate: 'notify',
  reduce: 'tag',
  delegate: 'set_status',
  keep: 'notify',
};

// Synthetic "workspace" flow: a Start-of-shift trigger fans into action nodes,
// one per task, with edges chaining them in priority order. Each task node also
// carries its AI verdict in the label so the user spots automate/delegate at a
// glance. Layout wraps into columns so a long list stays readable.
function buildTaskOverviewFlow(
  tasks: string[],
  designation: string,
  verdictByTask: Map<string, TaskSuggestion>,
): { nodes: StoredNode[]; edges: StoredEdge[] } {
  const PER_COL = 5;
  const X_GAP = 320;
  const Y_GAP = 130;
  const X0 = 60;
  const Y0 = 60;

  const triggerNode: StoredNode = {
    id: 'overview-trigger',
    type: 'trigger',
    position: { x: X0, y: Y0 },
    data: {
      kind: 'trigger',
      label: `Start of ${designation || 'shift'}`,
      config: { event: 'status_changed', toStatus: 'in_progress' } as TriggerConfig,
    },
  };

  const actionNodes: StoredNode[] = tasks.map((t, i) => {
    const v = verdictByTask.get(t.toLowerCase());
    const verdictLabel = v ? `${v.type.toUpperCase()} · ` : '';
    const type: ActionConfig['type'] = v ? VERDICT_ACTION[v.type] ?? 'notify' : 'notify';
    return {
      id: `overview-task-${i}`,
      type: 'action',
      position: {
        x: X0 + Math.floor(i / PER_COL) * X_GAP,
        y: Y0 + 160 + (i % PER_COL) * Y_GAP,
      },
      data: {
        kind: 'action',
        label: `${verdictLabel}${t}`,
        config: { type, message: v?.suggestion ?? '' } as ActionConfig,
      },
    };
  });

  // Chain: trigger → task[0] → task[1] → ... → task[n-1]
  const edges: StoredEdge[] = [];
  let prevId = triggerNode.id;
  for (const node of actionNodes) {
    edges.push({ id: `e-${prevId}-${node.id}`, source: prevId, target: node.id });
    prevId = node.id;
  }

  return { nodes: [triggerNode, ...actionNodes], edges };
}

// Detect the Deadline Tracking task by its name (case-insensitive substring) so
// the canvas can show the real, end-to-end automation we built — not a generic
// status-change → notify stub. Matches "Deadline Tracking", "Deadline Tracker",
// "deadline_tracking", "Bill Deadline", "Utility Deadlines", etc.
function isDeadlineTrackingTask(task: string): boolean {
  return /deadline/i.test(task);
}

// Default subtasks for the Deadline Tracking task. Seeded into subtasksMap on
// first visit so the Steps panel isn't empty out of the box — the user can
// edit/delete/reorder these like any other step. The canvas renders each as a
// step-N node (single source of truth), so there are no structural twins to
// dedupe against.
const DEADLINE_DEFAULT_STEPS: string[] = [
  'Add bill — name, due date, amount',
  'Save bill to database',
  'Check due date daily',
  'Notify when due / overdue',
  'Mark paid → auto-create next month',
];

// Concrete, step-by-step picture of the Deadline Tracking automation that's
// already wired in /deadline-tracking. The trigger is the only structural node
// (start of flow); the 5 follow-up steps live in subtasksMap so the Steps panel
// and the canvas stay 1:1 — no action-1..5 / step-N twin nodes possible.
function buildDeadlineTrackingFlow(): { nodes: StoredNode[]; edges: StoredEdge[] } {
  const nodes: StoredNode[] = [
    {
      id: 'trigger-1',
      type: 'trigger',
      position: { x: 60, y: 80 },
      data: {
        kind: 'trigger',
        label: 'When user opens Deadline Tracking',
        config: { event: 'status_changed', toStatus: 'in_progress' } as TriggerConfig,
      },
    },
  ];

  return { nodes, edges: [] };
}

// Verdict-aware starter for a drilled-into task that has no saved flow yet.
// Returns a trigger + main action + one chained sub-action per subtask, so the
// canvas always reflects "task + its steps" out of the box.
function buildVerdictStarter(
  task: string,
  verdict: TaskSuggestion | null,
  subtasks: string[] = [],
): { nodes: StoredNode[]; edges: StoredEdge[] } {
  const triggerNode: StoredNode = {
    id: 'trigger-1',
    type: 'trigger',
    position: { x: 80, y: 120 },
    data: {
      kind: 'trigger',
      label: 'When status changes',
      config: { event: 'status_changed', toStatus: 'in_progress' } as TriggerConfig,
    },
  };

  const actionType = verdict ? VERDICT_ACTION[verdict.type] ?? 'notify' : 'notify';
  const actionLabel = verdict
    ? actionType === 'set_status'
      ? 'Set status → in_progress'
      : actionType === 'tag'
      ? `Tag · ${verdict.type}`
      : `Notify · ${verdict.type}`
    : 'Notify';
  const actionNode: StoredNode = {
    id: 'action-1',
    type: 'action',
    position: { x: 460, y: 120 },
    data: {
      kind: 'action',
      label: actionLabel,
      config: {
        type: actionType,
        message: verdict
          ? actionType === 'set_status'
            ? undefined
            : `${task}: ${verdict.suggestion || verdict.rationale || ''}`.trim()
          : `${task} done`,
        setStatus: actionType === 'set_status' ? 'in_progress' : undefined,
      } as ActionConfig,
    },
  };

  const nodes: StoredNode[] = [triggerNode, actionNode];
  const edges: StoredEdge[] = [
    { id: 'e-trigger-1-action-1', source: 'trigger-1', target: 'action-1' },
  ];

  // Chain each subtask as a sub-action node below the main action.
  let prevId = actionNode.id;
  subtasks.forEach((s, i) => {
    const id = `step-${i + 1}`;
    nodes.push({
      id,
      type: 'action',
      position: { x: 460, y: 280 + i * 130 },
      data: {
        kind: 'action',
        label: `Step ${i + 1}: ${s}`,
        config: { type: 'notify', message: s } as ActionConfig,
      },
    });
    edges.push({ id: `e-${prevId}-${id}`, source: prevId, target: id });
    prevId = id;
  });

  return { nodes, edges };
}

// Keep the canvas's "step-N" sub-action nodes in lock-step with the Steps panel.
// Strips any existing step-N nodes (and their connecting edges) and re-chains
// one node per current subtask after the canvas's tail node. Used so that
// adding / removing / reordering a step on the left always updates the canvas
// on the right — even for saved flows or the Deadline Tracking demo.
const STEP_ID_RX = /^step-\d+$/;
function syncSubtaskSteps(
  nodes: StoredNode[],
  edges: StoredEdge[],
  subtasks: string[],
): { nodes: StoredNode[]; edges: StoredEdge[] } {
  const keptNodes = nodes.filter((n) => !STEP_ID_RX.test(n.id));
  const keptEdges = edges.filter(
    (e) => !STEP_ID_RX.test(e.source) && !STEP_ID_RX.test(e.target),
  );
  if (subtasks.length === 0) return { nodes: keptNodes, edges: keptEdges };

  // The "tail" is the node we should chain subtask steps after: the one with no
  // outgoing edge among the kept graph. Fall back to the last node if every
  // node has an outgoing edge (cyclic / no clear tail).
  const hasOutgoing = new Set(keptEdges.map((e) => e.source));
  const tail =
    keptNodes.find((n) => !hasOutgoing.has(n.id)) ?? keptNodes[keptNodes.length - 1];
  if (!tail) return { nodes: keptNodes, edges: keptEdges };

  const baseX = tail.position.x;
  const baseY = tail.position.y;
  const newNodes: StoredNode[] = subtasks.map((s, i) => ({
    id: `step-${i + 1}`,
    type: 'action',
    position: { x: baseX, y: baseY + 130 * (i + 1) },
    data: {
      kind: 'action',
      label: `Step ${i + 1}: ${s}`,
      config: { type: 'notify', message: s } as ActionConfig,
    },
  }));
  const newEdges: StoredEdge[] = [];
  let prev = tail.id;
  for (const n of newNodes) {
    newEdges.push({ id: `e-${prev}-${n.id}`, source: prev, target: n.id });
    prev = n.id;
  }
  return { nodes: [...keptNodes, ...newNodes], edges: [...keptEdges, ...newEdges] };
}

// Reverse direction of syncSubtaskSteps: read the step-N nodes on the canvas
// and pull out their labels. Only step-N ids count as user-managed subtasks —
// template structural nodes (trigger-1, action-1..N from buildDeadlineTrackingFlow
// / buildVerdictStarter) and palette-dropped nodes are first-class workflow
// blocks, NOT subtasks, even when their labels happen to start with "Step N".
// Deduped so a stale localStorage that picked up the same label twice can't
// keep showing it twice.
const STEP_LABEL_RX = /^step\s+\d+\s*[:·\-]?\s*/i;
function deriveSubtasksFromCanvas(nodes: StoredNode[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const n of nodes) {
    if (!STEP_ID_RX.test(n.id)) continue;
    const label = ((n.data as { label?: string } | undefined)?.label ?? '').trim();
    if (!label) continue;
    const clean = label.replace(STEP_LABEL_RX, '').trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

// Cheap content signature used to detect whether the canvas has *meaningfully*
// changed since the last save. React Flow fires onChange for selection and
// dimension updates on every render — without filtering, those would flip
// flowDirty back to true the instant a save resets it, making the "unsaved
// changes" indicator stick even after a successful save.
function meaningfulFlowSig(nodes: StoredNode[], edges: StoredEdge[]): string {
  const n = nodes.map((x) => {
    const data = x.data as { label?: unknown; config?: unknown } | undefined;
    return [
      x.id,
      x.type,
      Math.round(x.position?.x ?? 0),
      Math.round(x.position?.y ?? 0),
      typeof data?.label === 'string' ? data.label : '',
      data?.config ? JSON.stringify(data.config) : '',
    ].join('|');
  });
  const e = edges.map((x) => `${x.id}|${x.source}|${x.target}`);
  return `${n.join('::')}//${e.join('::')}`;
}

// Rule 16 — true while a saved flow's timestamp is younger than 24 hours.
// Used to decide whether to show the "Just saved · Review" pill.
function isWithin24h(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return false;
  return Date.now() - t < 24 * 60 * 60 * 1000;
}

// "Just saved · Review" pill — shows for 24h after an auto-save so the user
// has a discoverable rollback path beyond the 30-second Undo toast. Clicking
// Disable flips the flow's `enabled` flag to false (a soft kill — the flow
// stays in the DB, just won't fire).
function JustSavedPill({ flowName, onDisable }: { flowName: string; onDisable: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-full bg-blue-50 border border-blue-200 px-3 py-1.5 text-[11px] text-blue-900 shadow-sm">
      <CheckCircle2 className="w-3.5 h-3.5 text-blue-600 shrink-0" />
      <span className="font-medium truncate max-w-[180px]" title={flowName}>
        Just saved · Review
      </span>
      <button
        onClick={onDisable}
        title="Disable this automation — it will stop firing immediately"
        className="ml-1 text-blue-700 hover:text-rose-700 font-semibold underline-offset-2 hover:underline"
      >
        Disable
      </button>
    </div>
  );
}

// Thin vertical rail shown in place of a collapsed column — a single expand
// button plus the column's name rotated 90°. Used by all four resizable columns.
function CollapsedRail({
  label,
  side,
  onExpand,
}: {
  label: string;
  side: 'left' | 'right';
  onExpand: () => void;
}) {
  const Chevron = side === 'right' ? ChevronLeft : ChevronRight;
  return (
    <div className="h-full flex flex-col items-center gap-3 py-3 bg-white border-x border-gray-200">
      <button
        onClick={onExpand}
        title={`Expand ${label}`}
        className="p-1 rounded-md text-gray-500 hover:bg-gray-100"
      >
        <Chevron className="w-4 h-4" />
      </button>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 select-none [writing-mode:vertical-rl] rotate-180">
        {label}
      </div>
    </div>
  );
}

// Small collapse button placed in a column header.
function CollapseButton({ label, side, onClick }: { label: string; side: 'left' | 'right'; onClick: () => void }) {
  const Chevron = side === 'right' ? ChevronRight : ChevronLeft;
  return (
    <button
      onClick={onClick}
      title={`Collapse ${label}`}
      className="p-1 rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-600 shrink-0"
    >
      <Chevron className="w-3.5 h-3.5" />
    </button>
  );
}

export default function SkillFactoryV2() {
  const { user, hospitalType } = useAuth();
  const userEmail = user?.email ?? '';
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [staffCollapsed, setStaffCollapsed] = useState<boolean>(() => readCollapsed());

  // Per-column collapse (Tasks / Steps / Workflow / Chatbot). Each column can be
  // collapsed to a thin rail via the library's imperative collapse()/expand();
  // `colCollapsed` mirrors that state (driven by onCollapse/onExpand) so we know
  // when to render the rail instead of the full column.
  const tasksPanelRef = useRef<ImperativePanelHandle>(null);
  const stepsPanelRef = useRef<ImperativePanelHandle>(null);
  const workflowPanelRef = useRef<ImperativePanelHandle>(null);
  const aiPanelRef = useRef<ImperativePanelHandle>(null);
  const [colCollapsed, setColCollapsed] = useState({
    tasks: false,
    steps: false,
    workflow: false,
    ai: false,
  });
  const setCol = (k: 'tasks' | 'steps' | 'workflow' | 'ai', v: boolean) =>
    setColCollapsed((s) => (s[k] === v ? s : { ...s, [k]: v }));

  // Inline-input state — replaces the native window.prompt() popups so every
  // "Add" opens a text field inside its own column instead of a browser dialog.
  const [addingStaff, setAddingStaff] = useState(false);
  const [staffNameDraft, setStaffNameDraft] = useState('');
  const [staffDesignationDraft, setStaffDesignationDraft] = useState('');
  const [addingTask, setAddingTask] = useState(false);
  const [taskDraft, setTaskDraft] = useState('');
  const [addingStep, setAddingStep] = useState(false);
  const [stepDraft, setStepDraft] = useState('');
  const toggleStaffCollapsed = () => {
    setStaffCollapsed((v) => {
      writeCollapsed(!v);
      return !v;
    });
  };

  const [logs, setLogs] = useState<TaskOptimizerLog[]>([]);
  const [flows, setFlows] = useState<TaskFlow[]>([]);
  const [loading, setLoading] = useState(true);

  const [activeStaffKey, setActiveStaffKey] = useState<string>('');
  const [activeTask, setActiveTask] = useState<string>('');

  // The Steps panel unmounts/remounts as the active task changes; reset its
  // collapse flag so it always returns expanded (the library panel remounts open).
  useEffect(() => {
    setCol('steps', false);
  }, [activeTask]);

  const [staffOrder, setStaffOrder] = useState<string[]>([]);

  const [currentNodes, setCurrentNodes] = useState<StoredNode[]>([]);
  const [currentEdges, setCurrentEdges] = useState<StoredEdge[]>([]);
  const [flowDirty, setFlowDirty] = useState(false);
  // Signature captured at the last known "clean" point (load, save). The
  // onChange handler diffs the incoming canvas content against this so React
  // Flow's internal selection/dimension/measure events don't keep flipping
  // flowDirty back to true after a save.
  const cleanFlowSigRef = useRef('');

  // Per-log map of task → its subtasks. Loaded from localStorage when the
  // active log changes; saved on every mutation.
  const [subtasksMap, setSubtasksMap] = useState<Record<string, string[]>>({});

  // Smoother drag: a tiny distance threshold prevents accidental drags on click,
  // while explicit Mouse + Touch sensors keep both inputs responsive without
  // PointerSensor's slight delay. Keyboard sensor preserves accessibility.
  // Tighter activation (3 px) makes the drag begin nearly the moment you start
  // moving, while still rejecting clicks. Touch keeps a small delay so taps
  // and scroll-pans aren't mistaken for drags.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 3 } }),
    useSensor(MouseSensor, { activationConstraint: { distance: 3 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 100, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Drop animation: fade the now-stationary original while the overlay snaps
  // toward it. Feels native vs. dnd-kit's default which can look choppy.
  const dropAnimation: DropAnimation = useMemo(
    () => ({
      duration: 180,
      // Smooth ease-out — fast at start, gentle landing. No overshoot so the
      // card looks like it "settles" rather than bounces.
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      sideEffects: defaultDropAnimationSideEffects({
        styles: { active: { opacity: '0.3' } },
      }),
    }),
    [],
  );

  // Cursor-precise collision detection with a rectIntersection fallback. This is
  // markedly smoother than `closestCenter` for cross-list drags because the
  // hit-test follows the pointer rather than the centre of the dragged card.
  const collisionDetectionStrategy: CollisionDetection = (args) => {
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) return pointerCollisions;
    return rectIntersection(args);
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        let q = supabase
          .from(LOGS_TABLE)
          .select('id, user_email, hospital_type, staff_name, designation, log_date, tasks, ai_suggestions, created_at')
          .order('created_at', { ascending: false })
          .limit(500);
        if (hospitalType) q = q.eq('hospital_type', hospitalType);
        const { data, error } = await q;
        if (error) throw error;
        const flowRows = await fetchTaskFlows(hospitalType);
        if (cancelled) return;
        setLogs((data ?? []) as TaskOptimizerLog[]);
        setFlows(flowRows);
      } catch (e: unknown) {
        console.warn('[SkillFactoryV2] load failed', e);
        toast.error('Could not load Task Optimizer data.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [hospitalType, userEmail]);

  const isAdmin = isAdminRole(user?.role);

  const staffList = useMemo<StaffMember[]>(
    () =>
      deriveStaffList(
        logs,
        staffOrder.length ? staffOrder : readOrder(userEmail),
        user ? { username: user.username, email: user.email, role: user.role } : null,
        isAdmin,
      ),
    [logs, staffOrder, user, userEmail, isAdmin],
  );

  // First-load selection priority:
  //   1. Existing selection (don't override the user's pick on a refetch)
  //   2. Front Desk / Reception persona (the demo-friendly default)
  //   3. Logged-in user
  //   4. First staff card
  useEffect(() => {
    if (!staffList.length) return;
    setActiveStaffKey((prev) => {
      if (prev && staffList.some((s) => s.key === prev)) return prev;
      const frontDesk = staffList.find((s) => {
        const d = s.designation.toLowerCase();
        return (
          d.includes('front office') ||
          d.includes('reception') ||
          d === 'front desk'
        );
      });
      if (frontDesk) return frontDesk.key;
      const me = staffList.find((s) => s.isCurrentUser);
      return me?.key ?? staffList[0].key;
    });
  }, [staffList]);

  const activeStaff = useMemo<StaffMember | null>(
    () => staffList.find((s) => s.key === activeStaffKey) ?? null,
    [staffList, activeStaffKey],
  );
  const activeLog = useMemo(
    () => (activeStaff ? latestLogForStaff(logs, activeStaff.name) : null),
    [logs, activeStaff],
  );
  const ruleTasks = useMemo<string[]>(() => (activeLog?.tasks ?? []).filter(Boolean), [activeLog]);

  // Keep the selection valid when the task list changes, but DON'T auto-select
  // the first task — Subtasks column should only open on an explicit click.
  useEffect(() => {
    setActiveTask((prev) => (prev && ruleTasks.includes(prev) ? prev : ''));
  }, [ruleTasks]);

  // Load the saved subtasks-map whenever we switch logs.
  useEffect(() => {
    if (!activeLog) {
      setSubtasksMap({});
      return;
    }
    setSubtasksMap(readSubtasks(activeLog.id));
  }, [activeLog?.id]);

  // Filter on display too — blocks any blank in-memory entry from rendering as
  // an empty card before the next persist/reload purges it from localStorage.
  const activeSubtasks: string[] = activeTask
    ? (subtasksMap[activeTask] ?? []).filter((s) => typeof s === 'string' && s.trim().length > 0)
    : [];

  // Refs that always point at the latest canvas state. persistSubtasks needs
  // them so it can imperatively sync step-N nodes onto the live canvas without
  // going through a useEffect (which would clobber unsaved user edits on the
  // canvas). They're updated on every render, kept outside React's state.
  const nodesRef = useRef<StoredNode[]>([]);
  const edgesRef = useRef<StoredEdge[]>([]);
  nodesRef.current = currentNodes;
  edgesRef.current = currentEdges;

  const persistSubtasks = (next: Record<string, string[]>) => {
    setSubtasksMap(next);
    if (activeLog) writeSubtasks(activeLog.id, next);
    // Steps → Canvas: mirror the new subtask list onto the live canvas as
    // step-N nodes, preserving any other nodes the user/AI added. Done here
    // (imperatively) instead of via a useEffect dep on subtasksMap so canvas
    // edits aren't wiped every time a step changes.
    if (activeTask) {
      const subs = (next[activeTask] ?? []).filter(
        (s) => typeof s === 'string' && s.trim().length > 0,
      );
      const synced = syncSubtaskSteps(nodesRef.current, edgesRef.current, subs);
      setCurrentNodes(synced.nodes);
      setCurrentEdges(synced.edges);
      setFlowDirty(true);
    }
  };

  // Open the inline "+ Step" input at the top of the Steps panel.
  const addSubtask = () => {
    if (!activeTask) return;
    setStepDraft('');
    setAddingStep(true);
  };
  const cancelAddStep = () => {
    setAddingStep(false);
    setStepDraft('');
  };
  const commitAddStep = () => {
    if (!activeTask) return;
    const text = stepDraft.trim();
    if (!text) return cancelAddStep();
    const cur = subtasksMap[activeTask] ?? [];
    if (cur.some((s) => s.toLowerCase() === text.toLowerCase())) {
      toast.error('That step already exists.');
      return;
    }
    if (ruleTasks.some((t) => t.toLowerCase() === text.toLowerCase())) {
      toast.error(`"${text}" is already a top-level task. Pick a different step name.`);
      return;
    }
    persistSubtasks({ ...subtasksMap, [activeTask]: [...cur, text] });
    cancelAddStep();
  };

  const deleteSubtask = (text: string) => {
    if (!activeTask) return;
    const cur = subtasksMap[activeTask] ?? [];
    persistSubtasks({ ...subtasksMap, [activeTask]: cur.filter((s) => s !== text) });
  };

  const onSubtaskDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id || !activeTask) return;
    const cur = subtasksMap[activeTask] ?? [];
    const from = cur.indexOf(String(active.id));
    const to = cur.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    persistSubtasks({ ...subtasksMap, [activeTask]: arrayMove(cur, from, to) });
  };

  // Pre-index AI suggestions for the active log so per-task lookups are O(1).
  const verdictByTask = useMemo<Map<string, TaskSuggestion>>(() => {
    const m = new Map<string, TaskSuggestion>();
    for (const s of activeLog?.ai_suggestions ?? []) {
      if (s.task) m.set(s.task.toLowerCase(), s);
    }
    return m;
  }, [activeLog]);

  const verdictFor = (taskText: string): TaskSuggestion | null =>
    verdictByTask.get(taskText.toLowerCase()) ?? null;

  // Pre-index every saved flow so per-task "has flow" checks are O(1) instead of
  // a linear scan inside every RuleCard / chip render.
  const flowKeys = useMemo<Set<string>>(
    () => new Set(flows.map((f) => `${(f.role ?? '').toLowerCase()}::${f.name.toLowerCase()}`)),
    [flows],
  );
  const taskHasFlow = (designation: string, task: string) =>
    flowKeys.has(`${designation.toLowerCase()}::${task.toLowerCase()}`);

  const savedFlow = useMemo<TaskFlow | null>(() => {
    if (!activeStaff || !activeTask) return null;
    const role = activeStaff.designation.toLowerCase();
    return (
      flows.find(
        (f) =>
          (f.role ?? '').toLowerCase() === role &&
          f.name.toLowerCase() === activeTask.toLowerCase(),
      ) ?? null
    );
  }, [flows, activeStaff, activeTask]);

  useEffect(() => {
    if (activeTask) {
      // Drilled into a specific task. The Deadline Tracking task always shows
      // the real, end-to-end automation we built (overrides any old stub flow
      // saved before this view existed); other tasks prefer their saved flow.
      if (isDeadlineTrackingTask(activeTask)) {
        // The Deadline Tracking flow is a fixed, self-contained demo — its nodes
        // ARE the steps. We do NOT run syncSubtaskSteps here: doing so would
        // re-materialise each action node as a step-N node, which onChange then
        // re-derives, so the subtask list would grow on every render. Instead we
        // seed the Steps panel once from the flow's own actions.
        const base = buildDeadlineTrackingFlow();
        setCurrentNodes(base.nodes);
        setCurrentEdges(base.edges);
        const flowSteps = deriveSubtasksFromCanvas(base.nodes);
        const cur = subtasksMap[activeTask] ?? [];
        const same = flowSteps.length === cur.length && flowSteps.every((s, i) => s === cur[i]);
        if (!same) {
          const nextMap = { ...subtasksMap, [activeTask]: flowSteps };
          setSubtasksMap(nextMap);
          if (activeLog) writeSubtasks(activeLog.id, nextMap);
        }
        setFlowDirty(false);
        return;
      }
      let base: { nodes: StoredNode[]; edges: StoredEdge[] };
      if (savedFlow) {
        base = { nodes: savedFlow.nodes, edges: savedFlow.edges };
      } else {
        // Pass [] here — syncSubtaskSteps below is the single source of truth
        // for step-N nodes so adds/removes/reorders stay reflected on the canvas.
        base = buildVerdictStarter(
          activeTask,
          verdictByTask.get(activeTask.toLowerCase()) ?? null,
          [],
        );
      }
      // Seed the Deadline task's Steps panel so it isn't empty out of the box.
      // Empty *and* undefined both seed, which also recovers users whose stored
      // subtasks were wiped by the earlier "structural cleanup" pass. If the
      // user genuinely deletes every step, they can simply navigate away and
      // back — the seed is a UX guard, not a hard policy.
      let subs = subtasksMap[activeTask];
      if (
        isDeadlineTrackingTask(activeTask) &&
        (subs === undefined || subs.length === 0)
      ) {
        subs = DEADLINE_DEFAULT_STEPS;
        setSubtasksMap((prev) => {
          const next = { ...prev, [activeTask]: DEADLINE_DEFAULT_STEPS };
          if (activeLog) writeSubtasks(activeLog.id, next);
          return next;
        });
      } else {
        subs = subs ?? [];
      }
      const synced = syncSubtaskSteps(base.nodes, base.edges, subs);
      setCurrentNodes(synced.nodes);
      setCurrentEdges(synced.edges);
    } else if (activeStaff && ruleTasks.length > 0) {
      // Just a staff selected. If the staff itself is the Deadline Tracking
      // persona, or any of its tasks reference deadlines, show the real
      // deadline automation; otherwise fall back to the chained task overview.
      if (
        isDeadlineTrackingTask(activeStaff.name) ||
        isDeadlineTrackingTask(activeStaff.designation) ||
        ruleTasks.some((t) => isDeadlineTrackingTask(t))
      ) {
        const dl = buildDeadlineTrackingFlow();
        setCurrentNodes(dl.nodes);
        setCurrentEdges(dl.edges);
      } else {
        const overview = buildTaskOverviewFlow(ruleTasks, activeStaff.designation, verdictByTask);
        setCurrentNodes(overview.nodes);
        setCurrentEdges(overview.edges);
      }
    } else {
      setCurrentNodes([]);
      setCurrentEdges([]);
    }
    setFlowDirty(false);
    // subtasksMap intentionally NOT in deps: subtask edits sync onto the canvas
    // imperatively via persistSubtasks (Steps → Canvas) and the onChange handler
    // mirrors canvas edits back into subtasksMap (Canvas → Steps). Keeping it
    // here would re-derive the canvas from scratch on every step add/remove and
    // wipe any user edits.
  }, [savedFlow, activeTask, activeStaff?.key, ruleTasks, verdictByTask]);

  // Auto-fill a task's Steps panel with AI-generated sub-tasks when it has none
  // — the generic equivalent of the hardcoded DEADLINE_DEFAULT_STEPS seed above,
  // for every other task. Guards: only when a task is open, it's NOT the deadline
  // task (which has its own seed), its steps are `undefined` (never set — an empty
  // [] means the user intentionally cleared them, so we leave it), and we haven't
  // already kicked off generation for it this session. Best-effort: failures stay
  // silent and leave the panel empty. Seeds subtasksMap directly (like the
  // deadline seed) so the canvas isn't re-derived from scratch.
  const autoSeededStepsRef = useRef<Set<string>>(new Set());
  const [autoSeedingTask, setAutoSeedingTask] = useState<string | null>(null);
  useEffect(() => {
    if (!activeTask || !activeLog) return;
    if (isDeadlineTrackingTask(activeTask)) return;
    if (subtasksMap[activeTask] !== undefined) return;
    const key = `${activeLog.id}::${activeTask}`;
    if (autoSeededStepsRef.current.has(key)) return;
    autoSeededStepsRef.current.add(key);

    let cancelled = false;
    setAutoSeedingTask(activeTask);
    const taskAtStart = activeTask;
    const logAtStart = activeLog;
    void generateSubtasksForTask({ task: taskAtStart, designation: activeStaff?.designation ?? 'staff' })
      .then((steps) => {
        if (cancelled || steps.length === 0) return;
        setSubtasksMap((prev) => {
          if (prev[taskAtStart] !== undefined) return prev; // user added some meanwhile
          const next = { ...prev, [taskAtStart]: steps };
          writeSubtasks(logAtStart.id, next);
          return next;
        });
      })
      .catch((e) => console.warn('[SkillFactoryV2] auto-seed steps failed', e))
      .finally(() => {
        if (!cancelled) setAutoSeedingTask((t) => (t === taskAtStart ? null : t));
      });
    return () => {
      cancelled = true;
    };
  }, [activeTask, activeLog, subtasksMap, activeStaff?.designation]);

  const persistLogTasks = async (logId: string, nextTasks: string[]) => {
    setLogs((prev) => prev.map((l) => (l.id === logId ? { ...l, tasks: nextTasks } : l)));
    const { error } = await supabase.from(LOGS_TABLE).update({ tasks: nextTasks }).eq('id', logId);
    if (error) {
      toast.error('Could not save task order.');
      console.warn('[SkillFactoryV2] update tasks failed', error);
    }
  };

  // Open the inline "Add staff" form in the Staff column.
  const addStaff = () => {
    if (!userEmail) {
      toast.error('You need to sign in to add a staff member.');
      return;
    }
    setStaffNameDraft('');
    setStaffDesignationDraft('');
    setAddingStaff(true);
  };
  const cancelAddStaff = () => {
    setAddingStaff(false);
    setStaffNameDraft('');
    setStaffDesignationDraft('');
  };
  const commitAddStaff = async () => {
    const name = staffNameDraft.trim();
    if (!name) return cancelAddStaff();
    if (staffList.some((s) => s.key === staffKey(name))) {
      setActiveStaffKey(staffKey(name));
      cancelAddStaff();
      return;
    }
    const designation = staffDesignationDraft.trim() || 'Staff';
    const seedTasks = COMMON_TASKS[designation] ?? [];
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from(LOGS_TABLE)
      .insert({
        user_email: userEmail,
        hospital_type: hospitalType,
        staff_name: name,
        designation,
        log_date: today,
        tasks: seedTasks,
        ai_suggestions: null,
      })
      .select('id, user_email, hospital_type, staff_name, designation, log_date, tasks, ai_suggestions, created_at')
      .single();
    if (error || !data) {
      toast.error('Could not create the staff member.');
      return;
    }
    const row = data as TaskOptimizerLog;
    setLogs((prev) => [row, ...prev]);
    const newKey = staffKey(name);
    const nextOrder = [newKey, ...staffOrder.filter((k) => k !== newKey)];
    setStaffOrder(nextOrder);
    writeOrder(userEmail, nextOrder);
    setActiveStaffKey(newKey);
    cancelAddStaff();
    toast.success(
      `Added "${name}" (${designation})${seedTasks.length ? ` with ${seedTasks.length} starter tasks` : ''}.`,
    );
  };

  // Open the inline "+ Add task" input at the top of the Tasks column.
  const addTask = () => {
    if (!activeStaff) return;
    setTaskDraft('');
    setAddingTask(true);
  };
  const cancelAddTask = () => {
    setAddingTask(false);
    setTaskDraft('');
  };
  const commitAddTask = async () => {
    if (!activeStaff) return;
    const text = taskDraft.trim();
    if (!text) return cancelAddTask();
    if ((activeLog?.tasks ?? []).some((t) => t.toLowerCase() === text.toLowerCase())) {
      toast.error('That task already exists.');
      return;
    }
    let log = activeLog;
    if (!log) {
      const today = new Date().toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from(LOGS_TABLE)
        .insert({
          user_email: userEmail,
          hospital_type: hospitalType,
          staff_name: activeStaff.name,
          designation: activeStaff.designation,
          log_date: today,
          tasks: [text],
          ai_suggestions: null,
        })
        .select('id, user_email, hospital_type, staff_name, designation, log_date, tasks, ai_suggestions, created_at')
        .single();
      if (error || !data) {
        toast.error('Could not create the task log.');
        return;
      }
      log = data as TaskOptimizerLog;
      setLogs((prev) => [log!, ...prev]);
      setActiveTask(text);
      cancelAddTask();
      return;
    }
    await persistLogTasks(log.id, [...(log.tasks ?? []), text]);
    setActiveTask(text);
    cancelAddTask();
  };

  const deleteTask = async (task: string) => {
    if (!activeLog) return;
    // Inline UI replaces the native confirm() dialog: just delete. The user can
    // re-add the task immediately if it was an accident — destructive enough?
    // We keep a soft toast as feedback.
    const next = (activeLog.tasks ?? []).filter((t) => t !== task);
    await persistLogTasks(activeLog.id, next);
    toast(`Removed "${task}".`);
  };

  const onStaffDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = staffList.map((s) => s.key);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const next = arrayMove(ids, from, to);
    setStaffOrder(next);
    writeOrder(userEmail, next);
  };

  const onRuleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id || !activeLog) return;
    const tasks = activeLog.tasks ?? [];
    const from = tasks.indexOf(String(active.id));
    const to = tasks.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    void persistLogTasks(activeLog.id, arrayMove(tasks, from, to));
  };

  // ── Unified drag handler — supports cross-column moves between Tasks ↔ Steps.
  const draggingFromRef = useRef<'tasks' | 'steps' | null>(null);
  // Mirror of the active drag id so <DragOverlay/> can render a ghost preview.
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  const onUnifiedDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id);
    if (ruleTasks.includes(id)) draggingFromRef.current = 'tasks';
    else if (activeSubtasks.includes(id)) draggingFromRef.current = 'steps';
    else draggingFromRef.current = null;
    setActiveDragId(id);
  };

  const onUnifiedDragCancel = () => {
    draggingFromRef.current = null;
    setActiveDragId(null);
  };

  const onUnifiedDragEnd = async (e: DragEndEvent) => {
    const from = draggingFromRef.current;
    draggingFromRef.current = null;
    setActiveDragId(null);
    const { active, over } = e;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    // Where did the drop land?
    const overInTasks = overId === 'tasks-drop' || ruleTasks.includes(overId);
    const overInSteps = overId === 'steps-drop' || activeSubtasks.includes(overId);

    // Task → Step: demote a task into the active task's step list.
    if (from === 'tasks' && overInSteps && activeTask && activeTask !== activeId) {
      if (activeSubtasks.some((s) => s.toLowerCase() === activeId.toLowerCase())) {
        toast.error('That item is already a step.');
        return;
      }
      // Insert at drop target position when over another step; otherwise append.
      const overIdx = overId === 'steps-drop' ? activeSubtasks.length : activeSubtasks.indexOf(overId);
      const nextSteps =
        overIdx < 0
          ? [...activeSubtasks, activeId]
          : [...activeSubtasks.slice(0, overIdx), activeId, ...activeSubtasks.slice(overIdx)];
      persistSubtasks({ ...subtasksMap, [activeTask]: nextSteps });
      if (activeLog) {
        await persistLogTasks(
          activeLog.id,
          (activeLog.tasks ?? []).filter((t) => t !== activeId),
        );
      }
      toast.success(`Moved "${activeId}" into steps of "${activeTask}".`);
      return;
    }

    // Step → Task: promote a step back into the task list.
    if (from === 'steps' && overInTasks && activeTask) {
      if (ruleTasks.some((t) => t.toLowerCase() === activeId.toLowerCase())) {
        toast.error('A task with that name already exists.');
        return;
      }
      // Drop position inside the tasks list.
      const tasks = activeLog?.tasks ?? [];
      const overIdx = overId === 'tasks-drop' ? tasks.length : tasks.indexOf(overId);
      const nextTasks =
        overIdx < 0
          ? [...tasks, activeId]
          : [...tasks.slice(0, overIdx), activeId, ...tasks.slice(overIdx)];
      if (activeLog) await persistLogTasks(activeLog.id, nextTasks);
      const nextSteps = activeSubtasks.filter((s) => s !== activeId);
      persistSubtasks({ ...subtasksMap, [activeTask]: nextSteps });
      toast.success(`Promoted "${activeId}" to a task.`);
      return;
    }

    // Same-column reorders — delegate to the existing handlers.
    if (from === 'tasks' && overInTasks) {
      onRuleDragEnd(e);
      return;
    }
    if (from === 'steps' && overInSteps) {
      onSubtaskDragEnd(e);
      return;
    }
  };

  // Snapshot of the canvas state before the most recent chatbot apply, used to
  // power the 30-second Undo on the auto-save toast. Held in a ref so the
  // toast handler always sees the latest snapshot without re-rendering.
  const preApplySnapshotRef = useRef<{ nodes: StoredNode[]; edges: StoredEdge[] } | null>(null);

  // Single save path — used by both the manual "Save" button and the chatbot
  // auto-save. When activeTask is set, behaves exactly like before (status-
  // change automation tied to a staff member's task). When it isn't, derives a
  // name from the trigger label so non-status automations (bill_added etc.)
  // can be saved as global flows.
  const persistFlow = async (
    nodes: StoredNode[],
    edges: StoredEdge[],
    opts: { silent?: boolean; nameOverride?: string; roleOverride?: string } = {},
  ): Promise<boolean> => {
    const safeNodes = nodes.length ? nodes : makeStarterFlow().nodes;
    const safeEdges = edges.length ? edges : makeStarterFlow().edges;

    let name = opts.nameOverride ?? activeTask;
    let role = opts.roleOverride ?? activeStaff?.designation ?? null;
    if (!name) {
      const triggerNode = safeNodes.find((n) => n.type === 'trigger');
      const triggerLabel = triggerNode?.data?.label as string | undefined;
      name = triggerLabel?.trim() || 'AI automation';
      if (!role) role = 'global';
    }
    if (!role) role = activeStaff?.designation ?? 'global';

    try {
      await saveTaskFlow({
        id: savedFlow?.id,
        hospitalType,
        role,
        name,
        enabled: savedFlow?.enabled ?? true,
        nodes: safeNodes,
        edges: safeEdges,
      });
      setCurrentNodes(safeNodes);
      setCurrentEdges(safeEdges);
      cleanFlowSigRef.current = meaningfulFlowSig(safeNodes, safeEdges);
      const refreshed = await fetchTaskFlows(hospitalType);
      setFlows(refreshed);
      setFlowDirty(false);
      if (!opts.silent) toast.success('Workflow saved.');
      return true;
    } catch (e: unknown) {
      console.warn('[SkillFactoryV2] save flow failed', e);
      toast.error('Could not save the workflow.');
      return false;
    }
  };

  const saveCurrentFlow = async () => {
    if (!activeStaff || !activeTask) {
      toast.error('Pick a staff member and task first.');
      return;
    }
    await persistFlow(currentNodes, currentEdges);
  };

  // Rule 16 — soft kill from the "Just saved · Review" pill. Disables the
  // current saved flow (enabled=false) without deleting it, so the user can
  // re-enable later from the Automations panel.
  const disableSavedFlow = async () => {
    if (!savedFlow) return;
    try {
      await saveTaskFlow({
        id: savedFlow.id,
        hospitalType: savedFlow.hospital_type,
        role: savedFlow.role,
        name: savedFlow.name,
        enabled: false,
        nodes: savedFlow.nodes,
        edges: savedFlow.edges,
      });
      const refreshed = await fetchTaskFlows(hospitalType);
      setFlows(refreshed);
      toast.success('Automation disabled.', {
        description: 'It will no longer fire. Re-enable it from the Automations panel.',
      });
    } catch (e: unknown) {
      console.warn('[SkillFactoryV2] disable flow failed', e);
      toast.error('Could not disable the automation.');
    }
  };

  // Apply a flow the chatbot built. Default behavior: auto-save with a 30s
  // Undo. Dry-run mode (Rule 15): apply to canvas only, NO DB write, NO Undo
  // needed — the snapshot is still here in memory.
  const applyChatbotFlow = async (
    nodes: StoredNode[],
    edges: StoredEdge[],
    opts: { dryRun?: boolean; nameOverride?: string } = {},
  ) => {
    preApplySnapshotRef.current = { nodes: currentNodes, edges: currentEdges };
    setCurrentNodes(nodes);
    setCurrentEdges(edges);
    setFlowDirty(true);
    if (opts.dryRun) {
      toast.message('Dry run — nothing saved.', {
        description: 'Toggle off "Dry run" in the chatbot to save next time.',
      });
      return;
    }
    const ok = await persistFlow(nodes, edges, { silent: true, nameOverride: opts.nameOverride });
    if (!ok) return;
    toast.success('Automation saved.', {
      description: 'Active now.',
      duration: 30000,
      action: {
        label: 'Undo',
        onClick: () => {
          const snap = preApplySnapshotRef.current;
          if (!snap) return;
          setCurrentNodes(snap.nodes);
          setCurrentEdges(snap.edges);
          void persistFlow(snap.nodes, snap.edges, { silent: true, nameOverride: opts.nameOverride });
          toast.message('Reverted. Nothing was saved.');
        },
      },
    });
  };

  // Load an existing saved automation onto the canvas to edit. Snapshots the
  // current canvas (so the chatbot's Undo could revert) and resets the dirty
  // signature so a no-edit load doesn't show "unsaved".
  const loadExistingFlow = (flowId: string) => {
    const f = flows.find((x) => x.id === flowId);
    if (!f) {
      toast.error('That automation could not be found.');
      return;
    }
    preApplySnapshotRef.current = { nodes: currentNodes, edges: currentEdges };
    setCurrentNodes(f.nodes);
    setCurrentEdges(f.edges);
    setFlowDirty(false);
    cleanFlowSigRef.current = meaningfulFlowSig(f.nodes, f.edges);
  };

  // Create a NEW saved automation from a chatbot suggestion. Unlike persistFlow,
  // this never UPSERTs the open flow and never touches the canvas — it INSERTs a
  // fresh row (saveTaskFlow with no id) under a de-duped name. The name is forced
  // ≠ activeTask so the canvas-repaint build effect can't match it to savedFlow
  // and clobber the open flow. Returns the new row's id+name.
  const createAutomation = async (
    flow: GeneratedFlow,
    opts: { nameOverride?: string; alsoLoad?: boolean } = {},
  ): Promise<{ id: string; name: string } | null> => {
    const role = activeStaff?.designation ?? 'global';
    const baseName = (opts.nameOverride || flow.name || 'AI automation').trim() || 'AI automation';
    const taken = new Set(
      flows
        .filter((f) => (f.role ?? '').toLowerCase() === role.toLowerCase())
        .map((f) => f.name.toLowerCase()),
    );
    if (activeTask) taken.add(activeTask.toLowerCase());
    let name = baseName;
    let n = 2;
    while (taken.has(name.toLowerCase())) name = `${baseName} (${n++})`;

    const nodes = flow.nodes.length ? flow.nodes : makeStarterFlow().nodes;
    const edges = flow.edges.length ? flow.edges : makeStarterFlow().edges;
    try {
      await saveTaskFlow({ /* no id → INSERT a new row */ hospitalType, role, name, enabled: true, nodes, edges });
      const refreshed = await fetchTaskFlows(hospitalType);
      setFlows(refreshed);
      const created = refreshed.find(
        (f) => f.name === name && (f.role ?? '').toLowerCase() === role.toLowerCase(),
      );
      if (!created) {
        toast.error('Automation was saved but could not be located.');
        return null;
      }
      toast.success(`New automation created: "${name}".`, {
        description: 'Saved and live.',
        duration: 30000,
        action: {
          label: 'Undo',
          onClick: () => {
            void deleteTaskFlow(created.id).then(async () => {
              const after = await fetchTaskFlows(hospitalType);
              setFlows(after);
              toast.message('Removed the new automation.');
            });
          },
        },
      });
      if (opts.alsoLoad) loadExistingFlow(created.id);
      return { id: created.id, name: created.name };
    } catch (e: unknown) {
      console.warn('[SkillFactoryV2] create automation failed', e);
      toast.error('Could not create the automation.');
      return null;
    }
  };

  // Create a log for the active staff on demand — mirrors commitAddTask's insert
  // but seeds no starter tasks (the AI provides them). Returns null if it can't.
  const ensureActiveLog = async (): Promise<TaskOptimizerLog | null> => {
    if (activeLog) return activeLog;
    if (!activeStaff || !userEmail) return null;
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from(LOGS_TABLE)
      .insert({
        user_email: userEmail,
        hospital_type: hospitalType,
        staff_name: activeStaff.name,
        designation: activeStaff.designation,
        log_date: today,
        tasks: [],
        ai_suggestions: null,
      })
      .select('id, user_email, hospital_type, staff_name, designation, log_date, tasks, ai_suggestions, created_at')
      .single();
    if (error || !data) {
      toast.error('Could not create the task log.');
      return null;
    }
    const row = data as TaskOptimizerLog;
    setLogs((prev) => [row, ...prev]);
    return row;
  };

  // Apply the AI's add/remove of tasks to the active staff's log. Idempotent:
  // never re-adds an existing task, never removes a missing one. Returns the
  // resulting log + the names of tasks newly added (so the caller can drill in).
  const applyTaskChanges = async (
    changes: TaskChange[],
  ): Promise<{ log: TaskOptimizerLog | null; added: string[] }> => {
    if (!activeStaff || changes.length === 0) return { log: activeLog, added: [] };
    const log = await ensureActiveLog();
    if (!log) return { log: null, added: [] };
    let tasks = [...(log.tasks ?? [])];
    const added: string[] = [];
    for (const c of changes) {
      const exists = tasks.some((t) => t.toLowerCase() === c.task.toLowerCase());
      if (c.action === 'add' && !exists) {
        tasks.push(c.task);
        added.push(c.task);
      } else if (c.action === 'remove' && exists) {
        tasks = tasks.filter((t) => t.toLowerCase() !== c.task.toLowerCase());
      }
    }
    await persistLogTasks(log.id, tasks);
    return { log, added };
  };

  // Apply the AI's add/remove of steps. Writes straight to subtasksMap +
  // localStorage (not via persistSubtasks) so it doesn't re-sync the canvas and
  // fight the workflow the same apply is about to paint.
  const applyStepChanges = (changes: StepChange[], logId: string | undefined) => {
    if (changes.length === 0) return;
    const next: Record<string, string[]> = { ...subtasksMap };
    for (const c of changes) {
      const key = Object.keys(next).find((k) => k.toLowerCase() === c.task.toLowerCase()) ?? c.task;
      const cur = next[key] ?? [];
      if (c.action === 'add') {
        if (!cur.some((s) => s.toLowerCase() === c.step.toLowerCase())) next[key] = [...cur, c.step];
      } else {
        next[key] = cur.filter((s) => s.toLowerCase() !== c.step.toLowerCase());
      }
    }
    setSubtasksMap(next);
    if (logId) writeSubtasks(logId, next);
  };

  // Single entry point for a chatbot result: apply task changes, then step
  // changes, then the canvas workflow — in that order so the canvas wins the
  // final paint. When the AI invents a brand-new task and the user isn't drilled
  // into one, the flow is saved under that task and we drill into it, so clicking
  // the new task later shows exactly this workflow.
  const applyAiResult = async (flow: GeneratedFlow, opts: { dryRun?: boolean } = {}) => {
    const { log, added } = await applyTaskChanges(flow.taskChanges);
    applyStepChanges(flow.stepChanges, log?.id ?? activeLog?.id);
    if (!activeTask && added.length > 0) {
      await applyChatbotFlow(flow.nodes, flow.edges, { dryRun: opts.dryRun, nameOverride: added[0] });
      setActiveTask(added[0]);
    } else {
      await applyChatbotFlow(flow.nodes, flow.edges, {
        dryRun: opts.dryRun,
        nameOverride: activeTask || undefined,
      });
    }
  };

  const filteredStaff = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return staffList;
    return staffList.filter(
      (s) => s.name.toLowerCase().includes(term) || s.designation.toLowerCase().includes(term),
    );
  }, [staffList, search]);

  return (
    <div className="flex h-full min-h-0 bg-gray-50">
      {/* ── Staff column ── (collapsible; default collapsed) */}
      {staffCollapsed ? (
        <section className="w-11 shrink-0 border-r border-gray-200 bg-white flex flex-col items-center py-3 gap-3">
          <Sparkles className="w-4 h-4 text-blue-600" />
          <NotificationBell variant="compact" />
          <button
            onClick={toggleStaffCollapsed}
            title="Expand Staff panel"
            className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-700"
          >
            <PanelLeftOpen className="w-4 h-4" />
          </button>
          <div className="mt-2 w-full px-1 flex flex-col items-center gap-1 overflow-y-auto">
            {staffList.slice(0, 12).map((s) => (
              <button
                key={s.key}
                onClick={() => setActiveStaffKey(s.key)}
                title={`${s.designation} · ${s.name}`}
                className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-semibold transition-colors ${
                  activeStaffKey === s.key
                    ? 'bg-blue-600 text-white'
                    : s.isCurrentUser
                    ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {(s.designation || s.name).slice(0, 1).toUpperCase()}
              </button>
            ))}
          </div>
        </section>
      ) : (
        <section className="w-64 shrink-0 border-r border-gray-200 bg-white overflow-y-auto flex flex-col">
          <div className="px-4 pt-4 pb-3 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-blue-600 shrink-0" />
              <span className="text-sm font-semibold text-gray-900">Skill Factory</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 font-medium">
                v2
              </span>
              <NotificationBell variant="inline" />
              <button
                onClick={toggleStaffCollapsed}
                title="Collapse Staff panel"
                className="p-1 rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
            </div>
            <div className="mt-3 relative">
              <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search staff..."
                className="w-full text-xs pl-8 pr-2 py-1.5 rounded-md border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              />
            </div>
          </div>

          <div className="flex items-center justify-between px-4 pt-3 pb-1">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Staff</h2>
            <button
              onClick={addStaff}
              title="Add staff member"
              className="flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors"
            >
              <Plus className="w-3 h-3" /> Add
            </button>
          </div>
          <p className="px-4 pb-2 text-[10px] text-gray-400">
            {isAdmin ? (
              <span className="inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Admin view · showing all staff
              </span>
            ) : (
              <span>Showing your own card</span>
            )}
          </p>

          <div className="px-2 pb-4 flex-1 overflow-y-auto">
            {/* Inline "add staff" form — replaces the native window.prompt */}
            {addingStaff && (
              <StaffInlineForm
                name={staffNameDraft}
                designation={staffDesignationDraft}
                onChangeName={setStaffNameDraft}
                onChangeDesignation={setStaffDesignationDraft}
                onCommit={() => void commitAddStaff()}
                onCancel={cancelAddStaff}
              />
            )}
            {loading && (
              <div className="px-3 py-4 text-xs text-gray-400 flex items-center gap-2">
                <Loader2 className="w-3 h-3 animate-spin" /> Loading…
              </div>
            )}
            {!loading && staffList.length === 0 && !addingStaff && (
              <p className="px-3 py-4 text-xs text-gray-400">
                Not signed in. Click <span className="font-medium">Add</span> to create a staff entry.
              </p>
            )}
            {!loading && staffList.length > 0 && (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onStaffDragEnd}>
                <SortableContext items={filteredStaff.map((s) => s.key)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-1">
                    {filteredStaff.map((s) => (
                      <StaffCard
                        key={s.key}
                        staff={s}
                        active={activeStaffKey === s.key}
                        ruleCount={(latestLogForStaff(logs, s.name)?.tasks ?? []).length}
                        onSelect={() => setActiveStaffKey(s.key)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </div>
        </section>
      )}

      {/* ── Tasks + Steps share one DndContext so cards can be dragged across.
            Everything below Staff is also wrapped in a ResizablePanelGroup so
            the user can drag dividers to resize, persisted via autoSaveId. ── */}
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetectionStrategy}
        // Re-measure droppables on every layout change so the conditional Steps
        // panel and resizing columns never produce stale hit-targets.
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        // Tighter scroll on the column container during drag.
        autoScroll={{ threshold: { x: 0.15, y: 0.15 } }}
        onDragStart={onUnifiedDragStart}
        onDragEnd={onUnifiedDragEnd}
        onDragCancel={onUnifiedDragCancel}
      >
      <ResizablePanelGroup
        direction="horizontal"
        autoSaveId={activeTask ? 'sf-v2:cols:steps' : 'sf-v2:cols:no-steps'}
        className="flex-1"
      >

      <ResizablePanel
        id="tasks"
        order={1}
        ref={tasksPanelRef}
        collapsible
        collapsedSize={3}
        defaultSize={activeTask ? 18 : 22}
        minSize={10}
        onCollapse={() => setCol('tasks', true)}
        onExpand={() => setCol('tasks', false)}
      >
      {/* ── Tasks column ── */}
      {colCollapsed.tasks ? (
        <CollapsedRail label="Tasks" side="left" onExpand={() => tasksPanelRef.current?.expand()} />
      ) : (
      <section className="h-full border-r border-gray-200 bg-white overflow-y-auto">
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400 flex items-center gap-1.5">
            <CollapseButton label="Tasks" side="left" onClick={() => tasksPanelRef.current?.collapse()} />
            <ListTodo className="w-3.5 h-3.5 text-blue-600" />
            Tasks
          </h2>
          <button
            onClick={addTask}
            disabled={!activeStaff}
            title="Add task"
            className="flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Plus className="w-3 h-3" /> Add
          </button>
        </div>
        <div className="px-3 pb-4">
          {/* Inline "add task" input — opens within the column instead of a browser prompt */}
          {addingTask && activeStaff && (
            <InlineAddInput
              tone="blue"
              placeholder="Task name…"
              value={taskDraft}
              onChange={setTaskDraft}
              onCommit={() => void commitAddTask()}
              onCancel={cancelAddTask}
              hint="Press ↵ to add · Esc to cancel"
            />
          )}
          {!activeStaff && <p className="px-1 py-3 text-xs text-gray-400">Select a staff member on the left.</p>}
          {activeStaff && ruleTasks.length === 0 && !addingTask && (
            <p className="px-1 py-3 text-xs text-gray-400">
              No tasks yet for {activeStaff.name}. Click <span className="font-medium">Add</span>.
            </p>
          )}
          {activeStaff && ruleTasks.length > 0 && (
            <SortableContext items={ruleTasks} strategy={verticalListSortingStrategy}>
              <TasksDropZone>
                <div className="space-y-2">
                  {ruleTasks.map((t) => (
                    <RuleCard
                      key={t}
                      task={t}
                      active={activeTask === t}
                      verdict={verdictFor(t)}
                      hasFlow={taskHasFlow(activeStaff.designation, t)}
                      stepCount={(subtasksMap[t] ?? []).length}
                      onSelect={() => setActiveTask(t)}
                      onDelete={() => void deleteTask(t)}
                    />
                  ))}
                </div>
              </TasksDropZone>
            </SortableContext>
          )}
        </div>
      </section>
      )}
      </ResizablePanel>

      {/* ── Steps panel (appears only when a task is selected) ──
          Narrower, indented from the top, deep violet background, and a leading
          vertical accent bar make this visually a sub-panel of the active task —
          not another column of tasks. */}
      {activeTask && (
        <>
        <ResizableHandle withHandle />
        <ResizablePanel
          id="steps"
          order={2}
          ref={stepsPanelRef}
          collapsible
          collapsedSize={3}
          defaultSize={14}
          minSize={8}
          onCollapse={() => setCol('steps', true)}
          onExpand={() => setCol('steps', false)}
        >
        {colCollapsed.steps ? (
          <CollapsedRail label="Steps" side="left" onExpand={() => stepsPanelRef.current?.expand()} />
        ) : (
        <section className="h-full border-r border-violet-200 bg-violet-50/70 overflow-y-auto">
          {/* Connector strip echoing the indent — anchors the panel to the active task */}
          <div className="h-1 bg-violet-300/60" />
          <div className="pl-3">
            <div className="border-l-2 border-violet-300/60 pl-2.5 pr-2 pt-3 pb-1">
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex items-center gap-1">
                  <CollapseButton label="Steps" side="left" onClick={() => stepsPanelRef.current?.collapse()} />
                  <CornerDownRight className="w-3.5 h-3.5 text-violet-500 shrink-0" />
                  <h2 className="text-[11px] font-bold uppercase tracking-wider text-violet-700">Steps</h2>
                </div>
                <button
                  onClick={addSubtask}
                  title="Add step"
                  className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-violet-600 text-white hover:bg-violet-700 transition-colors shrink-0"
                >
                  <Plus className="w-3 h-3" /> Step
                </button>
              </div>
              <p className="text-[10px] text-violet-500/80 mt-0.5 truncate" title={activeTask}>
                inside "{activeTask}"
              </p>
            </div>

            <div className="border-l-2 border-violet-300/60 pl-2.5 pr-2 pb-4">
              {/* Inline "+ Step" input — replaces the native window.prompt */}
              {addingStep && (
                <InlineAddInput
                  tone="violet"
                  placeholder="Step name…"
                  value={stepDraft}
                  onChange={setStepDraft}
                  onCommit={commitAddStep}
                  onCancel={cancelAddStep}
                  hint="Press ↵ to add · Esc to cancel"
                />
              )}
              {autoSeedingTask === activeTask && activeSubtasks.length === 0 && !addingStep && (
                <div className="flex items-center gap-1.5 px-1 py-2 text-[11px] text-violet-600">
                  <Sparkles className="h-3 w-3 animate-pulse" /> Generating steps…
                </div>
              )}
              <SortableContext items={activeSubtasks} strategy={verticalListSortingStrategy}>
                <StepsDropZone empty={activeSubtasks.length === 0 && !addingStep && autoSeedingTask !== activeTask}>
                  {activeSubtasks.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      {activeSubtasks.map((s, i) => (
                        <SubtaskRow
                          key={s}
                          index={i}
                          text={s}
                          collidesWithTask={ruleTasks.some(
                            (t) => t.toLowerCase() === s.toLowerCase(),
                          )}
                          onDelete={() => deleteSubtask(s)}
                        />
                      ))}
                    </div>
                  )}
                </StepsDropZone>
              </SortableContext>
            </div>
          </div>
        </section>
        )}
        </ResizablePanel>
        </>
      )}

      <ResizableHandle withHandle />
      <ResizablePanel
        id="workflow"
        order={3}
        ref={workflowPanelRef}
        collapsible
        collapsedSize={3}
        defaultSize={activeTask ? 45 : 53}
        minSize={25}
        onCollapse={() => setCol('workflow', true)}
        onExpand={() => setCol('workflow', false)}
      >
      {/* ── Workflow column ── */}
      {colCollapsed.workflow ? (
        <CollapsedRail label="Workflow" side="left" onExpand={() => workflowPanelRef.current?.expand()} />
      ) : (
      <section className="h-full min-w-0 bg-gray-50 flex flex-col">
        <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-2">
          <div className="min-w-0 flex items-start gap-1">
            <CollapseButton label="Workflow" side="left" onClick={() => workflowPanelRef.current?.collapse()} />
            <div className="min-w-0">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400 truncate">
              Workflow
              {activeTask && (
                <span className="ml-2 normal-case font-normal text-gray-500">· {activeTask}</span>
              )}
            </h2>
            {activeTask && (
              <div className="mt-1.5">
                <SkillInsightChip task={activeTask} />
              </div>
            )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {flowDirty && <span className="text-[11px] text-amber-600">unsaved changes</span>}
            <button
              onClick={() => void saveCurrentFlow()}
              disabled={!activeTask}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Save className="w-3.5 h-3.5" /> Save
            </button>
          </div>
        </div>

        {/* All-tasks strip — overview of every task in this staff member's list */}
        {activeStaff && ruleTasks.length > 0 && (
          <div className="px-5 pb-2">
            <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1.5">
              All tasks · {ruleTasks.length}
            </p>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {ruleTasks.map((t) => {
                const v = verdictFor(t);
                const isActive = activeTask === t;
                const hasFlow = taskHasFlow(activeStaff.designation, t);
                return (
                  <button
                    key={t}
                    onClick={() => setActiveTask(t)}
                    title={t}
                    className={`shrink-0 max-w-[200px] truncate text-[11px] px-2.5 py-1 rounded-full border transition-colors flex items-center gap-1.5 ${
                      isActive
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-700 border-gray-200 hover:border-blue-300 hover:bg-blue-50'
                    }`}
                  >
                    {v && (
                      <span
                        className={`inline-block w-1.5 h-1.5 rounded-full ${
                          isActive ? 'bg-white/80' : VERDICT_DOT[v.type] ?? 'bg-slate-300'
                        }`}
                      />
                    )}
                    <span className="truncate">{t}</span>
                    {hasFlow && <span className={isActive ? 'opacity-80' : 'text-emerald-600'}>✓</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex-1 min-h-0 px-4 pb-4 flex flex-col gap-2">
          {!activeTask && (
            <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
              <Wand2 className="w-3.5 h-3.5 shrink-0" />
              Pick a task on the left to attach this workflow. You can still preview / experiment here.
            </div>
          )}
          <div className="flex-1 min-h-0">
            <SkillFactoryFlow
              // Remount when context changes so React Flow re-fits the view to the
              // new node set (initial `fitView` only runs on mount).
              key={activeTask ? `task:${activeTask}` : `overview:${activeStaff?.key ?? ''}:${ruleTasks.length}`}
              nodes={currentNodes}
              edges={currentEdges}
              onChange={(n, edges) => {
                setCurrentNodes(n);
                setCurrentEdges(edges);
                // Only flag dirty when the canvas's *meaningful* content
                // changes (id/type/position/label/config or edge wiring).
                // Skipping selection/dimension-only updates prevents the
                // "unsaved changes" pill from sticking after a save.
                if (meaningfulFlowSig(n, edges) !== cleanFlowSigRef.current) {
                  setFlowDirty(true);
                } else {
                  setFlowDirty(false);
                }
                // Canvas → Steps: when a node is added / renamed / deleted on
                // the canvas, mirror those changes back into subtasksMap so the
                // Steps panel reflects "anything done on the canvas". We write
                // state + localStorage directly (not via persistSubtasks) to
                // avoid bouncing the change back onto the canvas as a rebuild.
                // The Deadline Tracking flow is fixed — its action nodes are not
                // user subtasks, so we never mirror them back (that's what made
                // the subtask list grow). The Steps panel is seeded once in the
                // build effect instead.
                if (activeTask && !isDeadlineTrackingTask(activeTask)) {
                  const derived = deriveSubtasksFromCanvas(n);
                  const cur = subtasksMap[activeTask] ?? [];
                  const changed =
                    derived.length !== cur.length ||
                    derived.some((s, i) => s !== cur[i]);
                  if (changed) {
                    const nextMap = { ...subtasksMap, [activeTask]: derived };
                    setSubtasksMap(nextMap);
                    if (activeLog) writeSubtasks(activeLog.id, nextMap);
                  }
                }
              }}
              // Overview is preview-only — edits would be wiped on the next data
              // refresh anyway. The user must drill into a task to edit.
              readOnly={!activeTask}
              // In-canvas slot: button lives inside the React Flow viewport
              // (top-right panel), pinned to the canvas itself. Stacked with
              // the Rule-16 "Just saved · Review" pill so users have a
              // discoverable rollback path long after the 30s Undo expires.
              topRightPanel={
                <div className="flex flex-col items-end gap-2">
                  {savedFlow && isWithin24h(savedFlow.updated_at) && (
                    <JustSavedPill
                      flowName={savedFlow.name}
                      onDisable={() => void disableSavedFlow()}
                    />
                  )}
                  <BillScanMenu onOpenDashboard={() => navigate('/deadline-tracking')} />
                </div>
              }
            />
          </div>
        </div>
      </section>
      )}
      </ResizablePanel>

      <ResizableHandle withHandle />
      <ResizablePanel
        id="ai"
        order={4}
        ref={aiPanelRef}
        collapsible
        collapsedSize={3}
        defaultSize={activeTask ? 23 : 25}
        minSize={15}
        onCollapse={() => setCol('ai', true)}
        onExpand={() => setCol('ai', false)}
      >
      {/* ── AI Assistant ── */}
      {colCollapsed.ai ? (
        <CollapsedRail label="Chatbot" side="right" onExpand={() => aiPanelRef.current?.expand()} />
      ) : (
      <aside className="h-full border-l border-gray-200 bg-white flex flex-col">
        <div className="flex items-center gap-1 px-2 py-1 border-b border-gray-100 shrink-0">
          <CollapseButton label="Chatbot" side="right" onClick={() => aiPanelRef.current?.collapse()} />
          <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Chatbot</span>
        </div>
        <div className="flex-1 min-h-0">
        {activeStaff ? (
          <SkillFactoryChatbot
            task={activeTask}
            subtasks={activeSubtasks}
            designation={activeStaff.designation}
            allTasks={ruleTasks}
            stepsByTask={subtasksMap}
            currentFlow={{ nodes: currentNodes, edges: currentEdges }}
            onApply={(flow, opts) => {
              void applyAiResult(flow, opts);
            }}
            onCreateAutomation={(flow, opts) => createAutomation(flow, opts)}
            onLoadExistingFlow={(flowId) => loadExistingFlow(flowId)}
            listExistingFlows={() =>
              flows
                .filter((f) => (f.role ?? '').toLowerCase() === (activeStaff?.designation ?? '').toLowerCase())
                .map((f) => ({ id: f.id, name: f.name, enabled: f.enabled }))
            }
          />
        ) : (
          <div className="h-full flex items-center justify-center text-center text-gray-400 px-6">
            <p className="text-xs">Pick a staff member to start designing automations with AI.</p>
          </div>
        )}
        </div>
      </aside>
      )}
      </ResizablePanel>

      </ResizablePanelGroup>

      <DragOverlay dropAnimation={dropAnimation}>
        {activeDragId ? (
          <DragGhost
            text={activeDragId}
            kind={draggingFromRef.current === 'steps' ? 'step' : 'task'}
          />
        ) : null}
      </DragOverlay>
      </DndContext>
    </div>
  );
}

// ── Staff card (column 1) ───────────────────────────────────────────
function StaffCard({
  staff,
  active,
  ruleCount,
  onSelect,
}: {
  staff: StaffMember;
  active: boolean;
  ruleCount: number;
  onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: staff.key,
    transition: { duration: 180, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    // Original card fades & shrinks slightly while its ghost (DragOverlay) flies
    // with the cursor — gives a clear "lift" effect instead of a flat translate.
    opacity: isDragging ? 0.35 : 1,
    scale: isDragging ? '0.98' : '1',
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-1 rounded-lg border px-2 py-2 transition-colors ${
        active ? 'border-blue-300 bg-blue-50' : 'border-transparent hover:bg-gray-50'
      }`}
    >
      <button
        {...attributes}
        {...listeners}
        title="Drag to reorder"
        className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 shrink-0"
      >
        <GripVertical className="w-3.5 h-3.5" />
      </button>
      <button onClick={onSelect} className="flex-1 min-w-0 text-left">
        <div className="flex items-center gap-2">
          <Boxes className={`w-4 h-4 shrink-0 ${active ? 'text-blue-600' : 'text-gray-400'}`} />
          <span className="text-sm font-semibold text-gray-900 truncate">{staff.designation}</span>
          {staff.isCurrentUser && (
            <span className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold shrink-0">
              you
            </span>
          )}
        </div>
        <p className="text-[10px] text-gray-500 mt-0.5 pl-6 truncate flex items-center gap-1">
          <UserIcon className="w-3 h-3 text-gray-400 shrink-0" />
          <span className="truncate">{staff.name}</span>
          <span className="text-gray-300">·</span>
          <span>{ruleCount} task{ruleCount === 1 ? '' : 's'}</span>
        </p>
      </button>
    </div>
  );
}

// ── Inline-input helpers ────────────────────────────────────────────
// Single-line text field that opens within a column to replace window.prompt.
// Auto-focuses on mount; ↵ commits, Esc cancels. Tone picks the colour theme.
function InlineAddInput({
  tone,
  placeholder,
  value,
  onChange,
  onCommit,
  onCancel,
  hint,
}: {
  tone: 'blue' | 'violet';
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  hint?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  const palette =
    tone === 'violet'
      ? 'border-violet-300 focus-within:ring-violet-400 bg-white'
      : 'border-blue-300 focus-within:ring-blue-400 bg-white';
  return (
    <div className={`mb-2 rounded-md border ${palette} px-2 py-1.5 shadow-sm transition-all focus-within:ring-2`}>
      <input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onCommit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        placeholder={placeholder}
        className="w-full bg-transparent text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none"
      />
      <div className="mt-1 flex items-center justify-between gap-2">
        <p className="text-[9px] text-gray-400">{hint}</p>
        <div className="flex gap-1">
          <button
            onClick={onCancel}
            className="text-[10px] px-1.5 py-0.5 rounded text-gray-500 hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            onClick={onCommit}
            disabled={!value.trim()}
            className={`text-[10px] px-2 py-0.5 rounded text-white disabled:opacity-40 disabled:cursor-not-allowed ${
              tone === 'violet' ? 'bg-violet-600 hover:bg-violet-700' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

// Two-field staff form (name + designation), opens inline in the Staff column.
function StaffInlineForm({
  name,
  designation,
  onChangeName,
  onChangeDesignation,
  onCommit,
  onCancel,
}: {
  name: string;
  designation: string;
  onChangeName: (v: string) => void;
  onChangeDesignation: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    nameRef.current?.focus();
  }, []);
  const handleKey = (e: ReactKbEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onCommit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };
  return (
    <div className="mb-2 rounded-md border border-blue-300 bg-white px-2 py-2 shadow-sm">
      <p className="mb-1 text-[10px] uppercase tracking-wide text-blue-700 font-semibold">New staff</p>
      <input
        ref={nameRef}
        value={name}
        onChange={(e) => onChangeName(e.target.value)}
        onKeyDown={handleKey}
        placeholder="Name (e.g. Priya M.)"
        className="w-full rounded border border-gray-200 px-1.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400"
      />
      <input
        value={designation}
        onChange={(e) => onChangeDesignation(e.target.value)}
        onKeyDown={handleKey}
        placeholder="Designation (Nursing, Pharmacy, Lab…)"
        className="mt-1 w-full rounded border border-gray-200 px-1.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400"
      />
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <p className="text-[9px] text-gray-400">↵ to add · Esc to cancel</p>
        <div className="flex gap-1">
          <button onClick={onCancel} className="text-[10px] px-1.5 py-0.5 rounded text-gray-500 hover:bg-gray-100">
            Cancel
          </button>
          <button
            onClick={onCommit}
            disabled={!name.trim()}
            className="text-[10px] px-2 py-0.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

// Local alias just for the keydown handler signature in StaffInlineForm.
type ReactKbEvent = import('react').KeyboardEvent<HTMLInputElement>;

// ── Drag ghost ──────────────────────────────────────────────────────
// Rendered inside <DragOverlay/>; the original row stays in place (dimmed) so
// the cursor-tracking element is decoupled from the list — much smoother than
// transforming the original.
function DragGhost({ text, kind }: { text: string; kind: 'task' | 'step' }) {
  const isStep = kind === 'step';
  return (
    <div
      className={`pointer-events-none select-none rounded-lg border-2 px-3 py-2 shadow-2xl ${
        isStep ? 'border-violet-400 bg-violet-50' : 'border-blue-400 bg-white'
      }`}
      style={{
        width: isStep ? 200 : 256,
        transform: 'rotate(-1deg)',
      }}
    >
      <div className="flex items-center gap-2">
        {isStep ? (
          <CornerDownRight className="w-3.5 h-3.5 text-violet-500 shrink-0" />
        ) : (
          <ListTodo className="w-3.5 h-3.5 text-blue-600 shrink-0" />
        )}
        <span className="text-sm font-medium text-gray-900 truncate">{text}</span>
      </div>
      <div className="mt-1.5">
        <span
          className={`text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded-full font-semibold ${
            isStep ? 'bg-violet-200 text-violet-800' : 'bg-blue-100 text-blue-700'
          }`}
        >
          {isStep ? 'step' : 'task'}
        </span>
      </div>
    </div>
  );
}

// ── Drop zones ──────────────────────────────────────────────────────
// Pure droppable wrappers around the Tasks list and Steps panel so a card can
// be dropped onto an empty column (not only onto an existing row).
function TasksDropZone({ children }: { children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'tasks-drop' });
  return (
    <div
      ref={setNodeRef}
      className={`rounded-md transition-all duration-150 ${
        isOver ? 'ring-2 ring-blue-400 bg-blue-50/60 shadow-inner' : ''
      }`}
    >
      {children}
    </div>
  );
}
function StepsDropZone({ children, empty }: { children: ReactNode; empty: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'steps-drop' });
  return (
    <div
      ref={setNodeRef}
      className={`rounded-md transition-all duration-150 ${
        isOver
          ? 'ring-2 ring-violet-500 bg-violet-100/60 shadow-inner scale-[1.01]'
          : empty
          ? 'min-h-[88px] border-2 border-dashed border-violet-300/60'
          : ''
      }`}
    >
      {children}
      {empty && (
        <p className="py-4 text-[11px] text-violet-500/80 italic text-center">
          {isOver ? 'Release to drop as a step' : 'Drag a task here to make it a step'}
        </p>
      )}
    </div>
  );
}

// ── Subtask row (subtasks column) ───────────────────────────────────
// Visually distinct from RuleCard so a subtask and a task with the same wording
// are never confused: violet accent border, indent icon, "sub" badge.
function SubtaskRow({
  text,
  index,
  collidesWithTask,
  onDelete,
}: {
  text: string;
  index: number;
  collidesWithTask: boolean;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: text,
    transition: { duration: 180, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    // Original card fades & shrinks slightly while its ghost (DragOverlay) flies
    // with the cursor — gives a clear "lift" effect instead of a flat translate.
    opacity: isDragging ? 0.35 : 1,
    scale: isDragging ? '0.98' : '1',
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative rounded-lg border bg-white hover:bg-violet-50/60 ${
        collidesWithTask ? 'border-amber-300' : 'border-violet-200/80'
      }`}
    >
      <div className="flex items-start gap-1 px-2 py-2">
        <button
          {...attributes}
          {...listeners}
          title="Drag to reorder"
          className="cursor-grab active:cursor-grabbing text-violet-300 hover:text-violet-500 shrink-0 mt-0.5"
        >
          <GripVertical className="w-3.5 h-3.5" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-1.5">
            <CornerDownRight className="w-3 h-3 mt-0.5 text-violet-500 shrink-0" />
            <span className="text-[10px] text-violet-400 mt-[1px] shrink-0 font-mono">{index + 1}.</span>
            <span className="text-xs text-gray-800 pr-5 break-words">{text}</span>
          </div>
          <div className="flex items-center gap-1.5 mt-1 pl-5">
            <span className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 font-semibold">
              subtask
            </span>
            {collidesWithTask && (
              <span
                title="A top-level task has the same name. Rename to avoid confusion."
                className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 font-medium border border-amber-200"
              >
                <AlertTriangle className="w-2.5 h-2.5" /> same as task
              </span>
            )}
          </div>
        </div>
        <button
          onClick={onDelete}
          title="Delete subtask"
          className="absolute top-1.5 right-1.5 p-1 rounded text-violet-400 hover:text-red-600 hover:bg-red-50"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

// ── Rule card (column 2) ────────────────────────────────────────────
function RuleCard({
  task,
  active,
  verdict,
  hasFlow,
  stepCount,
  onSelect,
  onDelete,
}: {
  task: string;
  active: boolean;
  verdict: TaskSuggestion | null;
  hasFlow: boolean;
  stepCount: number;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task,
    // Slightly snappier than dnd-kit's default (250ms ease).
    transition: { duration: 180, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    // Original card fades & shrinks slightly while its ghost (DragOverlay) flies
    // with the cursor — gives a clear "lift" effect instead of a flat translate.
    opacity: isDragging ? 0.3 : 1,
    scale: isDragging ? '0.97' : '1',
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative rounded-lg border transition-colors ${
        active ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-gray-50 hover:bg-gray-100'
      }`}
    >
      <div className="flex items-start gap-1 px-2 py-2">
        <button
          {...attributes}
          {...listeners}
          title="Drag to reorder"
          className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 shrink-0 mt-0.5"
        >
          <GripVertical className="w-3.5 h-3.5" />
        </button>
        <button onClick={onSelect} className="flex-1 min-w-0 text-left">
          <div className="text-sm text-gray-900 pr-5">
            <span className="truncate block">{task}</span>
          </div>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <span className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-semibold">
              task
            </span>
            {verdict ? (
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${
                  TYPE_TONE[verdict.type] ?? TYPE_TONE.keep
                }`}
              >
                {verdict.type}
              </span>
            ) : (
              <span className="text-[10px] text-gray-400">not yet analysed</span>
            )}
            {stepCount > 0 && (
              <span
                title={`${stepCount} step${stepCount === 1 ? '' : 's'} inside this task`}
                className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 font-medium"
              >
                <CornerDownRight className="w-2.5 h-2.5" />
                {stepCount}
              </span>
            )}
            {hasFlow && <span className="text-[10px] text-emerald-700">· flow saved</span>}
          </div>
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Delete task"
          className="absolute top-1.5 right-1.5 p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}
