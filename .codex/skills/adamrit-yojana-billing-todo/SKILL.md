---
name: adamrit-yojana-billing-todo
description: Use when implementing, debugging, or reviewing the Adamrit HMIS "To-do list for billing of Yojana patients today" report, especially admitted/discharged/operated/extension sections, last-48-hours logic, Yojana filtering, document completeness, and operated-case sourcing from OT schedules/photos.
---

# Adamrit Yojana Billing Todo

## Core Files

- `src/pages/YojanaBillingTodoDocumentsReport.tsx`: report data loading, grouping, document status, print/export UI.
- `src/pages/ReportsCenter.tsx`: report entry point.
- `src/tablet/modules/ot-schedule/OtScheduleFlow.tsx`: source of completed OT schedule/photos used by operated section.

## Required Sections

The report title is `To-do list for billing of Yojana patients today`.

Show four sections:

- Admitted in last 48 hours.
- Discharged in last 48 hours.
- Operated in last 48 hours.
- Extension to be taken and not taken in the last 48 hours.

Use clear section totals and patient rows. Keep the report focused on Yojana/Ayushman/MJPJAY patients.

## Operated Section

The operated section should not rely only on legacy visit surgery fields. Include cases from:

- `visits.surgery_date` inside the last 48 hours.
- completed `ot_schedule` rows with `actual_end_time`, `updated_at`, or `scheduled_date` in the window.
- `file_uploads` with category `ot_photos` in the last 48 hours, mapped to the latest matching IPD Yojana visit when needed.

## Document Status

Use the same document completeness definitions as the patient documents report where possible. Avoid duplicated document-name mappings that can drift.

## Verification

Run:

```bash
npm run typecheck
npm run build
```

Smoke-test:

- Open `/yojana-billing-todo-documents-report`.
- Confirm all four sections render.
- Confirm operated count is not blank when completed OT schedules/photos exist.
- Confirm print button still works.
