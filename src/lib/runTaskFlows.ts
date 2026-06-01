import { supabase } from '@/integrations/supabase/client';
import { logActivity } from '@/lib/activity-logger';
import type {
  TaskFlow,
  FlowEventContext,
  TriggerConfig,
  ConditionConfig,
  ActionConfig,
  StoredNode,
} from '@/lib/taskOptimizerFlows';
import type { ActionStatus } from '@/lib/optimizeTasks';

// Result of one action firing — surfaced to the UI as a toast line.
export interface FlowActionResult {
  flowName: string;
  kind: ActionConfig['type'];
  message: string;
}

function nodesOfKind(flow: TaskFlow, kind: StoredNode['type']): StoredNode[] {
  return (flow.nodes ?? []).filter(n => n.type === kind);
}

// Does the flow's trigger match this status-change event?
function triggerMatches(flow: TaskFlow, ctx: FlowEventContext): boolean {
  const triggers = nodesOfKind(flow, 'trigger');
  if (triggers.length === 0) return false;
  return triggers.some(t => {
    const cfg = t.data.config as TriggerConfig;
    if (cfg.event !== 'status_changed') return false;
    return cfg.toStatus === 'any' || cfg.toStatus === ctx.status;
  });
}

function evalCondition(cfg: ConditionConfig, ctx: FlowEventContext): boolean {
  const raw =
    cfg.field === 'designation'
      ? ctx.designation
      : cfg.field === 'suggestion_type'
        ? ctx.suggestionType
        : String(ctx.timeSavedMins ?? '');
  const a = raw.toLowerCase().trim();
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
function conditionsPass(flow: TaskFlow, ctx: FlowEventContext): boolean {
  const conds = nodesOfKind(flow, 'condition');
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

    case 'tag':
      if (actionRowId) {
        await supabase
          .from('task_optimizer_actions')
          .update({ note: msg || 'Tagged by automation', updated_at: new Date().toISOString() })
          .eq('id', actionRowId)
          .then(() => {}, () => {});
      }
      return { flowName: flow.name, kind: 'tag', message: `Tagged "${ctx.taskText}"` };

    case 'set_status': {
      const target = (cfg.setStatus ?? 'in_progress') as ActionStatus;
      // Guard against a no-op / self-trigger loop: only update if different and
      // do NOT re-run flows from here.
      if (actionRowId && target !== ctx.status) {
        await supabase
          .from('task_optimizer_actions')
          .update({ status: target, updated_at: new Date().toISOString() })
          .eq('id', actionRowId)
          .then(() => {}, () => {});
      }
      return { flowName: flow.name, kind: 'set_status', message: `Set status → ${target}` };
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
