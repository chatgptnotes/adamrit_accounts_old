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
- Below surgery/package, show Surgeon Name, Anaesthetist Name, and Anesthesia Type.
- These three fields must auto-fill from Full Site PMJAY/MJPJAY Master tables using the selected package code/name:
  - `pmjay_mjpjay_packages.treatment_code` / `treatment_plan`
  - `pmjay_mjpjay_package_surgeons.surgeon_name`
  - `pmjay_mjpjay_package_anaesthetists.anaesthetist_name`
  - `pmjay_mjpjay_packages.anaesthesia_type`
- Save surgeon and anaesthetist to `ot_schedule.surgeon_name` and `ot_schedule.anesthetist_name`.
- Until a dedicated anesthesia column exists on `ot_schedule`, save Anesthesia Type in `ot_schedule.special_requirements` as `Anesthesia Type: ...`.
- Save to `ot_schedule`.
- Show the selected day's OT status list in the same tile.
- Status must display `Scheduled` or `Completed`; completion is read from `ot_schedule.status = completed` and should also treat a populated `visits.surgery_date` as completed for older/backfilled rows.
- Gaurav should not need to open the Sarvesh tile to know whether OT is finished.

Sarvesh tile:

- View daily OT schedule.
- Mark surgery as done.
- Capture/upload OT photos.
- When OT photos are uploaded, automatically consider surgery done.
- Mark Done and OT photo upload both update `ot_schedule.status = completed`, set completion timestamps, and update `visits.surgery_date`.
- Display Implant Bill and Implant Sticker from the Implant tab inside the OT Photos screen by reading `file_uploads.category = implant_invoice` and `file_uploads.category = implant_sticker`.
- If the Implant Bill or Implant Sticker exists, show the latest uploaded document. If missing, show Upload and Capture options in Sarvesh OT Photos.
- Implant document panels must use the same `file_uploads` categories as the Implant tab so later changes in the Implant tab automatically reflect in OT Photos after query refresh.

## Data Effects

- Completed schedule rows should set `ot_schedule.status = completed`.
- Completion should set `actual_end_time` or equivalent completion timestamp.
- Completion/photo upload should update `visits.surgery_date` when possible so downstream reports can detect operated patients.
- OT photos use `file_uploads.category = ot_photos`.
- Implant Bill uses `file_uploads.category = implant_invoice`.
- Implant Sticker uses `file_uploads.category = implant_sticker`.

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
