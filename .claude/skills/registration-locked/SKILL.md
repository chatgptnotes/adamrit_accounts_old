---
name: Registration forms are locked
description: The patient and visit registration forms (VisitRegistrationForm, VisitDetailsSection, VisitFormActions, PatientRegistrationForm/usePatientRegistration, PatientRegistrationForm/PatientInfoSection, tablet RegisterPatientFlow) are frozen. Do NOT change their fields, validation, required-field rules, submit handlers or insert payloads unless the user explicitly asks to change patient or visit registration.
source_project: adamrit
tags: [project-lock, frozen-page, registration, admission, do-not-touch]
---

# Registration forms are locked

## The Rule

These files are frozen. Do not edit, refactor, "clean up", or add validation
to them unless the user explicitly authorises a change to patient/visit
registration:

- `src/components/VisitRegistrationForm.tsx`
- `src/components/visit/VisitDetailsSection.tsx`
- `src/components/visit/VisitFormActions.tsx`
- `src/components/PatientRegistrationForm/usePatientRegistration.ts`
- `src/components/PatientRegistrationForm/PatientInfoSection.tsx`
- `src/tablet/modules/register/RegisterPatientFlow.tsx`

A `prebuild` guard (`scripts/check-registration-locked.cjs`) SHA256-checks all
six and fails `npm run build` on any change, so an accidental edit cannot
reach production.

## Why

Registration is the front door of the hospital. On 2026-08-04 a newly required
field — a Yojana registration ID that the government portal only issues per
IPD case — made OPD registration impossible for panel patients. The form could
not be submitted at all, and it stayed broken in production until the owner
reported it the next morning. The data gap that change was meant to close was
worth far less than the registrations it blocked.

## If a change IS authorised

1. Confirm with the owner that registration should change.
2. Check the change against **every entry point**: `VisitRegistrationForm` is
   rendered from Patient Dashboard, Today's IPD, the OPD patient table,
   Casualty (`AddEmergencyPatientDialog`) and the Dialysis dashboard.
3. Check **every visit type** — OPD, IPD, IPD (Inpatient), Emergency,
   Dialysis. A required field must be visible wherever it is required, and
   must never be required where the data cannot exist yet.
4. Exercise the actual submit path for OPD *and* IPD before shipping.
5. Deploy: `REGISTRATION_UNLOCK=1 npm run build`, then
   `node scripts/check-registration-locked.cjs --update-baseline`, and commit
   `scripts/registration-baseline.json` with the change.

## Related

`.claude/skills/finalbill-locked/SKILL.md` — the same mechanism guards
`src/pages/FinalBill.tsx`.
