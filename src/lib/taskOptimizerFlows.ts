import { supabase } from '@/integrations/supabase/client';
import type { ActionStatus, SuggestionType } from '@/lib/optimizeTasks';

// ── Node config shapes ──────────────────────────────────────────────
// A flow is a small graph: one trigger, zero+ conditions, one+ actions.
// Configs are plain data so the whole graph round-trips through JSONB.

export type FlowNodeKind = 'trigger' | 'condition' | 'action';

// The complete set of real-world events the runtime can fire flows on.
// Extending this list is a 5-step process (see plan: Part 5). Anything outside
// this set is rejected by FlowSafetyError before reaching the runtime.
export const FLOW_EVENT_TYPES = [
  'status_changed',
  'bill_added',
  'deadline_due',
  'deadline_overdue',
  'deadline_paid',
  'task_added',
  'scheduled',
] as const;
export type FlowEventType = (typeof FLOW_EVENT_TYPES)[number];

export const SCHEDULED_CADENCES = ['15m', 'hourly', 'daily'] as const;
export type ScheduledCadence = (typeof SCHEDULED_CADENCES)[number];

// Discriminated union of trigger configurations — old `status_changed` rows
// parse unchanged so no DB migration is needed.
export type TriggerConfig =
  | { event: 'status_changed'; toStatus: ActionStatus | 'any' }
  | { event: 'bill_added'; billType?: string | 'any' }
  | { event: 'deadline_due'; withinDays?: number }
  | { event: 'deadline_overdue' }
  | { event: 'deadline_paid' }
  | { event: 'task_added'; textContains?: string; designationContains?: string }
  | { event: 'scheduled'; cadence: ScheduledCadence };

export type ConditionField = 'designation' | 'suggestion_type' | 'time_saved_mins';
export type ConditionOp = 'eq' | 'contains' | 'gte';
export interface ConditionConfig {
  field: ConditionField;
  op: ConditionOp;
  value: string;
}

export type ActionType = 'notify' | 'tag' | 'set_status' | 'whatsapp' | 'email' | 'gmail_check' | 'slack';
export interface ActionConfig {
  type: ActionType;
  // notify/whatsapp/email: message; tag: note text; set_status: target status.
  message?: string;
  setStatus?: ActionStatus;
  // whatsapp/email/gmail_check stay opt-in; live sends/reads are never made
  // without this + creds.
  enabled?: boolean;
  // email-specific
  to?: string;
  subject?: string;
  // gmail_check-specific: Gmail search query (e.g. `is:unread newer_than:1d`).
  query?: string;
}

export type FlowNodeConfig = TriggerConfig | ConditionConfig | ActionConfig;

export interface FlowNodeData {
  kind: FlowNodeKind;
  label: string;
  config: FlowNodeConfig;
  [key: string]: unknown; // React Flow's Node data is an open record
}

// React Flow-compatible persisted shapes (only the fields we need to store).
export interface StoredNode {
  id: string;
  type: FlowNodeKind;
  position: { x: number; y: number };
  data: FlowNodeData;
}
export interface StoredEdge {
  id: string;
  source: string;
  target: string;
}

export interface TaskFlow {
  id: string;
  hospital_type: string | null;
  role: string | null; // staff role/persona this automation is for
  name: string;
  enabled: boolean;
  nodes: StoredNode[];
  edges: StoredEdge[];
  created_at: string;
  updated_at: string;
}

const TABLE = 'task_optimizer_flows';

export async function fetchTaskFlows(hospitalType: string | null): Promise<TaskFlow[]> {
  let query = supabase
    .from(TABLE)
    .select('id, hospital_type, role, name, enabled, nodes, edges, created_at, updated_at')
    .order('updated_at', { ascending: false })
    .limit(200);
  if (hospitalType) query = query.eq('hospital_type', hospitalType);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as TaskFlow[];
}

// Only enabled flows, for the execution path (status-change evaluation).
export async function fetchEnabledFlows(hospitalType: string | null): Promise<TaskFlow[]> {
  const all = await fetchTaskFlows(hospitalType);
  return all.filter(f => f.enabled);
}

export interface SaveFlowInput {
  id?: string;
  hospitalType: string | null;
  role: string | null;
  name: string;
  enabled: boolean;
  nodes: StoredNode[];
  edges: StoredEdge[];
}

export async function saveTaskFlow(input: SaveFlowInput): Promise<void> {
  const row = {
    ...(input.id ? { id: input.id } : {}),
    hospital_type: input.hospitalType,
    role: input.role,
    name: input.name,
    enabled: input.enabled,
    nodes: input.nodes,
    edges: input.edges,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from(TABLE).upsert(row);
  if (error) throw error;
}

export async function deleteTaskFlow(id: string): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq('id', id);
  if (error) throw error;
}

// Default starter graph for a new automation: trigger -> action, pre-wired.
export function makeStarterFlow(): { nodes: StoredNode[]; edges: StoredEdge[] } {
  return {
    nodes: [
      {
        id: 'trigger-1',
        type: 'trigger',
        position: { x: 80, y: 120 },
        data: {
          kind: 'trigger',
          label: 'When status changes',
          config: { event: 'status_changed', toStatus: 'done' } as TriggerConfig,
        },
      },
      {
        id: 'action-1',
        type: 'action',
        position: { x: 460, y: 120 },
        data: {
          kind: 'action',
          label: 'Notify',
          config: { type: 'notify', message: 'A task was marked done' } as ActionConfig,
        },
      },
    ],
    edges: [{ id: 'e-trigger-1-action-1', source: 'trigger-1', target: 'action-1' }],
  };
}

// Context passed to the engine when a suggestion's status changes.
export interface FlowEventContext {
  staffName: string;
  designation: string;
  suggestionType: SuggestionType;
  status: ActionStatus; // the NEW status
  timeSavedMins: number | null;
  taskText: string;
}
