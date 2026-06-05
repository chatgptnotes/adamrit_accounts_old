# Intake

## Trigger
- `POST /functions/v1/agent-patient-previsit` `{ appointment_id, language? }`
- Cron: 24 hours before any appointment marked `send_reminder: true`.

## Inputs assembled by the Edge Function
- Appointment: id, datetime, type (e.g. "MRI brain", "Cardiology consult", "Blood collection"), location, doctor name.
- Patient meta: first_name, age, language preference.
- Appointment type template: preparation_steps[], items_to_bring[], duration_estimate.

## What's NOT passed (de-identified out before LLM call)
- MRN, patient ID, full name, phone, email, address, DOB, ABHA, Aadhaar.

## Required for a draft
- Appointment must have a type that maps to a template. If not, escalate.

## Out of scope
- Appointment booking (separate flow).
- Medical questions from the patient (different agent / human).
