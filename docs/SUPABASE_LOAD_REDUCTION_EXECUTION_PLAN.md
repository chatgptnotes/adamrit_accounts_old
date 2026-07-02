# Supabase Load Reduction — Execution Plan

Date: 2026-07-02
Branch: `performance-and-optimization`
Goal: Cut DB requests/load ~90% on IPD dashboard, patient screens, billing, and other tabs **without changing any user-visible functionality**. Frontend-only, reversible, one small step at a time.

> This is the execution companion to `LIVE_SUPABASE_PERFORMANCE_STABILIZATION_PLAN.md` (process/safety) and `docs/SUPABASE_USAGE_AUDIT.md` (findings). It turns the strategy into concrete, testable edits.

---

## Root-cause summary (measured from code)

| Signal | Count | Meaning |
| --- | ---: | --- |
| Raw `.from()` / `.rpc()` call sites | 2,365 | Most reads hit Postgres directly |
| Reads wrapped in React Query (cached/dedup'd) | 712 blocks | Only ~1/3 of fetching is cached |
| `refetchInterval` polling queries | 38 | Continuous load; **worst = `QueueStatus.tsx` @ 8s** |
| `count: 'exact'` queries app-wide | 79 | Sidebar/badges re-count large tables |
| `useCounts.ts` count queries fired on mount | 18 | 18 round-trips per mount; imported by 4 files |
| `fetchAllRows` call sites (page 1000 × up to 500 pages) | 23 | A bad filter can page up to **500,000 rows** |

**Diagnostic:** "Fast for ~30 min after a Supabase restart, then slow again" = *accumulating request volume / connection pressure*, not slow individual queries. A restart clears connections; volume rebuilds within ~30 min and re-saturates the compute budget. Therefore the fix is **reduce request volume**, exactly the stated goal.

**Global config is already good** (`src/App.tsx:124`): `refetchOnWindowFocus: false`, `staleTime: 5min`, `retry: 1`. This protects only the 712 cached queries — the raw ~1,600+ sites and the pollers are the load.

---

## Non-negotiables (live hospital instance)

- No production SQL, migrations, RLS, or view/function changes in this plan (frontend-only).
- No change to billing math, patient registration, discharge, pharmacy, lab, or payment flows.
- Every step: one small change → build → test the exact workflow → deploy low-traffic → measure → next.
- Rollback = redeploy previous frontend build (each step is independently revertible).

---

## Tier 1 — Global, zero functional risk (do first)

Small edits, app-wide effect, nothing users see changes.

### 1.1 Pause all polling when tab is hidden + add gcTime (global)
- **File:** `src/App.tsx:124` (the `new QueryClient` defaultOptions).
- **Change:** add `refetchIntervalInBackground: false` (make hidden-tab pause explicit), `refetchOnReconnect: false`, and `gcTime: 1000 * 60 * 30` (keep cache 30 min so navigation reuses it).
- **Why safe:** React Query already pauses interval polling on backgrounded tabs by default; this makes it explicit and extends cache retention. No visible change.
- **Impact:** removes polling from every non-focused tab; fewer refetches on reconnect/navigation.
- **Test:** app loads; switch away from a polling screen (e.g. Bill Approvals) and back — data still current; no console errors.
- **Rollback:** revert the defaultOptions block.

### 1.2 Idle-pause governor for always-on screens (kiosks/wall displays)
- **Problem:** display screens (`QueueTV`, `QueueDisplay`, `QueueStatus`) are the *only* focused tab on a monitor, so hidden-tab pausing never triggers — they poll 24/7.
- **Change:** add a tiny `usePollingEnabled()` hook (visibility + `no user interaction for N min` → returns `false`), and pass `refetchInterval: enabled ? <interval> : false` on the ~38 pollers. Start with the display screens only.
- **Why safe:** a queue board with no one interacting does not need sub-minute refresh; the moment anyone views/touches it, polling resumes. Viewer experience unchanged.
- **Impact:** removes the largest steady-state baseline (a single 8s board = ~900 req/hr → ~0 when idle).
- **Test:** open queue board, confirm it updates while active; leave idle, confirm polling stops in Network tab; interact, confirm it resumes.
- **Rollback:** the hook defaults to `true`; revert per-file `enabled` wiring.

### 1.3 Right-size the aggressive intervals
- **Target:** `src/pages/QueueStatus.tsx:158` and `:322` (`refetchInterval: 8000`).
- **Change:** 8000 → 20000–30000 (still real-time enough for a waiting-room token board).
- **Why safe:** a patient watching "tokens ahead of me" does not perceive 8s vs 25s.
- **Impact:** ~3× fewer requests from every open personal/board view.
- **Test:** token count still advances as tokens are served.
- **Rollback:** restore `8000`.

**Confirm before shipping 1.3:** interval change is a (tiny) timing change, so it needs your OK per the "no functionality change" rule.

---

## Tier 2 — Shared cache for repeated reads (biggest structural cut)

Same data, byte-identical — just fetched once and reused. Medium risk (touches shared providers).

### 2.1 Collapse sidebar counts (`src/hooks/useCounts.ts`)
- **Now:** 18 separate `count: 'exact'` queries per mount + a 60s `refetchInterval` on pending prescriptions (`:435`). Imported by 4 places.
- **Step A (safe):** raise `staleTime` on the static master counts (diagnoses, users, surgery catalog, lab/radiology/medication catalogs, etc.) to 30–60 min — they barely change during a shift. Keep pending-prescriptions live.
- **Step B (later, optional):** replace the 18 counts with **one** read-only Postgres RPC returning all counts in a single row. *DB change → staging first, separate approval.* Not in Tier 2 scope; noted for Tier 4.
- **Impact:** 18 round-trips → a handful, and they stop re-firing on every mount.
- **Test:** sidebar badge numbers match before/after on each screen that shows them.
- **Rollback:** restore prior `staleTime`.

### 2.2 Shared master-data provider
- **Targets:** doctors, departments, wards/rooms, lab test catalog, medicine catalog, service categories, hospital list, user list — currently re-fetched raw across many screens.
- **Change:** one cached hook/provider per dataset with long `staleTime` (e.g. 30 min); screens consume the cache instead of their own `.from()` in `useEffect`.
- **Why safe:** these are reference tables; data is identical, only the fetch is deduplicated.
- **Impact:** removes a large constant fraction of per-screen requests (every screen currently re-reads several of these).
- **Test:** dropdowns/lookups populate identically on each converted screen.
- **Rollback:** revert per-screen consumption to prior direct fetch.

---

## Tier 3 — Fix the heaviest screens' N+1 / unbounded reads (per-screen, tested)

Biggest per-screen spike reduction. Billing-critical → careful manual testing each.

### 3.1 Cap `fetchAllRows` blast radius (`src/utils/fetchAllRows.ts`)
- **Now:** `PAGE_SIZE 1000 × MAX_PAGES 500` = up to 500k rows; 23 call sites.
- **Change:** add an optional `maxRows` argument and require a date range or explicit cap on the search-driven call sites (`LabOrders.tsx:2257`, `PatientOverview.tsx:193`, `TodaysIpdDashboard.tsx:1634`). Do **not** lower the global backstop blindly — audit each call site.
- **Test:** each search returns the same rows for a normal date range; a broad search no longer pages the whole table.
- **Rollback:** remove the cap argument.

### 3.2 `FinalBill.tsx` saved-service N+1 → bulk `.in()`
- **Target:** `:3140–3260` (lab/radiology/medication: list fetch then per-item detail fetch via `Promise.all(map(...))`).
- **Change:** collect ids, do one `.in('id', ids)` per service type.
- **Impact:** dozens of per-item requests → 3 bulk reads on bill open.
- **Test (billing-critical):** open an existing IPD final bill; saved lab/radiology/medicine names, rates, quantities identical; add/remove item; save; reload; print; **totals unchanged**.
- **Rollback:** revert to prior per-item fetch.

### 3.3 `TodaysIpdDashboard.tsx` per-visit referral check → one batch
- **Target:** `:2006` maps `checkReferralLetterUploaded(...)` per visible visit.
- **Change:** one batch query against `patient_documents` for all visible visits.
- **Test:** referral uploaded/not indicators match before/after; realtime update (`:2027`/`:2055`) still works.
- **Rollback:** revert to per-visit check.

### 3.4 `DischargeInvoice.tsx` duplicate service reads
- **Target:** `:77–96` and `:153–161` fetch the same service-category tables twice.
- **Change:** fetch once, derive totals + line items from the same result.
- **Test:** totals and line-item categories identical; print/export identical.
- **Rollback:** revert.

---

## Tier 4 — Database-side (only after Tiers 1–3, separate approval)

Requires staging + low-traffic window + rollback SQL. NOT part of frontend rollout.
- Single RPC/view for sidebar counts (replaces `useCounts` 18 queries).
- Indexes for the hot filters confirmed by Supabase slow-query logs.
- Materialized views for heavy report screens.

---

## Rollout order & expected contribution

| Step | Effort | Risk | Est. share of steady-state load removed |
| --- | --- | --- | --- |
| 1.1 global config | XS | None | polling on backgrounded tabs + nav refetches |
| 1.2 idle governor | S | None (defaults on) | **large** — kills 24/7 display polling |
| 1.3 interval right-size | XS | Tiny (confirm) | ~3× on queue views |
| 2.1 counts staleTime | S | Low | 18→few per mount, no re-fire |
| 2.2 master-data cache | M | Medium | **large** — dedups per-screen reads |
| 3.1 fetchAllRows cap | S | Low/Med | removes worst-case table scans |
| 3.2–3.4 N+1 fixes | M | Med (billing) | removes per-open spikes |

Tier 1 + 2 target the *steady-state* volume that saturates the DB (the "slows after 30 min" symptom). Tier 3 removes the *spikes*. Together: realistic path to 80–90% fewer requests, no functional change.

---

## Measure before/after (per step)

1. DevTools → Network → filter `supabase.co/rest` → clear → open target screen → count requests on load.
2. Repeat after search / tab switch / leave-and-return.
3. Record in the audit table. Ship only if count drops and workflow is unchanged.
4. Watch the Supabase dashboard (requests/min, CPU, connections) for 30–60 min post-deploy.

## First recommended action
Ship **Tier 1.1 + 1.2** together (zero functional risk), measure for 30–60 min, then proceed to **2.1 → 2.2**, then the Tier 3 screens one at a time with full billing testing.
