# Supabase Usage Audit

Date: 2026-07-01

## Scope

This is a read-only static audit of frontend Supabase usage. No database commands were run, no migrations were applied, and no app code was changed.

The goal is to identify likely sources of excessive Supabase requests in the live hospital application so fixes can be made safely, one workflow at a time.

## How This Was Checked

Commands used:

```bash
rg -c "supabase\.(from|rpc|channel)|\.from\(" src --glob "*.ts" --glob "*.tsx"
rg -c "select\(['\"]\*['\"]\)" src --glob "*.ts" --glob "*.tsx"
rg -n "channel\(|postgres_changes|removeChannel|unsubscribe" src --glob "*.ts" --glob "*.tsx"
rg -n "refetchInterval" src --glob "*.ts" --glob "*.tsx"
rg -n "fetchAllRows|fetchAllByIn" src --glob "*.ts" --glob "*.tsx"
```

These numbers are static code counts, not live production request counts. Supabase dashboard logs and browser Network measurements are still required before changing production behavior.

## Executive Summary

The main performance risk is not one single query. It is the combination of:

- Very large frontend files directly calling Supabase many times.
- Broad `select('*')` reads on hospital-critical tables.
- Read paths that fetch a list, then fetch details per item.
- Full-list helper usage that intentionally pages through all matching rows.
- Polling across many screens.
- Some report/dashboard screens loading many tables at once.

The highest-risk area is `src/pages/FinalBill.tsx`. It has the largest Supabase surface by far and contains several read patterns that can multiply requests. Because it is billing-critical, fixes must be tiny and manually tested.

## Static Inventory

### Highest Supabase Call Concentration

| File | Static Call Count | Risk |
| --- | ---: | --- |
| `src/pages/FinalBill.tsx` | 310 | Very high: billing-critical, many reads/writes |
| `src/pages/IpdDischargeSummary.tsx` | 49 | High: discharge-critical |
| `src/components/lab/LabOrders.tsx` | 47 | High: lab workflow and large lists |
| `src/pages/TodaysIpdDashboard.tsx` | 42 | High: dashboard list + batch fetches |
| `src/pages/MarketingDashboard.tsx` | 35 | Medium/high: report-like screen |
| `src/hooks/useFinancialSummary.ts` | 34 | High: billing totals |
| `src/pages/AdvanceStatementReport.tsx` | 34 | Medium/high: report-like screen |
| `src/pages/Invoice.tsx` | 33 | High: billing/invoice |
| `src/pages/DischargeSummaryEdit.tsx` | 32 | High: discharge workflow |
| `src/hooks/useLabData.ts` | 31 | High: lab data |
| `src/pages/CTMRIModule.tsx` | 28 | Medium/high: broad radiology reads |
| `src/pages/CorporateAreaDetail.tsx` | 27 | Medium |

### Highest `select('*')` Concentration

| File | Static `select('*')` Count | Risk |
| --- | ---: | --- |
| `src/pages/FinalBill.tsx` | 54 | Very high |
| `src/pages/DischargeInvoice.tsx` | 14 | High |
| `src/components/lab/LabPanelManager.tsx` | 10 | High |
| `src/hooks/useRadiologyData.ts` | 10 | Medium/high |
| `src/pages/CTMRIModule.tsx` | 10 | Medium/high |
| `src/pages/DischargeSummaryEdit.tsx` | 10 | High |
| `src/pages/IpdDischargeSummary.tsx` | 10 | High |
| `src/components/lab/LabOrders.tsx` | 9 | High |
| `src/components/pharmacy/SalesDetails.tsx` | 9 | High |
| `src/pages/Invoice.tsx` | 9 | High |
| `src/pages/OperationTheatre.tsx` | 9 | Medium/high |

## Key Findings

### 1. `FinalBill.tsx` Is The First Area To Measure

`src/pages/FinalBill.tsx` has 310 static Supabase call sites and 54 `select('*')` calls. This screen likely creates a large amount of traffic when opened, edited, searched, saved, or refreshed.

High-risk examples:

- `src/pages/FinalBill.tsx:3140` fetches `visit_labs` with `select('*')`, then `src/pages/FinalBill.tsx:3147` uses `Promise.all(labData.map(...))` to fetch `lab` details per lab item.
- `src/pages/FinalBill.tsx:3195` and `src/pages/FinalBill.tsx:3202` do the same pattern for radiology.
- `src/pages/FinalBill.tsx:3246` and `src/pages/FinalBill.tsx:3253` do the same pattern for medication.
- `src/pages/FinalBill.tsx:8439` to `src/pages/FinalBill.tsx:8820` contains a mandatory-services recovery/debug path that performs multiple fallback reads and broad `select('*')` queries.
- `src/pages/FinalBill.tsx:11637` loads mandatory services with `select('*')` and `.limit(500)` during search.
- `src/pages/FinalBill.tsx:11296` fetches visit + nested patient data during clinical-services search.

Safe first fix candidate:

- Keep UI behavior unchanged, but replace per-item detail fetches with one `.in('id', ids)` fetch for each service type.
- Do this only for one read path first, ideally the saved lab/radiology/medication load around lines `3140-3260`.
- Manually test opening an existing final bill, adding/removing lab/radiology/medicine items, saving, reloading, and printing.

### 2. `LabOrders.tsx` Uses Full-Result Paging On Large Lab Tables

`src/components/lab/LabOrders.tsx` is better than pure per-row querying in some places because it uses batch helpers. However, the helper can intentionally fetch all matching rows.

Important examples:

- `src/components/lab/LabOrders.tsx:2126` uses `fetchAllRows` to fetch all matching visits for patient search.
- `src/components/lab/LabOrders.tsx:2257` fetches all `visit_labs` for matching lab IDs across all dates when category/service search is active.
- `src/components/lab/LabOrders.tsx:2417` fetches paged `visit_labs` for the date-filtered default path.
- `src/components/lab/LabOrders.tsx:2516` fetches `lab_results` with `select('*')` by patient names.

Supporting helper:

- `src/utils/fetchAllRows.ts:10` uses a page size of `1000`.
- `src/utils/fetchAllRows.ts:11` allows up to `500` pages, meaning a bad filter can theoretically fetch up to `500,000` rows.

Safe first fix candidates:

- Require a date range or hard result limit for category/service searches.
- Narrow `lab_results` fields instead of `select('*')`.
- Add UI pagination before fetching all matching historical rows.

### 3. `PatientOverview.tsx` Can Load Very Large Patient Lists

High-risk examples:

- `src/pages/PatientOverview.tsx:193` uses `fetchAllRows` on `patients`.
- `src/pages/PatientOverview.tsx:197` selects all patient columns with nested visits.
- `src/pages/PatientOverview.tsx:247` fetches all patient `hospital_name` values just to build a hospital list.
- `src/pages/PatientOverview.tsx:262` reads `patient_call_records` with `select('*')`; date filters are optional.

Safe first fix candidates:

- Paginate the "All Patient" tab.
- Fetch only displayed patient columns.
- Replace all-patient hospital-name fetch with a small static config, cached lookup, or later a DB view/RPC after staging.
- Default call history to a date range.

### 4. `TodaysIpdDashboard.tsx` Uses Large Dashboard Reads

The dashboard has several good batching patterns, but it still has large read surfaces.

High-risk examples:

- `src/pages/TodaysIpdDashboard.tsx:1583` builds a large `visits` query with `*` and nested patient/referee/RM/diagnosis data.
- `src/pages/TodaysIpdDashboard.tsx:1634` uses `fetchAllRows`, so all matching IPD visits are paged in.
- `src/pages/TodaysIpdDashboard.tsx:1707`, `src/pages/TodaysIpdDashboard.tsx:1737`, `src/pages/TodaysIpdDashboard.tsx:1762`, and `src/pages/TodaysIpdDashboard.tsx:1781` batch related data, which is better than per-row queries but still adds several requests per dashboard load.
- `src/pages/TodaysIpdDashboard.tsx:2006` maps over every displayed visit and calls `checkReferralLetterUploaded(...)` for each visit.

Realtime cleanup looks correct:

- `src/pages/TodaysIpdDashboard.tsx:2027` creates the referral-letter realtime channel.
- `src/pages/TodaysIpdDashboard.tsx:2055` removes the channel on cleanup.

Safe first fix candidates:

- Replace per-visit referral-letter checks with one batch query against `patient_documents`.
- Narrow the `visits` select list instead of `*`.
- Add pagination or default date guards if dashboard result size is large.

### 5. `DischargeInvoice.tsx` Duplicates Service Reads

This screen appears safer to optimize than `FinalBill.tsx` because it is mostly read-only invoice display, but it is still billing-related and must be tested.

High-risk examples:

- `src/pages/DischargeInvoice.tsx:77` to `src/pages/DischargeInvoice.tsx:96` fetches all service category rows for financial totals.
- `src/pages/DischargeInvoice.tsx:153` to `src/pages/DischargeInvoice.tsx:161` fetches the same service category rows again for line items.

Safe first fix candidate:

- Fetch the six service-category tables once, then derive both totals and line items from the same cached query result.

### 6. Radiology/CT-MRI Screens Load Many Tables At Once

High-risk example:

- `src/pages/CTMRIModule.tsx:213` to `src/pages/CTMRIModule.tsx:225` runs 11 parallel queries on load, with 10 of them using `select('*')`.

Similar risk:

- `src/hooks/useRadiologyData.ts` also has 10 `select('*')` calls across radiology tables.

Safe first fix candidates:

- Lazy-load tab-specific data only when the tab is opened.
- Add date limits to order/report/appointment/history tables.
- Keep master tables cached longer.

### 7. Sidebar Counts Create Many Independent Count Queries

`src/hooks/useCounts.ts` runs many separate `count` queries:

- Diagnosis, patients, users, complications, surgery, lab, radiology, medication, referees, consultants, anesthetists, pending prescriptions, etc.
- `src/hooks/useCounts.ts:435` refetches pending prescriptions every 60 seconds.

This file already gates queries behind `enabled`, which is good. Still, if used broadly, it adds many requests after login.

Safe first fix candidates:

- Confirm `useCounts` is only mounted where count badges are visible.
- Increase stale time for master-data counts.
- Later, consider one Supabase RPC/view for all sidebar counts, but only after staging.

### 8. Polling Is Widespread

Static search found many `refetchInterval` uses, commonly every 60 seconds. Some are operationally justified, but every open browser tab multiplies this load.

Examples:

- `src/pages/QueueStatus.tsx` polls every 8 seconds in two queries.
- `src/pages/PaymentQR.tsx` polls every 15 seconds.
- `src/pages/BillApprovals.tsx` has multiple 60-120 second polling queries.
- `src/components/pharmacy/PrescriptionQueue.tsx` polls every 60 seconds.
- `src/pages/DischargedPatients.tsx` polls every 60 seconds.
- `src/pages/TodaysOpd.tsx`, `src/pages/SelfCheckIn.tsx`, `src/pages/PatientPortal.tsx`, and others also poll.

Safe first fix candidates:

- Disable polling when the tab/window is hidden.
- Poll only on screens that are actively open.
- Increase intervals for non-urgent report screens.
- Prefer realtime only where it is already well-scoped and cleaned up.

### 9. Realtime Subscriptions Mostly Have Cleanup

Realtime channels found:

| File | Channel | Cleanup |
| --- | --- | --- |
| `src/components/pharmacy/PharmacyDashboard.tsx` | `pharmacy-discount-approvals` | Uses `supabase.removeChannel(channel)` |
| `src/hooks/useCorporateData.ts` | dynamic corporate channel | Uses `corporateSubscription.unsubscribe()` |
| `src/hooks/usePendingPrescriptions.ts` | `prescription-changes` | Uses `supabaseAnon.removeChannel(channel)` |
| `src/pages/QueueDisplay.tsx` | `queue-display-live` | Uses `supabase.removeChannel(channel)` |
| `src/pages/TodaysIpdDashboard.tsx` | `referral-letter-changes` | Uses `supabase.removeChannel(channel)` |
| `src/components/tally/TallyCashBook.tsx` | `tally_vouchers_live_${companyId}` | Uses `supabase.removeChannel(channel)` |
| `src/components/tally/TallyLedgerView.tsx` | `ledger_view_${companyId}_${ledgerName}` | Uses `supabase.removeChannel(channel)` |

No obvious missing cleanup was found in this pass. The next check should be runtime: confirm channels are not duplicated after route changes.

### 10. Multiple Supabase Clients Make Auditing Harder

Supabase clients found:

- `src/integrations/supabase/client.ts`
- `src/integrations/supabase/data-client.ts`
- `src/utils/supabase-client.ts`

`data-client.ts` documents a reason for using an anon data client separately from auth. That may be valid, but the mixed usage makes request tracking, cache behavior, and auth/RLS behavior harder to reason about.

Safe first fix candidate:

- Do not consolidate clients immediately.
- Document which client should be used for auth, ordinary reads/writes, and special pharmacy/accounting flows.
- Only migrate usage after tests exist for the affected workflow.

## Safest First Optimization Candidates

### Candidate A: `DischargeInvoice.tsx` Duplicate Service Reads

Why this is safe:

- Mostly read-only.
- Clear duplication.
- No database changes required.

Expected benefit:

- Reduce repeated service-category reads for a single invoice load.

Manual tests:

- Open existing discharge invoice.
- Confirm totals match before/after.
- Confirm line item categories match before/after.
- Print/export if available.

### Candidate B: `FinalBill.tsx` Saved Service Detail Bulk Fetch

Why this is high impact:

- Final bill is the biggest Supabase caller.
- The lab/radiology/medication saved-data path has clear per-item detail queries.

Risk:

- Billing-critical. Must test carefully.

Expected benefit:

- Replace many per-item requests with three bulk `.in('id', ids)` reads.

Manual tests:

- Open final bill for existing IPD patient.
- Confirm saved lab/radiology/medicine rows show correct names, rates, and quantities.
- Add a new lab/radiology/medicine item.
- Save, reload, and print.
- Confirm bill totals do not change unexpectedly.

### Candidate C: `TodaysIpdDashboard.tsx` Referral Letter Status Batch

Why this is safe:

- Status display can be batch-fetched.
- Existing realtime cleanup is already present.

Expected benefit:

- Replace one request per visible visit with one batch request.

Manual tests:

- Open IPD dashboard.
- Confirm referral uploaded/not-uploaded indicators match before/after.
- Upload a referral letter.
- Confirm realtime update still works.

## What Not To Do Yet

Do not start with:

- Running SQL files from the repository.
- Changing RLS policies.
- Creating or replacing views/functions in production.
- Refactoring all Supabase clients.
- Rewriting `FinalBill.tsx`.
- Changing billing calculations without a before/after test case.

## Recommended Next Step

Before changing code, measure runtime on one target screen:

1. Open browser DevTools Network tab.
2. Clear network log.
3. Open `FinalBill` for one real test patient or staging patient.
4. Count Supabase requests during initial load.
5. Repeat after clicking the lab, radiology, medication, mandatory services, and clinical services areas.
6. Record the worst repeated request pattern.

If the runtime count confirms the static audit, the first code change should be either:

1. `DischargeInvoice.tsx`: remove duplicate service-table reads, or
2. `FinalBill.tsx`: bulk-fetch saved lab/radiology/medication details around lines `3140-3260`.

Both are frontend-only changes and do not require production database changes.
