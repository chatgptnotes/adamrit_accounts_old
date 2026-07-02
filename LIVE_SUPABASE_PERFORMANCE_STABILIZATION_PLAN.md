# Live Supabase Performance Stabilization Plan

## Purpose

This project is live in a hospital, so the goal is not to rewrite or aggressively optimize everything at once. The goal is to safely identify the biggest sources of Supabase load, reduce repeated frontend requests, and improve speed without breaking existing hospital workflows or changing production data unexpectedly.

## Current Project Context

- Frontend: React + Vite + TypeScript.
- Database/API: Supabase from the frontend.
- Caching library already available: `@tanstack/react-query`.
- Supabase calls are spread across pages, components, tablet modules, hooks, services, and utility files.
- There are multiple Supabase client entry points visible in the codebase, including:
  - `src/integrations/supabase/client.ts`
  - `src/integrations/supabase/data-client.ts`
  - `src/utils/supabase-client.ts`
- The repository contains many SQL scripts and database fix documents. These must not be run casually against production.

## Non-Negotiable Safety Rules

1. Do not run production SQL migrations during the first audit phase.
2. Do not drop, truncate, delete, rename, or rewrite production database objects unless separately reviewed and approved.
3. Do not change RLS policies directly in production without staging verification.
4. Do not change hospital billing, patient registration, discharge, pharmacy, lab, or payment flows without testing the exact workflow.
5. Every performance change should be small, reviewable, and reversible.
6. Measure before and after every change.
7. Prefer frontend request reduction before database structure changes.
8. If database changes are needed, test in staging first and deploy during a low-usage window.

## Step 1: Create A Baseline Without Changing Anything

### Goal

Understand where the load is coming from before touching code or database structure.

### Actions

1. Identify the most painful screens reported by users.
   - Example candidates: patient overview, final bill, IPD dashboard, lab orders, pharmacy billing, accounting reports, discharge summary.
   - Confirm actual pain points with hospital staff before optimizing random files.
our priority is to make thisese bug free and superfast first patient overview, final bill, IPD dashboard, lab orders, pharmacy billing, accounting reports, discharge summary.
2. Capture current Supabase usage from dashboard/logs.
   - Most frequent queries.
   - Slowest queries.
   - Tables with highest read load.
   - API request spikes by time.
   - Realtime subscription load.
   - Database CPU, memory, and connection pressure.

3. Capture frontend behavior for each bad screen.
   - Number of Supabase calls when opening the screen.
   - Number of calls after typing in search.
   - Number of calls after changing filters.
   - Number of calls after switching tabs.
   - Number of calls after leaving and returning to the screen.

### Output

Create a small audit table:

| Screen | User Problem | Supabase Calls On Load | Repeated Calls | Slow Tables | Risk Level | Notes |
| --- | --- | ---: | ---: | --- | --- | --- |
| Example | Slow patient list | TBD | TBD | patients, visits | High | Measure first |

## Step 2: Read-Only Code Audit

### Goal

Find dangerous frontend query patterns without changing code.

### Search Targets

Use code search to find:

```bash
rg -n "supabase\.(from|rpc|channel)|\.from\(" src --glob "*.ts" --glob "*.tsx"
rg -n "select\('\*'\)|select\(\"\*\"\)" src --glob "*.ts" --glob "*.tsx"
rg -n "setInterval|channel\(|postgres_changes|removeChannel|unsubscribe" src --glob "*.ts" --glob "*.tsx"
rg -n "useEffect|useQuery|refetchInterval|invalidateQueries" src --glob "*.ts" --glob "*.tsx"
```

### Classify Each Finding

For every important Supabase query, record:

| Field | Meaning |
| --- | --- |
| File | Where the query lives |
| Screen/Flow | Which hospital workflow uses it |
| Table/View/RPC | Supabase object being called |
| Operation | select, insert, update, delete, rpc, realtime |
| Trigger | page load, search input, tab open, modal open, autosave, interval |
| Frequency Risk | one time, repeated, per keystroke, per row, interval, realtime |
| Data Size Risk | full table, date range, single row, paginated |
| Safety Risk | billing, patient data, pharmacy stock, lab result, accounting |

### High-Risk Patterns To Flag

- `select('*')` on large tables.
- Queries without `.limit()` or `.range()`.
- Search queries firing on every keystroke without debounce.
- Loops that call Supabase once per patient, visit, medicine, bill, or lab item.
- Components fetching the same master data separately.
- `useEffect` dependency loops causing repeated fetches.
- React Query keys that change unnecessarily and refetch too often.
- Realtime channels created repeatedly or not removed on unmount.
- Hidden tabs or closed modals fetching data before the user opens them.
- Report pages fetching years of records at once.

## Step 3: Choose Only One Or Two Screens First

### Goal

Reduce risk by fixing the biggest problem area first, not the whole app.

### Selection Rules

Pick a screen only if:

1. Staff confirms it is slow or causing operational pain.
2. Supabase logs show high request count or slow query behavior.
3. The code audit shows repeated frontend fetching or unbounded reads.
4. The workflow can be manually tested after the change.

### Recommended First Targets

These are only candidates based on visible project structure, not final conclusions:

- `src/pages/FinalBill.tsx`
- `src/components/lab/LabOrders.tsx`
- `src/pages/PatientOverview.tsx`
- `src/pages/TodaysIpdDashboard.tsx`
- `src/components/pharmacy/PharmacyBilling.tsx`
- Accounting dashboard/report components
- Tablet workflows under `src/tablet/`

## Step 4: Safe Frontend-Only Fixes First

### Goal

Reduce Supabase calls without changing production database schema.

### Allowed Low-Risk Fixes

1. Add debounce to search.
   - Patient search, medicine search, lab test search, doctor search, and billing item search should not query on every keypress.

2. Add pagination or range limits.
   - Use `.range(0, 49)` or equivalent for lists.
   - Avoid loading entire patient, visit, bill, lab, pharmacy, or accounting tables.

3. Select only required columns.
   - Replace broad `select('*')` with explicit fields when safe.

4. Fetch data only when needed.
   - Use React Query `enabled` for queries that depend on selected patient, visit, modal state, or active tab.

5. Reuse cached master data.
   - Doctors, departments, room metadata, lab test catalog, medicine catalog, billing categories, and user lists can often be cached for a short time.

6. Clean up realtime subscriptions.
   - Ensure every Supabase channel is removed or unsubscribed on component unmount.
   - Avoid opening the same channel multiple times for the same screen.

7. Batch related lookups.
   - Prefer one `.in('id', ids)` query instead of one query per row.

8. Avoid refetch storms after saves.
   - Invalidate only the affected React Query keys.
   - Do not invalidate broad keys that reload many unrelated screens.

### Example Bad Pattern

```ts
for (const patient of patients) {
  await supabase.from("visits").select("*").eq("patient_id", patient.id);
}
```

### Safer Pattern

```ts
const patientIds = patients.map((patient) => patient.id);

await supabase
  .from("visits")
  .select("id, patient_id, visit_id, admission_date, discharge_date")
  .in("patient_id", patientIds);
```

## Step 5: Manual Workflow Testing After Each Frontend Fix

Every fix must be tested against the actual workflow it touches.

### Minimum Test Checklist

- Login works.
- Patient search works.
- Patient registration works if touched.
- Visit/admission flow works if touched.
- Billing totals remain correct if touched.
- Payment save works if touched.
- Pharmacy stock behavior remains correct if touched.
- Lab order/result workflow remains correct if touched.
- Discharge summary/final bill workflow remains correct if touched.
- No repeated toast errors or console errors.
- Reloading the page does not lose important state.

### Performance Checklist

- Supabase calls on page load reduced.
- Search requests are debounced.
- No duplicate calls when switching tabs.
- No duplicate realtime channels.
- Large lists are paginated or limited.
- User-visible behavior remains the same.

## Step 6: Database Changes Only After Proof

### Goal

Make DB changes only when the frontend-only fixes are not enough or logs clearly prove a database bottleneck.

### Possible DB Fixes

- Add indexes for common filters and joins.
- Create views for repeated joined read models.
- Create RPC functions for complex summary queries.
- Create materialized views for heavy reports.
- Simplify expensive RLS policies.
- Add report tables or cached summaries for dashboards.

### Required Approval Before DB Change

Before any database change:

1. Identify exact slow query or repeated query.
2. Confirm affected table size and usage.
3. Prepare migration SQL.
4. Prepare rollback SQL where possible.
5. Test in staging or copied environment.
6. Verify no RLS/security behavior changes unexpectedly.
7. Schedule production deploy during low usage.
8. Take a backup or confirm Supabase recovery point.

### DB Commands To Avoid In Production Without Explicit Approval

```sql
DROP TABLE
DROP VIEW
DROP FUNCTION
TRUNCATE
DELETE without exact filters
ALTER TABLE on critical tables during busy hours
DISABLE RLS
UPDATE without exact filters
```

## Step 7: Deployment Process

### For Frontend-Only Changes

1. Create a small branch for one screen or one query group.
2. Make the smallest safe code change.
3. Run TypeScript/build checks.
4. Test the touched workflow manually.
5. Deploy during a lower-traffic window if the workflow is critical.
6. Monitor Supabase requests and user complaints after deployment.
7. Keep rollback ready by redeploying the previous frontend build.

### For Database Changes

1. Never combine risky DB changes with large frontend refactors.
2. Apply DB change in staging first.
3. Run smoke tests.
4. Apply production change during low usage.
5. Monitor CPU, slow queries, errors, and affected workflows.
6. Keep rollback plan ready.

## Step 8: Ongoing Rules For New Development

1. No new unpaginated list queries.
2. No new `select('*')` on large tables.
3. No Supabase calls inside loops unless explicitly reviewed.
4. Search inputs must be debounced.
5. Realtime channels must have cleanup.
6. Dashboard/report queries must have date ranges.
7. Shared lookup data should use React Query caching.
8. Billing, patient, pharmacy, lab, and accounting changes require manual workflow testing.

## Priority Order

1. Read-only audit of Supabase usage in code.
2. Read-only Supabase dashboard/log review.
3. Pick one high-impact slow screen.
4. Reduce duplicate frontend requests.
5. Add debounce, pagination, column selection, and conditional fetches.
6. Test exact hospital workflow.
7. Deploy small frontend-only fix.
8. Measure improvement.
9. Repeat for the next screen.
10. Consider database indexes/views/RPC only after frontend request problems are understood.

## Success Metrics

Track these before and after each change:

| Metric | Target Direction |
| --- | --- |
| Supabase calls per screen load | Down |
| Duplicate calls per screen load | Down |
| Search calls per typing session | Down |
| Slow queries | Down |
| Database CPU | Down |
| Time to usable screen | Down |
| User-visible workflow errors | No increase |
| Billing/data correctness issues | Zero tolerance |

## First Concrete Task

The first implementation task should be a read-only Supabase usage audit that creates a file like:

```text
docs/SUPABASE_USAGE_AUDIT.md
```

That audit should list:

- All high-risk Supabase calls.
- Screens with the most direct queries.
- Realtime subscriptions and cleanup status.
- Unpaginated list queries.
- `select('*')` usage on likely large tables.
- Queries triggered by search, timers, tabs, modals, or row loops.
- Safest first screen to optimize.

No production database changes are needed for this first task.
