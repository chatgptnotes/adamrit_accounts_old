# Corporate Claim Tracking — Work Log

**Project:** Adamrit HMIS  
**Work period:** Approximately 7–10 August 2026  
**Scope:** Local implementation only. No commit, push, deployment, production migration, or existing HMIS data modification was performed during this work session.

## Objective

Create a safe, auditable PMJAY/MJPJAY corporate-claim tracking module that reads government portal exports, displays the actual patient-level rows, tracks claim stages and payments, and keeps all existing HMIS records isolated and untouched.

## Source data used

The portal snapshot was supplied from `E:\pdfanddocs\corporateadam` and contains six files:

| Portal file/stage | Rows |
|---|---:|
| Under Treatment | 52 |
| Claims To Be Submitted | 100 |
| Claims Sent To Bank | 15 |
| Pending With Payer | 199 |
| Claims Approved From Bank — Payment Initiated | 1 |
| Claims Approved From Bank — Payment Accomplished | 180 |
| Claims Rejected | 6 |
| **Total** | **553** |

The dashboard total of 553 is the sum of those parsed source rows. The stage totals are not invented. The displayed paid total is calculated by summing the parsed `Claim Paid Amount` values from the payment-accomplished rows. It is a source-file calculation, not an independently verified bank reconciliation. It should be treated as a portal-reported amount until the source values are checked and the import is saved in the tracking database.

## Phase 1 completed

- Added a standalone route: `/corporate-claim-tracking`.
- Added Billing & Accounts sidebar access and dashboard access links.
- Added PMJAY and MJPJAY tabs so the schemes are visually separated.
- Added browser parsing for caret-delimited CSV plus XLS/XLSX files.
- Added validation for required identifiers, names, hospital, dates, and amounts.
- Added patient-level preview tables instead of showing only summary numbers.
- Added stage filters for all six portal stages.
- Added search by patient, Registration ID, Program ID, UTR, and status.
- Added an additive migration defining ten isolated tracking tables:
  1. Import batches
  2. Source files
  3. Imported rows
  4. Claims
  5. Status history
  6. Payment transactions
  7. Queries
  8. Match decisions
  9. Review items
  10. Audit events
- Added a controlled import Edge Function intended to write only those new tracking tables.
- Existing patients, visits, bills, payments, portal-import tables, and unrelated modules were not designed to be updated by this feature.

## Phase 2 implemented locally

- Reworked the page into an operational dashboard/worklist.
- Added separate PMJAY and MJPJAY dashboard scopes.
- Added cards for total claims, every portal stage, paid total, and review count.
- Added Claims, Payments, Queries & Rejections, and Review Worklist views.
- Added search and stage filtering for claim rows.
- Added a claim-detail dialog with:
  - Patient and government IDs
  - Claim, approved, and paid amounts
  - Payment state, UTR, payment date, TDS, and RF
  - Portal status history
  - Payment transaction history
  - Queries and review items
- Added role protection so Super Admin, Admin, and Billing are the operational claim-review roles.
- Added a second controlled workflow Edge Function for review resolution and query notes.
- Added strict scheme detection:
  - `PJ...` Program ID → PMJAY
  - `MJ...` Program ID → MJPJAY
  - Other prefixes → `UNRESOLVED` review state
- Added exact-identifier matching logic. A claim is auto-linked only when one exact HMIS candidate is found; ambiguous or missing matches remain for review.
- Added immediate local preview fallback so patient rows appear as soon as files are selected, even when the local database is unavailable.
- Added duplicate-file protection based on file content fingerprint, not filename. Renaming the same file does not create a second import.
- Duplicate checking occurs before a new import batch is created.

## Safety rules followed

- No `DELETE`, `DROP`, `TRUNCATE`, reset, or destructive database command was used.
- No existing HMIS table was altered by the claim-tracking migration.
- No existing patient, visit, bill, payment, or portal-import row was updated.
- Existing unrelated working-tree changes were preserved.
- Production was not deployed to.
- No commit or push was performed for this local Phase 2 work.

## Files added or changed for this feature

- `src/pages/CorporateClaimTracking.tsx`
- `src/lib/corporateClaimTracking.ts`
- `supabase/functions/corporate-claim-import/index.ts`
- `supabase/functions/corporate-claim-workflow/index.ts`
- `supabase/migrations/20260808120000_create_corporate_claim_tracking.sql`

## Verification performed

- Corporate claim parser acceptance was previously checked against all six supplied files and produced 553 valid source rows.
- `npm run build` passed locally, including the project’s protected-file checks.
- The build emitted pre-existing warnings from unrelated modules and large chunks.
- Repository-wide `npm run typecheck` remains blocked by existing/baseline errors in unrelated pages; no Corporate Claim Tracking error was reported in the feature files.
- Local Supabase status could not be started because Docker was unavailable.

## Current limitation

The browser preview works without a database. Permanent dashboard data, saved history, matching records, payment records, review actions, and duplicate persistence require the new tracking migration and Edge Functions to be run in a local/test Supabase environment. Docker must be available before applying the migration locally.

Until then, selecting the files again is expected after a browser refresh; the preview is local browser state and is not permanent database storage.

## Recommended next steps

1. Start Docker Desktop and the local Supabase stack.
2. Apply only the new corporate-claim tracking migration to the local/test database.
3. Serve the two claim Edge Functions locally.
4. Import the six files and verify saved dashboard totals against the source files.
5. Test duplicate upload, PMJAY/MJPJAY separation, unresolved IDs, exact matching, review permissions, payment totals, and audit history.
6. Review the local result before deciding whether to commit or push.

## Complete three-phase roadmap

### Phase 1 — Safe foundation and import

Phase 1 establishes an isolated claim-tracking area. It accepts the six government portal exports, validates their layouts and values, identifies the portal stage, previews patient-level rows, and records source-file identity. The import layer is additive and auditable. It does not replace the existing Corporate Scheme module and does not write to existing HMIS records.

### Phase 2 — Operations and follow-up

Phase 2 converts the preview into an operational workspace. Each scheme has its own tab and data scope so PMJAY and MJPJAY counts, patients, payments, and review items cannot be accidentally mixed. The workspace provides dashboard cards, stage worklists, search, claim details, payment details, query/rejection follow-up, duplicate protection, safe exact matching, review handling, and role-controlled actions.

### Phase 3 — Reports, reconciliation, and hardening

Phase 3 is planned for after the local Phase 2 review:

- Add downloadable CSV/XLSX reports for claims by scheme, stage, date range, hospital, payment state, rejection, query, and review status.
- Add a reconciliation report comparing claimed, approved, paid, TDS, RF, and outstanding amounts, with source-file and report-date references.
- Add payment/UTR reconciliation tools that flag missing UTRs, duplicate UTRs, partial payments, amount differences, and payment rows that do not tie to a claim.
- Add management summaries for ageing claims, pending-with-payer ageing, rejection trends, query ageing, approval-to-payment time, and scheme-wise totals.
- Add a source-import history screen showing every file, content fingerprint, report date, row counts, validation result, duplicate decision, and importing user.
- Add print-friendly claim detail and review/audit reports without exposing unrelated HMIS data.
- Add pagination and server-side filtering for large claim volumes instead of loading all rows into the browser.
- Add stronger database indexes and query performance checks only on the new tracking tables.
- Add automated tests for all six file layouts, duplicate uploads, renamed duplicate files, malformed rows, scheme conflicts, unresolved IDs, exact matching, role permissions, payment totals, and audit events.
- Add local/test rollback and recovery documentation without using destructive commands. Any production rollout would require explicit review and authorization.
- Complete a security review of RLS, Edge Function authentication, role checks, audit completeness, and sensitive-data exposure before production use.
- Produce a final acceptance checklist for Billing, Admin, and Super Admin users.

## Decisions agreed for the module

### Separate schemes

PMJAY and MJPJAY are separate views inside one module, not two unrelated pages. A user can switch tabs, but the claims, stage cards, payments, reviews, and totals are filtered to the selected scheme. This prevents a PMJAY payment from appearing in an MJPJAY total.

### Government identifiers

The strict scheme rule is based on the normalized Program ID prefix. `PJ` means PMJAY and `MJ` means MJPJAY. An identifier such as `MH0P65RZS` does not match either prefix and must remain unresolved for review; it must never be silently classified.

### Duplicate imports

The same file content must be shown only once. The system fingerprints the normalized file content rather than relying on the filename. Uploading the same file again, even after renaming it, skips the duplicate and shows the existing import result. Duplicate source rows and duplicate payment transactions are also protected by fingerprints.

### Matching policy

Matching is read-only against existing HMIS data. A claim may auto-link only when exactly one exact identifier candidate is found. Missing, conflicting, or multiple candidates remain in Review. A match never edits the patient, visit, bill, or payment row in HMIS.

### Permissions

All logged-in users may view permitted tracking data according to application access. Only Super Admin, Admin, and Billing users may resolve review items or add/resolve claim-query workflow actions. Every controlled action records the actor and an audit event.

### Database choice

The ten-table design was retained because imports, source files, rows, claims, histories, payments, queries, match decisions, review items, and audit events have different lifecycles and audit requirements. Combining them into one or two tables would make source lineage, repeated status changes, payment reconciliation, and review history harder to protect and report.

### What the dashboard numbers mean

The stage counts come from the six parsed portal files. In the supplied snapshot, 52 + 100 + 15 + 199 + 1 + 180 + 6 = 553 rows. The paid total is a real arithmetic sum of the parsed `Claim Paid Amount` field for payment-accomplished rows; it is not a decorative number. It is still only as reliable as the government export until the source values are independently reconciled against bank records.

### Safety boundary

The module is intentionally separate from existing HMIS workflows. No destructive SQL is allowed. No existing table is altered by the tracking migration. No existing patient, visit, bill, payment, or portal-import data is deleted or overwritten. Production deployment and production migration require a separate explicit decision after local acceptance.

## Phase 3 acceptance criteria

Phase 3 will be considered complete only when:

- PMJAY and MJPJAY reports reconcile independently.
- Exported totals can be traced to source files, rows, and report dates.
- Duplicate imports do not change claim, payment, or dashboard totals.
- Payment reconciliation identifies amount/UTR discrepancies without modifying HMIS payments.
- Review, query, and audit reports identify who changed what and when.
- Large datasets remain usable with server-side pagination and filtering.
- All checks pass in local/test first, with no destructive migration or production action.
