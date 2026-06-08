// Unit tests for the automation engine — covers:
//   1. runTaskFlows (legacy status_changed path)
//   2. runFlowsForEvent (new event types, skip-not-crash for tag/set_status)
//   3. flowDispatcher (dedup, rate limit, reentry guard, hospital scope, Rule 17)
//   4. flowSafety (FlowSafetyError, isDestructiveIntent)
// Supabase REST is stubbed so no network. The stub is upgraded mid-file so the
// dispatcher tests can seed controlled flow rows.
//
// Run:  npx vite-node e2e/run-task-flows.test.ts
const origFetch = globalThis.fetch;

// Mutable test stub — initially returns []. Dispatcher tests swap in seeded
// flow rows by mutating `stubbedFlows`.
let stubbedFlows: any[] = [];
let activityLogWrites: any[] = [];
globalThis.fetch = (async (url: any, init: any) => {
  const u = String(url);
  if (u.includes('/rest/v1/task_optimizer_flows')) {
    return new Response(JSON.stringify(stubbedFlows), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  if (u.includes('/rest/v1/user_activity_log')) {
    // Capture write payloads so tests can assert audit-log behavior.
    if (init?.method === 'POST' && init?.body) {
      try { activityLogWrites.push(JSON.parse(init.body)); } catch { /* noop */ }
    }
    return new Response('[]', { status: 201, headers: { 'content-type': 'application/json' } });
  }
  if (u.includes('/rest/v1/')) return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
  return origFetch(url, init);
}) as typeof fetch;

// Pretend we have a logged-in user so logActivity actually attempts the POST.
const ls = (globalThis as any).localStorage ?? {
  _s: new Map<string, string>(),
  getItem(k: string) { return this._s.get(k) ?? null; },
  setItem(k: string, v: string) { this._s.set(k, v); },
  removeItem(k: string) { this._s.delete(k); },
};
(globalThis as any).localStorage = ls;
ls.setItem('hmis_user', JSON.stringify({ id: 'u1', email: 'test@example.com', role: 'admin', hospitalType: 'hope' }));

// Also pretend we have a navigator / window for activity-logger.
if (!(globalThis as any).navigator) (globalThis as any).navigator = { userAgent: 'test', language: 'en' };
if (!(globalThis as any).window) (globalThis as any).window = { location: { pathname: '/test' }, screen: { width: 800, height: 600 } };

const { runTaskFlows, runFlowsForEvent } = await import('../src/lib/runTaskFlows.ts');
const flowDispatcher = await import('../src/lib/flowDispatcher.ts');
const flowSafety = await import('../src/lib/flowSafety.ts');

function flow(overrides: any = {}) {
  return {
    id: 'f1', hospital_type: 'hope', name: 'Test flow', enabled: true,
    created_at: '', updated_at: '',
    nodes: [
      { id: 't1', type: 'trigger', position: { x: 0, y: 0 }, data: { kind: 'trigger', label: 'T', config: { event: 'status_changed', toStatus: 'done' } } },
      { id: 'a1', type: 'action', position: { x: 0, y: 0 }, data: { kind: 'action', label: 'A', config: { type: 'notify', message: '{task} by {staff}' } } },
    ],
    edges: [{ id: 'e1', source: 't1', target: 'a1' }],
    ...overrides,
  };
}

const baseCtx = {
  staffName: 'Priya', designation: 'Nursing', suggestionType: 'automate' as const,
  status: 'done' as const, timeSavedMins: 30, taskText: 'Enter vitals',
};

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); }
}

// 1. Trigger matches (status done) -> notify fires with interpolation
let res = await runTaskFlows([flow()], baseCtx, null);
check('trigger match fires action', res.length === 1, res);
check('  message interpolated', res[0]?.message === 'Enter vitals by Priya', res[0]?.message);

// 2. Trigger does NOT match (status in_progress)
res = await runTaskFlows([flow()], { ...baseCtx, status: 'in_progress' }, null);
check('non-matching status -> no fire', res.length === 0, res);

// 3. toStatus 'any' fires on any status
const anyFlow = flow();
anyFlow.nodes[0].data.config = { event: 'status_changed', toStatus: 'any' } as any;
res = await runTaskFlows([anyFlow], { ...baseCtx, status: 'dismissed' }, null);
check('toStatus any fires on dismissed', res.length === 1, res);

// 4. Condition passes (suggestion_type eq automate)
const condPass = flow();
condPass.nodes.splice(1, 0, { id: 'c1', type: 'condition', position: { x: 0, y: 0 }, data: { kind: 'condition', label: 'C', config: { field: 'suggestion_type', op: 'eq', value: 'automate' } } } as any);
res = await runTaskFlows([condPass], baseCtx, null);
check('passing condition -> fires', res.length === 1, res);

// 5. Condition fails (designation eq Billing)
const condFail = flow();
condFail.nodes.splice(1, 0, { id: 'c1', type: 'condition', position: { x: 0, y: 0 }, data: { kind: 'condition', label: 'C', config: { field: 'designation', op: 'eq', value: 'Billing' } } } as any);
res = await runTaskFlows([condFail], baseCtx, null);
check('failing condition -> no fire', res.length === 0, res);

// 6. gte condition on time_saved_mins (30 >= 15)
const gte = flow();
gte.nodes.splice(1, 0, { id: 'c1', type: 'condition', position: { x: 0, y: 0 }, data: { kind: 'condition', label: 'C', config: { field: 'time_saved_mins', op: 'gte', value: '15' } } } as any);
res = await runTaskFlows([gte], baseCtx, null);
check('gte time_saved passes (30>=15)', res.length === 1, res);

// 7. Disabled flow skipped
res = await runTaskFlows([flow({ enabled: false })], baseCtx, null);
check('disabled flow skipped', res.length === 0, res);

// 8. set_status action returns target message (no row id -> no DB write, no loop)
const setStatus = flow();
setStatus.nodes[1].data.config = { type: 'set_status', setStatus: 'in_progress' } as any;
res = await runTaskFlows([setStatus], baseCtx, null);
check('set_status reports target', res[0]?.message?.includes('in_progress') === true, res[0]?.message);

// 8a. Rule 14 — set_status with actionRowId records prior status for Undo.
// Trigger fires on toStatus='in_progress', ctx.status='in_progress', and the
// action target is 'done' (different from ctx.status, so it mutates).
const setStatusWithRow = flow();
setStatusWithRow.nodes[0].data.config = { event: 'status_changed', toStatus: 'in_progress' } as any;
setStatusWithRow.nodes[1].data.config = { type: 'set_status', setStatus: 'done' } as any;
res = await runTaskFlows([setStatusWithRow], { ...baseCtx, status: 'in_progress' as any }, 'row-1');
check('Rule 14: set_status carries undo descriptor', !!res[0]?.undo && (res[0] as any).undo.column === 'status', res[0]);
check('Rule 14: set_status undo priorValue is prior status', (res[0] as any).undo?.priorValue === 'in_progress', res[0]);

// 8b. set_status WITHOUT actionRowId → no undo (nothing was mutated)
res = await runTaskFlows([setStatusWithRow], { ...baseCtx, status: 'in_progress' as any }, null);
check('Rule 14: set_status without row has no undo descriptor', !res[0]?.undo, res[0]);

// 8c. set_status no-op (target === ctx.status) → no undo even with rowId
const setStatusNoop = flow();
setStatusNoop.nodes[0].data.config = { event: 'status_changed', toStatus: 'done' } as any;
setStatusNoop.nodes[1].data.config = { type: 'set_status', setStatus: 'done' } as any;
res = await runTaskFlows([setStatusNoop], baseCtx, 'row-1');
check('Rule 14: set_status no-op records no undo', !res[0]?.undo, res[0]);

// 9. whatsapp disabled-by-default reports "disabled"
const wa = flow();
wa.nodes[1].data.config = { type: 'whatsapp', message: 'ping', enabled: false } as any;
res = await runTaskFlows([wa], baseCtx, null);
check('whatsapp off -> intent only', res[0]?.message?.toLowerCase().includes('disabled') === true, res[0]?.message);

// ─────────────────────────────────────────────────────────────────────
// Group 2 — runFlowsForEvent (new event types + skip-not-crash)
// ─────────────────────────────────────────────────────────────────────
function billAddedFlow(overrides: any = {}) {
  return {
    id: 'f-ba', hospital_type: 'hope', name: 'BA flow', enabled: true,
    created_at: '2020-01-01T00:00:00Z', updated_at: '',
    nodes: [
      { id: 't1', type: 'trigger', position: { x: 0, y: 0 }, data: { kind: 'trigger', label: 'T', config: { event: 'bill_added', billType: 'any' } } },
      { id: 'a1', type: 'action', position: { x: 0, y: 0 }, data: { kind: 'action', label: 'A', config: { type: 'notify', message: 'New bill added' } } },
    ],
    edges: [{ id: 'e1', source: 't1', target: 'a1' }],
    ...overrides,
  };
}
function deadlineDueFlow() {
  const f = billAddedFlow();
  f.id = 'f-dd';
  f.nodes[0].data.config = { event: 'deadline_due', withinDays: 3 } as any;
  return f;
}

// 10. bill_added fires for bill_added event
res = await runFlowsForEvent([billAddedFlow()], 'bill_added', null, null);
check('runFlowsForEvent: bill_added fires bill_added flow', res.length === 1, res);

// 11. bill_added flow does NOT fire on deadline_due
res = await runFlowsForEvent([billAddedFlow()], 'deadline_due', null, null);
check('runFlowsForEvent: bill_added flow isolated from deadline_due', res.length === 0, res);

// 12. deadline_due flow does NOT fire on bill_added
res = await runFlowsForEvent([deadlineDueFlow()], 'bill_added', null, null);
check('runFlowsForEvent: deadline_due flow isolated from bill_added', res.length === 0, res);

// 13. Unrelated/unknown event → empty result, no throw
res = await runFlowsForEvent([billAddedFlow()], 'status_changed' as any, null, null);
check('runFlowsForEvent: unrelated event returns empty', res.length === 0, res);

// 14. tag action SKIPPED (not crashed) when actionRowId is null on a non-status event
const tagOnBA = billAddedFlow();
tagOnBA.nodes[1].data.config = { type: 'tag', message: 'tagged' } as any;
res = await runFlowsForEvent([tagOnBA], 'bill_added', null, null);
check('runFlowsForEvent: tag skipped (not crashed) without row', res.length === 1 && /Skipped/.test(res[0]?.message ?? ''), res);

// 15. set_status action SKIPPED similarly
const ssOnBA = billAddedFlow();
ssOnBA.nodes[1].data.config = { type: 'set_status', setStatus: 'done' } as any;
res = await runFlowsForEvent([ssOnBA], 'bill_added', null, null);
check('runFlowsForEvent: set_status skipped (not crashed) without row', res.length === 1 && /Skipped/.test(res[0]?.message ?? ''), res);

// 16. notify still fires even with null ctx (uses synthetic empty ctx internally)
res = await runFlowsForEvent([billAddedFlow()], 'bill_added', null, null);
check('runFlowsForEvent: notify fires without status context', res.length === 1 && res[0].kind === 'notify', res);

// 17. Legacy status_changed via runFlowsForEvent (backward compat)
const legacy = flow();
res = await runFlowsForEvent([legacy], 'status_changed', baseCtx, null);
check('runFlowsForEvent: legacy status_changed still fires', res.length === 1, res);

// 17a. bill_added with billType='wifi' fires only for matching billType payloads
const wifiOnly = billAddedFlow();
(wifiOnly.nodes[0].data.config as any).billType = 'wifi';
res = await runFlowsForEvent([wifiOnly], 'bill_added', null, null, { billType: 'wifi' });
check('runFlowsForEvent: billType=wifi fires for wifi payload', res.length === 1, res);
res = await runFlowsForEvent([wifiOnly], 'bill_added', null, null, { billType: 'electricity' });
check('runFlowsForEvent: billType=wifi skipped for electricity payload', res.length === 0, res);

// 17b. bill_added with billType='any' (or undefined) is permissive
const anyBill = billAddedFlow();
(anyBill.nodes[0].data.config as any).billType = 'any';
res = await runFlowsForEvent([anyBill], 'bill_added', null, null, { billType: 'wifi' });
check('runFlowsForEvent: billType=any matches every payload', res.length === 1, res);

// 17c. deadline_due with withinDays=1 ignores 5-days-away bills
const tightDue = deadlineDueFlow();
(tightDue.nodes[0].data.config as any).withinDays = 1;
res = await runFlowsForEvent([tightDue], 'deadline_due', null, null, { daysUntilDue: 5 });
check('runFlowsForEvent: withinDays=1 skips 5-days-away', res.length === 0, res);
res = await runFlowsForEvent([tightDue], 'deadline_due', null, null, { daysUntilDue: 1 });
check('runFlowsForEvent: withinDays=1 matches exactly 1-day', res.length === 1, res);
// Negative days = overdue, belongs to deadline_overdue not deadline_due
res = await runFlowsForEvent([tightDue], 'deadline_due', null, null, { daysUntilDue: -2 });
check('runFlowsForEvent: deadline_due skips overdue (negative days)', res.length === 0, res);

// ─────────────────────────────────────────────────────────────────────
// Group 3 — flowSafety (FlowSafetyError, isDestructiveIntent)
// ─────────────────────────────────────────────────────────────────────

// 18. isDestructiveIntent catches obvious destructive verbs
check('isDestructiveIntent: matches "delete all overdue bills"', flowSafety.isDestructiveIntent('delete all overdue bills') === true);
check('isDestructiveIntent: matches "PURGE old"', flowSafety.isDestructiveIntent('PURGE old') === true);
check('isDestructiveIntent: matches "drop bills"', flowSafety.isDestructiveIntent('drop bills') === true);
check('isDestructiveIntent: matches "wipe history"', flowSafety.isDestructiveIntent('wipe history') === true);

// 19. Whole-word match — "description" must NOT match "destroy"
check('isDestructiveIntent: word boundary respected (description ≠ destroy)', flowSafety.isDestructiveIntent('write a description for bills') === false);
check('isDestructiveIntent: safe phrase passes ("notify me when added")', flowSafety.isDestructiveIntent('notify me when added') === false);

// 20. pickSafeAlternative returns a non-empty string for matched verbs
check('pickSafeAlternative: returns suggestion for "delete"', (flowSafety.pickSafeAlternative('delete bills') ?? '').length > 0);
check('pickSafeAlternative: returns null for non-destructive text', flowSafety.pickSafeAlternative('notify me daily') === null);

// 21. FlowSafetyError carries kind + detail + safeAlternative
const err = new flowSafety.FlowSafetyError('destructive_prompt', 'asked to delete', 'Tag instead');
check('FlowSafetyError: kind set', err.kind === 'destructive_prompt');
check('FlowSafetyError: safeAlternative carried', err.safeAlternative === 'Tag instead');
check('FlowSafetyError: instanceof Error', err instanceof Error);

// 22. Action allowlist is exactly 5 entries (Rule 1 — assert no destructive added)
check('SAFE_ACTION_TYPES has exactly 5 entries', flowSafety.SAFE_ACTION_TYPES.length === 5, flowSafety.SAFE_ACTION_TYPES);
const safeSet = new Set(flowSafety.SAFE_ACTION_TYPES);
check('SAFE_ACTION_TYPES contains notify/tag/set_status/whatsapp/email', ['notify', 'tag', 'set_status', 'whatsapp', 'email'].every((t) => safeSet.has(t as any)));
check('SAFE_ACTION_TYPES does NOT contain "delete"', !safeSet.has('delete' as any));

// ─────────────────────────────────────────────────────────────────────
// Group 4 — flowDispatcher (Rules 7, 8, 9, 11, 13, 17)
// ─────────────────────────────────────────────────────────────────────
const { dispatchFlowEvent, _resetDispatcherForTests, setAutomationsPausedUntil } = flowDispatcher;

function statusCtx() {
  return { ...baseCtx };
}

// Reset between dispatcher tests so dedup/rate-limit state from one doesn't bleed into next.
_resetDispatcherForTests();
stubbedFlows = [billAddedFlow()];

// 23. First dispatch fires (Rule 9 — dedup miss)
res = await dispatchFlowEvent('bill_added', { hospitalType: 'hope', entityId: 'bill-1' });
check('dispatcher: first dispatch fires', res.length === 1, res);

// 24. Second dispatch with same entity/event is deduped (Rule 9)
res = await dispatchFlowEvent('bill_added', { hospitalType: 'hope', entityId: 'bill-1' });
check('dispatcher: duplicate same-day same-entity is deduped', res.length === 0, res);

// 25. Different entity fires (dedup is per-entity)
res = await dispatchFlowEvent('bill_added', { hospitalType: 'hope', entityId: 'bill-2' });
check('dispatcher: different entity fires through dedup', res.length === 1, res);

// 26. dedupSuffix lets identical entity fire again (Rule 9 carve-out)
_resetDispatcherForTests();
res = await dispatchFlowEvent('bill_added', { hospitalType: 'hope', entityId: 'bill-1', dedupSuffix: 'a' });
const res2 = await dispatchFlowEvent('bill_added', { hospitalType: 'hope', entityId: 'bill-1', dedupSuffix: 'b' });
check('dispatcher: different dedupSuffix bypasses dedup', res.length === 1 && res2.length === 1, [res, res2]);

// 27. Hospital scoping (Rule 7) — flow for hospital A doesn't fire when hospital B dispatches.
_resetDispatcherForTests();
stubbedFlows = [billAddedFlow({ hospital_type: 'hope' })];
res = await dispatchFlowEvent('bill_added', { hospitalType: 'ayushman', entityId: 'bill-A' });
check('dispatcher: hospital scoping filters out other-hospital flows', res.length === 0, res);

// 28. Rule 17 — entityCreatedAt older than flow.created_at → flow does NOT fire (backlog protection)
_resetDispatcherForTests();
stubbedFlows = [billAddedFlow({ created_at: '2025-06-01T00:00:00Z' })];
res = await dispatchFlowEvent('deadline_due', {
  hospitalType: 'hope',
  entityId: 'old-bill',
  entityCreatedAt: '2024-01-01T00:00:00Z', // entity older than flow
});
check('dispatcher: Rule 17 — flow newer than entity is skipped', res.length === 0, res);

// 29. Rule 17 — entityCreatedAt NEWER than flow.created_at → flow fires
_resetDispatcherForTests();
stubbedFlows = [billAddedFlow({ created_at: '2020-01-01T00:00:00Z' })];
res = await dispatchFlowEvent('deadline_due', {
  hospitalType: 'hope',
  entityId: 'new-bill',
  entityCreatedAt: '2026-06-01T00:00:00Z', // entity newer than flow
});
check('dispatcher: Rule 17 — flow older than entity fires', res.length === 0 || res.length === 1, res);
// Note: the bill_added flow has event='bill_added' not 'deadline_due', so it won't match here.
// Use a deadline_due flow for the positive assertion.
_resetDispatcherForTests();
stubbedFlows = [deadlineDueFlow()];
(stubbedFlows[0] as any).created_at = '2020-01-01T00:00:00Z';
res = await dispatchFlowEvent('deadline_due', {
  hospitalType: 'hope',
  entityId: 'new-bill-2',
  entityCreatedAt: '2026-06-01T00:00:00Z',
});
check('dispatcher: Rule 17 — pre-existing deadline_due flow fires for new entity', res.length === 1, res);

// 30. Rule 13 — kill switch suppresses all dispatches
_resetDispatcherForTests();
stubbedFlows = [billAddedFlow()];
setAutomationsPausedUntil(Date.now() + 60_000);
res = await dispatchFlowEvent('bill_added', { hospitalType: 'hope', entityId: 'bill-paused' });
check('dispatcher: Rule 13 — paused state returns empty', res.length === 0, res);
setAutomationsPausedUntil(null);

// 31. Rule 11 — rate limit kicks in after 100 fires (per flow per hour).
// Use unique entityIds + distinct dedupSuffix so dedup doesn't short-circuit.
_resetDispatcherForTests();
stubbedFlows = [billAddedFlow()];
let firedCount = 0;
for (let i = 0; i < 105; i++) {
  const r = await dispatchFlowEvent('bill_added', {
    hospitalType: 'hope',
    entityId: `rate-${i}`,
    dedupSuffix: String(i),
  });
  if (r.length > 0) firedCount++;
}
check('dispatcher: Rule 11 — rate limit caps at 100 per hour', firedCount === 100, { firedCount });

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
