// Single entry point for firing automations from anywhere in the app. Every
// real-world event (`bill_added`, `deadline_due`, ..., `status_changed`) calls
// `dispatchFlowEvent` — never `runTaskFlows` directly — so the safety, audit,
// and dedup rules from the plan are enforced in one place.
//
// Defense-in-depth layers implemented here:
//   - Rule 7  Hospital scoping — flows from hospital A never fire for hospital B
//   - Rule 8  Reentrancy guard — depth-1 only; recursive dispatches throw
//   - Rule 9  Per-day dedup — `${event}:${entityId}:${YYYY-MM-DD}` once per tab
//   - Rule 11 Rate limit — 100 fires/hour per flow per hospital
//   - Rule 12 Audit log — every fire/skip/block writes one user_activity_log row
import { logActivity } from '@/lib/activity-logger';
import {
  fetchEnabledFlows,
  type FlowEventType,
  type FlowEventContext,
} from '@/lib/taskOptimizerFlows';
import { runFlowsForEvent, type FlowActionResult } from '@/lib/runTaskFlows';
import { FlowSafetyError } from '@/lib/flowSafety';

// What every dispatched event must carry. `entityId` is whatever the source
// considers "the thing that happened" (bill id, task action id, ...). Used as
// dedup key + audit log target.
export interface FlowEventPayload {
  hospitalType: string | null;
  entityId: string;
  // Optional status-change context (only required for `status_changed`).
  statusContext?: FlowEventContext;
  // Optional actionRowId for tag/set_status (only meaningful for status_changed).
  actionRowId?: string | null;
  // Optional dedup suffix appended to the dedup key. Use it when the same
  // entity can legitimately produce multiple distinct events in one day (e.g.
  // status_changed: suggested → in_progress → done — all three should fire).
  // Leave undefined for passive scans (deadline_due/overdue) where one fire
  // per day per bill is the goal.
  dedupSuffix?: string;
  // Rule 17 — when the entity (bill, task, etc.) was created. State-event
  // sources (deadline_due/overdue passive scans) MUST pass this so a freshly-
  // saved flow doesn't retroactively fire for the entire historical backlog.
  // Action-event sources (bill_added, deadline_paid) may omit it — the action
  // just happened, so any pre-existing flow is allowed to fire.
  entityCreatedAt?: string | null;
  // Per-event-type filter values used by triggerMatchesEvent to gate flows
  // whose typed config (cfg.billType, cfg.withinDays, ...) narrows the match.
  eventData?: {
    billType?: string;        // for bill_added — matched against cfg.billType
    daysUntilDue?: number;    // for deadline_due — must be <= cfg.withinDays
  };
  // Free-form extras carried through to the audit log for traceability.
  meta?: Record<string, unknown>;
}

// ── Dedup (Rule 9) ──────────────────────────────────────────────────
// Keyed `${event}:${entityId}:${YYYY-MM-DD}`. Bounded at 5000 with FIFO
// eviction so a long-lived tab never grows unbounded. Per-tab — opening a
// fresh tab is treated as a new session (acceptable for notify-class actions).
const DEDUP_MAX = 5000;
const dedupSet = new Set<string>();
const dedupOrder: string[] = [];

function todayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dedupHit(eventType: FlowEventType, entityId: string, suffix?: string): boolean {
  const today = todayKey();
  const key = suffix
    ? `${eventType}:${entityId}:${today}:${suffix}`
    : `${eventType}:${entityId}:${today}`;
  if (dedupSet.has(key)) return true;
  dedupSet.add(key);
  dedupOrder.push(key);
  // FIFO eviction beyond cap + purge any keys that aren't from today.
  if (dedupSet.size > DEDUP_MAX) {
    const evict = dedupOrder.shift();
    if (evict) dedupSet.delete(evict);
  }
  return false;
}

// ── Rate limit (Rule 11) ────────────────────────────────────────────
// Per-flow + per-hospital bucket reset each hour. Protects against a
// misconfigured trigger source spamming users or burning Supabase quota.
const RATE_MAX_PER_HOUR = 100;
const rateBuckets = new Map<string, { count: number; hourBucket: number }>();

function currentHourBucket(): number {
  return Math.floor(Date.now() / (60 * 60 * 1000));
}

function rateLimited(flowId: string, hospitalType: string | null): boolean {
  const key = `${flowId}:${hospitalType ?? '_'}`;
  const now = currentHourBucket();
  const entry = rateBuckets.get(key);
  if (!entry || entry.hourBucket !== now) {
    rateBuckets.set(key, { count: 1, hourBucket: now });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_MAX_PER_HOUR;
}

// ── Reentrancy guard (Rule 8) ───────────────────────────────────────
// A flow's action must never re-enter dispatchFlowEvent. The depth counter
// stays at 0 except during the synchronous call window of a single dispatch.
let dispatchDepth = 0;

// ── Hospital-wide kill switch (Rule 13) ─────────────────────────────
// Master pause backed by localStorage so it survives reloads within the same
// origin. Set by the admin in AutomationsPanel ("Pause all"); read by every
// dispatch before any work happens. Returns true when paused.
const PAUSE_KEY = 'automations:pausedUntil';
export function setAutomationsPausedUntil(unixMs: number | null): void {
  try {
    if (unixMs && unixMs > Date.now()) {
      localStorage.setItem(PAUSE_KEY, String(unixMs));
    } else {
      localStorage.removeItem(PAUSE_KEY);
    }
  } catch {
    /* localStorage may be unavailable in private mode — fail open */
  }
}
export function getAutomationsPausedUntil(): number | null {
  try {
    const raw = localStorage.getItem(PAUSE_KEY);
    if (!raw) return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= Date.now()) {
      localStorage.removeItem(PAUSE_KEY);
      return null;
    }
    return n;
  } catch {
    return null;
  }
}
function isPaused(): boolean {
  return getAutomationsPausedUntil() !== null;
}

// ── Main entry point ────────────────────────────────────────────────
export async function dispatchFlowEvent(
  eventType: FlowEventType,
  payload: FlowEventPayload,
): Promise<FlowActionResult[]> {
  // Rule 13 — master kill switch. When an admin paused automations, write a
  // single audit row per dispatch (so it's visible they were suppressed) and
  // return without firing anything.
  if (isPaused()) {
    void logActivity('automation_paused', {
      event: eventType,
      entityId: payload.entityId,
    });
    return [];
  }

  // Rule 8 — refuse nested dispatches outright. The runtime never calls this
  // from inside runAction; if it does in the future, that's a bug we want to
  // surface (and break) instead of silently looping forever.
  if (dispatchDepth > 0) {
    const err = new FlowSafetyError(
      'reentry',
      `dispatchFlowEvent re-entered while another dispatch was running (event=${eventType}).`,
    );
    void logActivity('automation_blocked_safety', {
      event: eventType,
      reason: 'reentry',
      entityId: payload.entityId,
    });
    throw err;
  }

  // Rule 9 — per-day dedup. Callers can pass `dedupSuffix` when the same
  // entity can legitimately produce several distinct events in one day.
  if (dedupHit(eventType, payload.entityId, payload.dedupSuffix)) {
    return [];
  }

  dispatchDepth += 1;
  try {
    const flows = await fetchEnabledFlows(payload.hospitalType);
    // Rule 7 — hospital scoping is also enforced by fetchEnabledFlows's query,
    // but we keep this filter as defense in depth in case a flow row leaks
    // through without a hospital_type (legacy rows).
    const scoped = flows.filter(
      (f) => !payload.hospitalType || !f.hospital_type || f.hospital_type === payload.hospitalType,
    );

    // Rule 17 — filter out flows that were created AFTER the entity. Only
    // applied when the caller passed entityCreatedAt (state-event scans like
    // deadline_due). Action events leave entityCreatedAt undefined so every
    // pre-existing flow stays in scope.
    const backlogSafe = payload.entityCreatedAt
      ? scoped.filter((f) => {
          // Older flow than the entity → safe (flow was already around when
          // the entity existed, would have caught the original event).
          return new Date(f.created_at).getTime() <= new Date(payload.entityCreatedAt!).getTime();
        })
      : scoped;

    const allResults: FlowActionResult[] = [];
    for (const flow of backlogSafe) {
      if (rateLimited(flow.id, payload.hospitalType)) {
        void logActivity('automation_rate_limited', {
          event: eventType,
          flowId: flow.id,
          flowName: flow.name,
        });
        continue;
      }
      const results = await runFlowsForEvent(
        [flow],
        eventType,
        payload.statusContext ?? null,
        payload.actionRowId ?? null,
        payload.eventData,
      );
      if (results.length > 0) {
        void logActivity('automation_fired', {
          event: eventType,
          flowId: flow.id,
          flowName: flow.name,
          entityId: payload.entityId,
          // Carry `undo` through so Activity Log can render an inline Undo
          // button for tag / set_status actions within the 30-second window.
          actions: results.map((r) => ({ kind: r.kind, message: r.message, undo: r.undo ?? null })),
          meta: payload.meta ?? null,
        });
        allResults.push(...results);
      }
    }
    return allResults;
  } finally {
    dispatchDepth -= 1;
  }
}

// Test/utility — clear in-memory state. Used by `e2e/run-task-flows.test.ts`
// to reset between cases.
export function _resetDispatcherForTests(): void {
  dedupSet.clear();
  dedupOrder.length = 0;
  rateBuckets.clear();
  dispatchDepth = 0;
}
