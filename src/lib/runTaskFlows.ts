import { supabase } from '@/integrations/supabase/client';
import { logActivity } from '@/lib/activity-logger';
import { notifyUtilitySlack } from '@/lib/notifySlack';
import type {
  TaskFlow,
  FlowEventContext,
  FlowEventType,
  TriggerConfig,
  ConditionConfig,
  ActionConfig,
  StoredNode,
} from '@/lib/taskOptimizerFlows';
import type { ActionStatus } from '@/lib/optimizeTasks';

// Result of one action firing — surfaced to the UI as a toast line, and
// propagated through the audit log so Activity Log can render an Undo button.
export interface FlowActionResult {
  flowName: string;
  kind: ActionConfig['type'];
  message: string;
  // Rule 14 — present only for mutating actions (tag, set_status). Carries the
  // exact field the action changed plus the prior value so the UI can issue an
  // inverse update within the 30-second undo window.
  undo?: {
    table: 'task_optimizer_actions';
    rowId: string;
    column: 'note' | 'status';
    priorValue: string | null;
  };
  // guide action only — a clickable deep link surfaced on the toast so the user
  // can jump straight to the page/tab they need to act on.
  deepLink?: { url: string; label: string };
}

function nodesOfKind(flow: TaskFlow, kind: StoredNode['type']): StoredNode[] {
  return (flow.nodes ?? []).filter(n => n.type === kind);
}

// Does the flow's trigger match this status-change event? (Legacy path.)
function triggerMatches(flow: TaskFlow, ctx: FlowEventContext): boolean {
  const triggers = nodesOfKind(flow, 'trigger');
  if (triggers.length === 0) return false;
  return triggers.some(t => {
    const cfg = t.data.config as TriggerConfig;
    if (cfg.event !== 'status_changed') return false;
    return cfg.toStatus === 'any' || cfg.toStatus === ctx.status;
  });
}

// Per-event filter values used by triggerMatchesEvent so a flow's typed config
// (billType, withinDays, …) actually narrows the match instead of just being
// dead config.
export interface FlowEventData {
  billType?: string;
  daysUntilDue?: number;
  taskText?: string;
  designation?: string;
}

// Generic per-event matcher used by runFlowsForEvent. For status_changed it
// compares `toStatus` against ctx; for bill_added it respects cfg.billType
// ('any' or undefined = match all); for deadline_due it gates on cfg.withinDays
// (daysUntilDue must be >= 0 and <= withinDays).
function triggerMatchesEvent(
  flow: TaskFlow,
  eventType: FlowEventType,
  ctx: FlowEventContext | null,
  eventData: FlowEventData | undefined,
): boolean {
  const triggers = nodesOfKind(flow, 'trigger');
  if (triggers.length === 0) return false;
  return triggers.some(t => {
    const cfg = t.data.config as TriggerConfig;
    if (cfg.event !== eventType) return false;
    switch (cfg.event) {
      case 'status_changed':
        if (!ctx) return false;
        return cfg.toStatus === 'any' || cfg.toStatus === ctx.status;
      case 'bill_added': {
        // 'any' (or absent) means "match every bill type". Otherwise compare
        // case-insensitively so user free-text matches the canonical enum.
        const want = cfg.billType?.toString().trim().toLowerCase();
        if (!want || want === 'any') return true;
        const got = eventData?.billType?.toString().trim().toLowerCase();
        // If the caller didn't pass a billType, fall back to permissive match
        // (don't silently drop the event — preserve "fire when in doubt").
        return !got || got === want;
      }
      case 'deadline_due': {
        // withinDays = 3 means "fire if the bill is due within the next 3 days
        // (non-negative)". Overdue bills (negative days) belong to deadline_overdue.
        const within = typeof cfg.withinDays === 'number' ? cfg.withinDays : 3;
        const d = eventData?.daysUntilDue;
        if (typeof d !== 'number') return true; // no data → permissive
        return d >= 0 && d <= within;
      }
      case 'deadline_overdue':
      case 'deadline_paid':
        return true;
      case 'task_added': {
        const wantText = cfg.textContains?.toString().trim().toLowerCase();
        const wantDes = cfg.designationContains?.toString().trim().toLowerCase();
        const gotText = eventData?.taskText?.toString().toLowerCase() ?? '';
        const gotDes = eventData?.designation?.toString().toLowerCase() ?? '';
        if (wantText && !gotText.includes(wantText)) return false;
        if (wantDes && !gotDes.includes(wantDes)) return false;
        return true;
      }
      case 'scheduled':
        // Scheduled flows are evaluated by the server-side runner
        // (run-scheduled-flows edge function), never the client dispatcher.
        return false;
    }
  });
}

function evalCondition(cfg: ConditionConfig, ctx: FlowEventContext | null): boolean {
  // No status-change context (e.g. a bill_added event): fields aren't available
  // — treat the condition as not matched rather than crashing on undefined.
  if (!ctx) return false;
  const raw =
    cfg.field === 'designation'
      ? ctx.designation
      : cfg.field === 'suggestion_type'
        ? ctx.suggestionType
        : String(ctx.timeSavedMins ?? '');
  const a = (raw ?? '').toString().toLowerCase().trim();
  const b = cfg.value.toLowerCase().trim();
  switch (cfg.op) {
    case 'eq':
      return a === b;
    case 'contains':
      return a.includes(b);
    case 'gte':
      return Number(ctx.timeSavedMins ?? 0) >= Number(cfg.value || 0);
    default:
      return false;
  }
}

// All conditions in the flow must pass (simple AND). Keeps evaluation
// predictable regardless of exact wiring of a linear trigger->...->action chain.
function conditionsPass(flow: TaskFlow, ctx: FlowEventContext | null): boolean {
  const conds = nodesOfKind(flow, 'condition');
  if (conds.length === 0) return true;
  return conds.every(c => evalCondition(c.data.config as ConditionConfig, ctx));
}

function interpolate(message: string, ctx: FlowEventContext): string {
  return (message || '')
    .replace(/\{staff\}/gi, ctx.staffName)
    .replace(/\{task\}/gi, ctx.taskText)
    .replace(/\{status\}/gi, ctx.status)
    .replace(/\{designation\}/gi, ctx.designation);
}

// Run one action against the event. DB side effects are best-effort and never
// throw to the caller — automations must not block a status save.
async function runAction(
  flow: TaskFlow,
  cfg: ActionConfig,
  ctx: FlowEventContext,
  actionRowId: string | null,
): Promise<FlowActionResult> {
  const msg = interpolate(cfg.message || '', ctx);
  switch (cfg.type) {
    case 'notify':
      logActivity('task_flow_notify', { flow: flow.name, task: ctx.taskText, status: ctx.status });
      return { flowName: flow.name, kind: 'notify', message: msg || `Notified for "${ctx.taskText}"` };

    case 'tag': {
      let priorNote: string | null = null;
      if (actionRowId) {
        // Read the current note BEFORE the update so the audit log can carry
        // it for the Activity Log Undo button (Rule 14).
        try {
          const { data } = await supabase
            .from('task_optimizer_actions')
            .select('note')
            .eq('id', actionRowId)
            .single();
          priorNote = (data?.note as string | null) ?? null;
        } catch {
          /* best effort; missing prior means Undo will be disabled */
        }
        await supabase
          .from('task_optimizer_actions')
          .update({ note: msg || 'Tagged by automation', updated_at: new Date().toISOString() })
          .eq('id', actionRowId)
          .then(() => {}, () => {});
      }
      return {
        flowName: flow.name,
        kind: 'tag',
        message: `Tagged "${ctx.taskText}"`,
        undo: actionRowId
          ? { table: 'task_optimizer_actions', rowId: actionRowId, column: 'note', priorValue: priorNote }
          : undefined,
      };
    }

    case 'set_status': {
      const target = (cfg.setStatus ?? 'in_progress') as ActionStatus;
      // Guard against a no-op / self-trigger loop: only update if different and
      // do NOT re-run flows from here.
      const willMutate = !!actionRowId && target !== ctx.status;
      if (willMutate) {
        await supabase
          .from('task_optimizer_actions')
          .update({ status: target, updated_at: new Date().toISOString() })
          .eq('id', actionRowId!)
          .then(() => {}, () => {});
      }
      return {
        flowName: flow.name,
        kind: 'set_status',
        message: `Set status → ${target}`,
        undo: willMutate
          ? { table: 'task_optimizer_actions', rowId: actionRowId!, column: 'status', priorValue: ctx.status }
          : undefined,
      };
    }

    case 'whatsapp':
      // Outbound sends stay opt-in. Without cfg.enabled (and server creds) we
      // only record intent — never silently message anyone.
      logActivity('task_flow_whatsapp_intent', { flow: flow.name, task: ctx.taskText, enabled: !!cfg.enabled });
      return {
        flowName: flow.name,
        kind: 'whatsapp',
        message: cfg.enabled
          ? `WhatsApp queued: ${msg || ctx.taskText}`
          : `WhatsApp action (disabled) — would send: ${msg || ctx.taskText}`,
      };

    case 'email':
      logActivity('task_flow_email_intent', {
        flow: flow.name,
        task: ctx.taskText,
        to: cfg.to,
        subject: cfg.subject,
        enabled: !!cfg.enabled,
      });
      return {
        flowName: flow.name,
        kind: 'email',
        message: cfg.enabled
          ? `Email queued to ${cfg.to || '(no address)'}: ${cfg.subject || msg || ctx.taskText}`
          : `Email action (disabled) — would send to ${cfg.to || '(no address)'}: ${cfg.subject || msg || ctx.taskText}`,
      };

    case 'gmail_check':
      // Browser-side stub: the real Gmail poll runs inside the
      // run-scheduled-flows edge function. From a `task_added` trigger on the
      // client we just record intent so the user sees the automation took.
      logActivity('task_flow_gmail_check_intent', {
        flow: flow.name,
        query: cfg.query,
        enabled: !!cfg.enabled,
      });
      return {
        flowName: flow.name,
        kind: 'gmail_check',
        message: cfg.enabled
          ? `Gmail check queued${cfg.query ? ` (${cfg.query})` : ''}`
          : `Gmail check (disabled) — would run${cfg.query ? ` (${cfg.query})` : ''}`,
      };

    case 'slack':
      // Channel broadcast (low blast radius) — fires by default, unlike the
      // opt-in whatsapp/email DM actions. notifyUtilitySlack swallows its own
      // errors, so this never throws into the runtime.
      await notifyUtilitySlack(msg || `Automation "${flow.name}" fired for "${ctx.taskText}"`);
      logActivity('task_flow_slack', { flow: flow.name, task: ctx.taskText });
      return { flowName: flow.name, kind: 'slack', message: `Slack alert sent: ${msg || ctx.taskText}` };

    case 'guide': {
      // Non-mutating: points the user at the page/tab to act on. The dispatcher
      // renders the clickable deep link; here we just carry url + label + text.
      const url = (cfg.url || '').trim();
      logActivity('task_flow_guide', { flow: flow.name, url, task: ctx.taskText });
      return {
        flowName: flow.name,
        kind: 'guide',
        message: msg || `Open ${cfg.label || 'the page'} for "${ctx.taskText}"`,
        deepLink: url ? { url, label: (cfg.label || 'Open').trim() } : undefined,
      };
    }

    default:
      return { flowName: flow.name, kind: cfg.type, message: 'Unknown action' };
  }
}

// Evaluate all enabled flows for a status-change event and run matching actions.
// `actionRowId` is the task_optimizer_actions row just upserted, so tag/set_status
// can target it. Returns one result per fired action for UI display.
export async function runTaskFlows(
  flows: TaskFlow[],
  ctx: FlowEventContext,
  actionRowId: string | null,
): Promise<FlowActionResult[]> {
  const results: FlowActionResult[] = [];
  for (const flow of flows) {
    if (!flow.enabled) continue;
    if (!triggerMatches(flow, ctx)) continue;
    if (!conditionsPass(flow, ctx)) continue;
    for (const node of nodesOfKind(flow, 'action')) {
      try {
        results.push(await runAction(flow, node.data.config as ActionConfig, ctx, actionRowId));
      } catch {
        // Ignore a single failing action; keep the rest of the automation going.
      }
    }
  }
  return results;
}

// Generic event runner used by flowDispatcher. Filters flows by event type,
// evaluates conditions where applicable, runs actions. Actions that need a
// task_optimizer_actions row id (tag / set_status) are SKIPPED with a logged
// warning when ctx is null or actionRowId is null — never crash.
export async function runFlowsForEvent(
  flows: TaskFlow[],
  eventType: FlowEventType,
  ctx: FlowEventContext | null,
  actionRowId: string | null,
  eventData?: FlowEventData,
): Promise<FlowActionResult[]> {
  const results: FlowActionResult[] = [];
  for (const flow of flows) {
    if (!flow.enabled) continue;
    if (!triggerMatchesEvent(flow, eventType, ctx, eventData)) continue;
    if (!conditionsPass(flow, ctx)) continue;
    for (const node of nodesOfKind(flow, 'action')) {
      const cfg = node.data.config as ActionConfig;
      // Skip actions that need a status-context row when none is available.
      if ((cfg.type === 'tag' || cfg.type === 'set_status') && (!ctx || !actionRowId)) {
        logActivity('automation_skipped', {
          flow: flow.name,
          flowId: flow.id,
          event: eventType,
          actionType: cfg.type,
          reason: 'not applicable to this event',
        });
        results.push({
          flowName: flow.name,
          kind: cfg.type,
          message: `Skipped: ${cfg.type} needs a task action row.`,
        });
        continue;
      }
      try {
        // ctx may be null for non-status events; runAction's notify/whatsapp/
        // email branches don't depend on ctx fields except via interpolate,
        // which we handle by passing a synthetic empty ctx.
        const safeCtx: FlowEventContext =
          ctx ??
          ({
            staffName: '',
            designation: '',
            suggestionType: 'automate',
            status: 'in_progress',
            timeSavedMins: null,
            taskText: '',
          } as FlowEventContext);
        results.push(await runAction(flow, cfg, safeCtx, actionRowId));
      } catch {
        // Ignore a single failing action; keep the rest of the automation going.
      }
    }
  }
  return results;
}
