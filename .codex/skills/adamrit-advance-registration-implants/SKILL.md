---
name: adamrit-advance-registration-implants
description: Use when implementing, debugging, or reviewing Adamrit HMIS Advance Statement Arshiya registration and implant behavior, especially Yojana Registration ID, package name/code auto-population, package master updates, implant search/add, and consistency with the Advance Statement Report.
---

# Adamrit Advance Registration And Implants

## Core Files

- `src/tablet/modules/advance/AdvanceFlow.tsx`: tablet Arshiya patient picker and Registration & implants screen.
- `src/pages/AdvanceStatementReport.tsx`: desktop/report-side registration, package, and code consistency.
- `src/tablet/config/modules.ts`, `src/tablet/screens/TabletModuleHost.tsx`, `src/config/tileAccess.ts`: tile routing and access if adding/removing tablet modules.

## Expected Behavior

- When a patient visit is opened, fetch saved `yojana_registration_id`, `package_code`, and `package_name` from `visits`.
- Show saved registration/package fields without requiring manual re-entry.
- Let users edit only when details need correction.
- Patient search should include patient name, patient ID, phone, visit number, registration ID, package code, and package name.
- Saving an existing package from search should update the current visit.
- Creating a package should tolerate existing master rows and still save the package code/name to the current visit.
- The same registration ID, package name, and package code must display consistently in Tablet View and `AdvanceStatementReport`.

## Data Notes

- Package master table: `pmjay_mjpjay_packages`.
- Visit fields: `visits.yojana_registration_id`, `visits.package_code`, `visits.package_name`.
- Implant additions are stored separately; keep visible selected implants and approved/amount values aligned with existing schema usage in `AdvanceFlow.tsx`.

## Verification

Run:

```bash
npm run typecheck
npm run build
```

Smoke-test:

- Open `/advance` in tablet mode.
- Select a Yojana/IPD patient.
- Confirm Registration & implants shows existing registration ID and package code/name.
- Update package by selecting from search and verify the displayed saved package changes.
- Check `AdvanceStatementReport` still displays matching package name/code.
