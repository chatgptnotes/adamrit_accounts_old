---
name: adamrit-patient-document-reports
description: Use when implementing, debugging, or reviewing Adamrit HMIS report-tab patient document reports, including document status filters, document type filters, pending/completed document display, printability after filtering, and report navigation.
---

# Adamrit Patient Document Reports

## Core Files

- `src/pages/PatientDocumentsReport.tsx`: existing patient documents report.
- `src/pages/YojanaBillingTodoDocumentsReport.tsx`: current billing-focused Yojana patient document todo report.
- `src/pages/ReportsCenter.tsx`: reports-section navigation.

## Filter Rules

Status and document type filters must always work together.

- `All documents` + no document type: show both completed and pending documents.
- `All documents` + document type: show the selected type whether completed or pending.
- `Pending documents` + no document type: show only pending documents.
- `Pending documents` + document type: show only patients where that selected document type is pending, and display only that pending document in the pending column.
- `Completed documents` + no document type: show only completed documents.
- `Completed documents` + document type: show only patients where that selected document type is completed, and display only that completed document in the completed column.

Avoid showing all documents after the status filter changes; the visible chips/lists must reflect the active filter combination.

## Print Behavior

Filtered report output should be printable. Use existing print patterns (`window.print()` or a report-specific print window) and make sure print CSS does not include unrelated navigation/toolbars unless the existing report pattern does so.

## Verification

Run:

```bash
npm run typecheck
npm run build
```

Smoke-test combinations:

- Pending + Discharge Summary.
- Completed + Discharge Summary.
- All + Discharge Summary.
- Pending with no type.
- Clear filters returns unfiltered report.
