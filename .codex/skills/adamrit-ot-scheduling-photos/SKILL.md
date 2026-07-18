---
name: adamrit-ot-scheduling-photos
description: Use when implementing, debugging, or reviewing Adamrit HMIS tablet OT scheduling and OT photo workflows, including Dr. Gaurav scheduling, Sarvesh completion, surgery done status, OT photo upload/capture, and operated-case report integration.
---

# Adamrit OT Scheduling Photos

## Core Files

- `src/tablet/modules/ot-schedule/OtScheduleFlow.tsx`: shared tablet flow for scheduling and photo completion.
- `src/tablet/config/modules.ts`: tablet tiles for Gaurav schedule and Sarvesh photos.
- `src/tablet/screens/TabletModuleHost.tsx`: route host mapping.
- `src/config/tileAccess.ts`: tile access keys.
- `src/pages/YojanaBillingTodoDocumentsReport.tsx`: operated-section consumption.

## Expected Workflow

Gaurav tile:

- Search IPD/Emergency patient visits.
- Select patient.
- Add surgery/package name, date, time, and OT room.
- Save to `ot_schedule`.

Sarvesh tile:

- View daily OT schedule.
- Mark surgery as done.
- Capture/upload OT photos.
- When OT photos are uploaded, automatically consider surgery done.

## Data Effects

- Completed schedule rows should set `ot_schedule.status = completed`.
- Completion should set `actual_end_time` or equivalent completion timestamp.
- Completion/photo upload should update `visits.surgery_date` when possible so downstream reports can detect operated patients.
- OT photos use `file_uploads.category = ot_photos`.

## Report Integration

The Yojana billing todo operated section should include completed OT schedule rows and recent `ot_photos`, not only older surgery fields.

## Verification

Run:

```bash
npm run typecheck
npm run build
```

Smoke-test:

- Open the Gaurav schedule tile and confirm patient search/schedule save UI renders.
- Open the Sarvesh OT photos tile and confirm scheduled cases render.
- Confirm marking done or uploading photos makes the case eligible for the operated section in the Yojana billing todo report.
